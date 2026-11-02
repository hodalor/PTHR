/**
 * Tenant-scoped payroll auto-generation.
 * Period is defined by startDay/endDay (1-31). If startDay > endDay the cycle
 * crosses months (e.g. 26 → 25). On the end day, draft payroll rows are created
 * for active employees that do not already have a row for that period.
 * Generated rows remain fully editable via the normal payroll module APIs.
 */

function toNumberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampDay(value, fallback) {
  const day = Math.round(Number(value));
  if (!Number.isFinite(day)) {
    return fallback;
  }
  return Math.max(1, Math.min(31, day));
}

function normalizePayrollAutoGenerate(source = {}) {
  return {
    enabled: Boolean(source.enabled),
    periodStartDay: clampDay(source.periodStartDay, 1),
    periodEndDay: clampDay(source.periodEndDay, 30),
    runHourUtc: Math.max(0, Math.min(23, Math.round(Number(source.runHourUtc) || 0))),
  };
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function isoDateFromParts(year, monthIndex, day) {
  const safeDay = Math.min(day, daysInMonth(year, monthIndex));
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function parseIsoDate(value) {
  const match = String(value || '')
    .slice(0, 10)
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  };
}

/**
 * Resolve the payroll period that ends on `asOfDate` when today matches end day.
 * Returns null when asOfDate is not the configured end day.
 */
function resolvePeriodEndingOn(asOfDate, config) {
  const parsed = parseIsoDate(asOfDate);
  if (!parsed) {
    return null;
  }
  const { enabled, periodStartDay, periodEndDay } = normalizePayrollAutoGenerate(config);
  if (!enabled) {
    return null;
  }
  const endDayThisMonth = Math.min(periodEndDay, daysInMonth(parsed.year, parsed.monthIndex));
  if (parsed.day !== endDayThisMonth) {
    return null;
  }

  let startYear = parsed.year;
  let startMonthIndex = parsed.monthIndex;
  if (periodStartDay > periodEndDay) {
    startMonthIndex -= 1;
    if (startMonthIndex < 0) {
      startMonthIndex = 11;
      startYear -= 1;
    }
  }

  const periodStart = isoDateFromParts(startYear, startMonthIndex, periodStartDay);
  const periodEnd = isoDateFromParts(parsed.year, parsed.monthIndex, periodEndDay);
  const payrollMonth = `${parsed.year}-${String(parsed.monthIndex + 1).padStart(2, '0')}`;
  const periodKey = `${periodStart}_${periodEnd}`;

  return {
    periodStart,
    periodEnd,
    payrollMonth,
    periodKey,
  };
}

function resolvePeriodForMonth(payrollMonth, config) {
  const match = String(payrollMonth || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const normalized = normalizePayrollAutoGenerate({ ...config, enabled: true });
  const asOfDate = isoDateFromParts(year, monthIndex, normalized.periodEndDay);
  return resolvePeriodEndingOn(asOfDate, normalized);
}

function isLockedPayrollStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['paid', 'posted', 'final', 'finalized', 'closed'].includes(normalized);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function payrollRowCoversDate(row, dateValue) {
  const date = String(dateValue || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const start = String(row?.periodStart || '').slice(0, 10);
  const end = String(row?.periodEnd || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return date >= start && date <= end;
  }
  const month = String(row?.payrollMonth || row?.month || row?.period || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) && date.startsWith(month);
}

function penaltyFieldForType(penaltyType) {
  const normalized = String(penaltyType || '').trim().toLowerCase();
  if (normalized === 'no-clock-in') {
    return 'noClockInPenalty';
  }
  if (normalized === 'no-clock-out') {
    return 'noClockOutPenalty';
  }
  if (normalized === 'absent') {
    return 'absentPenalty';
  }
  return 'lateDeduction';
}

function applyClearanceToPayrollRecord(row, adjustment) {
  const clearedAmount = Math.max(0, toNumberValue(adjustment?.clearedAmount));
  if (clearedAmount <= 0) {
    return null;
  }
  const field = penaltyFieldForType(adjustment?.penaltyType);
  const currentLate = Math.max(0, toNumberValue(row?.lateDeduction));
  const currentNoClockIn = Math.max(0, toNumberValue(row?.noClockInPenalty));
  const currentNoClockOut = Math.max(0, toNumberValue(row?.noClockOutPenalty));
  const currentAbsent = Math.max(0, toNumberValue(row?.absentPenalty));
  const storedAttendance = Math.max(0, toNumberValue(row?.totalAttendancePenalty));
  const attendanceTotal = storedAttendance > 0
    ? storedAttendance
    : currentLate + currentNoClockIn + currentNoClockOut + currentAbsent;
  const applied = Math.min(clearedAmount, attendanceTotal);
  if (applied <= 0) {
    return null;
  }
  let remaining = applied;
  const nextLate = field === 'lateDeduction' ? Math.max(0, currentLate - remaining) : currentLate;
  if (field === 'lateDeduction') {
    remaining = Math.max(0, remaining - Math.min(remaining, currentLate));
  }
  const nextNoClockIn = field === 'noClockInPenalty' ? Math.max(0, currentNoClockIn - remaining) : currentNoClockIn;
  if (field === 'noClockInPenalty') {
    remaining = Math.max(0, remaining - Math.min(remaining, currentNoClockIn));
  }
  const nextNoClockOut = field === 'noClockOutPenalty' ? Math.max(0, currentNoClockOut - remaining) : currentNoClockOut;
  if (field === 'noClockOutPenalty') {
    remaining = Math.max(0, remaining - Math.min(remaining, currentNoClockOut));
  }
  const nextAbsent = field === 'absentPenalty' ? Math.max(0, currentAbsent - remaining) : currentAbsent;
  if (field === 'absentPenalty') {
    remaining = Math.max(0, remaining - Math.min(remaining, currentAbsent));
  }
  // Generated payroll currently stores the net attendance total on lateDeduction.
  const fallbackLate = remaining > 0 ? Math.max(0, nextLate - remaining) : nextLate;
  const nextAttendance = Math.max(0, attendanceTotal - applied);
  const splitRemainder = nextNoClockIn + nextNoClockOut + nextAbsent;
  const syncedLate = splitRemainder > 0 ? fallbackLate : nextAttendance;
  const napsaDeduction = Math.max(0, toNumberValue(row?.napsaDeduction));
  const nhimaDeduction = Math.max(0, toNumberValue(row?.nhimaDeduction));
  const taxDeduction = Math.max(0, toNumberValue(row?.taxDeduction));
  const otherDeduction = Math.max(0, toNumberValue(row?.otherDeduction));
  const totalDeductions = napsaDeduction + nhimaDeduction + taxDeduction + otherDeduction + nextAttendance;
  const totalEarnings = Math.max(
    0,
    toNumberValue(row?.totalEarnings || row?.grossPay || row?.basicPay)
  );
  return {
    lateDeduction: syncedLate.toFixed(2),
    noClockInPenalty: nextNoClockIn.toFixed(2),
    noClockOutPenalty: nextNoClockOut.toFixed(2),
    absentPenalty: nextAbsent.toFixed(2),
    totalAttendancePenalty: nextAttendance.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    netPayable: Math.max(0, totalEarnings - totalDeductions).toFixed(2),
    updatedAt: new Date().toISOString(),
  };
}

async function applyPenaltyClearanceToOpenPayroll(db, adjustment = {}) {
  const employeeId = String(adjustment.employeeId || '').trim();
  const employeeName = String(adjustment.employee || '').trim();
  const date = String(adjustment.date || '').slice(0, 10);
  if ((!employeeId && !employeeName) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { updated: 0 };
  }
  const matchOr = [];
  if (employeeId) {
    const employeeRegex = new RegExp(`^${escapeRegex(employeeId)}$`, 'i');
    matchOr.push({ employeeId: employeeRegex });
    matchOr.push({ employee: employeeRegex });
  }
  if (employeeName) {
    const nameRegex = new RegExp(`^${escapeRegex(employeeName)}$`, 'i');
    matchOr.push({ employee: nameRegex });
  }
  const payrollRows = await db.collection('payrollRecords').find({ $or: matchOr }).toArray();
  let updated = 0;
  for (const row of payrollRows) {
    if (isLockedPayrollStatus(row.status) || !payrollRowCoversDate(row, date)) {
      continue;
    }
    const nextValues = applyClearanceToPayrollRecord(row, adjustment);
    if (!nextValues) {
      continue;
    }
    await db.collection('payrollRecords').updateOne({ _id: row._id }, { $set: nextValues });
    updated += 1;
  }
  return { updated };
}

function calcStatutory(mode, value, basicPay, grossPay) {
  const numeric = Math.max(0, Number(value) || 0);
  if (mode === 'percent-gross') {
    return (grossPay * numeric) / 100;
  }
  if (mode === 'percent-basic') {
    return (basicPay * numeric) / 100;
  }
  return numeric;
}

function isEmployeeActiveForPayroll(employee) {
  const status = String(employee?.status || '').trim().toLowerCase();
  const stage = String(employee?.employmentState || '').trim().toLowerCase();
  const blocked = new Set(['inactive', 'stopped', 'stoped', 'fired', 'resigned', 'terminated', 'expired']);
  return !blocked.has(status) && !blocked.has(stage);
}

function buildPayrollRecordForEmployee({
  employee,
  period,
  lateDeduction,
  lateMinutes,
  workingDays,
  statutoryRules,
  nowIso,
  otherDeduction = 0,
  existing = null,
}) {
  const basicPay = toNumberValue(employee.basicPay);
  const monthlyBonuses = toNumberValue(employee.monthlyBonuses);
  const transportAllowance = toNumberValue(employee.transportAllowance);
  const housingAllowance = toNumberValue(employee.housingAllowance);
  const foodAllowance = toNumberValue(employee.foodAllowance);
  const grossPay = basicPay + monthlyBonuses + transportAllowance + housingAllowance + foodAllowance;
  const napsaDeduction = calcStatutory(statutoryRules?.napsaMode || 'percent-basic', statutoryRules?.napsaValue, basicPay, grossPay);
  const nhimaDeduction = calcStatutory(statutoryRules?.nhimaMode || 'percent-basic', statutoryRules?.nhimaValue, basicPay, grossPay);
  const taxMinAmount = Math.max(0, Number(statutoryRules?.taxMinAmount) || 0);
  const taxDeduction =
    grossPay >= taxMinAmount
      ? calcStatutory(statutoryRules?.taxMode || 'percent-basic', statutoryRules?.taxValue, basicPay, grossPay)
      : 0;
  const totalAttendancePenalty = Math.max(0, lateDeduction);
  const resolvedOtherDeduction = Math.max(0, toNumberValue(otherDeduction));
  const totalDeductions = napsaDeduction + nhimaDeduction + taxDeduction + resolvedOtherDeduction + totalAttendancePenalty;
  const totalEarnings = grossPay;
  const netPayable = Math.max(0, totalEarnings - totalDeductions);
  const recordId =
    String(existing?.id || '').trim() ||
    `PAY-AUTO-${String(employee.id || 'EMP').replace(/[^A-Za-z0-9]/g, '')}-${period.periodKey}`;

  return {
    id: recordId,
    employee: String(employee.fullName || ''),
    employeeId: String(employee.id || ''),
    month: period.payrollMonth,
    payrollMonth: period.payrollMonth,
    period: period.payrollMonth,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodKey: period.periodKey,
    taxId: String(employee.taxId || ''),
    pensionId: String(employee.pensionId || ''),
    nhimaNumber: String(employee.nhimaNumber || ''),
    accessAccount: String(employee.accessAccount || ''),
    mobileMoneyNumber: String(employee.mobileMoneyNumber || ''),
    mobileMoneyNetwork: String(employee.mobileMoneyNetwork || ''),
    mobileMoneyName: String(employee.mobileMoneyName || ''),
    bankName: String(employee.bankName || ''),
    bankAccountName: String(employee.bankAccountName || ''),
    bankAccountNumber: String(employee.bankAccountNumber || ''),
    basicPay: basicPay.toFixed(2),
    monthlyBonuses: monthlyBonuses.toFixed(2),
    transportAllowance: transportAllowance.toFixed(2),
    housingAllowance: housingAllowance.toFixed(2),
    foodAllowance: foodAllowance.toFixed(2),
    workingDays: String(workingDays || 26),
    lateMinutes: String(Math.max(0, lateMinutes)),
    lateDeduction: totalAttendancePenalty.toFixed(2),
    noClockInPenalty: '0.00',
    noClockOutPenalty: '0.00',
    absentPenalty: '0.00',
    totalAttendancePenalty: totalAttendancePenalty.toFixed(2),
    napsaDeduction: napsaDeduction.toFixed(2),
    nhimaDeduction: nhimaDeduction.toFixed(2),
    taxDeduction: taxDeduction.toFixed(2),
    otherDeduction: resolvedOtherDeduction.toFixed(2),
    overtimeEarnings: '0.00',
    grossPay: grossPay.toFixed(2),
    totalEarnings: totalEarnings.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    netPayable: netPayable.toFixed(2),
    status: String(existing?.status || 'Draft').trim() || 'Draft',
    autoGenerated: true,
    source: existing?.source || 'auto-generate',
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

async function generatePayrollForTenantDb(db, options = {}) {
  const asOfDate = String(options.asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const payrollMonthInput = String(options.payrollMonth || '').trim();
  const force = Boolean(options.force);
  const updateExisting = options.updateExisting !== false;
  const attendanceSettingsRecord = await db.collection('appSettings').findOne({ _id: 'attendance-rules' });
  const generalSettingsRecord = await db.collection('appSettings').findOne({ _id: 'general-settings' });
  const attendanceSettings = attendanceSettingsRecord?.value || {};
  const generalSettings = generalSettingsRecord?.value || {};
  const autoConfig = normalizePayrollAutoGenerate(generalSettings.payrollAutoGenerate || {});

  let period = null;
  if (/^\d{4}-\d{2}$/.test(payrollMonthInput)) {
    period = resolvePeriodForMonth(payrollMonthInput, autoConfig);
  } else {
    period = resolvePeriodEndingOn(asOfDate, autoConfig);
    if (!period && force) {
      const parsed = parseIsoDate(asOfDate);
      if (parsed) {
        period = resolvePeriodEndingOn(
          isoDateFromParts(parsed.year, parsed.monthIndex, autoConfig.periodEndDay),
          { ...autoConfig, enabled: true }
        );
      }
    }
  }
  if (!period) {
    return {
      skipped: true,
      reason: 'Could not resolve payroll period. Select a month or set the company period end day.',
      created: 0,
      updated: 0,
      skippedExisting: 0,
    };
  }

  const runMarkerId = `payroll-auto:${period.periodKey}`;
  const existingRun = await db.collection('appSettings').findOne({ _id: runMarkerId });
  if (existingRun && !force && !payrollMonthInput) {
    return { skipped: true, reason: 'Already generated for this period', created: 0, updated: 0, skippedExisting: 0, period };
  }

  const employees = await db.collection('employees').find({}).toArray();
  const activeEmployees = employees.filter(isEmployeeActiveForPayroll);
  const [attendanceRows, adjustmentRows] = await Promise.all([
    db.collection('attendanceTime').find(
      { date: { $gte: period.periodStart, $lte: period.periodEnd } },
      { projection: { employeeId: 1, employee: 1, deductionAmount: 1, lateMinutes: 1 } }
    ).toArray(),
    db.collection('attendancePenaltyAdjustments').find(
      { date: { $gte: period.periodStart, $lte: period.periodEnd } },
      { projection: { employeeId: 1, employee: 1, clearedAmount: 1, penaltyType: 1 } }
    ).toArray(),
  ]);

  const deductionByEmployee = new Map();
  attendanceRows.forEach((row) => {
    const key = String(row.employeeId || '').trim() || String(row.employee || '').trim();
    if (!key) {
      return;
    }
    const current = deductionByEmployee.get(key) || { deductionAmount: 0, lateMinutes: 0 };
    current.deductionAmount += Math.max(0, toNumberValue(row.deductionAmount));
    current.lateMinutes += Math.max(0, toNumberValue(row.lateMinutes));
    deductionByEmployee.set(key, current);
  });
  const clearanceByEmployee = new Map();
  adjustmentRows.forEach((row) => {
    const key = String(row.employeeId || '').trim() || String(row.employee || '').trim();
    if (!key) {
      return;
    }
    clearanceByEmployee.set(key, (clearanceByEmployee.get(key) || 0) + Math.max(0, toNumberValue(row.clearedAmount)));
  });

  const workingDays = Math.max(1, Number(attendanceSettings.payrollWorkingDays) || 26);
  const statutoryRules = generalSettings.statutoryRules || {};
  const nowIso = new Date().toISOString();
  let created = 0;
  let updated = 0;
  let skippedExisting = 0;

  for (const employee of activeEmployees) {
    const employeeId = String(employee.id || '').trim();
    if (!employeeId) {
      continue;
    }
    const existing = await db.collection('payrollRecords').findOne({
      employeeId,
      $or: [
        { periodKey: period.periodKey },
        { payrollMonth: period.payrollMonth },
        { month: period.payrollMonth },
      ],
    });
    if (existing && isLockedPayrollStatus(existing.status)) {
      skippedExisting += 1;
      continue;
    }
    if (existing && !updateExisting) {
      skippedExisting += 1;
      continue;
    }

    const totals =
      deductionByEmployee.get(employeeId) ||
      deductionByEmployee.get(String(employee.fullName || '').trim()) ||
      { deductionAmount: 0, lateMinutes: 0 };
    const clearedAmount =
      clearanceByEmployee.get(employeeId) ||
      clearanceByEmployee.get(String(employee.fullName || '').trim()) ||
      0;

    const record = buildPayrollRecordForEmployee({
      employee,
      period,
      lateDeduction: Math.max(0, totals.deductionAmount - clearedAmount),
      lateMinutes: totals.lateMinutes,
      workingDays,
      statutoryRules,
      nowIso,
      otherDeduction: existing ? toNumberValue(existing.otherDeduction) : 0,
      existing,
    });

    if (existing) {
      const { _id, ...recordWithoutId } = record;
      await db.collection('payrollRecords').updateOne({ _id: existing._id }, { $set: recordWithoutId });
      updated += 1;
    } else {
      await db.collection('payrollRecords').insertOne(record);
      created += 1;
    }
  }

  await db.collection('appSettings').updateOne(
    { _id: runMarkerId },
    {
      $set: {
        value: {
          periodKey: period.periodKey,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          payrollMonth: period.payrollMonth,
          created,
          updated,
          skippedExisting,
          completedAt: nowIso,
        },
        updatedAt: nowIso,
      },
      $setOnInsert: { createdAt: nowIso },
    },
    { upsert: true }
  );

  return { skipped: false, created, updated, skippedExisting, period };
}

async function runPayrollAutoGenerateForAllTenants(masterDb, getTenantDatabase, options = {}) {
  const tenants = await masterDb.collection('tenants').find({ status: 'active' }).toArray();
  const tenantIds = ['master', ...tenants.map((tenant) => String(tenant.tenantId || '').trim()).filter(Boolean)];
  const uniqueTenantIds = Array.from(new Set(tenantIds));
  const results = [];

  for (const tenantId of uniqueTenantIds) {
    try {
      const context = await getTenantDatabase(masterDb, tenantId);
      const result = await generatePayrollForTenantDb(context.db, options);
      results.push({ tenantId, ...result });
    } catch (error) {
      results.push({
        tenantId,
        skipped: true,
        reason: error instanceof Error ? error.message : 'Failed',
        created: 0,
        skippedExisting: 0,
      });
    }
  }

  return results;
}

module.exports = {
  normalizePayrollAutoGenerate,
  resolvePeriodEndingOn,
  resolvePeriodForMonth,
  generatePayrollForTenantDb,
  runPayrollAutoGenerateForAllTenants,
  applyPenaltyClearanceToOpenPayroll,
  isLockedPayrollStatus,
};
