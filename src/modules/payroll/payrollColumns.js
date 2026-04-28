export const augmentPayrollColumns = (columns) => {
  if (!Array.isArray(columns)) {
    return [];
  }
  if (columns.some((column) => column.key === 'loanSummary')) {
    return columns;
  }
  const statusIndex = columns.findIndex((column) => column.key === 'status');
  if (statusIndex === -1) {
    return [...columns, { key: 'loanSummary', label: 'Loans' }];
  }
  return [...columns.slice(0, statusIndex), { key: 'loanSummary', label: 'Loans' }, ...columns.slice(statusIndex)];
};

