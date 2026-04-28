import { useEffect, useMemo } from 'react';
import { filterEmployeesBySearch, findExactEmployeeBySearch } from '../../utils/employeeSearch';
import { buildPayrollFormValuesFromEmployee, computePayrollPreviewValues } from './payrollUtils';

const formatMoneyValue = (value) => {
  const numeric = Number(value) || 0;
  return numeric ? numeric.toFixed(2) : '';
};

export const usePayrollForm = ({ active, appSettings, employeeBaseRows, formValues, modalState, setFormValues }) => {
  const payrollFormEmployeeMatches = useMemo(() => {
    if (!active) {
      return [];
    }
    return filterEmployeesBySearch(employeeBaseRows, formValues.payrollEmployeeSearch);
  }, [active, employeeBaseRows, formValues.payrollEmployeeSearch]);

  const selectedPayrollFormEmployee = useMemo(() => {
    if (!active) {
      return null;
    }
    return (
      employeeBaseRows.find((employee) => String(employee.id || '') === String(formValues.employeeId || '')) ||
      employeeBaseRows.find((employee) => String(employee.fullName || '') === String(formValues.employee || '')) ||
      findExactEmployeeBySearch(employeeBaseRows, formValues.payrollEmployeeSearch) ||
      null
    );
  }, [active, employeeBaseRows, formValues.employee, formValues.employeeId, formValues.payrollEmployeeSearch]);

  useEffect(() => {
    if (!active || modalState.mode !== 'form') {
      return;
    }
    const matchedEmployee = findExactEmployeeBySearch(employeeBaseRows, formValues.payrollEmployeeSearch);
    if (!matchedEmployee) {
      return;
    }
    if (String(formValues.employeeId || '') === String(matchedEmployee.id || '')) {
      return;
    }
    setFormValues((prev) => buildPayrollFormValuesFromEmployee(matchedEmployee, prev));
  }, [active, employeeBaseRows, formValues.employeeId, formValues.payrollEmployeeSearch, modalState.mode, setFormValues]);

  const payrollPreviewValues = useMemo(() => {
    if (!active) {
      return {};
    }
    const preview = computePayrollPreviewValues(formValues, appSettings);
    return {
      grossPay: formatMoneyValue(preview.grossPay),
      overtimeEarnings: formatMoneyValue(preview.overtimeEarnings),
      totalEarnings: formatMoneyValue(preview.totalEarnings),
      totalAttendancePenalty: formatMoneyValue(preview.totalAttendancePenalty),
      totalDeductions: formatMoneyValue(preview.totalDeductions),
      netPayable: formatMoneyValue(preview.netPayable),
      napsaDeduction: formatMoneyValue(preview.napsaDeduction),
      nhimaDeduction: formatMoneyValue(preview.nhimaDeduction),
      taxDeduction: formatMoneyValue(preview.taxDeduction),
    };
  }, [active, appSettings, formValues]);

  return {
    payrollFormEmployeeMatches,
    selectedPayrollFormEmployee,
    payrollPreviewValues,
  };
};
