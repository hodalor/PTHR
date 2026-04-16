const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
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
const JWT_EXPIRES_IN = '12h';
const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const defaultEmployeeModules = ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual'];

const usersCollection = (db) => db.collection('users');
const rolesCollection = (db) => db.collection('roles');

function toIsoDateOrNull(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getSubscriptionDaysRemaining(expiresAtRaw) {
  const expiresAt = toIsoDateOrNull(expiresAtRaw);
  if (!expiresAt) {
    return null;
  }
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function isSubscriptionExpired(expiresAtRaw) {
  const expiresAt = toIsoDateOrNull(expiresAtRaw);
  return Boolean(expiresAt && new Date(expiresAt).getTime() < Date.now());
}

async function resolveTenantPolicy(masterDb, tenantId) {
  if (tenantId === 'master') {
    return {
      tenantId: 'master',
      packageType: 'enterprise',
      grantedModules: [...allModules],
      dbName: masterDb.databaseName,
      employeeLimit: 1000000,
      concurrentLoginLimit: 1000000,
      subscriptionExpiresAt: null,
      subscriptionDaysRemaining: null,
    };
  }
  const tenant = await masterDb.collection('tenants').findOne({ tenantId, status: 'active' });
  if (!tenant) {
    return null;
  }
  const packageModules = resolvePackageModules(tenant.packageType);
  const grantedModules = resolveTenantGrantedModules(tenant.packageType, tenant.grantedModules);
  const limits = resolveTenantEffectiveLimits(tenant);
  const subscriptionExpiresAt = toIsoDateOrNull(tenant.subscriptionExpiresAt);
  return {
    tenantId,
    packageType: tenant.packageType,
    grantedModules: grantedModules.length > 0 ? grantedModules : packageModules,
    dbName: tenant.dbName,
    name: tenant.name || tenantId,
    employeeLimit: limits.employeeLimit,
    concurrentLoginLimit: limits.concurrentLoginLimit,
    subscriptionExpiresAt,
    subscriptionDaysRemaining: getSubscriptionDaysRemaining(subscriptionExpiresAt),
  };
}

function resolveAllowedModules(user, tenantPolicy) {
  const role = String(user?.role || '').toLowerCase();
  if (!user) {
    return [];
  }
  if (role === 'superadmin' && tenantPolicy?.tenantId === 'master') {
    return ['*'];
  }
  const requested = Array.isArray(user.allowedModules)
    ? user.allowedModules.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const baseline =
    role === 'employee' && requested.length === 0
      ? defaultEmployeeModules
      : requested.length > 0
        ? requested
        : tenantPolicy?.grantedModules || [];
  const tenantSet = new Set(tenantPolicy?.grantedModules || []);
  return tenantSet.size === 0 ? baseline : baseline.filter((moduleId) => tenantSet.has(moduleId));
}

function buildAuthUserPayload(user, tenantPolicy) {
  const role = String(user.role || 'employee').toLowerCase();
  return {
    id: user._id.toString(),
    username: user.username,
    fullName: user.fullName || user.username,
    role,
    employeeId: user.employeeId || '',
    tenantId: tenantPolicy?.tenantId || user.tenantId || 'master',
    packageType: tenantPolicy?.packageType || 'basic',
    subscriptionExpiresAt: tenantPolicy?.subscriptionExpiresAt || null,
    subscriptionDaysRemaining:
      typeof tenantPolicy?.subscriptionDaysRemaining === 'number' ? tenantPolicy.subscriptionDaysRemaining : null,
    employeeLimit: tenantPolicy?.employeeLimit || null,
    concurrentLoginLimit: tenantPolicy?.concurrentLoginLimit || null,
    allowedModules: resolveAllowedModules({ ...user, role }, tenantPolicy),
  };
}

async function ensureSuperAdmin(db) {
  const users = usersCollection(db);
  const roles = rolesCollection(db);
  const now = new Date().toISOString();
  const existingRole = await roles.findOne({ name: 'superadmin' });
  const roleId = existingRole
    ? existingRole._id
    : (
        await roles.insertOne({
          name: 'superadmin',
          description: 'Master super admin',
          permissions: ['*'],
          createdAt: now,
          updatedAt: now,
        })
      ).insertedId;
  const existingUser = await users.findOne({ username: 'superadmin', tenantId: 'master' });
  const payload = {
    fullName: 'System Super Admin',
    passwordHash: await bcrypt.hash('SuperAdmin@2026', 10),
    role: 'superadmin',
    roleId,
    tenantId: 'master',
    allowedModules: ['*'],
    isActive: true,
    updatedAt: now,
  };
  if (!existingUser) {
    await users.insertOne({ username: 'superadmin', createdAt: now, ...payload });
    return;
  }
  await users.updateOne({ _id: existingUser._id }, { $set: payload });
}

function extractToken(req) {
  return (req.headers.authorization || '').split(' ')[1] || '';
}

async function getAuthUser(req) {
  const token = extractToken(req);
  if (!token) {
    return null;
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
  const tenantId = normalizeTenantId(payload.tenantId) || 'master';
  let tenantDb;
  try {
    tenantDb = await req.getTenantDb(tenantId);
  } catch (error) {
    return null;
  }
  if (payload.jti) {
    const activeSession = await tenantDb.collection('authSessions').findOne({
      tokenId: payload.jti,
      revokedAt: null,
      expiresAt: { $gt: new Date().toISOString() },
    });
    if (!activeSession) {
      return null;
    }
  }
  const user = await usersCollection(tenantDb).findOne({ _id: new req.db.bson.ObjectId(payload.sub) });
  if (!user || !user.isActive) {
    return null;
  }
  const tenantPolicy = await resolveTenantPolicy(req.masterDb, tenantId);
  return { ...user, tenantId, tenantPolicy, tokenPayload: payload };
}

async function requireSuperAdmin(req, res, next) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (String(user.role || '').toLowerCase() !== 'superadmin' || user.tenantId !== 'master') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    req.authUser = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Auth check failed' });
  }
}

router.post('/bootstrap-superadmin', async (req, res) => {
  try {
    await ensureSuperAdmin(req.masterDb);
    res.json({ ok: true, tenantId: 'master', username: 'superadmin', password: 'SuperAdmin@2026' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bootstrap super admin' });
  }
});

router.get('/tenant-packages', requireSuperAdmin, async (req, res) => {
  res.json({
    packages: Object.entries(packageDefaults).map(([id, value]) => ({
      id,
      modules: value.modules,
      employeeLimit: value.employeeLimit,
      concurrentLoginLimit: value.concurrentLoginLimit,
    })),
    modules: allModules,
  });
});

router.get('/tenants', requireSuperAdmin, async (req, res) => {
  try {
    const tenants = await req.masterDb.collection('tenants').find({}).sort({ createdAt: -1 }).toArray();
    res.json({
      tenants: tenants.map((tenant) => {
        const limits = resolveTenantEffectiveLimits(tenant);
        return {
          id: tenant._id.toString(),
          tenantId: tenant.tenantId,
          name: tenant.name,
          dbName: tenant.dbName,
          packageType: tenant.packageType,
          grantedModules: Array.isArray(tenant.grantedModules) ? tenant.grantedModules : [],
          status: tenant.status || 'active',
          employeeLimit: limits.employeeLimit,
          concurrentLoginLimit: limits.concurrentLoginLimit,
          employeeLimitOverride: tenant.employeeLimitOverride || null,
          concurrentLoginLimitOverride: tenant.concurrentLoginLimitOverride || null,
          subscriptionExpiresAt: tenant.subscriptionExpiresAt || null,
          subscriptionDaysRemaining: getSubscriptionDaysRemaining(tenant.subscriptionExpiresAt),
          createdAt: tenant.createdAt,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load tenants' });
  }
});

router.post('/tenants', requireSuperAdmin, async (req, res) => {
  try {
    const {
      tenantId,
      name,
      packageType,
      grantedModules,
      employeeLimitOverride,
      concurrentLoginLimitOverride,
      subscriptionExpiresAt,
      adminUsername,
      adminPassword,
      adminFullName,
    } = req.body || {};
    const normalizedTenantId = normalizeTenantId(tenantId);
    if (!normalizedTenantId || normalizedTenantId === 'master') {
      res.status(400).json({ error: 'Valid tenantId is required (cannot be master)' });
      return;
    }
    if (!adminUsername || !adminPassword) {
      res.status(400).json({ error: 'Default tenant admin username and password are required' });
      return;
    }
    if (await req.masterDb.collection('tenants').findOne({ tenantId: normalizedTenantId })) {
      res.status(409).json({ error: 'Tenant already exists' });
      return;
    }
    const normalizedPackage = String(packageType || 'basic').trim().toLowerCase();
    if (!packageDefaults[normalizedPackage]) {
      res.status(400).json({ error: 'Invalid package type' });
      return;
    }

    const now = new Date().toISOString();
    const resolvedGrantedModules = resolveTenantGrantedModules(normalizedPackage, grantedModules);
    const dbName = `hr_tenant_${normalizedTenantId.replace(/-/g, '_')}`;
    await req.masterDb.collection('tenants').insertOne({
      tenantId: normalizedTenantId,
      name: String(name || normalizedTenantId).trim(),
      dbName,
      packageType: normalizedPackage,
      grantedModules: resolvedGrantedModules,
      employeeLimitOverride:
        Number.isFinite(Number(employeeLimitOverride)) && Number(employeeLimitOverride) > 0
          ? Math.floor(Number(employeeLimitOverride))
          : null,
      concurrentLoginLimitOverride:
        Number.isFinite(Number(concurrentLoginLimitOverride)) && Number(concurrentLoginLimitOverride) > 0
          ? Math.floor(Number(concurrentLoginLimitOverride))
          : null,
      subscriptionExpiresAt: toIsoDateOrNull(subscriptionExpiresAt),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: req.authUser.username,
    });

    const tenantDb = await req.getTenantDb(normalizedTenantId);
    const collections = await tenantDb.listCollections().toArray();
    for (const item of collections) {
      await tenantDb.collection(item.name).drop();
    }

    const roleId = (
      await rolesCollection(tenantDb).insertOne({
        name: 'tenant-admin',
        description: 'Default admin for tenant',
        permissions: ['*'],
        createdAt: now,
        updatedAt: now,
      })
    ).insertedId;
    await usersCollection(tenantDb).insertOne({
      username: String(adminUsername).trim(),
      fullName: String(adminFullName || adminUsername).trim(),
      passwordHash: await bcrypt.hash(String(adminPassword), 10),
      role: 'tenant-admin',
      roleId,
      tenantId: normalizedTenantId,
      allowedModules: resolvedGrantedModules,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create tenant' });
  }
});

router.put('/tenants/:tenantId', requireSuperAdmin, async (req, res) => {
  try {
    const targetTenantId = normalizeTenantId(req.params.tenantId);
    if (!targetTenantId || targetTenantId === 'master') {
      res.status(400).json({ error: 'Cannot edit master tenant' });
      return;
    }
    const existingTenant = await req.masterDb.collection('tenants').findOne({ tenantId: targetTenantId });
    if (!existingTenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const {
      name,
      packageType,
      grantedModules,
      employeeLimitOverride,
      concurrentLoginLimitOverride,
      subscriptionExpiresAt,
      status,
    } = req.body || {};
    const normalizedPackage = String(packageType || existingTenant.packageType || 'basic').trim().toLowerCase();
    if (!packageDefaults[normalizedPackage]) {
      res.status(400).json({ error: 'Invalid package type' });
      return;
    }
    const resolvedGrantedModules = resolveTenantGrantedModules(normalizedPackage, grantedModules);
    await req.masterDb.collection('tenants').updateOne(
      { tenantId: targetTenantId },
      {
        $set: {
          name: String(name || existingTenant.name || targetTenantId).trim(),
          packageType: normalizedPackage,
          grantedModules: resolvedGrantedModules,
          employeeLimitOverride:
            Number.isFinite(Number(employeeLimitOverride)) && Number(employeeLimitOverride) > 0
              ? Math.floor(Number(employeeLimitOverride))
              : null,
          concurrentLoginLimitOverride:
            Number.isFinite(Number(concurrentLoginLimitOverride)) && Number(concurrentLoginLimitOverride) > 0
              ? Math.floor(Number(concurrentLoginLimitOverride))
              : null,
          subscriptionExpiresAt: toIsoDateOrNull(subscriptionExpiresAt),
          status: status === 'inactive' ? 'inactive' : 'active',
          updatedAt: new Date().toISOString(),
          updatedBy: req.authUser.username,
        },
      }
    );
    await (await req.getTenantDb(targetTenantId)).collection('users').updateMany(
      {},
      {
        $set: {
          allowedModules: resolvedGrantedModules,
          updatedAt: new Date().toISOString(),
        },
      }
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update tenant' });
  }
});

router.delete('/tenants/:tenantId', requireSuperAdmin, async (req, res) => {
  try {
    const targetTenantId = normalizeTenantId(req.params.tenantId);
    if (!targetTenantId || targetTenantId === 'master') {
      res.status(400).json({ error: 'Cannot delete master tenant' });
      return;
    }
    const existingTenant = await req.masterDb.collection('tenants').findOne({ tenantId: targetTenantId });
    if (!existingTenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    await req.masterDb.collection('tenants').deleteOne({ tenantId: targetTenantId });
    if (existingTenant.dbName && req.getDbByName) {
      await req.getDbByName(existingTenant.dbName).dropDatabase();
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete tenant' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { tenantId, username, password } = req.body || {};
    const normalizedTenantId = normalizeTenantId(tenantId);
    const identifier = String(username || '').trim();
    if (!normalizedTenantId || !identifier || !password) {
      res.status(400).json({ error: 'tenantId, username/employee ID and password are required' });
      return;
    }
    const tenantPolicy = await resolveTenantPolicy(req.masterDb, normalizedTenantId);
    if (!tenantPolicy) {
      res.status(404).json({ error: 'Tenant not found or inactive' });
      return;
    }
    if (isSubscriptionExpired(tenantPolicy.subscriptionExpiresAt)) {
      res.status(403).json({ error: 'Tenant subscription has expired. Contact support.' });
      return;
    }

    const tenantDb = await req.getTenantDb(normalizedTenantId);
    const users = usersCollection(tenantDb);
    let user = await users.findOne({ $or: [{ username: identifier }, { employeeId: identifier }] });
    if (!user) {
      const employee = await tenantDb.collection('employees').findOne({ id: identifier });
      if (employee && employee.password) {
        const now = new Date().toISOString();
        const doc = {
          username: identifier,
          fullName: employee.fullName || identifier,
          passwordHash: await bcrypt.hash(String(employee.password), 10),
          role: 'employee',
          employeeId: identifier,
          tenantId: normalizedTenantId,
          allowedModules: [],
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };
        const result = await users.insertOne(doc);
        user = { _id: result.insertedId, ...doc };
      }
    }
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    if (!(await bcrypt.compare(password, user.passwordHash || ''))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const sessions = tenantDb.collection('authSessions');
    const nowIso = new Date().toISOString();
    await sessions.deleteMany({ $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $lte: nowIso } }] });
    const activeSessions = await sessions.countDocuments({ revokedAt: null, expiresAt: { $gt: nowIso } });
    if (activeSessions >= tenantPolicy.concurrentLoginLimit) {
      res.status(429).json({ error: 'Concurrent login limit reached for this tenant plan.' });
      return;
    }

    const tokenId = randomUUID();
    const token = jwt.sign(
      {
        sub: user._id.toString(),
        username: user.username,
        role: user.role || 'employee',
        tenantId: normalizedTenantId,
        jti: tokenId,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    await sessions.insertOne({
      tokenId,
      userId: user._id.toString(),
      username: user.username,
      tenantId: normalizedTenantId,
      issuedAt: nowIso,
      expiresAt: new Date(Date.now() + AUTH_SESSION_TTL_MS).toISOString(),
      revokedAt: null,
    });
    res.json({ token, user: buildAuthUserPayload({ ...user, tenantId: normalizedTenantId }, tenantPolicy) });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = extractToken(req);
    if (!token) {
      res.json({ ok: true });
      return;
    }
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      res.json({ ok: true });
      return;
    }
    const tenantDb = await req.getTenantDb(normalizeTenantId(payload.tenantId) || 'master');
    if (payload.jti) {
      await tenantDb.collection('authSessions').updateOne(
        { tokenId: payload.jti, revokedAt: null },
        { $set: { revokedAt: new Date().toISOString() } }
      );
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (isSubscriptionExpired(user.tenantPolicy?.subscriptionExpiresAt)) {
      res.status(403).json({ error: 'Tenant subscription has expired. Contact support.' });
      return;
    }
    res.json({ user: buildAuthUserPayload(user, user.tenantPolicy) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load current user' });
  }
});

router.get('/users', requireSuperAdmin, async (req, res) => {
  try {
    const rows = await usersCollection(req.db).find({}).project({ passwordHash: 0 }).sort({ createdAt: -1 }).toArray();
    res.json({
      users: rows.map((user) => ({
        id: user._id.toString(),
        username: user.username,
        fullName: user.fullName || user.username,
        role: user.role || 'employee',
        employeeId: user.employeeId || '',
        tenantId: user.tenantId || req.tenantId || 'master',
        allowedModules: Array.isArray(user.allowedModules) ? user.allowedModules : [],
        isActive: user.isActive !== false,
        createdAt: user.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.post('/users', requireSuperAdmin, async (req, res) => {
  try {
    const { username, fullName, password, role, employeeId, allowedModules, isActive } = req.body || {};
    const trimmedUsername = String(username || '').trim();
    if (!trimmedUsername || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    const users = usersCollection(req.db);
    if (await users.findOne({ username: trimmedUsername })) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    const normalizedAllowedModules = Array.isArray(allowedModules)
      ? allowedModules.map((value) => String(value || '').trim()).filter(Boolean)
      : typeof allowedModules === 'string'
        ? allowedModules
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
    const now = new Date().toISOString();
    const doc = {
      username: trimmedUsername,
      fullName: fullName && String(fullName).trim() ? String(fullName).trim() : trimmedUsername,
      passwordHash: await bcrypt.hash(String(password), 10),
      role: role || 'employee',
      tenantId: req.tenantId,
      employeeId: employeeId && String(employeeId).trim() ? String(employeeId).trim() : '',
      allowedModules: normalizedAllowedModules,
      isActive: isActive !== false,
      createdAt: now,
      updatedAt: now,
    };
    const result = await users.insertOne(doc);
    res.status(201).json({
      user: {
        id: result.insertedId.toString(),
        username: doc.username,
        fullName: doc.fullName,
        role: doc.role,
        tenantId: doc.tenantId,
        employeeId: doc.employeeId || '',
        allowedModules: doc.allowedModules,
        isActive: doc.isActive,
        createdAt: doc.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

module.exports = { router, ensureSuperAdmin };
