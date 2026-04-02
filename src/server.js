const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const trackingRoutes = require('./routes/tracking');
const mobileRoutes = require('./routes/mobile');
const { router: authRoutes, ensureSuperAdmin } = require('./routes/auth');

const PORT = process.env.PORT || 8000;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'hr';

const moduleCollections = {
  'employee-management': 'employees',
  'attendance-time': 'attendanceTime',
  'loan-records': 'loanRecords',
  fingerprint: 'fingerprintRecords',
  'leave-management': 'leaveRequests',
  'payroll-management': 'payrollRecords',
  'documents-records': 'documentRecords',
  'reports-analytics': 'reportRecords',
  'auth-roles': 'authRoleRecords',
  recruitment: 'recruitmentRecords',
  performance: 'performanceRecords',
  training: 'trainingRecords',
};

let mongoClient;

async function connectToMongo() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }
  if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
    return mongoClient.db(MONGO_DB_NAME);
  }
  mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  return mongoClient.db(MONGO_DB_NAME);
}

async function syncEmployeeUser(db, employee) {
  try {
    const employeeId = String(employee.id || '').trim();
    const portalPassword = String(employee.password || '').trim();
    if (!employeeId || !portalPassword) {
      return;
    }
    const users = db.collection('users');
    const username = employeeId;
    const existing = await users.findOne({
      $or: [{ username }, { employeeId }],
    });
    const passwordHash = await bcrypt.hash(portalPassword, 10);
    const now = new Date().toISOString();
    if (existing) {
      await users.updateOne(
        { _id: existing._id },
        {
          $set: {
            username,
            fullName: employee.fullName || username,
            employeeId,
            passwordHash,
            role: existing.role || 'employee',
            isActive: existing.isActive !== false,
            updatedAt: now,
          },
        }
      );
    } else {
      await users.insertOne({
        username,
        fullName: employee.fullName || username,
        employeeId,
        passwordHash,
        role: 'employee',
        allowedModules: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    console.error('Failed to sync employee user', error);
  }
}

async function persistModuleRecord(db, moduleId, record) {
  if (!record || !record.id) {
    return;
  }
  const collectionName = moduleCollections[moduleId];
  if (!collectionName) {
    return;
  }
  const collection = db.collection(collectionName);
  const { id, _id, ...rest } = record;
  const update = {
    ...rest,
    id,
    updatedAt: new Date().toISOString(),
  };
  await collection.updateOne({ id }, { $set: update }, { upsert: false });
}

function getModuleCollection(db, moduleId) {
  const collectionName = moduleCollections[moduleId];
  if (!collectionName) {
    return null;
  }
  return db.collection(collectionName);
}

app.get('/health', async (req, res) => {
  try {
    const db = await connectToMongo();
    await db.command({ ping: 1 });
    res.json({ status: 'ok', service: 'hr-backend', mongo: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', service: 'hr-backend', mongo: 'unavailable' });
  }
});

app.use(async (req, res, next) => {
  try {
    const db = await connectToMongo();
    req.db = db;
    req.db.bson = { ObjectId };
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/mobile', mobileRoutes);

app.get('/api/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const records = await collection.find({}).sort({ _id: -1 }).limit(500).toArray();
    res.json({ records });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load records' });
  }
});

app.post('/api/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const payload = {
      ...req.body,
      moduleId,
      createdAt: req.body.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await collection.insertOne(payload);
    const inserted = await collection.findOne({ _id: result.insertedId });
    if (moduleId === 'employee-management' && inserted) {
      await syncEmployeeUser(req.db, inserted);
    }
    res.status(201).json({ record: inserted });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create record' });
  }
});

app.put('/api/modules/:moduleId/:recordId', async (req, res) => {
  try {
    const { moduleId, recordId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const { _id, ...requestBody } = req.body || {};
    const update = {
      ...requestBody,
      moduleId,
      updatedAt: new Date().toISOString(),
    };
    const result = await collection.updateOne({ id: recordId }, { $set: update });
    if (!result.matchedCount) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    const updated = await collection.findOne({ id: recordId });
    if (moduleId === 'employee-management') {
      await syncEmployeeUser(req.db, updated);
    }
    res.json({ record: updated });
  } catch (error) {
    console.error('Failed to update record', error);
    res.status(500).json({ error: 'Failed to update record' });
  }
});

app.delete('/api/modules/:moduleId/:recordId', async (req, res) => {
  try {
    const { moduleId, recordId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const result = await collection.deleteOne({ id: recordId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

app.use('/api/tracking', trackingRoutes);

async function start() {
  try {
    const db = await connectToMongo();
    app.locals.db = db;
    await ensureSuperAdmin(db);
    app.listen(PORT, () => {
      console.log(`Connected to MongoDB Atlas database "${MONGO_DB_NAME}"`);
      console.log(`HR backend listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start backend', error);
    process.exit(1);
  }
}

start();
