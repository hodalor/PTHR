import { toNumberValue } from '../../utils/number';
import { resolveEmployeeKey } from '../../utils/employeeSearch';

const normalizeAttendanceClockings = (row) => {
  if (!row) {
    return [];
  }
  if (Array.isArray(row.clockings) && row.clockings.length > 0) {
    return row.clockings
      .map((clocking) => ({
        mode: clocking.mode === 'clock-out' ? 'clock-out' : 'clock-in',
        time: String(clocking.time || '').trim(),
      }))
      .filter((clocking) => /^\d{2}:\d{2}$/.test(clocking.time))
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  }
  const fallback = [];
  if (row.checkIn) {
    fallback.push({ mode: 'clock-in', time: String(row.checkIn) });
  }
  if (row.checkOut) {
    fallback.push({ mode: 'clock-out', time: String(row.checkOut) });
  }
  return fallback.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
};

const getAttendanceClockSummary = (row) => {
  const clockings = normalizeAttendanceClockings(row);
  const firstClockIn = clockings.find((clocking) => clocking.mode === 'clock-in') || null;
  const lastClockOut = [...clockings].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
  return {
    checkIn: firstClockIn?.time || '',
    checkOut: lastClockOut?.time || '',
  };
};

export const enhancePayrollRows = ({
  baseRows,
  moduleRowsState,
  appSettings,
  getTodayIsoDate,
  getCurrentClockValue,
  toMinutesFromClock,
  getMinutesBetweenClocks,
  isLoanCountableRecord,
}) => {
  const employeeRows = moduleRowsState['employee-management'] || [];
  const attendanceTimeRows = moduleRowsState['attendance-time'] || [];
  const leaveRows = moduleRowsState['leave-management'] || [];
  const penaltyAdjustmentRows = moduleRowsState['attendance-penalty-adjustments'] || [];
  const loanRows = moduleRowsState['loan-records'] || [];
  const lateMinutesByEmployee = attendanceTimeRows.reduce((acc, attendanceRow) => {
    const key = resolveEmployeeKey(employeeRows, attendanceRow.employeeId, attendanceRow.employee);
    if (!key) {
      return acc;
    }
    const minutes = Math.max(0, Number(attendanceRow.lateMinutes) || 0);
    acc[key] = (acc[key] || 0) + minutes;
    return acc;
  }, {});
  const lateDeductionByEmployee = attendanceTimeRows.reduce((acc, attendanceRow) => {
    const key = resolveEmployeeKey(employeeRows, attendanceRow.employeeId, attendanceRow.employee);
    if (!key) {
      return acc;
    }
    const amount = Math.max(0, toNumberValue(attendanceRow.deductionAmount));
    acc[key] = (acc[key] || 0) + amount;
    return acc;
  }, {});
  const nowDate = getTodayIsoDate();
  const nowMinutes = toMinutesFromClock(getCurrentClockValue()) || 0;
  const shiftEndMinutes = toMinutesFromClock(appSettings.attendanceShiftEnd) ?? 0;
  const noClockInPenaltyByEmployee = {};
  const noClockOutPenaltyByEmployee = {};
  const absentPenaltyByEmployee = {};
  attendanceTimeRows.forEach((attendanceRow) => {
    const key = resolveEmployeeKey(employeeRows, attendanceRow.employeeId, attendanceRow.employee);
    const matchedEmployee = employeeRows.find((employeeRow) => String(employeeRow.id || '').trim() === key) || null;
    if (!key) {
      return;
    }
    const currentDate = String(attendanceRow.date || '');
    const isPastDate = currentDate < nowDate;
    const isNoonReached = isPastDate || (currentDate === nowDate && nowMinutes >= 12 * 60);
    const isClockOutDeadlineReached = isPastDate;
    const leaveMatch = leaveRows.find((leaveRow) => {
      const leaveEmployeeKey = resolveEmployeeKey(employeeRows, leaveRow.employeeId, leaveRow.employee);
      const leaveStatus = String(leaveRow.status || '').toLowerCase();
      return (
        leaveEmployeeKey === key &&
        (leaveStatus === 'approved' || leaveStatus === 'active') &&
        String(leaveRow.startDate || '') <= currentDate &&
        String(leaveRow.endDate || '') >= currentDate
      );
    });
    const employeeStatus = String(matchedEmployee?.status || '').toLowerCase();
    const employeeStage = String(matchedEmployee?.employmentState || '').toLowerCase();
    const isOffDuty = employeeStatus !== 'active' || employeeStage === 'terminated' || employeeStage === 'suspended';
    const isExempt = isOffDuty || Boolean(leaveMatch);
    if (isExempt) {
      return;
    }
    const attendanceSummary = getAttendanceClockSummary(attendanceRow);
    const checkInMinutes = toMinutesFromClock(attendanceSummary.checkIn);
    const rawCheckOut = String(attendanceSummary.checkOut || '');
    const hasClockOut =
      rawCheckOut !== '00:00' &&
      rawCheckOut !== '24:00' &&
      toMinutesFromClock(attendanceSummary.checkOut) !== null &&
      toMinutesFromClock(attendanceSummary.checkOut) > (checkInMinutes ?? 0);
    const missingClockIn = checkInMinutes === null && isNoonReached;
    const missingClockOut = !hasClockOut && isClockOutDeadlineReached;
    const missingCount = Number(missingClockIn) + Number(missingClockOut);
    const payrollForEmployee =
      baseRows.find((payrollRow) => String(payrollRow.employeeId || '').trim() === key) ||
      baseRows.find((payrollRow) => resolveEmployeeKey(employeeRows, payrollRow.employeeId, payrollRow.employee) === key);
    const basicPay = toNumberValue(payrollForEmployee?.basicPay || matchedEmployee?.basicPay);
    const workingDays = Math.max(
      1,
      Number(payrollForEmployee?.workingDays || matchedEmployee?.workingDays || appSettings.payrollWorkingDays) || 1
    );
    const dailyWage = basicPay > 0 ? basicPay / workingDays : 0;
    if (missingCount >= 2) {
      absentPenaltyByEmployee[key] = (absentPenaltyByEmployee[key] || 0) + dailyWage;
    } else if (missingClockIn) {
      noClockInPenaltyByEmployee[key] = (noClockInPenaltyByEmployee[key] || 0) + dailyWage / 2;
    } else if (missingClockOut) {
      noClockOutPenaltyByEmployee[key] = (noClockOutPenaltyByEmployee[key] || 0) + dailyWage / 2;
    }
    if (checkInMinutes !== null && hasClockOut && shiftEndMinutes > 0) {
      const checkOutMinutes = toMinutesFromClock(attendanceSummary.checkOut) || 0;
      if (checkOutMinutes < shiftEndMinutes) {
        noClockOutPenaltyByEmployee[key] = noClockOutPenaltyByEmployee[key] || 0;
      }
    }
  });
  const clearedByPenaltyAndEmployee = penaltyAdjustmentRows.reduce((acc, row) => {
    const key = `${String(row.employeeId || '').trim()}|${String(row.penaltyType || '').trim()}`;
    acc[key] = (acc[key] || 0) + toNumberValue(row.clearedAmount);
    return acc;
  }, {});
  const loanSummaryByEmployee = loanRows.reduce((acc, loanRow) => {
    const employeeId = String(loanRow.employeeId || '').trim();
    const employeeName = String(loanRow.employee || '').trim();
    if (!employeeId && !employeeName) {
      return acc;
    }
    const matchedEmployee =
      employeeRows.find((employeeRow) => String(employeeRow.id || '').trim() === employeeId) ||
      employeeRows.find((employeeRow) => String(employeeRow.fullName || '').trim() === employeeName);
    const key = String(matchedEmployee?.id || employeeId || employeeName);
    if (!key) {
      return acc;
    }
    const isActive = isLoanCountableRecord(loanRow);
    const balance = toNumberValue(loanRow.balance || loanRow.amount);
    const current = acc[key] || {
      totalBalance: 0,
      activeCount: 0,
      totalCount: 0,
    };
    const next = {
      totalBalance: current.totalBalance + (isActive ? balance : 0),
      activeCount: current.activeCount + (isActive ? 1 : 0),
      totalCount: current.totalCount + (isActive ? 1 : 0),
    };
    acc[key] = next;
    return acc;
  }, {});
  const scheduledMinutes = Math.max(1, getMinutesBetweenClocks(appSettings.attendanceReportTime, appSettings.attendanceShiftEnd));
  return baseRows.map((payrollRow) => {
    const payrollEmployeeId = String(payrollRow.employeeId || '').trim();
    const payrollEmployeeName = String(payrollRow.employee || '').trim();
    const key = resolveEmployeeKey(employeeRows, payrollEmployeeId, payrollEmployeeName);
    const matchedEmployee = employeeRows.find((employeeRow) => String(employeeRow.id || '').trim() === key) || null;
    const lateMinutes = lateMinutesByEmployee[key] || 0;
    const basicPay = toNumberValue(payrollRow.basicPay);
    const workingDays = Math.max(1, Number(payrollRow.workingDays || appSettings.payrollWorkingDays) || 1);
    const autoMinuteRate = basicPay > 0 ? basicPay / workingDays / scheduledMinutes : 0;
    const fixedMinuteRate = Math.max(0, Number(appSettings.attendanceFixedDeductionPerMinute) || 0);
    const fixedScope = String(appSettings.attendanceFixedScope || 'all');
    const fixedApplies =
      fixedScope === 'all' ||
      (fixedScope === 'department' && String(matchedEmployee?.department || '') === String(appSettings.attendanceFixedDepartment || '')) ||
      (fixedScope === 'individual' &&
        String(matchedEmployee?.id || payrollEmployeeId || '') === String(appSettings.attendanceFixedEmployeeId || ''));
    const minuteRate = appSettings.attendanceCalculationMode === 'fixed' && fixedApplies ? fixedMinuteRate : autoMinuteRate;
    const lateDeduction = lateDeductionByEmployee[key] > 0 ? lateDeductionByEmployee[key] : lateMinutes * minuteRate;
    const noClockInPenalty = noClockInPenaltyByEmployee[key] || 0;
    const noClockOutPenalty = noClockOutPenaltyByEmployee[key] || 0;
    const absentPenalty = absentPenaltyByEmployee[key] || 0;
    const lateClearance = clearedByPenaltyAndEmployee[`${key}|lateness`] || 0;
    const noClockInClearance = clearedByPenaltyAndEmployee[`${key}|no-clock-in`] || 0;
    const noClockOutClearance = clearedByPenaltyAndEmployee[`${key}|no-clock-out`] || 0;
    const absentClearance = clearedByPenaltyAndEmployee[`${key}|absent`] || 0;
    const netLateDeduction = Math.max(0, lateDeduction - lateClearance);
    const netNoClockInPenalty = Math.max(0, noClockInPenalty - noClockInClearance);
    const netNoClockOutPenalty = Math.max(0, noClockOutPenalty - noClockOutClearance);
    const netAbsentPenalty = Math.max(0, absentPenalty - absentClearance);
    const totalAttendancePenalty = netLateDeduction + netNoClockInPenalty + netNoClockOutPenalty + netAbsentPenalty;
    const loanSummary = loanSummaryByEmployee[key] || {
      totalBalance: 0,
      activeCount: 0,
      totalCount: 0,
    };
    const loanSummaryLabel =
      loanSummary.activeCount > 0 ? `${loanSummary.activeCount} loan(s) • bal ${loanSummary.totalBalance.toFixed(2)}` : '';
    return {
      ...payrollRow,
      lateMinutes: String(lateMinutes),
      deductionRatePerMinute: minuteRate.toFixed(3),
      lateDeduction: netLateDeduction.toFixed(2),
      noClockInPenalty: netNoClockInPenalty.toFixed(2),
      noClockOutPenalty: netNoClockOutPenalty.toFixed(2),
      absentPenalty: netAbsentPenalty.toFixed(2),
      totalAttendancePenalty: totalAttendancePenalty.toFixed(2),
      payableAfterLate: Math.max(0, basicPay - totalAttendancePenalty).toFixed(2),
      loanSummary: loanSummaryLabel,
      loanCount: String(loanSummary.activeCount || 0),
      loanBalance: loanSummary.totalBalance ? loanSummary.totalBalance.toFixed(2) : '',
    };
  });
};
