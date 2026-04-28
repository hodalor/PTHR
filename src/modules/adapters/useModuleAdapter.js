import { usePayrollAdapter } from '../payroll/usePayrollAdapter';

export const useModuleAdapter = (props) => {
  const payrollAdapter = usePayrollAdapter(props);
  if (props.activeModuleId === 'payroll-management') {
    return payrollAdapter;
  }
  return null;
};

