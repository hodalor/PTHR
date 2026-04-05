export const normalizeEmployeeSearchText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const getEmployeeSearchCandidates = (employee) => {
  const employeeId = String(employee?.id || employee?.employeeId || employee?.staffId || '').trim();
  const fullName = String(employee?.fullName || employee?.employee || employee?.name || '').trim();
  const firstName = String(employee?.firstName || '').trim();
  const lastName = String(employee?.lastName || '').trim();
  const combinedName = `${firstName} ${lastName}`.trim();
  const reversedCombinedName = `${lastName} ${firstName}`.trim();
  const compactQueryTargets = [fullName, combinedName].filter(Boolean).map((text) => text.replace(/\s+/g, ''));
  return [
    employeeId,
    fullName,
    combinedName,
    reversedCombinedName,
    `${fullName} ${employeeId}`.trim(),
    `${fullName} (${employeeId})`.trim(),
    `${combinedName} ${employeeId}`.trim(),
    ...compactQueryTargets,
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
  const compactQuery = query.replace(/\s+/g, '');
  return [...(employees || [])]
    .filter((employee) => {
      const candidates = getEmployeeSearchCandidates(employee);
      const haystack = candidates.join(' ');
      const compactHaystack = haystack.replace(/\s+/g, '');
      const allTokensMatch = queryTokens.every((token) => haystack.includes(token));
      return allTokensMatch || compactHaystack.includes(compactQuery);
    })
    .sort((a, b) => {
      const aId = normalizeEmployeeSearchText(a?.id || a?.employeeId || a?.staffId);
      const bId = normalizeEmployeeSearchText(b?.id || b?.employeeId || b?.staffId);
      const aName = normalizeEmployeeSearchText(a?.fullName || a?.employee || a?.name);
      const bName = normalizeEmployeeSearchText(b?.fullName || b?.employee || b?.name);
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
