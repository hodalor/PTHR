import { enhancePayrollRows } from '../payroll/enhancePayrollRows';
import { augmentPayrollColumns } from '../payroll/payrollColumns';

export const getModuleEnhancers = (moduleId) => {
  if (moduleId === 'payroll-management') {
    return {
      augmentColumns: augmentPayrollColumns,
      getRows: (ctx) => enhancePayrollRows(ctx),
    };
  }
  return null;
};

