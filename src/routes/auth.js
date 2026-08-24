const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const {
  allModules,
  packageDefaults,
  normalizeTenantId,
  resolvePackageModules,
  resolveTenantGrantedModules,
  resolveTenantEffectiveLimits,
  resolveUserAllowedModulesForTenant,
} = require('../tenancy');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SUPERADMIN_USERNAME = String(process.env.SUPERADMIN_USERNAME || 'superadmin').trim();
const SUPERADMIN_PASSWORD = String(process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@2026').trim();
const SUPERADMIN_FULL_NAME = String(process.env.SUPERADMIN_FULL_NAME || 'Platform Super Admin').trim();
const PAYSTACK_SECRET_KEY = String(process.env.PAYSTACK_SECRET_KEY || '').trim();
const PAYSTACK_PUBLIC_KEY = String(process.env.PAYSTACK_PUBLIC_KEY || '').trim();
const PAYSTACK_CALLBACK_BASE_URL = String(process.env.PAYSTACK_CALLBACK_BASE_URL || '').trim();
const defaultEmployeeModules = ['dashboard', 'attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual'];
const SUBSCRIPTION_SETTINGS_COLLECTION = 'subscriptionSettings';
const TENANT_PAYMENTS_COLLECTION = 'tenantPayments';
const SUBSCRIPTION_DEFAULT_CURRENCY = 'GHS';
const SUBSCRIPTION_DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_CODE_LENGTH = 12;
const DEFAULT_MANUAL_EXTENSION_DAYS = 30;
const defaultSubscriptionPlanCatalog = {
  basic: { label: 'Basic', monthlyAmount: 800 },
  pro: { label: 'Pro', monthlyAmount: 1000 },
  enterprise: { label: 'Enterprise', monthlyAmount: 1500 },
};
const roleRank = {
  employee: 1,
  manager: 2,
  hr: 2,
  admin: 3,
  'tenant-admin': 3,
  superadmin: 4,
};
const blockedEmployeeStatusValues = new Set(['inactive', 'stopped', 'stoped', 'fired', 'resigned', 'terminated']);
const blockedEmployeeStageValues = new Set(['inactive', 'stopped', 'stoped', 'fired', 'resigned', 'terminated', 'expired']);

function normalizeEmployeeLifecycleValue(value) {
  return String(value || '').trim().toLowerCase();
}

function getEmployeeAccessBlockReason(employee) {
  if (!employee) {
    return '';
  }
  const normalizedStatus = normalizeEmployeeLifecycleValue(employee.status);
  const normalizedEmploymentState = normalizeEmployeeLifecycleValue(employee.employmentState);
  if (blockedEmployeeStatusValues.has(normalizedStatus)) {
    return `Employee status is ${String(employee.status || 'inactive').trim()}`;
  }
  if (blockedEmployeeStageValues.has(normalizedEmploymentState)) {
    return `Employment stage is ${String(employee.employmentState || 'inactive').trim()}`;
  }
  return '';
}

async function getLinkedEmployeeAccessState(db, userLike) {
  const employeeId = String(userLike?.employeeId || '').trim();
  if (!employeeId) {
    return { employee: null, blocked: false, reason: '' };
  }
  const employee = await db.collection('employees').findOne(
    { id: employeeId },
    { projection: { id: 1, status: 1, employmentState: 1 } }
  );
  const reason = getEmployeeAccessBlockReason(employee);
  return {
    employee,
    blocked: Boolean(reason),
    reason,
  };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSessionExpiryIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getDateOnlyStart(value) {
  const normalized = String(value || '').slice(0, 10);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSubscriptionDaysRemaining(value) {
  const expiryDate = getDateOnlyStart(value);
  if (!expiryDate) {
    return null;
  }
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return Math.round((expiryDate.getTime() - todayStart.getTime()) / SUBSCRIPTION_DAY_MS);
}

function isTenantSubscriptionExpired(tenant) {
  const daysRemaining = getSubscriptionDaysRemaining(tenant?.subscriptionExpiresAt);
  return daysRemaining !== null && daysRemaining <= 0;
}

function roundCurrencyAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}

function normalizeActivationCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ACTIVATION_CODE_LENGTH);
}

function isValidEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeTenantPricingOverrides(value, basePeriods = []) {
  const requested = value && typeof value === 'object' && !Array.isArray(value) ? value : Array.isArray(value) ? {} : {};
  const normalized = {};
  for (let months = 1; months <= 12; months += 1) {
    const key = `month_${months}`;
    const rawValue = Number(requested[key]);
    const isSet = Number.isFinite(rawValue) && rawValue > 0;
    if (!isSet) {
      continue;
    }
    normalized[key] = roundCurrencyAmount(rawValue);
  }
  return normalized;
}

function resolveTenantPricingOverridesWithDefaults(value, basePeriods = []) {
  const stored = normalizeTenantPricingOverrides(value, []);
  const defaults = Array.isArray(basePeriods) ? basePeriods : [];
  const resolved = {};
  defaults.forEach((period) => {
    const months = Math.max(1, Math.min(12, Math.round(Number(period?.months) || 0)));
    if (!months) {
      return;
    }
    const key = `month_${months}`;
    const storedValue = Number(stored[key]);
    const fallbackAmount = roundCurrencyAmount(Number(period?.amount) || 0);
    resolved[key] = Number.isFinite(storedValue) && storedValue > 0 ? roundCurrencyAmount(storedValue) : fallbackAmount;
  });
  return resolved;
}

function applyTenantPricingOverrides(periods, pricingOverrides) {
  const overrides = pricingOverrides && typeof pricingOverrides === 'object' ? pricingOverrides : {};
  if (!Array.isArray(periods)) {
    return [];
  }
  return periods.map((period) => {
    const months = Math.max(1, Math.min(12, Math.round(Number(period?.months) || 0)));
    const overrideValue = Number(overrides[`month_${months}`]);
    const nextAmount = Number.isFinite(overrideValue) && overrideValue > 0 ? roundCurrencyAmount(overrideValue) : roundCurrencyAmount(period?.amount);
    return {
      ...period,
      months,
      amount: nextAmount,
    };
  });
}

function extractResponseError(error, fallbackMessage = 'Failed to initialize payment') {
  const errorMessage =
    error instanceof Error
      ? String(error.message || '')
      : typeof error === 'string'
        ? error
        : '';
  return errorMessage || fallbackMessage;
}

function buildDefaultRenewalPeriods(monthlyAmount) {
  const baseAmount = roundCurrencyAmount(monthlyAmount);
  return Array.from({ length: 12 }, (_, index) => {
    const months = index + 1;
    return {
      months,
      days: months * 30,
      discountPercent: 0,
      amount: roundCurrencyAmount(baseAmount * months),
    };
  });
}

function buildDefaultSubscriptionSettings() {
  return {
    currency: SUBSCRIPTION_DEFAULT_CURRENCY,
    manualExtensionDays: DEFAULT_MANUAL_EXTENSION_DAYS,
    paymentGateways: {
      paystackEnabled: true,
    },
    plans: Object.entries(defaultSubscriptionPlanCatalog).map(([planKey, plan]) => ({
      planKey,
      label: plan.label,
      monthlyAmount: roundCurrencyAmount(plan.monthlyAmount),
      periods: buildDefaultRenewalPeriods(plan.monthlyAmount),
    })),
    updatedAt: null,
    createdAt: null,
  };
}

function normalizeRenewalPeriods(value, monthlyAmount) {
  const defaultPeriods = buildDefaultRenewalPeriods(monthlyAmount);
  const requested = Array.isArray(value) ? value : [];
  const seenMonths = new Set();
  const normalized = requested
    .map((item) => {
      const months = Math.max(1, Math.min(12, Math.round(Number(item?.months) || 0)));
      if (!months || seenMonths.has(months)) {
        return null;
      }
      seenMonths.add(months);
      const discountPercent = Math.max(0, Math.min(100, Number(item?.discountPercent) || 0));
      const calculatedAmount = roundCurrencyAmount(Number(monthlyAmount) * months * (1 - discountPercent / 100));
      const amount = roundCurrencyAmount(Number(item?.amount));
      return {
        months,
        days: months * 30,
        discountPercent,
        amount: amount > 0 ? amount : calculatedAmount,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.months - b.months);
  return normalized.length > 0 ? normalized : defaultPeriods;
}

function normalizeSubscriptionSettings(value) {
  const defaults = buildDefaultSubscriptionSettings();
  const source = value?.value ? value.value : value || {};
  const plans = Object.keys(defaultSubscriptionPlanCatalog).map((planKey) => {
    const defaultPlan = defaults.plans.find((plan) => plan.planKey === planKey);
    const requestedPlan =
      (Array.isArray(source.plans) ? source.plans : []).find((plan) => String(plan?.planKey || '') === planKey) || {};
    const monthlyAmount = roundCurrencyAmount(
      Number(requestedPlan.monthlyAmount) > 0 ? requestedPlan.monthlyAmount : defaultPlan.monthlyAmount
    );
    return {
      planKey,
      label: String(requestedPlan.label || defaultPlan.label || planKey).trim() || defaultPlan.label,
      monthlyAmount,
      periods: normalizeRenewalPeriods(requestedPlan.periods, monthlyAmount),
    };
  });
  return {
    currency: String(source.currency || defaults.currency).trim().toUpperCase() || defaults.currency,
    manualExtensionDays:
      Number.isFinite(Number(source.manualExtensionDays)) && Number(source.manualExtensionDays) > 0
        ? Math.max(1, Math.round(Number(source.manualExtensionDays)))
        : defaults.manualExtensionDays,
    paymentGateways: {
      paystackEnabled:
        source?.paymentGateways?.paystackEnabled === undefined
          ? defaults.paymentGateways.paystackEnabled
          : Boolean(source.paymentGateways.paystackEnabled),
    },
    plans,
    updatedAt: source.updatedAt || value?.updatedAt || null,
    createdAt: source.createdAt || value?.createdAt || null,
  };
}

async function loadSubscriptionSettings(masterDb) {
  const record = await masterDb.collection(SUBSCRIPTION_SETTINGS_COLLECTION).findOne({ _id: 'config' });
  return normalizeSubscriptionSettings(record?.value || record || {});
}

async function saveSubscriptionSettings(masterDb, settings) {
  const normalized = normalizeSubscriptionSettings(settings);
  const now = new Date().toISOString();
  await masterDb.collection(SUBSCRIPTION_SETTINGS_COLLECTION).updateOne(
    { _id: 'config' },
    {
      $set: {
        value: {
          currency: normalized.currency,
          manualExtensionDays: normalized.manualExtensionDays,
          paymentGateways: normalized.paymentGateways,
          plans: normalized.plans,
          updatedAt: now,
        },
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
  return {
    ...normalized,
    updatedAt: now,
    createdAt: normalized.createdAt || now,
  };
}

async function generateUniqueActivationCode(masterDb) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = crypto
      .randomBytes(8)
      .toString('base64')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, ACTIVATION_CODE_LENGTH);
    if (code.length !== ACTIVATION_CODE_LENGTH) {
      continue;
    }
    const existing = await masterDb.collection('tenants').findOne({ activationCode: code }, { projection: { _id: 1 } });
    if (!existing) {
      return code;
    }
  }
  return crypto.randomUUID().replace(/-/g, '').toUpperCase().slice(0, ACTIVATION_CODE_LENGTH);
}

async function ensureActivationCodeIsUnique(masterDb, activationCode, tenantIdToExclude = '') {
  const normalizedCode = normalizeActivationCode(activationCode);
  if (normalizedCode.length !== ACTIVATION_CODE_LENGTH) {
    return normalizedCode;
  }
  const existing = await masterDb.collection('tenants').findOne(
    {
      activationCode: normalizedCode,
      tenantId: {
        $ne: normalizeTenantId(tenantIdToExclude) || '',
      },
    },
    { projection: { _id: 1, tenantId: 1 } }
  );
  if (existing) {
    throw new Error('Activation code already exists for another tenant');
  }
  return normalizedCode;
}

function getPlanSubscriptionSettings(subscriptionSettings, packageType) {
  const normalizedPlanKey = String(packageType || 'basic').trim().toLowerCase();
  return (
    subscriptionSettings.plans.find((plan) => String(plan.planKey || '').trim().toLowerCase() === normalizedPlanKey) ||
    subscriptionSettings.plans[0]
  );
}

function getTenantExpiryDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(`${String(value).slice(0, 10)}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftTenantExpiry(subscriptionExpiresAt, deltaDays) {
  const currentExpiry = getTenantExpiryDate(subscriptionExpiresAt);
  const today = new Date();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 0);
  let baseDate = currentExpiry || todayEnd;
  if (deltaDays >= 0 && (!currentExpiry || currentExpiry.getTime() < todayEnd.getTime())) {
    baseDate = todayEnd;
  }
  const nextExpiry = new Date(baseDate.getTime() + Number(deltaDays || 0) * SUBSCRIPTION_DAY_MS);
  return nextExpiry.toISOString().slice(0, 10);
}

function buildTenantSubscriptionPublicSummary(tenant, subscriptionSettings) {
  const plan = getPlanSubscriptionSettings(subscriptionSettings, tenant?.packageType || 'basic');
  const basePeriods = Array.isArray(plan?.periods) ? plan.periods : [];
  const periods = applyTenantPricingOverrides(basePeriods, tenant?.subscriptionPricingOverrides);
  return {
    tenantId: String(tenant?.tenantId || ''),
    tenantName: String(tenant?.name || tenant?.tenantId || ''),
    packageType: String(tenant?.packageType || 'basic'),
    planLabel: String(plan?.label || tenant?.packageType || 'Plan'),
    currency: subscriptionSettings.currency,
    subscriptionExpiresAt: tenant?.subscriptionExpiresAt || null,
    subscriptionDaysRemaining: getSubscriptionDaysRemaining(tenant?.subscriptionExpiresAt),
    subscriptionExpired: isTenantSubscriptionExpired(tenant),
    manualExtensionDays: subscriptionSettings.manualExtensionDays,
    paymentGateways: subscriptionSettings.paymentGateways,
    periods,
  };
}

function buildTenantSubscriptionAdminSummary(tenant, subscriptionSettings) {
  const basePublic = buildTenantSubscriptionPublicSummary(tenant, subscriptionSettings);
  const pricingOverrides = normalizeTenantPricingOverrides(tenant?.subscriptionPricingOverrides, []);
  return {
    ...basePublic,
    activationCode: String(tenant?.activationCode || ''),
    lastPaymentAt: tenant?.lastPaymentAt || null,
    totalPaidAmount: roundCurrencyAmount(tenant?.totalPaidAmount || 0),
    subscriptionPricingOverrides: pricingOverrides,
  };
}

async function extendTenantSubscription(masterDb, tenantId, deltaDays, metadata = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const tenant = await masterDb.collection('tenants').findOne({ tenantId: normalizedTenantId });
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  const nextExpiry = shiftTenantExpiry(tenant.subscriptionExpiresAt, deltaDays);
  const now = new Date().toISOString();
  const update = {
    subscriptionExpiresAt: nextExpiry,
    updatedAt: now,
  };
  if (metadata.markPaid) {
    update.lastPaymentAt = now;
    update.totalPaidAmount = roundCurrencyAmount(Number(tenant.totalPaidAmount || 0) + Number(metadata.amount || 0));
  }
  await masterDb.collection('tenants').updateOne({ tenantId: normalizedTenantId }, { $set: update });
  const updatedTenant = await masterDb.collection('tenants').findOne({ tenantId: normalizedTenantId });
  return updatedTenant;
}

async function recordTenantPayment(masterDb, payload) {
  const now = new Date().toISOString();
  const record = {
    tenantId: String(payload?.tenantId || '').trim().toLowerCase(),
    tenantName: String(payload?.tenantName || '').trim(),
    packageType: String(payload?.packageType || '').trim().toLowerCase(),
    reference: String(payload?.reference || crypto.randomUUID()),
    provider: String(payload?.provider || 'manual'),
    channel: String(payload?.channel || ''),
    status: String(payload?.status || 'pending'),
    currency: String(payload?.currency || SUBSCRIPTION_DEFAULT_CURRENCY).trim().toUpperCase(),
    amount: roundCurrencyAmount(payload?.amount || 0),
    months: Math.max(0, Math.round(Number(payload?.months) || 0)),
    daysAdded: Math.round(Number(payload?.daysAdded) || 0),
    customerEmail: String(payload?.customerEmail || '').trim(),
    reason: String(payload?.reason || '').trim(),
    metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    createdAt: payload?.createdAt || now,
    updatedAt: now,
    appliedAt: payload?.appliedAt || null,
  };
  await masterDb.collection(TENANT_PAYMENTS_COLLECTION).updateOne(
    { reference: record.reference },
    {
      $set: record,
      $setOnInsert: {
        createdAt: record.createdAt,
      },
    },
    { upsert: true }
  );
  return record;
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${protocol}://${host}` : '';
}

function sanitizeUser(user, tenantId, tenant) {
  return {
    id: String(user?._id || ''),
    username: String(user?.username || ''),
    fullName: String(user?.fullName || user?.username || ''),
    role: String(user?.role || ''),
    employeeId: String(user?.employeeId || ''),
    isActive: Boolean(user?.isActive),
    tenantId: String(tenantId || 'master'),
    tenantName: String(tenant?.name || tenantId || ''),
    packageType: tenant?.packageType || (tenantId === 'master' ? 'enterprise' : undefined),
    subscriptionExpiresAt: tenant?.subscriptionExpiresAt || null,
    subscriptionDaysRemaining: tenantId === 'master' ? null : getSubscriptionDaysRemaining(tenant?.subscriptionExpiresAt),
    allowedModules: resolveUserAllowedModulesForTenant({ user, tenant, tenantId, defaultEmployeeModules }),
    employeeStatus: String(user?.employeeStatus || ''),
    employeeEmploymentState: String(user?.employeeEmploymentState || ''),
    accountDisabledReason: String(user?.accountDisabledReason || ''),
  };
}

async function ensureTenantIndexes(db) {
  await Promise.allSettled([
    db.collection('users').createIndex({ username: 1 }, { unique: true }),
    db.collection('users').createIndex({ employeeId: 1 }, { unique: true, sparse: true }),
    db.collection('employees').createIndex({ id: 1 }, { unique: true }),
    db.collection('authSessions').createIndex({ tokenId: 1 }, { unique: true }),
    db.collection('authSessions').createIndex({ userId: 1, revokedAt: 1 }),
  ]);
}

async function loadAuthUserFromToken(req) {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  if (!token) {
    return null;
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
  if (!payload?.sub || !ObjectId.isValid(payload.sub)) {
    return null;
  }
  const user = await req.db.collection('users').findOne({
    _id: new ObjectId(payload.sub),
    isActive: true,
  });
  if (!user) {
    return null;
  }
  if (payload.jti) {
    const activeSession = await req.db.collection('authSessions').findOne({
      tokenId: payload.jti,
      revokedAt: null,
      expiresAt: { $gt: new Date().toISOString() },
    });
    if (!activeSession) {
      return null;
    }
  }
  const employeeAccessState = await getLinkedEmployeeAccessState(req.db, user);
  if (employeeAccessState.blocked) {
    return null;
  }
  return { user, payload, token };
}

async function requireSuperAdmin(req, res, next) {
  try {
    const auth = await loadAuthUserFromToken(req);
    if (!auth || String(auth.user.role || '').toLowerCase() !== 'superadmin' || req.tenantId !== 'master') {
      res.status(403).json({ error: 'Super admin access is required' });
      return;
    }
    req.authUser = auth.user;
    req.authTokenPayload = auth.payload;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization failed' });
  }
}

function normalizeModuleIds(value) {
  const moduleSet = new Set(allModules);
  const requestedModules = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim());
  return requestedModules.filter((moduleId) => moduleSet.has(moduleId));
}

async function requireUserManagementAccess(req, res, next) {
  try {
    const auth = await loadAuthUserFromToken(req);
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const role = String(auth.user.role || '').toLowerCase();
    if (role === 'superadmin' && req.tenantId === 'master') {
      req.authUser = auth.user;
      req.authTokenPayload = auth.payload;
      next();
      return;
    }
    if (req.tenantId === 'master') {
      res.status(403).json({ error: 'Super admin access is required' });
      return;
    }
    const allowedModules = resolveUserAllowedModulesForTenant({ user: auth.user, tenant: req.tenant, tenantId: req.tenantId, defaultEmployeeModules });
    if (role === 'employee' || !allowedModules.includes('user-management')) {
      res.status(403).json({ error: 'User management access is required' });
      return;
    }
    req.authUser = auth.user;
    req.authTokenPayload = auth.payload;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization failed' });
  }
}

function getRoleLevel(value) {
  return roleRank[String(value || '').trim().toLowerCase()] || 0;
}

async function syncUserAccessToEmployeeRecord(db, userLikeRecord) {
  const employeeId = String(userLikeRecord?.employeeId || '').trim();
  if (!employeeId) {
    return;
  }
  await db.collection('employees').updateOne(
    { id: employeeId },
    {
      $set: {
        fullName: String(userLikeRecord?.fullName || '').trim(),
        role: String(userLikeRecord?.role || 'employee').trim().toLowerCase(),
        allowedModules: normalizeModuleIds(userLikeRecord?.allowedModules),
        updatedAt: new Date().toISOString(),
      },
    }
  );
}

async function createTenantAdminUser(db, tenantId, payload) {
  const now = new Date().toISOString();
  const adminUsername = String(payload.adminUsername || '').trim();
  const adminPassword = String(payload.adminPassword || '').trim();
  const adminFullName = String(payload.adminFullName || adminUsername || `${tenantId} Admin`).trim();
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await db.collection('users').insertOne({
    username: adminUsername,
    fullName: adminFullName,
    employeeId: '',
    passwordHash,
    role: 'admin',
    allowedModules: resolveTenantGrantedModules(payload.packageType, payload.grantedModules),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function ensureSuperAdmin(masterDb) {
  await ensureTenantIndexes(masterDb);
  const users = masterDb.collection('users');
  const now = new Date().toISOString();
  const existing = await users.findOne({ username: SUPERADMIN_USERNAME });
  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10);
  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      {
        $set: {
          fullName: SUPERADMIN_FULL_NAME,
          passwordHash,
          role: 'superadmin',
          allowedModules: ['*'],
          isActive: true,
          updatedAt: now,
        },
      }
    );
    return;
  }
  await users.insertOne({
    username: SUPERADMIN_USERNAME,
    fullName: SUPERADMIN_FULL_NAME,
    employeeId: '',
    passwordHash,
    role: 'superadmin',
    allowedModules: ['*'],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

router.get('/subscription/public-status', async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.query?.tenantId);
    if (!tenantId || tenantId === 'master') {
      res.status(400).json({ error: 'A tenant ID is required' });
      return;
    }
    const [tenant, subscriptionSettings] = await Promise.all([
      req.masterDb.collection('tenants').findOne({ tenantId }),
      loadSubscriptionSettings(req.masterDb),
    ]);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    res.json({
      tenant: buildTenantSubscriptionPublicSummary(tenant, subscriptionSettings),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load subscription status' });
  }
});

router.post('/subscription/manual-extend', async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.body?.tenantId);
    const activationCode = normalizeActivationCode(req.body?.activationCode);
    if (!tenantId || !activationCode) {
      res.status(400).json({ error: 'Tenant ID and activation code are required' });
      return;
    }
    const [tenant, subscriptionSettings] = await Promise.all([
      req.masterDb.collection('tenants').findOne({ tenantId }),
      loadSubscriptionSettings(req.masterDb),
    ]);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    if (activationCode.length !== ACTIVATION_CODE_LENGTH || activationCode !== normalizeActivationCode(tenant.activationCode)) {
      res.status(403).json({ error: 'Invalid activation code' });
      return;
    }
    const updatedTenant = await extendTenantSubscription(req.masterDb, tenantId, subscriptionSettings.manualExtensionDays);
    const summary = buildTenantSubscriptionPublicSummary(updatedTenant, subscriptionSettings);
    await recordTenantPayment(req.masterDb, {
      tenantId,
      tenantName: updatedTenant.name || updatedTenant.tenantId,
      packageType: updatedTenant.packageType,
      reference: `manual-${tenantId}-${Date.now()}`,
      provider: 'manual-code',
      status: 'success',
      currency: subscriptionSettings.currency,
      amount: 0,
      months: 1,
      daysAdded: subscriptionSettings.manualExtensionDays,
      reason: 'Manual activation code extension',
      appliedAt: new Date().toISOString(),
      metadata: {
        mode: 'manual-code',
      },
    });
    res.json({
      ok: true,
      tenant: summary,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to extend subscription manually' });
  }
});

router.post('/subscription/paystack/initialize', async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      res.status(400).json({ error: 'Paystack secret key is not configured' });
      return;
    }
    const tenantId = normalizeTenantId(req.body?.tenantId);
    const customerEmail = String(req.body?.email || '').trim().toLowerCase();
    const selectedMonths = Math.max(1, Math.min(12, Math.round(Number(req.body?.months) || 0)));
    const returnUrl = String(req.body?.returnUrl || '').trim();
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }
    if (!isValidEmail(customerEmail)) {
      res.status(400).json({ error: 'A valid payment email is required' });
      return;
    }
    if (!selectedMonths) {
      res.status(400).json({ error: 'Renewal period is required' });
      return;
    }
    const [tenant, subscriptionSettings] = await Promise.all([
      req.masterDb.collection('tenants').findOne({ tenantId }),
      loadSubscriptionSettings(req.masterDb),
    ]);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    if (!subscriptionSettings.paymentGateways.paystackEnabled) {
      res.status(403).json({ error: 'Paystack payments are disabled' });
      return;
    }
    const plan = getPlanSubscriptionSettings(subscriptionSettings, tenant.packageType);
    const effectivePeriods = applyTenantPricingOverrides(plan?.periods || [], tenant?.subscriptionPricingOverrides);
    const period = effectivePeriods.find((item) => Number(item.months) === selectedMonths);
    if (!period) {
      res.status(400).json({ error: 'Selected renewal period is not available for this tenant plan' });
      return;
    }
    const roundedAmount = roundCurrencyAmount(period.amount);
    if (roundedAmount <= 0) {
      res.status(400).json({ error: 'Subscription amount must be greater than zero' });
      return;
    }
    const reference = `pthr-${tenantId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    let redirectBase = (returnUrl || PAYSTACK_CALLBACK_BASE_URL || getRequestOrigin(req)).trim();
    if (redirectBase) {
      const lowerRedirect = redirectBase.toLowerCase();
      if (lowerRedirect.includes('paystack.co') || lowerRedirect.includes('paystack.com')) {
        redirectBase = '';
      } else if (!/^https?:\/\//i.test(redirectBase)) {
        redirectBase = `https://${redirectBase.replace(/^\/+/, '')}`;
      }
    }
    const callbackUrl = redirectBase
      ? `${redirectBase.replace(/\/+$/, '')}${redirectBase.includes('?') ? '&' : '?'}paystackReference=${encodeURIComponent(reference)}&tenantId=${encodeURIComponent(tenantId)}`
      : undefined;
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: Math.round(roundedAmount * 100),
        currency: String(subscriptionSettings.currency || SUBSCRIPTION_DEFAULT_CURRENCY).trim().toUpperCase(),
        reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: {
          tenantId,
          packageType: tenant.packageType,
          months: period.months,
          daysAdded: period.days,
        },
      }),
    });
    const paystackData = await paystackResponse.json().catch((jsonError) => {
      throw new Error(`Paystack returned an invalid response. ${extractResponseError(jsonError, 'Unable to parse Paystack response')}`);
    });
    if (!paystackResponse.ok) {
      const paystackMessage =
        paystackData && typeof paystackData === 'object' ? String(paystackData.message || '') : '';
      const statusHint =
        paystackResponse.status >= 400 && paystackResponse.status < 500
          ? 'Check your Paystack key, callback URL, and payment details.'
          : 'Paystack service issue. Please try again.';
      const errorMessage =
        paystackMessage ||
        `Unable to initialize Paystack payment (status ${paystackResponse.status}). ${statusHint}`;
      res.status(502).json({ error: errorMessage });
      return;
    }
    if (!paystackData?.status || !paystackData?.data?.authorization_url) {
      res.status(502).json({
        error:
          (paystackData && typeof paystackData === 'object' ? String(paystackData.message || '') : '') ||
          'Paystack did not return a checkout URL. Check your callback URL and Paystack configuration.',
      });
      return;
    }
    await recordTenantPayment(req.masterDb, {
      tenantId,
      tenantName: tenant.name || tenant.tenantId,
      packageType: tenant.packageType,
      reference,
      provider: 'paystack',
      channel: 'hosted-checkout',
      status: 'pending',
      currency: subscriptionSettings.currency,
      amount: roundedAmount,
      months: period.months,
      daysAdded: period.days,
      customerEmail,
      reason: 'Tenant subscription renewal',
      metadata: {
        accessCode: paystackData?.data?.access_code || '',
        callbackUrl: callbackUrl || '',
      },
    });
    res.json({
      ok: true,
      authorizationUrl: paystackData.data.authorization_url,
      reference,
      publicKeyAvailable: Boolean(PAYSTACK_PUBLIC_KEY),
    });
  } catch (error) {
    res.status(500).json({ error: extractResponseError(error, 'Failed to initialize payment') });
  }
});

router.get('/subscription/paystack/verify', async (req, res) => {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      res.status(400).json({ error: 'Paystack secret key is not configured' });
      return;
    }
    const reference = String(req.query?.reference || '').trim();
    if (!reference) {
      res.status(400).json({ error: 'Payment reference is required' });
      return;
    }
    const paymentRecord = await req.masterDb.collection(TENANT_PAYMENTS_COLLECTION).findOne({ reference });
    if (!paymentRecord) {
      res.status(404).json({ error: 'Payment record not found' });
      return;
    }
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });
    const verifyData = await verifyResponse.json().catch(() => null);
    if (!verifyResponse.ok) {
      const paystackMessage =
        verifyData && typeof verifyData === 'object' ? String(verifyData.message || '') : '';
      res.status(502).json({
        error:
          paystackMessage ||
          `Unable to verify payment with Paystack (status ${verifyResponse.status}). Please try again.`,
      });
      return;
    }
    if (!verifyData?.status || !verifyData?.data) {
      res.status(502).json({
        error:
          (verifyData && typeof verifyData === 'object' ? String(verifyData.message || '') : '') ||
          'Paystack did not return verification details.',
      });
      return;
    }
    const transaction = verifyData.data;
    const paidSuccessfully = String(transaction.status || '').toLowerCase() === 'success';
    if (!paidSuccessfully) {
      await recordTenantPayment(req.masterDb, {
        ...paymentRecord,
        status: String(transaction.status || 'failed'),
        channel: String(transaction.channel || paymentRecord.channel || ''),
        metadata: {
          ...(paymentRecord.metadata || {}),
          paystackResponse: transaction,
        },
      });
      res.status(400).json({
        error:
          typeof transaction.gateway_response === 'string' && transaction.gateway_response
            ? `Payment failed: ${transaction.gateway_response}`
            : 'Payment was not successful',
      });
      return;
    }
    let updatedTenant = await req.masterDb.collection('tenants').findOne({ tenantId: paymentRecord.tenantId });
    if (!paymentRecord.appliedAt) {
      updatedTenant = await extendTenantSubscription(req.masterDb, paymentRecord.tenantId, paymentRecord.daysAdded, {
        markPaid: true,
        amount: paymentRecord.amount,
      });
      await recordTenantPayment(req.masterDb, {
        ...paymentRecord,
        status: 'success',
        channel: String(transaction.channel || paymentRecord.channel || ''),
        customerEmail: String(transaction.customer?.email || paymentRecord.customerEmail || ''),
        appliedAt: new Date().toISOString(),
        metadata: {
          ...(paymentRecord.metadata || {}),
          paystackResponse: transaction,
        },
      });
    }
    const subscriptionSettings = await loadSubscriptionSettings(req.masterDb);
    res.json({
      ok: true,
      tenant: buildTenantSubscriptionPublicSummary(updatedTenant, subscriptionSettings),
    });
  } catch (error) {
    res.status(500).json({ error: extractResponseError(error, 'Failed to verify payment') });
  }
});

router.get('/subscription/settings', requireSuperAdmin, async (req, res) => {
  try {
    const settings = await loadSubscriptionSettings(req.masterDb);
    res.json({ settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load subscription settings' });
  }
});

router.put('/subscription/settings', requireSuperAdmin, async (req, res) => {
  try {
    const settings = await saveSubscriptionSettings(req.masterDb, req.body || {});
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save subscription settings' });
  }
});

router.get('/subscription/payments', requireSuperAdmin, async (req, res) => {
  try {
    const payments = await req.masterDb.collection(TENANT_PAYMENTS_COLLECTION).find({}).sort({ createdAt: -1 }).limit(300).toArray();
    res.json({ payments });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load payment records' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.body?.tenantId);
    const identifier = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!tenantId || !identifier || !password) {
      res.status(400).json({ error: 'Tenant ID, username, and password are required' });
      return;
    }
    await ensureTenantIndexes(req.db);
    if (req.tenant && String(req.tenant.status || 'active') !== 'active') {
      res.status(403).json({ error: 'Tenant is inactive' });
      return;
    }
    if (req.tenantId !== 'master' && isTenantSubscriptionExpired(req.tenant)) {
      const subscriptionSettings = await loadSubscriptionSettings(req.masterDb);
      res.status(403).json({
        error:
          'Tenant subscription has expired. This tenant cannot sign in until payment is completed or a valid 12-character activation code is entered.',
        subscriptionExpired: true,
        tenant: buildTenantSubscriptionPublicSummary(req.tenant, subscriptionSettings),
      });
      return;
    }
    const users = req.db.collection('users');
    const usernameRegex = new RegExp(`^${escapeRegex(identifier)}$`, 'i');
    const user = await users.findOne({
      isActive: true,
      $or: [{ username: usernameRegex }, { employeeId: identifier }],
    });
    if (!user?.passwordHash) {
      res.status(401).json({ error: 'Invalid tenant ID, username, or password' });
      return;
    }
    const employeeAccessState = await getLinkedEmployeeAccessState(req.db, user);
    if (employeeAccessState.blocked) {
      res.status(403).json({
        error: `${employeeAccessState.reason}. This account cannot sign in.`,
      });
      return;
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      res.status(401).json({ error: 'Invalid tenant ID, username, or password' });
      return;
    }
    const role = String(user.role || '').toLowerCase();
    if (role !== 'superadmin' && req.tenantId !== 'master') {
      const limits = resolveTenantEffectiveLimits(req.tenant || {});
      const concurrentLimit = Number(limits.concurrentLoginLimit) || 0;
      if (concurrentLimit > 0) {
        const activeSessions = await req.db.collection('authSessions').countDocuments({
          userId: String(user._id),
          revokedAt: null,
          expiresAt: { $gt: new Date().toISOString() },
        });
        if (activeSessions >= concurrentLimit) {
          res.status(403).json({ error: `Concurrent login limit reached (${concurrentLimit}) for this tenant.` });
          return;
        }
      }
    }
    const tokenId = crypto.randomUUID();
    const token = jwt.sign(
      {
        sub: String(user._id),
        role: user.role,
        tenantId: req.tenantId,
        employeeId: user.employeeId || '',
        jti: tokenId,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    const now = new Date().toISOString();
    await req.db.collection('authSessions').insertOne({
      tokenId,
      userId: String(user._id),
      tenantId: req.tenantId,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
      expiresAt: getSessionExpiryIso(7),
    });
    res.json({
      token,
      user: sanitizeUser(user, req.tenantId, req.tenant),
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const auth = await loadAuthUserFromToken(req);
    if (!auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (req.tenantId !== 'master' && isTenantSubscriptionExpired(req.tenant)) {
      const subscriptionSettings = await loadSubscriptionSettings(req.masterDb);
      res.status(403).json({
        error:
          'Tenant subscription has expired. This tenant cannot sign in until payment is completed or a valid 12-character activation code is entered.',
        subscriptionExpired: true,
        tenant: buildTenantSubscriptionPublicSummary(req.tenant, subscriptionSettings),
      });
      return;
    }
    res.json({ user: sanitizeUser(auth.user, req.tenantId, req.tenant) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load current user' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const auth = await loadAuthUserFromToken(req);
    if (!auth) {
      res.json({ ok: true });
      return;
    }
    const now = new Date().toISOString();
    await req.db.collection('authSessions').updateMany(
      { tokenId: auth.payload.jti, revokedAt: null },
      { $set: { revokedAt: now, updatedAt: now } }
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/users', requireUserManagementAccess, async (req, res) => {
  try {
    await ensureTenantIndexes(req.db);
    const users = await req.db.collection('users').find({}).sort({ createdAt: -1, username: 1 }).toArray();
    const employees = await req.db
      .collection('employees')
      .find({}, { projection: { id: 1, status: 1, employmentState: 1 } })
      .toArray();
    const employeeById = new Map(employees.map((employee) => [String(employee.id || '').trim(), employee]).filter(([id]) => id));
    res.json({
      users: users.map((user) => {
        const linkedEmployee = employeeById.get(String(user.employeeId || '').trim()) || null;
        const accessReason = getEmployeeAccessBlockReason(linkedEmployee);
        return sanitizeUser(
          {
            ...user,
            employeeStatus: String(linkedEmployee?.status || ''),
            employeeEmploymentState: String(linkedEmployee?.employmentState || ''),
            accountDisabledReason: accessReason,
          },
          req.tenantId,
          req.tenant
        );
      }),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.post('/users', requireUserManagementAccess, async (req, res) => {
  try {
    await ensureTenantIndexes(req.db);
    const username = String(req.body?.username || '').trim();
    const fullName = String(req.body?.fullName || username).trim();
    const password = String(req.body?.password || '');
    const requestedRole = String(req.body?.role || 'employee').trim().toLowerCase();
    const employeeId = String(req.body?.employeeId || '').trim();
    const allowedModules = normalizeModuleIds(req.body?.allowedModules);
    const actorRole = String(req.authUser?.role || '').trim().toLowerCase();
    const actorRoleLevel = getRoleLevel(actorRole);
    const requestedRoleLevel = getRoleLevel(requestedRole);
    if (!username || !fullName || !password) {
      res.status(400).json({ error: 'Username, full name, and password are required' });
      return;
    }
    if (!requestedRoleLevel) {
      res.status(400).json({ error: 'Invalid role selected' });
      return;
    }
    const isMasterSuperAdmin = actorRole === 'superadmin' && req.tenantId === 'master';
    if (!isMasterSuperAdmin && requestedRole === 'superadmin') {
      res.status(403).json({ error: 'Only the master super admin can create super admin users' });
      return;
    }
    if (!isMasterSuperAdmin && requestedRoleLevel >= actorRoleLevel) {
      res.status(403).json({ error: 'You can only create users with a lower role than your own' });
      return;
    }
    if (!isMasterSuperAdmin) {
      const actorAllowedModules = new Set(resolveUserAllowedModulesForTenant({ user: req.authUser, tenant: req.tenant, tenantId: req.tenantId, defaultEmployeeModules }));
      const hasForbiddenModule = allowedModules.some((moduleId) => !actorAllowedModules.has(moduleId));
      if (hasForbiddenModule) {
        res.status(403).json({ error: 'You can only assign modules that are already enabled for your account' });
        return;
      }
    }
    const existingUser = await req.db.collection('users').findOne({
      $or: [{ username: new RegExp(`^${escapeRegex(username)}$`, 'i') }, ...(employeeId ? [{ employeeId }] : [])],
    });
    if (existingUser) {
      res.status(409).json({ error: employeeId && existingUser.employeeId === employeeId ? 'Employee ID already exists' : 'Username already exists' });
      return;
    }
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(password, 10);
    const userDoc = {
      username,
      fullName,
      passwordHash,
      role: requestedRole,
      employeeId,
      allowedModules,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    const result = await req.db.collection('users').insertOne(userDoc);
    await syncUserAccessToEmployeeRecord(req.db, userDoc);
    res.status(201).json({
      user: sanitizeUser({ ...userDoc, _id: result.insertedId }, req.tenantId, req.tenant),
    });
  } catch (error) {
    if (error?.code === 11000) {
      res.status(409).json({ error: 'Username or employee ID already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:userId', requireUserManagementAccess, async (req, res) => {
  try {
    await ensureTenantIndexes(req.db);
    const userId = String(req.params?.userId || '').trim();
    if (!ObjectId.isValid(userId)) {
      res.status(400).json({ error: 'Invalid user selected' });
      return;
    }
    const existingUser = await req.db.collection('users').findOne({ _id: new ObjectId(userId) });
    if (!existingUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const actorRole = String(req.authUser?.role || '').trim().toLowerCase();
    const actorRoleLevel = getRoleLevel(actorRole);
    const targetRoleLevel = getRoleLevel(existingUser.role);
    const requestedRole = String(req.body?.role || existingUser.role || 'employee').trim().toLowerCase();
    const requestedRoleLevel = getRoleLevel(requestedRole);
    const isMasterSuperAdmin = actorRole === 'superadmin' && req.tenantId === 'master';
    if (!requestedRoleLevel) {
      res.status(400).json({ error: 'Invalid role selected' });
      return;
    }
    if (!isMasterSuperAdmin && String(existingUser.role || '').trim().toLowerCase() === 'superadmin') {
      res.status(403).json({ error: 'Only the master super admin can edit super admin users' });
      return;
    }
    if (!isMasterSuperAdmin && targetRoleLevel >= actorRoleLevel) {
      res.status(403).json({ error: 'You can only edit users with a lower role than your own' });
      return;
    }
    if (!isMasterSuperAdmin && requestedRole === 'superadmin') {
      res.status(403).json({ error: 'Only the master super admin can assign super admin role' });
      return;
    }
    if (!isMasterSuperAdmin && requestedRoleLevel >= actorRoleLevel) {
      res.status(403).json({ error: 'You can only assign a lower role than your own' });
      return;
    }
    const allowedModules = normalizeModuleIds(req.body?.allowedModules);
    if (!isMasterSuperAdmin) {
      const actorAllowedModules = new Set(
        resolveUserAllowedModulesForTenant({ user: req.authUser, tenant: req.tenant, tenantId: req.tenantId, defaultEmployeeModules })
      );
      const hasForbiddenModule = allowedModules.some((moduleId) => !actorAllowedModules.has(moduleId));
      if (hasForbiddenModule) {
        res.status(403).json({ error: 'You can only assign modules that are already enabled for your account' });
        return;
      }
    }
    const fullName = String(req.body?.fullName || existingUser.fullName || existingUser.username || '').trim();
    const isActive = req.body?.isActive === undefined ? existingUser.isActive !== false : Boolean(req.body?.isActive);
    const password = String(req.body?.password || '');
    const now = new Date().toISOString();
    const update = {
      fullName: fullName || existingUser.username,
      role: requestedRole,
      allowedModules,
      isActive,
      updatedAt: now,
    };
    if (password) {
      update.passwordHash = await bcrypt.hash(password, 10);
    }
    await req.db.collection('users').updateOne({ _id: existingUser._id }, { $set: update });
    const updatedUser = await req.db.collection('users').findOne({ _id: existingUser._id });
    await syncUserAccessToEmployeeRecord(req.db, updatedUser);
    res.json({
      user: sanitizeUser(updatedUser, req.tenantId, req.tenant),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.get('/tenant-packages', requireSuperAdmin, async (req, res) => {
  try {
    const subscriptionSettings = await loadSubscriptionSettings(req.masterDb);
    res.json({
      modules: [...allModules],
      packages: Object.entries(packageDefaults).map(([id, value]) => ({
        id,
        modules: value.modules,
        employeeLimit: value.employeeLimit,
        concurrentLoginLimit: value.concurrentLoginLimit,
        subscription:
          subscriptionSettings.plans.find((plan) => String(plan.planKey || '').trim().toLowerCase() === id) || null,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load tenant packages' });
  }
});

router.get('/tenants', requireSuperAdmin, async (req, res) => {
  try {
    const subscriptionSettings = await loadSubscriptionSettings(req.masterDb);
    const rows = await req.masterDb.collection('tenants').find({}).sort({ createdAt: -1 }).toArray();
    const tenants = rows.map((tenant) => {
      const limits = resolveTenantEffectiveLimits(tenant);
      const plan = getPlanSubscriptionSettings(subscriptionSettings, tenant.packageType || 'basic');
      const basePeriods = Array.isArray(plan?.periods) ? plan.periods : [];
      const storedOverrides = normalizeTenantPricingOverrides(tenant?.subscriptionPricingOverrides, []);
      const periods = applyTenantPricingOverrides(basePeriods, storedOverrides);
      return {
        id: String(tenant._id || tenant.tenantId),
        tenantId: tenant.tenantId,
        name: tenant.name || tenant.tenantId,
        packageType: tenant.packageType || 'basic',
        planLabel: plan?.label || tenant.packageType || 'basic',
        grantedModules: resolveTenantGrantedModules(tenant.packageType, tenant.grantedModules),
        employeeLimitOverride: tenant.employeeLimitOverride || null,
        concurrentLoginLimitOverride: tenant.concurrentLoginLimitOverride || null,
        employeeLimit: limits.employeeLimit,
        concurrentLoginLimit: limits.concurrentLoginLimit,
        dbName: tenant.dbName,
        subscriptionExpiresAt: tenant.subscriptionExpiresAt || null,
        subscriptionDaysRemaining: getSubscriptionDaysRemaining(tenant.subscriptionExpiresAt),
        activationCode: tenant.activationCode || '',
        lastPaymentAt: tenant.lastPaymentAt || null,
        totalPaidAmount: roundCurrencyAmount(tenant.totalPaidAmount || 0),
        status: tenant.status || 'active',
        subscriptionPricingOverrides: storedOverrides,
        periods,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      };
    });
    res.json({ tenants });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load tenants' });
  }
});

router.get('/tenants/:tenantId/subscription', requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.params.tenantId);
    const [tenant, settings] = await Promise.all([
      req.masterDb.collection('tenants').findOne({ tenantId }),
      loadSubscriptionSettings(req.masterDb),
    ]);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    const payments = await req.masterDb
      .collection(TENANT_PAYMENTS_COLLECTION)
      .find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    res.json({
      tenant: buildTenantSubscriptionAdminSummary(tenant, settings),
      payments,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load tenant subscription' });
  }
});

router.put('/tenants/:tenantId/subscription', requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.params.tenantId);
    const existingTenant = await req.masterDb.collection('tenants').findOne({ tenantId });
    if (!existingTenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    const requestedDaysDelta = Math.round(Number(req.body?.daysDelta) || 0);
    const regenerateActivationCode = Boolean(req.body?.regenerateActivationCode);
    const requestedActivationCode = normalizeActivationCode(req.body?.activationCode);
    const settings = await loadSubscriptionSettings(req.masterDb);
    const plan = getPlanSubscriptionSettings(settings, existingTenant?.packageType || 'basic');
    const requestedPricingOverrides = normalizeTenantPricingOverrides(req.body?.pricingOverrides, plan?.periods || []);
    const update = {
      updatedAt: new Date().toISOString(),
    };
    let subscriptionPricingChanged = false;
    const normalizedExistingOverrides = normalizeTenantPricingOverrides(existingTenant?.subscriptionPricingOverrides, plan?.periods || []);
    const overrideKeys = new Set([...Object.keys(normalizedExistingOverrides), ...Object.keys(requestedPricingOverrides)]);
    for (const key of overrideKeys) {
      if (Number(normalizedExistingOverrides[key]) !== Number(requestedPricingOverrides[key])) {
        subscriptionPricingChanged = true;
        break;
      }
    }
    if (subscriptionPricingChanged) {
      update.subscriptionPricingOverrides = requestedPricingOverrides;
    }
    if (requestedDaysDelta !== 0) {
      update.subscriptionExpiresAt = shiftTenantExpiry(existingTenant.subscriptionExpiresAt, requestedDaysDelta);
    }
    if (regenerateActivationCode) {
      update.activationCode = await generateUniqueActivationCode(req.masterDb);
    } else if (requestedActivationCode.length === ACTIVATION_CODE_LENGTH) {
      update.activationCode = await ensureActivationCodeIsUnique(req.masterDb, requestedActivationCode, tenantId);
    }
    const hasChanges = Object.keys(update).length > 1 || Object.keys(update).some((key) => key !== 'updatedAt');
    if (hasChanges) {
      await req.masterDb.collection('tenants').updateOne({ tenantId }, { $set: update });
    }
    const updatedTenant = await req.masterDb.collection('tenants').findOne({ tenantId });
    if (requestedDaysDelta !== 0) {
      await recordTenantPayment(req.masterDb, {
        tenantId,
        tenantName: updatedTenant.name || updatedTenant.tenantId,
        packageType: updatedTenant.packageType,
        reference: `admin-adjust-${tenantId}-${Date.now()}`,
        provider: 'admin-adjustment',
        status: 'success',
        currency: settings.currency,
        amount: 0,
        months: 0,
        daysAdded: requestedDaysDelta,
        reason: String(req.body?.reason || 'Admin subscription day adjustment'),
        appliedAt: new Date().toISOString(),
        metadata: {
          actor: String(req.authUser?.username || 'superadmin'),
        },
      });
    }
    res.json({
      ok: true,
      tenant: buildTenantSubscriptionAdminSummary(updatedTenant, settings),
    });
  } catch (error) {
    res.status(500).json({ error: extractResponseError(error, 'Failed to update tenant subscription') });
  }
});

router.post('/tenants', requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.body?.tenantId);
    const name = String(req.body?.name || '').trim();
    const packageType = String(req.body?.packageType || 'basic').trim().toLowerCase();
    const adminUsername = String(req.body?.adminUsername || '').trim();
    const adminPassword = String(req.body?.adminPassword || '').trim();
    if (!tenantId || !name || !adminUsername || !adminPassword) {
      res.status(400).json({ error: 'Tenant ID, name, admin username, and admin password are required' });
      return;
    }
    const existingTenant = await req.masterDb.collection('tenants').findOne({ tenantId });
    if (existingTenant) {
      res.status(409).json({ error: `Tenant ${tenantId} already exists.` });
      return;
    }
    const dbName = `tenant-${tenantId}`;
    const now = new Date().toISOString();
    const grantedModules = resolveTenantGrantedModules(packageType, req.body?.grantedModules);
    const requestedActivationCode = normalizeActivationCode(req.body?.activationCode);
    const subscriptionSettings = await loadSubscriptionSettings(req.masterDb);
    const plan = getPlanSubscriptionSettings(subscriptionSettings, packageType);
    const subscriptionPricingOverrides = normalizeTenantPricingOverrides(req.body?.pricingOverrides, plan?.periods || []);
    const activationCode =
      requestedActivationCode.length === ACTIVATION_CODE_LENGTH
        ? await ensureActivationCodeIsUnique(req.masterDb, requestedActivationCode)
        : await generateUniqueActivationCode(req.masterDb);
    const tenantPayload = {
      tenantId,
      name,
      packageType,
      dbName,
      activationCode,
      grantedModules,
      employeeLimitOverride:
        Number.isFinite(Number(req.body?.employeeLimitOverride)) && Number(req.body?.employeeLimitOverride) > 0
          ? Math.floor(Number(req.body.employeeLimitOverride))
          : null,
      concurrentLoginLimitOverride:
        Number.isFinite(Number(req.body?.concurrentLoginLimitOverride)) && Number(req.body?.concurrentLoginLimitOverride) > 0
          ? Math.floor(Number(req.body.concurrentLoginLimitOverride))
          : null,
      subscriptionExpiresAt: req.body?.subscriptionExpiresAt ? String(req.body.subscriptionExpiresAt).slice(0, 10) : null,
      subscriptionPricingOverrides,
      totalPaidAmount: 0,
      lastPaymentAt: null,
      status: String(req.body?.status || 'active') === 'inactive' ? 'inactive' : 'active',
      createdAt: now,
      updatedAt: now,
    };
    await req.masterDb.collection('tenants').insertOne(tenantPayload);
    const tenantDb = req.getDbByName(dbName);
    await ensureTenantIndexes(tenantDb);
    await createTenantAdminUser(tenantDb, tenantId, {
      ...req.body,
      packageType,
      grantedModules,
    });
    res.status(201).json({ ok: true, tenant: tenantPayload });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

router.put('/tenants/:tenantId', requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.params.tenantId);
    const existingTenant = await req.masterDb.collection('tenants').findOne({ tenantId });
    if (!existingTenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    const packageType = String(req.body?.packageType || existingTenant.packageType || 'basic').trim().toLowerCase();
    const requestedActivationCode = normalizeActivationCode(req.body?.activationCode);
    const regenerateActivationCode = Boolean(req.body?.regenerateActivationCode);
    const subscriptionSettings = await loadSubscriptionSettings(req.masterDb);
    const plan = getPlanSubscriptionSettings(subscriptionSettings, packageType);
    const requestedPricingOverrides = normalizeTenantPricingOverrides(req.body?.pricingOverrides, plan?.periods || []);
    const normalizedExistingOverrides = normalizeTenantPricingOverrides(existingTenant?.subscriptionPricingOverrides, plan?.periods || []);
    let subscriptionPricingChanged = false;
    const overrideKeys = new Set([...Object.keys(normalizedExistingOverrides), ...Object.keys(requestedPricingOverrides)]);
    for (const key of overrideKeys) {
      if (Number(normalizedExistingOverrides[key]) !== Number(requestedPricingOverrides[key])) {
        subscriptionPricingChanged = true;
        break;
      }
    }
    const update = {
      name: String(req.body?.name || existingTenant.name || tenantId).trim(),
      packageType,
      grantedModules: resolveTenantGrantedModules(packageType, req.body?.grantedModules),
      employeeLimitOverride:
        Number.isFinite(Number(req.body?.employeeLimitOverride)) && Number(req.body?.employeeLimitOverride) > 0
          ? Math.floor(Number(req.body.employeeLimitOverride))
          : null,
      concurrentLoginLimitOverride:
        Number.isFinite(Number(req.body?.concurrentLoginLimitOverride)) && Number(req.body?.concurrentLoginLimitOverride) > 0
          ? Math.floor(Number(req.body.concurrentLoginLimitOverride))
          : null,
      subscriptionExpiresAt: req.body?.subscriptionExpiresAt ? String(req.body.subscriptionExpiresAt).slice(0, 10) : null,
      status: String(req.body?.status || 'active') === 'inactive' ? 'inactive' : 'active',
      updatedAt: new Date().toISOString(),
    };
    if (subscriptionPricingChanged) {
      update.subscriptionPricingOverrides = requestedPricingOverrides;
    }
    if (regenerateActivationCode) {
      update.activationCode = await generateUniqueActivationCode(req.masterDb);
    } else if (requestedActivationCode.length === ACTIVATION_CODE_LENGTH) {
      update.activationCode = await ensureActivationCodeIsUnique(req.masterDb, requestedActivationCode, tenantId);
    } else {
      update.activationCode = existingTenant.activationCode || '';
    }
    await req.masterDb.collection('tenants').updateOne({ tenantId }, { $set: update });
    const tenantDb = req.getDbByName(existingTenant.dbName);
    await ensureTenantIndexes(tenantDb);
    await tenantDb.collection('users').updateMany(
      { role: 'admin' },
      { $set: { allowedModules: update.grantedModules, updatedAt: update.updatedAt } }
    );
    res.json({ ok: true, tenant: { ...existingTenant, ...update } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tenant' });
  }
});

router.delete('/tenants/:tenantId', requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = normalizeTenantId(req.params.tenantId);
    if (!tenantId || tenantId === 'master') {
      res.status(400).json({ error: 'Master tenant cannot be deleted' });
      return;
    }
    const existingTenant = await req.masterDb.collection('tenants').findOne({ tenantId });
    if (!existingTenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    await req.masterDb.collection('tenants').deleteOne({ tenantId });
    await req.getDbByName(existingTenant.dbName).dropDatabase();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete tenant' });
  }
});

module.exports = {
  router,
  ensureSuperAdmin,
};
