import { toNumberValue } from '../../utils/number';

export const formatPayrollPeriodLabel = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  const monthInputMatch = normalized.match(/^(\d{4})-(\d{2})$/);
  if (monthInputMatch) {
    const [, yearPart, monthPart] = monthInputMatch;
    const monthIndex = Number(monthPart) - 1;
    const monthName = new Date(Number(yearPart), monthIndex, 1).toLocaleString('en-US', { month: 'long' });
    return `${yearPart}-${monthName}`;
  }
  const legacyMatch = normalized.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (legacyMatch) {
    const [, monthName, yearPart] = legacyMatch;
    return `${yearPart}-${monthName}`;
  }
  return normalized;
};

export const toPayrollMonthInputValue = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (/^\d{4}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const formattedMatch = normalized.match(/^(\d{4})-([A-Za-z]+)$/);
  if (formattedMatch) {
    const [, yearPart, monthName] = formattedMatch;
    const monthDate = new Date(`${monthName} 1, ${yearPart}`);
    if (!Number.isNaN(monthDate.getTime())) {
      return `${yearPart}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    }
  }
  const legacyMatch = normalized.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (legacyMatch) {
    const [, monthName, yearPart] = legacyMatch;
    const monthDate = new Date(`${monthName} 1, ${yearPart}`);
    if (!Number.isNaN(monthDate.getTime())) {
      return `${yearPart}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    }
  }
  return '';
};

export const computePayrollPreviewValues = (values, appSettings) => {
  const basicPay = toNumberValue(values.basicPay);
  const monthlyBonuses = toNumberValue(values.monthlyBonuses);
  const transportAllowance = toNumberValue(values.transportAllowance);
  const housingAllowance = toNumberValue(values.housingAllowance);
  const foodAllowance = toNumberValue(values.foodAllowance);
  const grossPay = basicPay + monthlyBonuses + transportAllowance + housingAllowance + foodAllowance;
  const lateDeduction = toNumberValue(values.lateDeduction);
  const noClockInPenalty = toNumberValue(values.noClockInPenalty);
  const noClockOutPenalty = toNumberValue(values.noClockOutPenalty);
  const absentPenalty = toNumberValue(values.absentPenalty);
  const totalAttendancePenalty = lateDeduction + noClockInPenalty + noClockOutPenalty + absentPenalty;
  const overtimeEarnings = toNumberValue(values.overtimeEarnings);
  const totalEarnings = grossPay + overtimeEarnings;
  const statutoryRules = appSettings.statutoryRules || {};
  const calcStatutory = (mode, value) => {
    const numeric = Math.max(0, Number(value) || 0);
    if (mode === 'percent-gross') {
      return (grossPay * numeric) / 100;
    }
    if (mode === 'percent-basic') {
      return (basicPay * numeric) / 100;
    }
    return numeric;
  };
  const napsaDeduction = calcStatutory(statutoryRules.napsaMode || 'percent-basic', statutoryRules.napsaValue ?? 0);
  const nhimaDeduction = calcStatutory(statutoryRules.nhimaMode || 'percent-basic', statutoryRules.nhimaValue ?? 0);
  const taxMinAmount = Math.max(0, Number(statutoryRules.taxMinAmount) || 0);
  const taxDeduction =
    grossPay >= taxMinAmount ? calcStatutory(statutoryRules.taxMode || 'percent-basic', statutoryRules.taxValue ?? 0) : 0;
  const otherDeduction = toNumberValue(values.otherDeduction);
  const totalDeductions = napsaDeduction + nhimaDeduction + taxDeduction + otherDeduction + totalAttendancePenalty;
  const netPayable = totalEarnings - totalDeductions;
  return {
    grossPay,
    overtimeEarnings,
    totalEarnings,
    totalAttendancePenalty,
    totalDeductions,
    netPayable,
    napsaDeduction,
    nhimaDeduction,
    taxDeduction,
    lateDeduction,
    noClockInPenalty,
    noClockOutPenalty,
    absentPenalty,
    otherDeduction,
  };
};

export const buildPayrollFormValuesFromEmployee = (employee, previousValues = {}) => {
  if (!employee) {
    return previousValues;
  }
  return {
    ...previousValues,
    payrollEmployeeSearch: `${employee.fullName || ''} (${employee.id || ''})`.trim(),
    employee: employee.fullName || '',
    employeeId: employee.id || '',
    taxId: employee.taxId || '',
    pensionId: employee.pensionId || '',
    nhimaNumber: employee.nhimaNumber || '',
    accessAccount: employee.accessAccount || '',
    mobileMoneyNumber: employee.mobileMoneyNumber || '',
    mobileMoneyNetwork: employee.mobileMoneyNetwork || '',
    mobileMoneyName: employee.mobileMoneyName || previousValues.mobileMoneyName || '',
    bankName: employee.bankName || '',
    bankAccountName: employee.bankAccountName || '',
    bankAccountNumber: employee.bankAccountNumber || '',
    basicPay: employee.basicPay || '',
    monthlyBonuses: employee.monthlyBonuses || '',
    transportAllowance: employee.transportAllowance || '',
    housingAllowance: employee.housingAllowance || '',
    foodAllowance: employee.foodAllowance || '',
    workingDays: employee.workingDays || previousValues.workingDays || '',
    status: previousValues.status || employee.employmentState || 'Processing',
  };
};
