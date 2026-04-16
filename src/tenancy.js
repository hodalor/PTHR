const allModules = [
  'employee-management',
  'attendance-time',
  'loan-records',
  'fingerprint',
  'leave-management',
  'payroll-management',
  'documents-records',
  'reports-analytics',
  'auth-roles',
  'recruitment',
  'performance',
  'training',
  'monitoring-tracking',
  'user-management',
  'settings',
  'manual',
  'tenant-management',
];

const packageDefaults = {
  basic: {
    modules: ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual'],
    employeeLimit: 25,
    concurrentLoginLimit: 8,
  },
  pro: {
    modules: [
      'employee-management',
      'attendance-time',
      'loan-records',
      'fingerprint',
      'leave-management',
      'payroll-management',
      'documents-records',
      'reports-analytics',
      'monitoring-tracking',
      'manual',
    ],
    employeeLimit: 300,
    concurrentLoginLimit: 80,
  },
  enterprise: {
    modules: [...allModules],
    employeeLimit: 5000,
    concurrentLoginLimit: 1200,
  },
};

function normalizeTenantId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

function resolvePackageModules(packageType) {
  const normalized = String(packageType || '').trim().toLowerCase();
  return packageDefaults[normalized] ? [...packageDefaults[normalized].modules] : [...packageDefaults.basic.modules];
}

function resolvePackageLimits(packageType) {
  const normalized = String(packageType || '').trim().toLowerCase();
  const base = packageDefaults[normalized] || packageDefaults.basic;
  return {
    employeeLimit: Number(base.employeeLimit) || 0,
    concurrentLoginLimit: Number(base.concurrentLoginLimit) || 0,
  };
}

function resolveTenantGrantedModules(packageType, requestedModules) {
  const requested = Array.isArray(requestedModules)
    ? requestedModules.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (requested.length === 0) {
    return resolvePackageModules(packageType);
  }
  const validSet = new Set(allModules);
  return requested.filter((moduleId) => validSet.has(moduleId));
}

function resolveTenantEffectiveLimits(tenant) {
  const packageLimits = resolvePackageLimits(tenant?.packageType);
  const employeeLimit = Number(tenant?.employeeLimitOverride);
  const concurrentLoginLimit = Number(tenant?.concurrentLoginLimitOverride);
  return {
    employeeLimit:
      Number.isFinite(employeeLimit) && employeeLimit > 0 ? Math.floor(employeeLimit) : packageLimits.employeeLimit,
    concurrentLoginLimit:
      Number.isFinite(concurrentLoginLimit) && concurrentLoginLimit > 0
        ? Math.floor(concurrentLoginLimit)
        : packageLimits.concurrentLoginLimit,
  };
}

module.exports = {
  allModules,
  packageDefaults,
  normalizeTenantId,
  resolvePackageModules,
  resolvePackageLimits,
  resolveTenantGrantedModules,
  resolveTenantEffectiveLimits,
};
