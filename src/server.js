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

const defaultAttendanceSettings = {
  attendanceLateAfter: '08:15',
  attendanceReportTime: '08:00',
  attendanceShiftEnd: '17:00',
  payrollWorkingDays: 26,
  attendanceCalculationMode: 'auto',
  attendanceFixedDeductionPerMinute: 0.128,
  attendanceFixedScope: 'all',
  attendanceFixedDepartment: '',
  attendanceFixedEmployeeId: '',
  shifts: [
    {
      id: 'SHIFT-MORNING',
      name: 'Morning',
      reportTime: '08:00',
      shiftEnd: '17:00',
      graceInMinutes: 15,
      graceOutMinutes: 0,
      overtimeEnabled: false,
      overtimeStartAfterMinutes: 0,
      overtimePayPerMinute: 0,
    },
  ],
};

function normalizeAttendanceSettings(payload) {
  const source = payload || {};
  const shifts = Array.isArray(source.shifts)
    ? source.shifts
        .map((shift, index) => ({
          id: String(shift?.id || `SHIFT-${index + 1}`),
          name: String(shift?.name || '').trim(),
          reportTime: String(shift?.reportTime || '').trim(),
          shiftEnd: String(shift?.shiftEnd || '').trim(),
          graceInMinutes: Math.max(0, Number(shift?.graceInMinutes) || 0),
          graceOutMinutes: Math.max(0, Number(shift?.graceOutMinutes) || 0),
          overtimeEnabled: Boolean(shift?.overtimeEnabled),
          overtimeStartAfterMinutes: Math.max(0, Number(shift?.overtimeStartAfterMinutes) || 0),
          overtimePayPerMinute: Math.max(0, Number(shift?.overtimePayPerMinute) || 0),
        }))
        .filter(
          (shift) =>
            shift.name &&
            /^\d{2}:\d{2}$/.test(shift.reportTime) &&
            /^\d{2}:\d{2}$/.test(shift.shiftEnd)
        )
    : [];
  return {
    attendanceLateAfter: String(source.attendanceLateAfter || defaultAttendanceSettings.attendanceLateAfter),
    attendanceReportTime: String(source.attendanceReportTime || defaultAttendanceSettings.attendanceReportTime),
    attendanceShiftEnd: String(source.attendanceShiftEnd || defaultAttendanceSettings.attendanceShiftEnd),
    payrollWorkingDays: Math.max(1, Number(source.payrollWorkingDays) || defaultAttendanceSettings.payrollWorkingDays),
    attendanceCalculationMode: source.attendanceCalculationMode === 'fixed' ? 'fixed' : 'auto',
    attendanceFixedDeductionPerMinute: Math.max(
      0,
      Number(source.attendanceFixedDeductionPerMinute) || defaultAttendanceSettings.attendanceFixedDeductionPerMinute
    ),
    attendanceFixedScope: ['all', 'department', 'individual'].includes(String(source.attendanceFixedScope || ''))
      ? String(source.attendanceFixedScope)
      : defaultAttendanceSettings.attendanceFixedScope,
    attendanceFixedDepartment: String(source.attendanceFixedDepartment || ''),
    attendanceFixedEmployeeId: String(source.attendanceFixedEmployeeId || ''),
    shifts: shifts.length > 0 ? shifts : defaultAttendanceSettings.shifts,
  };
}

function toMinutesFromClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatWorkedDuration(checkIn, checkOut) {
  const start = toMinutesFromClock(checkIn);
  const end = toMinutesFromClock(checkOut);
  if (start === null || end === null || end <= start) {
    return '';
  }
  const diff = end - start;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return `${hours}h ${minutes}m`;
}

function normalizeAttendanceClockings(row) {
  const fromClockings = Array.isArray(row?.clockings)
    ? row.clockings
        .map((clocking) => ({
          id: String(clocking?.id || ''),
          mode: clocking?.mode === 'clock-out' ? 'clock-out' : 'clock-in',
          time: String(clocking?.time || '').trim(),
          lat: typeof clocking?.lat === 'number' ? clocking.lat : undefined,
          lng: typeof clocking?.lng === 'number' ? clocking.lng : undefined,
          accuracy: typeof clocking?.accuracy === 'number' ? clocking.accuracy : null,
          source: String(clocking?.source || row?.source || 'System'),
          createdAt: String(clocking?.createdAt || ''),
        }))
        .filter((clocking) => /^\d{1,2}:\d{2}$/.test(clocking.time))
    : [];
  if (fromClockings.length > 0) {
    return fromClockings.sort((left, right) => left.time.localeCompare(right.time));
  }
  const fallback = [];
  if (/^\d{1,2}:\d{2}$/.test(String(row?.checkIn || ''))) {
    fallback.push({
      id: `CLK-IN-${Date.now()}`,
      mode: 'clock-in',
      time: String(row.checkIn).trim(),
      lat: typeof row?.checkInLat === 'number' ? row.checkInLat : undefined,
      lng: typeof row?.checkInLng === 'number' ? row.checkInLng : undefined,
      accuracy: typeof row?.checkInAccuracy === 'number' ? row.checkInAccuracy : null,
      source: String(row?.source || 'System'),
      createdAt: String(row?.date || ''),
    });
  }
  if (/^\d{1,2}:\d{2}$/.test(String(row?.checkOut || ''))) {
    fallback.push({
      id: `CLK-OUT-${Date.now()}`,
      mode: 'clock-out',
      time: String(row.checkOut).trim(),
      lat: typeof row?.checkOutLat === 'number' ? row.checkOutLat : undefined,
      lng: typeof row?.checkOutLng === 'number' ? row.checkOutLng : undefined,
      accuracy: typeof row?.checkOutAccuracy === 'number' ? row.checkOutAccuracy : null,
      source: String(row?.source || 'System'),
      createdAt: String(row?.date || ''),
    });
  }
  return fallback.sort((left, right) => left.time.localeCompare(right.time));
}

function enrichAttendanceRecordWithContext(payload, context) {
  const source = payload || {};
  const employeeId = String(source.employeeId || '').trim();
  const employeeName = String(source.employee || '').trim();
  const settings = context?.settings || defaultAttendanceSettings;
  const employee =
    context?.employeeById?.get(employeeId) ||
    context?.employeeByEmployeeId?.get(employeeId) ||
    context?.employeeByName?.get(employeeName) ||
    null;
  if (!employeeId && !employeeName && !employee) {
    return source;
  }
  const shiftName = String(source.shift || employee?.assignedShift || settings.shifts?.[0]?.name || 'Default').trim();
  const shiftConfig =
    settings.shifts.find(
      (shift) => String(shift?.name || '').trim().toLowerCase() === shiftName.toLowerCase()
    ) || settings.shifts[0];
  const clockings = normalizeAttendanceClockings(source);
  const firstClockIn = clockings.find((clocking) => clocking.mode === 'clock-in') || null;
  const lastClockOut = [...clockings].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
  const checkIn = firstClockIn?.time || String(source.checkIn || '').trim();
  const checkOut = lastClockOut?.time || String(source.checkOut || '').trim();
  const reportMinutes = toMinutesFromClock(shiftConfig?.reportTime || settings.attendanceReportTime);
  const lateAfterMinutes =
    reportMinutes === null ? null : reportMinutes + Math.max(0, Number(shiftConfig?.graceInMinutes) || 0);
  const checkInMinutes = toMinutesFromClock(checkIn);
  const lateMinutes =
    lateAfterMinutes === null || checkInMinutes === null ? 0 : Math.max(0, checkInMinutes - lateAfterMinutes);
  const existingStatus = String(source.status || '').trim();
  const status =
    checkInMinutes === null
      ? existingStatus || 'Absent'
      : lateMinutes > 0
        ? 'Late'
        : existingStatus === 'On Leave'
          ? 'On Leave'
          : 'On Time';
  return {
    ...source,
    shift: shiftConfig?.name || shiftName,
    checkIn,
    checkOut,
    workedHours: checkIn && checkOut ? formatWorkedDuration(checkIn, checkOut) : String(source.workedHours || ''),
    lateMinutes: String(lateMinutes),
    status,
    clockings,
  };
}

async function enrichAttendanceRecord(db, payload) {
  const source = payload || {};
  const employeeId = String(source.employeeId || '').trim();
  const employeeName = String(source.employee || '').trim();
  const [settingsRecord, employee] = await Promise.all([
    db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
    db.collection('employees').findOne({
      $or: [{ id: employeeId }, { employeeId }, { fullName: employeeName }],
    }),
  ]);
  return enrichAttendanceRecordWithContext(source, {
    settings: normalizeAttendanceSettings(settingsRecord?.value),
    employeeById: new Map(employee?.id ? [[String(employee.id), employee]] : []),
    employeeByEmployeeId: new Map(employee?.employeeId ? [[String(employee.employeeId), employee]] : []),
    employeeByName: new Map(employee?.fullName ? [[String(employee.fullName), employee]] : []),
  });
}

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

app.get('/api/settings/attendance', async (req, res) => {
  try {
    const record = await req.db.collection('appSettings').findOne({ _id: 'attendance-rules' });
    const settings = normalizeAttendanceSettings(record?.value);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load attendance settings' });
  }
});

app.post('/api/settings/attendance', async (req, res) => {
  try {
    const settings = normalizeAttendanceSettings(req.body);
    await req.db.collection('appSettings').updateOne(
      { _id: 'attendance-rules' },
      {
        $set: {
          value: settings,
          updatedAt: new Date().toISOString(),
        },
        $setOnInsert: {
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save attendance settings' });
  }
});

app.get('/api/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const records = await collection.find({}).sort({ _id: -1 }).limit(500).toArray();
    if (moduleId !== 'attendance-time') {
      res.json({ records });
      return;
    }
    const [settingsRecord, employees] = await Promise.all([
      req.db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
      req.db.collection('employees').find({}).toArray(),
    ]);
    const employeeById = new Map();
    const employeeByEmployeeId = new Map();
    const employeeByName = new Map();
    for (const employee of employees) {
      if (employee?.id) {
        employeeById.set(String(employee.id), employee);
      }
      if (employee?.employeeId) {
        employeeByEmployeeId.set(String(employee.employeeId), employee);
      }
      if (employee?.fullName) {
        employeeByName.set(String(employee.fullName), employee);
      }
    }
    const settings = normalizeAttendanceSettings(settingsRecord?.value);
    const normalizedRecords = records.map((row) =>
      enrichAttendanceRecordWithContext(row, {
        settings,
        employeeById,
        employeeByEmployeeId,
        employeeByName,
      })
    );
    res.json({ records: normalizedRecords });
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
    const incoming = moduleId === 'attendance-time' ? await enrichAttendanceRecord(req.db, req.body) : req.body;
    const payload = {
      ...incoming,
      moduleId,
      createdAt: incoming.createdAt || new Date().toISOString(),
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
    const existingRecord = await collection.findOne({ id: recordId });
    if (!existingRecord) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    const { _id, ...requestBody } = req.body || {};
    const mergedRequest = { ...existingRecord, ...requestBody };
    const normalized = moduleId === 'attendance-time' ? await enrichAttendanceRecord(req.db, mergedRequest) : mergedRequest;
    const normalizedWithoutId = { ...(normalized || {}) };
    delete normalizedWithoutId._id;
    const update = {
      ...normalizedWithoutId,
      moduleId,
      updatedAt: new Date().toISOString(),
    };
    const result = await collection.updateOne({ id: recordId }, { $set: update });
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
