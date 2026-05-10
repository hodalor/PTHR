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
} = require('../tenancy');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const SUPERADMIN_USERNAME = String(process.env.SUPERADMIN_USERNAME || 'superadmin').trim();
const SUPERADMIN_PASSWORD = String(process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@2026').trim();
const SUPERADMIN_FULL_NAME = String(process.env.SUPERADMIN_FULL_NAME || 'Platform Super Admin').trim();
const defaultEmployeeModules = ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual'];
const roleRank = {
  employee: 1,
  manager: 2,
  admin: 3,
  'tenant-admin': 3,
  superadmin: 4,
};

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getSessionExpiryIso(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function getSubscriptionDaysRemaining(value) {
  if (!value) {
    return null;
  }
  const expiryDate = new Date(`${String(value).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(expiryDate.getTime())) {
    return null;
  }
  return Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function isTenantSubscriptionExpired(tenant) {
  const daysRemaining = getSubscriptionDaysRemaining(tenant?.subscriptionExpiresAt);
  return daysRemaining !== null && daysRemaining < 0;
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
    packageType: tenant?.packageType || (tenantId === 'master' ? 'enterprise' : undefined),
    allowedModules: resolveUserAllowedModulesForTenant(user, tenant, tenantId),
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

function resolveUserAllowedModulesForTenant(user, tenant, tenantId) {
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
  const baseline =
    role === 'employee' && requestedModules.length === 0
      ? defaultEmployeeModules
      : requestedModules.length > 0
        ? requestedModules
        : tenantGrants;
  const tenantSet = new Set(tenantGrants);
  if (tenantSet.size === 0) {
    return baseline;
  }
  return baseline.filter((moduleId) => tenantSet.has(moduleId));
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
    const allowedModules = resolveUserAllowedModulesForTenant(auth.user, req.tenant, req.tenantId);
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
      res.status(403).json({ error: 'Tenant subscription has expired' });
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
    res.json({
      users: users.map((user) => sanitizeUser(user, req.tenantId, req.tenant)),
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
      const actorAllowedModules = new Set(resolveUserAllowedModulesForTenant(req.authUser, req.tenant, req.tenantId));
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

router.get('/tenant-packages', requireSuperAdmin, async (req, res) => {
  res.json({
    modules: [...allModules],
    packages: Object.entries(packageDefaults).map(([id, value]) => ({
      id,
      modules: value.modules,
      employeeLimit: value.employeeLimit,
      concurrentLoginLimit: value.concurrentLoginLimit,
    })),
  });
});

router.get('/tenants', requireSuperAdmin, async (req, res) => {
  try {
    const rows = await req.masterDb.collection('tenants').find({}).sort({ createdAt: -1 }).toArray();
    const tenants = rows.map((tenant) => {
      const limits = resolveTenantEffectiveLimits(tenant);
      return {
        id: String(tenant._id || tenant.tenantId),
        tenantId: tenant.tenantId,
        name: tenant.name || tenant.tenantId,
        packageType: tenant.packageType || 'basic',
        grantedModules: resolveTenantGrantedModules(tenant.packageType, tenant.grantedModules),
        employeeLimitOverride: tenant.employeeLimitOverride || null,
        concurrentLoginLimitOverride: tenant.concurrentLoginLimitOverride || null,
        employeeLimit: limits.employeeLimit,
        concurrentLoginLimit: limits.concurrentLoginLimit,
        dbName: tenant.dbName,
        subscriptionExpiresAt: tenant.subscriptionExpiresAt || null,
        subscriptionDaysRemaining: getSubscriptionDaysRemaining(tenant.subscriptionExpiresAt),
        status: tenant.status || 'active',
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      };
    });
    res.json({ tenants });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load tenants' });
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
    const tenantPayload = {
      tenantId,
      name,
      packageType,
      dbName,
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
