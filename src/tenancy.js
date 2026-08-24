const allModules = [
  'dashboard',
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
    modules: ['dashboard', 'attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual', 'settings'],
    employeeLimit: 25,
    concurrentLoginLimit: 8,
  },
  pro: {
    modules: [
      'dashboard',
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
      'settings',
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

function resolveRoleDefaultModules(role, defaultEmployeeModules = []) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'employee') {
    return Array.isArray(defaultEmployeeModules) ? [...defaultEmployeeModules] : [];
  }
  if (normalizedRole === 'manager') {
    return ['dashboard', 'employee-management', 'attendance-time', 'leave-management', 'monitoring-tracking', 'manual'];
  }
  if (normalizedRole === 'hr') {
    return [
      'dashboard',
      'employee-management',
      'attendance-time',
      'loan-records',
      'leave-management',
      'reports-analytics',
      'user-management',
      'manual',
    ];
  }
  return [];
}

function resolveTenantGrantedModules(packageType, requestedModules) {
  const packageModules = resolvePackageModules(packageType);
  const requested = Array.isArray(requestedModules)
    ? requestedModules.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const validSet = new Set(allModules);
  const merged = new Set(packageModules);
  requested.forEach((moduleId) => {
    if (validSet.has(moduleId)) {
      merged.add(moduleId);
    }
  });
  return Array.from(merged);
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

function resolveUserAllowedModulesForTenant({ user, tenant, tenantId, defaultEmployeeModules = [] }) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'superadmin' && tenantId === 'master') {
    return ['*'];
  }
  const packageModules = tenant ? resolvePackageModules(tenant.packageType) : [];
  const tenantGrants = tenant
    ? resolveTenantGrantedModules(tenant.packageType, tenant.grantedModules)
    : packageModules;
  const requestedModules = Array.isArray(user?.allowedModules)
    ? user.allowedModules.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const isAdminRole = role === 'admin' || role === 'tenant-admin' || role === 'superadmin';
  const roleDefaults = resolveRoleDefaultModules(role, defaultEmployeeModules);
  const baseline = isAdminRole
    ? tenantGrants
    : requestedModules.length > 0
      ? requestedModules
      : roleDefaults.length > 0
        ? roleDefaults
        : tenantGrants;
  const tenantSet = new Set(tenantGrants);
  if (tenantSet.size === 0) {
    return baseline;
  }
  return baseline.filter((moduleId) => tenantSet.has(moduleId));
}

module.exports = {
  allModules,
  packageDefaults,
  normalizeTenantId,
  resolvePackageModules,
  resolvePackageLimits,
  resolveTenantGrantedModules,
  resolveTenantEffectiveLimits,
  resolveRoleDefaultModules,
  resolveUserAllowedModulesForTenant,
};
