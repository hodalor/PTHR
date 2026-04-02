import { moduleUiData } from '../../config/moduleUiData';
import { parseCsv } from '../../utils/csv';

export const downloadPayrollTemplate = () => {
  const payrollConfig = moduleUiData['payroll-management'];
  if (!payrollConfig || !payrollConfig.columns) {
    return;
  }
  const columns = payrollConfig.columns.filter((column) => column.key !== 'id');
  const header = columns.map((column) => column.key).join(',');
  const blob = new Blob([`${header}\n`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'payroll_template.csv';
  link.click();
};

export const parsePayrollCsvRows = async (file) => {
  const text = await file.text();
  const { headers, rows: csvRows } = parseCsv(text);
  if (!headers.length || !csvRows.length) {
    return [];
  }
  return csvRows
    .map((rowCells, index) => {
      const payload = headers.reduce((acc, headerKey, headerIndex) => {
        const normalizedKey = String(headerKey || '').trim();
        if (!normalizedKey) {
          return acc;
        }
        return {
          ...acc,
          [normalizedKey]: rowCells[headerIndex] ?? '',
        };
      }, {});
      const rowId = payload.id || `PAY-${String(index + 1).padStart(3, '0')}`;
      return { ...payload, id: rowId };
    })
    .filter((row) => row.employeeId || row.employee);
};

