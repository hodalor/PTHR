import { resolveEmployeeKey } from './employeeSearch';

const PAYROLL_MODULE_ID = 'payroll-management';

export const getEmployeePayrollProfile = ({ moduleRowsState, employeeBaseRows, employeeId, employeeName }) => {
  const payrollRows = moduleRowsState?.[PAYROLL_MODULE_ID] || [];
  if (!Array.isArray(payrollRows) || payrollRows.length === 0) {
    return null;
  }
  const key = resolveEmployeeKey(employeeBaseRows || [], employeeId, employeeName);
  if (!key) {
    return null;
  }
  return payrollRows.find((row) => resolveEmployeeKey(employeeBaseRows || [], row.employeeId, row.employee) === key) || null;
};

