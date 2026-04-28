export const toNumberValue = (value) => {
  const sanitized = String(value || '').replace(/[^0-9.-]/g, '');
  const numeric = Number(sanitized);
  return Number.isFinite(numeric) ? numeric : 0;
};

