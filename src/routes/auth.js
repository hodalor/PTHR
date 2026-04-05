const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = '12h';
const defaultEmployeeModules = ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking'];

function getUsersCollection(db) {
  return db.collection('users');
}

function getRolesCollection(db) {
  return db.collection('roles');
}

async function ensureSuperAdmin(db) {
  const users = getUsersCollection(db);
  const roles = getRolesCollection(db);

  const existingSuperAdminRole = await roles.findOne({ name: 'superadmin' });
  const superAdminRoleId = existingSuperAdminRole
    ? existingSuperAdminRole._id
    : (await roles.insertOne({
        name: 'superadmin',
        description: 'God mode super admin with access to all features',
        permissions: ['*'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })).insertedId;

  const existingSuperAdminUser = await users.findOne({ username: 'superadmin' });
  const passwordHash = await bcrypt.hash('SuperAdmin@2026', 10);
  const now = new Date().toISOString();
  if (!existingSuperAdminUser) {
    await users.insertOne({
      username: 'superadmin',
      fullName: 'System Super Admin',
      passwordHash,
      role: 'superadmin',
      roleId: superAdminRoleId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await users.updateOne(
      { _id: existingSuperAdminUser._id },
      {
        $set: {
          fullName: 'System Super Admin',
          passwordHash,
          role: 'superadmin',
          roleId: superAdminRoleId,
          isActive: true,
          updatedAt: now,
        },
      }
    );
  }
}

async function getAuthUser(req) {
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
  const users = getUsersCollection(req.db);
  const user = await users.findOne({ _id: new req.db.bson.ObjectId(payload.sub) });
  if (!user || !user.isActive) {
    return null;
  }
  return user;
}

function resolveAllowedModules(user) {
  const normalizedRole = String(user?.role || '').toLowerCase();
  if (!user) {
    return [];
  }
  if (normalizedRole === 'superadmin') {
    return ['*'];
  }
  const allowedModules = Array.isArray(user.allowedModules)
    ? user.allowedModules.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (normalizedRole === 'employee' && allowedModules.length === 0) {
    return defaultEmployeeModules;
  }
  return allowedModules;
}

function buildAuthUserPayload(user) {
  const normalizedRole = String(user.role || 'employee').toLowerCase();
  return {
    id: user._id.toString(),
    username: user.username,
    fullName: user.fullName || user.username,
    role: normalizedRole,
    employeeId: user.employeeId || '',
    allowedModules: resolveAllowedModules({ ...user, role: normalizedRole }),
  };
}

async function requireSuperAdmin(req, res, next) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (user.role !== 'superadmin') {
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
    await ensureSuperAdmin(req.db);
    res.json({
      ok: true,
      username: 'superadmin',
      password: 'SuperAdmin@2026',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bootstrap super admin' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const identifier = String(username || '').trim();
    if (!identifier || !password) {
      res.status(400).json({ error: 'Username/Employee ID and password are required' });
      return;
    }
    const users = getUsersCollection(req.db);
    let user = await users.findOne({
      $or: [{ username: identifier }, { employeeId: identifier }],
    });

    if (!user) {
      const employees = req.db.collection('employees');
      const employee = await employees.findOne({ id: identifier });
      if (employee && employee.password) {
        const passwordHash = await bcrypt.hash(String(employee.password), 10);
        const now = new Date().toISOString();
        const doc = {
          username: identifier,
          fullName: employee.fullName || identifier,
          passwordHash,
          role: 'employee',
          employeeId: identifier,
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

    const isMatch = await bcrypt.compare(password, user.passwordHash || '');
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }
    const tokenPayload = {
      sub: user._id.toString(),
      username: user.username,
      role: user.role || 'employee',
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({
      token,
      user: buildAuthUserPayload(user),
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({
      user: buildAuthUserPayload(user),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load current user' });
  }
});

router.get('/users', requireSuperAdmin, async (req, res) => {
  try {
    const users = getUsersCollection(req.db);
    const rows = await users
      .find({})
      .project({ passwordHash: 0 })
      .sort({ createdAt: -1 })
      .toArray();
    const sanitized = rows.map((user) => ({
      id: user._id.toString(),
      username: user.username,
      fullName: user.fullName || user.username,
      role: user.role || 'employee',
      employeeId: user.employeeId || '',
      allowedModules: Array.isArray(user.allowedModules) ? user.allowedModules : [],
      isActive: user.isActive !== false,
      createdAt: user.createdAt,
    }));
    res.json({ users: sanitized });
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
    const users = getUsersCollection(req.db);
    const existing = await users.findOne({ username: trimmedUsername });
    if (existing) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    let normalizedAllowedModules = [];
    if (Array.isArray(allowedModules)) {
      normalizedAllowedModules = allowedModules.map((value) => String(value || '').trim()).filter(Boolean);
    } else if (typeof allowedModules === 'string') {
      normalizedAllowedModules = allowedModules
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const now = new Date().toISOString();
    const doc = {
      username: trimmedUsername,
      fullName: fullName && String(fullName).trim() ? String(fullName).trim() : trimmedUsername,
      passwordHash,
      role: role || 'employee',
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

module.exports = {
  router,
  ensureSuperAdmin,
};
