import { toNumberValue } from '../../utils/number';
import { resolveEmployeeKey } from '../../utils/employeeSearch';

const ATTENDANCE_DAY_RULE_META = [
  { key: 'monday', defaultEnabled: true },
  { key: 'tuesday', defaultEnabled: true },
  { key: 'wednesday', defaultEnabled: true },
  { key: 'thursday', defaultEnabled: true },
  { key: 'friday', defaultEnabled: true },
  { key: 'saturday', defaultEnabled: false },
  { key: 'sunday', defaultEnabled: false },
  { key: 'holiday', defaultEnabled: false },
];

const parseHolidayDateList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  }
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => String(item || '').trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
};

const buildDefaultShiftDayRules = (base = {}) =>
  ATTENDANCE_DAY_RULE_META.reduce((accumulator, meta) => {
    accumulator[meta.key] = {
      enabled: meta.defaultEnabled,
      reportTime: String(base.reportTime || '08:00').trim(),
      shiftEnd: String(base.shiftEnd || '17:00').trim(),
      graceInMinutes: Math.max(0, Number(base.graceInMinutes) || 0),
      graceOutMinutes: Math.max(0, Number(base.graceOutMinutes) || 0),
      overtimeEnabled: Boolean(base.overtimeEnabled),
      overtimeStartAfterMinutes: Math.max(0, Number(base.overtimeStartAfterMinutes) || 0),
      overtimePayPerMinute: Math.max(0, Number(base.overtimePayPerMinute) || 0),
    };
    return accumulator;
  }, {});

const normalizeShiftDayRules = (dayRules, base = {}) =>
  ATTENDANCE_DAY_RULE_META.reduce((accumulator, meta) => {
    const source = dayRules?.[meta.key] || {};
    accumulator[meta.key] = {
      enabled: source.enabled === undefined ? meta.defaultEnabled : Boolean(source.enabled),
      reportTime: String(source.reportTime || base.reportTime || '08:00').trim(),
      shiftEnd: String(source.shiftEnd || base.shiftEnd || '17:00').trim(),
      graceInMinutes:
        source.graceInMinutes === undefined
          ? Math.max(0, Number(base.graceInMinutes) || 0)
          : Math.max(0, Number(source.graceInMinutes) || 0),
      graceOutMinutes:
        source.graceOutMinutes === undefined
          ? Math.max(0, Number(base.graceOutMinutes) || 0)
          : Math.max(0, Number(source.graceOutMinutes) || 0),
      overtimeEnabled:
        source.overtimeEnabled === undefined ? Boolean(base.overtimeEnabled) : Boolean(source.overtimeEnabled),
      overtimeStartAfterMinutes:
        source.overtimeStartAfterMinutes === undefined
          ? Math.max(0, Number(base.overtimeStartAfterMinutes) || 0)
          : Math.max(0, Number(source.overtimeStartAfterMinutes) || 0),
      overtimePayPerMinute:
        source.overtimePayPerMinute === undefined
          ? Math.max(0, Number(base.overtimePayPerMinute) || 0)
          : Math.max(0, Number(source.overtimePayPerMinute) || 0),
    };
    return accumulator;
  }, {});

const getAttendanceDayRuleKey = (dateValue, holidayDates = []) => {
  const normalizedDate = String(dateValue || '').trim();
  if (normalizedDate && holidayDates.includes(normalizedDate)) {
    return 'holiday';
  }
  const parsed = new Date(`${normalizedDate}T00:00:00`);
  const weekdayIndex = Number.isNaN(parsed.getTime()) ? 1 : parsed.getDay();
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][weekdayIndex] || 'monday';
};

const isPermissionLeaveRecord = (row) => String(row?.type || '').trim().toLowerCase() === 'permission';

const getAttendancePermissionScope = (row) => {
  const normalized = String(row?.attendanceExemptionScope || '').trim().toLowerCase();
  if (['all', 'late-only', 'no-clock-in', 'no-clock-out', 'missing-clock'].includes(normalized)) {
    return normalized;
  }
  return 'all';
};

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
  const employeeRowsByKey = new Map(
    employeeRows
      .map((employeeRow) => [resolveEmployeeKey(employeeRows, employeeRow.id, employeeRow.fullName), employeeRow])
      .filter(([key]) => Boolean(key))
  );
  const payrollRowsByKey = new Map(
    baseRows
      .map((payrollRow) => [resolveEmployeeKey(employeeRows, payrollRow.employeeId, payrollRow.employee), payrollRow])
      .filter(([key]) => Boolean(key))
  );
  const shiftConfigs = (Array.isArray(appSettings.shifts) ? appSettings.shifts : [])
    .map((shift, index) => {
      const name = String(shift?.name || '').trim();
      const reportTime = String(shift?.reportTime || appSettings.attendanceReportTime || '08:00').trim();
      const shiftEnd = String(shift?.shiftEnd || appSettings.attendanceShiftEnd || '17:00').trim();
      if (!name || !/^\d{2}:\d{2}$/.test(reportTime) || !/^\d{2}:\d{2}$/.test(shiftEnd)) {
        return null;
      }
      return {
        id: String(shift?.id || `SHIFT-${index + 1}`),
        name,
        reportTime,
        shiftEnd,
        graceInMinutes: Math.max(0, Number(shift?.graceInMinutes) || 0),
        graceOutMinutes: Math.max(0, Number(shift?.graceOutMinutes) || 0),
        overtimeEnabled: Boolean(shift?.overtimeEnabled),
        overtimeStartAfterMinutes: Math.max(0, Number(shift?.overtimeStartAfterMinutes) || 0),
        overtimePayPerMinute: Math.max(0, Number(shift?.overtimePayPerMinute) || 0),
        dayRules: normalizeShiftDayRules(shift?.dayRules, {
          reportTime,
          shiftEnd,
          graceInMinutes: Math.max(0, Number(shift?.graceInMinutes) || 0),
          graceOutMinutes: Math.max(0, Number(shift?.graceOutMinutes) || 0),
          overtimeEnabled: Boolean(shift?.overtimeEnabled),
          overtimeStartAfterMinutes: Math.max(0, Number(shift?.overtimeStartAfterMinutes) || 0),
          overtimePayPerMinute: Math.max(0, Number(shift?.overtimePayPerMinute) || 0),
        }),
      };
    })
    .filter(Boolean);
  const holidayDates = parseHolidayDateList(appSettings.attendanceHolidayDates);
  const lateMinutesByEmployee = {};
  const lateDeductionByEmployee = {};
  const overtimeMinutesByEmployee = {};
  const overtimeAmountByEmployee = {};
  const nowDate = getTodayIsoDate();
  const nowMinutes = toMinutesFromClock(getCurrentClockValue()) || 0;
  const noClockInPenaltyByEmployee = {};
  const noClockOutPenaltyByEmployee = {};
  const absentPenaltyByEmployee = {};
  attendanceTimeRows.forEach((attendanceRow) => {
    const key = resolveEmployeeKey(employeeRows, attendanceRow.employeeId, attendanceRow.employee);
    if (!key) {
      return;
    }
    const matchedEmployee = employeeRowsByKey.get(key) || null;
    const currentDate = String(attendanceRow.date || '');
    const isPastDate = currentDate < nowDate;
    const shiftName = String(attendanceRow.shift || matchedEmployee?.assignedShift || '').trim().toLowerCase();
    const shiftConfig =
      shiftConfigs.find((shift) => String(shift?.name || '').trim().toLowerCase() === shiftName) || shiftConfigs[0] || null;
    const ruleKey = getAttendanceDayRuleKey(currentDate, holidayDates);
    const dayRule =
      shiftConfig?.dayRules?.[ruleKey] ||
      buildDefaultShiftDayRules({
        reportTime: shiftConfig?.reportTime || appSettings.attendanceReportTime,
        shiftEnd: shiftConfig?.shiftEnd || appSettings.attendanceShiftEnd,
        graceInMinutes: Math.max(0, Number(shiftConfig?.graceInMinutes) || 0),
        graceOutMinutes: Math.max(0, Number(shiftConfig?.graceOutMinutes) || 0),
        overtimeEnabled: Boolean(shiftConfig?.overtimeEnabled),
        overtimeStartAfterMinutes: Math.max(0, Number(shiftConfig?.overtimeStartAfterMinutes) || 0),
        overtimePayPerMinute: Math.max(0, Number(shiftConfig?.overtimePayPerMinute) || 0),
      })[ruleKey];
    const reportTime = String(dayRule?.reportTime || shiftConfig?.reportTime || appSettings.attendanceReportTime || '').trim();
    const shiftEnd = String(dayRule?.shiftEnd || shiftConfig?.shiftEnd || appSettings.attendanceShiftEnd || '').trim();
    const reportMinutes = toMinutesFromClock(reportTime) ?? 0;
    const graceInMinutes = Math.max(0, Number(dayRule?.graceInMinutes) || 0);
    const graceOutMinutes = Math.max(0, Number(dayRule?.graceOutMinutes) || 0);
    const lateAfterMinutes = reportMinutes + graceInMinutes;
    const shiftEndMinutes = toMinutesFromClock(shiftEnd) ?? 0;
    const shiftEndWithGraceMinutes = shiftEndMinutes + graceOutMinutes;
    const isWorkingDay = Boolean(dayRule?.enabled);
    const leaveMatch = leaveRows.find((leaveRow) => {
      const leaveEmployeeKey = resolveEmployeeKey(employeeRows, leaveRow.employeeId, leaveRow.employee);
      const leaveStatus = String(leaveRow.status || '').toLowerCase();
      return (
        leaveEmployeeKey === key &&
        !isPermissionLeaveRecord(leaveRow) &&
        (leaveStatus === 'approved' || leaveStatus === 'active') &&
        String(leaveRow.startDate || '') <= currentDate &&
        String(leaveRow.endDate || '') >= currentDate
      );
    });
    const permissionMatch = leaveRows.find((leaveRow) => {
      const leaveEmployeeKey = resolveEmployeeKey(employeeRows, leaveRow.employeeId, leaveRow.employee);
      const leaveStatus = String(leaveRow.status || '').toLowerCase();
      return (
        leaveEmployeeKey === key &&
        isPermissionLeaveRecord(leaveRow) &&
        (leaveStatus === 'approved' || leaveStatus === 'active') &&
        String(leaveRow.startDate || '') <= currentDate &&
        String(leaveRow.endDate || '') >= currentDate
      );
    });
    const permissionScope = permissionMatch ? getAttendancePermissionScope(permissionMatch) : '';
    const exemptLate = permissionScope === 'all' || permissionScope === 'late-only';
    const exemptNoClockIn = permissionScope === 'all' || permissionScope === 'missing-clock' || permissionScope === 'no-clock-in';
    const exemptNoClockOut = permissionScope === 'all' || permissionScope === 'missing-clock' || permissionScope === 'no-clock-out';
    const employeeStatus = String(matchedEmployee?.status || '').toLowerCase();
    const employeeStage = String(matchedEmployee?.employmentState || '').toLowerCase();
    const isOffDuty = employeeStatus !== 'active' || employeeStage === 'terminated' || employeeStage === 'suspended';
    const isExempt = isOffDuty || Boolean(leaveMatch) || !isWorkingDay;
    const attendanceSummary = getAttendanceClockSummary(attendanceRow);
    const checkInMinutes = toMinutesFromClock(attendanceSummary.checkIn);
    const rawCheckOut = String(attendanceSummary.checkOut || '');
    const hasMidnightCheckout = rawCheckOut === '00:00' || rawCheckOut === '24:00';
    const checkOutMinutes = hasMidnightCheckout ? null : toMinutesFromClock(attendanceSummary.checkOut);
    const hasClockOut = checkOutMinutes !== null && checkOutMinutes > (checkInMinutes ?? 0);
    const rawLateMinutes = Math.max(0, Number(attendanceRow.lateMinutes) || 0);
    lateMinutesByEmployee[key] = (lateMinutesByEmployee[key] || 0) + rawLateMinutes;
    const payrollForEmployee = payrollRowsByKey.get(key) || null;
    const basicPay = toNumberValue(payrollForEmployee?.basicPay || matchedEmployee?.basicPay);
    const workingDays = Math.max(
      1,
      Number(payrollForEmployee?.workingDays || matchedEmployee?.workingDays || appSettings.payrollWorkingDays) || 1
    );
    const dailyWage = basicPay > 0 ? basicPay / workingDays : 0;
    const scheduledMinutes = Math.max(
      1,
      getMinutesBetweenClocks(reportTime || appSettings.attendanceReportTime, shiftEnd || appSettings.attendanceShiftEnd) || 1
    );
    const autoMinuteRate = basicPay > 0 ? basicPay / workingDays / scheduledMinutes : 0;
    const fixedMinuteRate = Math.max(0, Number(appSettings.attendanceFixedDeductionPerMinute) || 0);
    const fixedScope = String(appSettings.attendanceFixedScope || 'all');
    const fixedApplies =
      fixedScope === 'all' ||
      (fixedScope === 'department' &&
        String(matchedEmployee?.department || '') === String(appSettings.attendanceFixedDepartment || '')) ||
      (fixedScope === 'individual' &&
        String(matchedEmployee?.id || attendanceRow.employeeId || '') === String(appSettings.attendanceFixedEmployeeId || ''));
    const deductionRatePerMinute =
      appSettings.attendanceCalculationMode === 'fixed' && fixedApplies ? fixedMinuteRate : autoMinuteRate;
    const effectiveLateMinutes =
      !isWorkingDay
        ? 0
        : rawLateMinutes > 0
          ? rawLateMinutes
          : checkInMinutes !== null
            ? Math.max(0, checkInMinutes - lateAfterMinutes)
            : 0;
    const storedLateDeduction = Math.max(0, toNumberValue(attendanceRow.deductionAmount));
    const computedLateDeduction = deductionRatePerMinute * effectiveLateMinutes;
    const lateDeduction = exemptLate ? 0 : storedLateDeduction > 0 ? storedLateDeduction : computedLateDeduction;
    lateDeductionByEmployee[key] = (lateDeductionByEmployee[key] || 0) + lateDeduction;
    const isClockInDeadlineReached = isPastDate || (currentDate === nowDate && nowMinutes >= lateAfterMinutes);
    const isClockOutDeadlineReached = isPastDate || (currentDate === nowDate && nowMinutes >= shiftEndWithGraceMinutes);
    const missingClockIn = !isExempt && !exemptNoClockIn && checkInMinutes === null && isClockInDeadlineReached;
    const missingClockOut = !isExempt && !exemptNoClockOut && !hasClockOut && isClockOutDeadlineReached;
    const missingCount = Number(missingClockIn) + Number(missingClockOut);
    if (missingCount >= 2) {
      absentPenaltyByEmployee[key] =
        (absentPenaltyByEmployee[key] || 0) +
        dailyWage * (Math.max(0, Number(appSettings.attendanceAbsentPenaltyPercent) || 0) / 100);
    } else if (missingClockIn) {
      noClockInPenaltyByEmployee[key] =
        (noClockInPenaltyByEmployee[key] || 0) +
        dailyWage * (Math.max(0, Number(appSettings.attendanceNoClockInPenaltyPercent) || 0) / 100);
    } else if (missingClockOut) {
      noClockOutPenaltyByEmployee[key] =
        (noClockOutPenaltyByEmployee[key] || 0) +
        dailyWage * (Math.max(0, Number(appSettings.attendanceNoClockOutPenaltyPercent) || 0) / 100);
    }
    const overtimeMinutesFromRow = Math.max(0, Number(attendanceRow.overtimeMinutes) || 0);
    const overtimeAmountFromRow = Math.max(0, toNumberValue(attendanceRow.overtimeAmount));
    if (overtimeMinutesFromRow > 0 || overtimeAmountFromRow > 0) {
      overtimeMinutesByEmployee[key] = (overtimeMinutesByEmployee[key] || 0) + overtimeMinutesFromRow;
      overtimeAmountByEmployee[key] = (overtimeAmountByEmployee[key] || 0) + overtimeAmountFromRow;
      return;
    }
    if (!hasClockOut) {
      return;
    }
    const overtimeEnabled = Boolean(dayRule?.overtimeEnabled);
    if (!shiftConfig || !overtimeEnabled || !isWorkingDay) {
      return;
    }
    if (shiftEndMinutes === null || checkOutMinutes === null) {
      return;
    }
    const overtimeStartMinutes = shiftEndMinutes + Math.max(0, Number(dayRule?.overtimeStartAfterMinutes) || 0);
    const overtimeMinutes = Math.max(0, checkOutMinutes - overtimeStartMinutes);
    if (overtimeMinutes <= 0) {
      return;
    }
    const overtimeAmount = overtimeMinutes * Math.max(0, Number(dayRule?.overtimePayPerMinute) || 0);
    overtimeMinutesByEmployee[key] = (overtimeMinutesByEmployee[key] || 0) + overtimeMinutes;
    overtimeAmountByEmployee[key] = (overtimeAmountByEmployee[key] || 0) + overtimeAmount;
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
    const matchedEmployee = employeeRowsByKey.get(key) || null;
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
    const overtimeMinutes = overtimeMinutesByEmployee[key] || 0;
    const overtimeEarnings = overtimeAmountByEmployee[key] || 0;
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
      overtimeMinutes: String(overtimeMinutes),
      overtimeEarnings: overtimeEarnings.toFixed(2),
      payableAfterLate: Math.max(0, basicPay - totalAttendancePenalty).toFixed(2),
      loanSummary: loanSummaryLabel,
      loanCount: String(loanSummary.activeCount || 0),
      loanBalance: loanSummary.totalBalance ? loanSummary.totalBalance.toFixed(2) : '',
    };
  });
};
