export const normalizeEmployeeSearchText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const getEmployeeSearchCandidates = (employee) => {
  const employeeId = String(employee?.id || '').trim();
  const fullName = String(employee?.fullName || '').trim();
  return [
    employeeId,
    fullName,
    `${fullName} ${employeeId}`.trim(),
    `${fullName} (${employeeId})`.trim(),
    String(employee?.department || '').trim(),
    String(employee?.position || '').trim(),
    String(employee?.taxId || '').trim(),
    String(employee?.pensionId || '').trim(),
    String(employee?.nhimaNumber || '').trim(),
    String(employee?.email || '').trim(),
    String(employee?.phonePrimary || '').trim(),
    String(employee?.phoneSecondary || '').trim(),
    String(employee?.phone || employee?.contactNumber || '').trim(),
    String(employee?.mobileMoneyNumber || '').trim(),
    String(employee?.mobileMoneyNetwork || '').trim(),
    String(employee?.bankName || '').trim(),
    String(employee?.bankAccountNumber || '').trim(),
    String(employee?.bankAccountName || '').trim(),
    String(employee?.idCardNumber || '').trim(),
  ]
    .map((item) => normalizeEmployeeSearchText(item))
    .filter(Boolean);
};

export const filterEmployeesBySearch = (employees, value, limit = 6) => {
  const query = normalizeEmployeeSearchText(value);
  if (!query) {
    return [];
  }
  const queryTokens = query.split(' ').filter(Boolean);
  return [...(employees || [])]
    .filter((employee) => {
      const candidates = getEmployeeSearchCandidates(employee);
      const haystack = candidates.join(' ');
      return queryTokens.every((token) => haystack.includes(token));
    })
    .sort((a, b) => {
      const aId = normalizeEmployeeSearchText(a?.id);
      const bId = normalizeEmployeeSearchText(b?.id);
      const aName = normalizeEmployeeSearchText(a?.fullName);
      const bName = normalizeEmployeeSearchText(b?.fullName);
      const aStarts = aId.startsWith(query) || aName.startsWith(query) ? 1 : 0;
      const bStarts = bId.startsWith(query) || bName.startsWith(query) ? 1 : 0;
      if (bStarts !== aStarts) {
        return bStarts - aStarts;
      }
      return aName.localeCompare(bName);
    })
    .slice(0, limit);
};

export const findExactEmployeeBySearch = (employees, value) => {
  const query = normalizeEmployeeSearchText(value);
  if (!query) {
    return null;
  }
  return (
    (employees || []).find((employee) =>
      getEmployeeSearchCandidates(employee).some((candidate) => candidate === query)
    ) || null
  );
};

export const extractEmployeeIdFromText = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const match = text.match(/([A-Za-z]{2,4}\d{6,12})/);
  return match ? String(match[1]).trim() : '';
};

export const resolveEmployeeKey = (employees, employeeIdValue, employeeNameValue) => {
  const directId = String(employeeIdValue || '').trim();
  const extractedId = extractEmployeeIdFromText(employeeNameValue);
  const candidateId = directId || extractedId;
  if (candidateId) {
    const matchedById = (employees || []).find((employee) => String(employee.id || '').trim() === candidateId);
    if (matchedById?.id) {
      return String(matchedById.id).trim();
    }
    return candidateId;
  }
  const matchedByName = findExactEmployeeBySearch(employees, employeeNameValue);
  if (matchedByName?.id) {
    return String(matchedByName.id).trim();
  }
  return String(employeeNameValue || '').trim();
};

