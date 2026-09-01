const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Storage } = require('@google-cloud/storage');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const https = require('https');
const {
  allModules,
  normalizeTenantId,
  resolvePackageModules,
  resolveTenantGrantedModules,
  resolveTenantEffectiveLimits,
  resolveUserAllowedModulesForTenant,
} = require('./tenancy');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '30mb' }));

const trackingRoutes = require('./routes/tracking');
const mobileRoutes = require('./routes/mobile');
const { router: authRoutes, ensureSuperAdmin } = require('./routes/auth');

const PORT = process.env.PORT || 8000;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_MASTER_DB_NAME = process.env.MONGO_DB_NAME || 'hr-master';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const GCS_BUCKET_NAME = String(process.env.GCS_BUCKET_NAME || '').trim();
const GCS_PROJECT_ID = String(process.env.GCS_PROJECT_ID || '').trim();
const GCS_CLIENT_EMAIL = String(process.env.GCS_CLIENT_EMAIL || '').trim();
const GCS_PRIVATE_KEY_ID = String(process.env.GCS_PRIVATE_KEY_ID || '').trim();
const GCS_PRIVATE_KEY = String(process.env.GCS_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const defaultEmployeeModules = ['dashboard', 'attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual'];
const allowedUserRoles = new Set(['employee', 'manager', 'hr', 'admin', 'tenant-admin', 'superadmin']);
const blockedEmployeeStatusValues = new Set(['inactive', 'stopped', 'stoped', 'fired', 'resigned', 'terminated']);
const blockedEmployeeStageValues = new Set(['inactive', 'stopped', 'stoped', 'fired', 'resigned', 'terminated', 'expired']);
const HOT_READ_CACHE_TTL_MS = 15000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const moduleCollections = {
  'employee-management': 'employees',
  'attendance-time': 'attendanceTime',
  'attendance-penalty-adjustments': 'attendancePenaltyAdjustments',
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

const attendanceDayRuleMeta = [
  { key: 'monday', defaultEnabled: true },
  { key: 'tuesday', defaultEnabled: true },
  { key: 'wednesday', defaultEnabled: true },
  { key: 'thursday', defaultEnabled: true },
  { key: 'friday', defaultEnabled: true },
  { key: 'saturday', defaultEnabled: false },
  { key: 'sunday', defaultEnabled: false },
  { key: 'holiday', defaultEnabled: false },
];

function parseHolidayDateList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item || '').trim()));
  }
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => String(item || '').trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

function buildDefaultShiftDayRules(base = {}) {
  return attendanceDayRuleMeta.reduce((accumulator, meta) => {
    accumulator[meta.key] = {
      enabled: meta.defaultEnabled,
      reportTime: String(base.reportTime || '08:00').trim(),
      shiftEnd: String(base.shiftEnd || '17:00').trim(),
      graceInMinutes: Math.max(0, Number(base.graceInMinutes) || 0),
      graceOutMinutes: Math.max(0, Number(base.graceOutMinutes) || 0),
      overtimeEnabled: Boolean(base.overtimeEnabled),
      overtimeStartAfterMinutes: Math.max(0, Number(base.overtimeStartAfterMinutes) || 0),
      overtimePayPerMinute: Math.max(0, Number(base.overtimePayPerMinute) || 0),
    };
    return accumulator;
  }, {});
}

function normalizeShiftDayRules(dayRules, base = {}) {
  return attendanceDayRuleMeta.reduce((accumulator, meta) => {
    const source = dayRules?.[meta.key] || {};
    accumulator[meta.key] = {
      enabled: source.enabled === undefined ? meta.defaultEnabled : Boolean(source.enabled),
      reportTime: String(source.reportTime || base.reportTime || '08:00').trim(),
      shiftEnd: String(source.shiftEnd || base.shiftEnd || '17:00').trim(),
      graceInMinutes:
        source.graceInMinutes === undefined
          ? Math.max(0, Number(base.graceInMinutes) || 0)
          : Math.max(0, Number(source.graceInMinutes) || 0),
      graceOutMinutes:
        source.graceOutMinutes === undefined
          ? Math.max(0, Number(base.graceOutMinutes) || 0)
          : Math.max(0, Number(source.graceOutMinutes) || 0),
      overtimeEnabled:
        source.overtimeEnabled === undefined ? Boolean(base.overtimeEnabled) : Boolean(source.overtimeEnabled),
      overtimeStartAfterMinutes:
        source.overtimeStartAfterMinutes === undefined
          ? Math.max(0, Number(base.overtimeStartAfterMinutes) || 0)
          : Math.max(0, Number(source.overtimeStartAfterMinutes) || 0),
      overtimePayPerMinute:
        source.overtimePayPerMinute === undefined
          ? Math.max(0, Number(base.overtimePayPerMinute) || 0)
          : Math.max(0, Number(source.overtimePayPerMinute) || 0),
    };
    return accumulator;
  }, {});
}

function getAttendanceDayRuleKey(dateValue, holidayDates = []) {
  const normalizedDate = String(dateValue || '').trim();
  if (normalizedDate && holidayDates.includes(normalizedDate)) {
    return 'holiday';
  }
  const parsed = new Date(`${normalizedDate}T00:00:00`);
  const weekdayIndex = Number.isNaN(parsed.getTime()) ? 1 : parsed.getDay();
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][weekdayIndex] || 'monday';
}

const defaultAttendanceSettings = {
  attendanceLateAfter: '08:15',
  attendanceReportTime: '08:00',
  attendanceShiftEnd: '17:00',
  requireWebClockInPhoto: false,
  payrollWorkingDays: 26,
  attendanceCalculationMode: 'auto',
  attendanceFixedDeductionPerMinute: 0.128,
  attendanceFixedScope: 'all',
  attendanceFixedDepartment: '',
  attendanceFixedEmployeeId: '',
  attendanceNoClockInPenaltyPercent: 50,
  attendanceNoClockOutPenaltyPercent: 50,
  attendanceAbsentPenaltyPercent: 100,
  attendanceHolidayDates: [],
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
      dayRules: buildDefaultShiftDayRules({
        reportTime: '08:00',
        shiftEnd: '17:00',
        graceInMinutes: 15,
        graceOutMinutes: 0,
        overtimeEnabled: false,
        overtimeStartAfterMinutes: 0,
        overtimePayPerMinute: 0,
      }),
    },
  ],
};

const defaultIdentifierPresets = [
  {
    id: 'ghana',
    name: 'Ghana (SSNIT/TIN)',
    pensionLabel: 'SSNIT Number',
    taxLabel: 'TIN',
  },
  {
    id: 'zambia',
    name: 'Zambia (NAPSA/TPIN)',
    pensionLabel: 'NAPSA Number',
    taxLabel: 'TPIN',
  },
];

const defaultGeneralSettings = {
  appName: 'PTHR',
  sidebarColor: '#0a73d9',
  defaultCurrency: 'USD',
  penaltyActorUsername: 'admin',
  currencies: ['USD', 'GHS', 'ZMW'],
  identifierPresets: defaultIdentifierPresets,
  identifierCountry: defaultIdentifierPresets[0].id,
  pensionFieldLabel: defaultIdentifierPresets[0].pensionLabel,
  taxFieldLabel: defaultIdentifierPresets[0].taxLabel,
  employmentStages: ['Probation', 'Confirmed', 'Suspended', 'On Leave', 'Fired', 'Expired'],
  statutoryRules: {
    napsaMode: 'percent-basic',
    napsaValue: 5,
    nhimaMode: 'percent-basic',
    nhimaValue: 1,
    taxMode: 'percent-basic',
    taxValue: 10,
    taxMinAmount: 0,
  },
  loanRules: {
    minTakeHomePercent: 45,
    maxLoanDeductionPercentOfGross: 35,
    defaultInterestPercentPerMonth: 5,
    overduePenaltyPercentPerDay: 2,
  },
  idCardDesign: {
    companyName: 'PTHR',
    orientation: 'landscape',
    borderRadius: 18,
    logoUrl: '',
    primaryColor: '#0f4ca3',
    secondaryColor: '#21aa9c',
  },
  fingerprintIntegration: {
    mode: 'simulation',
    gatewayUrl: '',
    apiVersion: 'v1',
    heartbeatSeconds: 30,
  },
  departments: [
    { name: 'Human Resources', code: 'HR' },
    { name: 'Engineering', code: 'EN' },
    { name: 'Finance', code: 'FN' },
    { name: 'Operations', code: 'OP' },
  ],
};

let gcsBucket = null;

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

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDateInput(value, fallback = getTodayIsoDate()) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : fallback;
}

function getMonthStartIsoDate(value) {
  return `${normalizeIsoDateInput(value).slice(0, 7)}-01`;
}

function toNumberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function hasAttendanceClockIn(record) {
  if (!record) {
    return false;
  }
  if (Array.isArray(record.clockings)) {
    return record.clockings.some((clocking) => String(clocking?.mode || '').trim().toLowerCase() === 'clock-in');
  }
  return Boolean(String(record.checkIn || '').trim());
}

function isLeaveRejectedRecord(record) {
  const departmentApproval = String(record?.departmentApproval || record?.supervisorApproval || '').trim().toLowerCase();
  const hrApproval = String(record?.hrApproval || '').trim().toLowerCase();
  const managerApproval = String(record?.managerApproval || record?.finalManagerApproval || record?.branchManagerApproval || '')
    .trim()
    .toLowerCase();
  const status = String(record?.status || '').trim().toLowerCase();
  return departmentApproval === 'rejected' || hrApproval === 'rejected' || managerApproval === 'rejected' || status === 'rejected';
}

function isLeaveFullyApprovedRecord(record) {
  if (!record || isLeaveRejectedRecord(record)) {
    return false;
  }
  const departmentApproval = String(record?.departmentApproval || record?.supervisorApproval || '').trim().toLowerCase();
  const hrApproval = String(record?.hrApproval || '').trim().toLowerCase();
  const managerApproval = String(record?.managerApproval || record?.finalManagerApproval || record?.branchManagerApproval || '')
    .trim()
    .toLowerCase();
  return departmentApproval === 'approved' && hrApproval === 'approved' && managerApproval === 'approved';
}

function isLoanCountableRecord(record) {
  const status = String(record?.status || '').trim().toLowerCase();
  return status === 'active' || status === 'approved';
}

function getLoanViewStatusForTab(record, viewTab = 'requests') {
  if (viewTab === 'department') {
    return String(record?.departmentApproval || 'Pending').trim() || 'Pending';
  }
  if (viewTab === 'hr') {
    return String(record?.hrApproval || 'Pending').trim() || 'Pending';
  }
  if (viewTab === 'manager') {
    return String(record?.managerApproval || 'Pending').trim() || 'Pending';
  }
  return String(record?.status || 'Pending').trim() || 'Pending';
}

function getLoanListView(records, query = {}, authUser = null) {
  const normalizedRole = String(authUser?.role || '').trim().toLowerCase();
  const employeeId = String(authUser?.employeeId || '').trim();
  const employeeName = String(authUser?.fullName || '').trim();
  const viewTab = String(query.viewTab || 'requests').trim().toLowerCase();
  const searchText = String(query.search || '').trim().toLowerCase();
  const statusFilter = String(query.statusFilter || 'All').trim();
  const pageSize = Math.min(250, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Number(query.page) || 1);

  let scopedRows = Array.isArray(records) ? records : [];
  if (normalizedRole === 'employee') {
    scopedRows = scopedRows.filter((row) => {
      const rowEmployeeId = String(row?.employeeId || '').trim();
      const rowEmployeeName = String(row?.employee || '').trim();
      if (employeeId) {
        return rowEmployeeId === employeeId;
      }
      if (employeeName) {
        return rowEmployeeName === employeeName;
      }
      return false;
    });
  }
  if (viewTab === 'hr') {
    scopedRows = scopedRows.filter((row) => String(row?.departmentApproval || '').trim() === 'Approved');
  } else if (viewTab === 'manager') {
    scopedRows = scopedRows.filter(
      (row) =>
        String(row?.departmentApproval || '').trim() === 'Approved' &&
        String(row?.hrApproval || '').trim() === 'Approved'
    );
  }

  const statusOptions = [
    ...new Set(
      scopedRows
        .map((row) => getLoanViewStatusForTab(row, viewTab))
        .filter((value) => String(value || '').trim().length > 0)
    ),
  ].sort((left, right) => left.localeCompare(right));

  const filteredRows = scopedRows.filter((row) => {
    const statusLabel = getLoanViewStatusForTab(row, viewTab);
    const matchesStatus = statusFilter === 'All' || statusLabel === statusFilter;
    if (!matchesStatus) {
      return false;
    }
    if (!searchText) {
      return true;
    }
    return (
      String(row?.employee || '').toLowerCase().includes(searchText) ||
      String(row?.employeeId || '').toLowerCase().includes(searchText) ||
      String(row?.type || '').toLowerCase().includes(searchText) ||
      String(row?.department || '').toLowerCase().includes(searchText) ||
      String(row?.status || '').toLowerCase().includes(searchText)
    );
  });

  const sortedRows = [...filteredRows].sort((left, right) => {
    const dateCompare = String(right?.issuedOn || '').localeCompare(String(left?.issuedOn || ''));
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return String(right?._id || '').localeCompare(String(left?._id || ''));
  });

  const summary = filteredRows.reduce(
    (accumulator, row) => {
      const statusLabel = getLoanViewStatusForTab(row, viewTab).toLowerCase();
      accumulator.totalRequests += 1;
      if (statusLabel.includes('pending')) {
        accumulator.pendingCount += 1;
      } else if (statusLabel === 'approved') {
        accumulator.approvedCount += 1;
      } else if (statusLabel === 'rejected') {
        accumulator.rejectedCount += 1;
      }
      return accumulator;
    },
    { totalRequests: 0, pendingCount: 0, approvedCount: 0, rejectedCount: 0 }
  );

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(totalPages, page);
  const start = (safePage - 1) * pageSize;
  return {
    records: sortedRows.slice(start, start + pageSize),
    meta: {
      totalRows,
      totalPages,
      page: safePage,
      pageSize,
      statusOptions,
      summary,
    },
  };
}

function buildAttendanceClockRangeQuery(query = {}, authUser = null) {
  const normalizedRole = String(authUser?.role || '').trim().toLowerCase();
  const employeeId = String(authUser?.employeeId || '').trim();
  const employeeName = String(authUser?.fullName || '').trim();
  const startDate = String(query.startDate || '').trim();
  const endDate = String(query.endDate || '').trim();
  const mongoQuery = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    mongoQuery.date = startDate <= endDate ? { $gte: startDate, $lte: endDate } : { $gte: endDate, $lte: startDate };
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    mongoQuery.date = startDate;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    mongoQuery.date = endDate;
  }
  if (normalizedRole === 'employee') {
    const employeeOr = [];
    if (employeeId) {
      employeeOr.push({ employeeId });
    }
    if (employeeName) {
      employeeOr.push({ employee: employeeName });
    }
    if (employeeOr.length > 0) {
      mongoQuery.$or = employeeOr;
    }
  }
  return mongoQuery;
}

function buildAttendanceComplianceQuery(query = {}, authUser = null) {
  const normalizedRole = String(authUser?.role || '').trim().toLowerCase();
  const employeeId = String(authUser?.employeeId || '').trim();
  const employeeName = String(authUser?.fullName || '').trim();
  const targetDate = String(query.date || '').trim();
  const mongoQuery = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    mongoQuery.date = targetDate;
  }
  if (normalizedRole === 'employee') {
    const employeeOr = [];
    if (employeeId) {
      employeeOr.push({ employeeId });
    }
    if (employeeName) {
      employeeOr.push({ employee: employeeName });
    }
    if (employeeOr.length > 0) {
      mongoQuery.$or = employeeOr;
    }
  }
  return mongoQuery;
}

function buildAttendancePerformanceQuery(query = {}, authUser = null) {
  const normalizedRole = String(authUser?.role || '').trim().toLowerCase();
  const employeeId = String(authUser?.employeeId || '').trim();
  const employeeName = String(authUser?.fullName || '').trim();
  const startDate = String(query.startDate || '').trim();
  const endDate = String(query.endDate || '').trim();
  const mongoQuery = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    mongoQuery.date = { $gte: startDate, $lte: endDate };
  }
  if (normalizedRole === 'employee') {
    const employeeOr = [];
    if (employeeId) {
      employeeOr.push({ employeeId });
    }
    if (employeeName) {
      employeeOr.push({ employee: employeeName });
    }
    if (employeeOr.length > 0) {
      mongoQuery.$or = employeeOr;
    }
  }
  return mongoQuery;
}

function isPermissionLeaveRecord(row) {
  return String(row?.type || '').trim().toLowerCase() === 'permission';
}

function getAttendancePermissionScope(row) {
  const normalized = String(row?.attendanceExemptionScope || '').trim().toLowerCase();
  return ['all', 'late-only', 'no-clock-in', 'no-clock-out', 'missing-clock'].includes(normalized)
    ? normalized
    : 'all';
}

function parseIsoDateValue(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDateString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function overlapDaysInclusive(startA, endA, startB, endB) {
  const safeStartA = parseIsoDateValue(startA);
  const safeEndA = parseIsoDateValue(endA);
  const safeStartB = parseIsoDateValue(startB);
  const safeEndB = parseIsoDateValue(endB);
  if (!safeStartA || !safeEndA || !safeStartB || !safeEndB) {
    return 0;
  }
  const start = Math.max(safeStartA.getTime(), safeStartB.getTime());
  const end = Math.min(safeEndA.getTime(), safeEndB.getTime());
  if (start > end) {
    return 0;
  }
  return Math.floor((end - start) / DAY_IN_MS) + 1;
}

function getAttendanceEmployeeMatchClauses(authUser = null, fields = {}) {
  const idField = String(fields.idField || 'employeeId');
  const nameField = String(fields.nameField || 'employee');
  const employeeId = String(authUser?.employeeId || '').trim();
  const employeeName = String(authUser?.fullName || '').trim();
  const clauses = [];
  if (employeeId) {
    clauses.push({ [idField]: employeeId });
  }
  if (employeeName) {
    clauses.push({ [nameField]: employeeName });
  }
  return clauses;
}

function getRecordEmployeeKey(record) {
  return String(record?.id || record?.employeeId || record?.fullName || record?.employee || '')
    .trim()
    .toLowerCase();
}

function getComparableAttendanceValue(row, sortKey) {
  switch (sortKey) {
    case 'date':
      return String(row?.date || '');
    case 'employee':
      return String(row?.employee || '');
    case 'shift':
      return String(row?.shift || '');
    case 'checkIn':
      return toMinutesFromClock(row?.checkIn) ?? -1;
    case 'checkOut':
      return toMinutesFromClock(row?.checkOut) ?? -1;
    case 'dailyStatus':
      return String(row?.dailyStatus || '');
    case 'lateMinutes':
      return Math.max(0, toNumberValue(row?.lateMinutes));
    case 'deductionAmount':
      return Math.max(0, toNumberValue(row?.deductionAmount));
    default:
      return String(row?.employee || '');
  }
}

function compareAttendanceSortValues(left, right, direction) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const bothNumbers = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
  const base = bothNumbers ? leftNumber - rightNumber : String(left ?? '').localeCompare(String(right ?? ''));
  return direction === 'desc' ? -base : base;
}

function getAttendanceClockListView(records, query = {}, context = {}) {
  const searchText = String(query.search || '').trim().toLowerCase();
  const pageSize = Math.min(250, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const mergedRows = mergeDuplicateAttendanceRecords(records, context)
    .filter((row) => {
      if (!searchText) {
        return true;
      }
      return (
        String(row?.employee || '').toLowerCase().includes(searchText) ||
        String(row?.employeeId || '').toLowerCase().includes(searchText) ||
        String(row?.department || '').toLowerCase().includes(searchText)
      );
    })
    .sort((left, right) => {
      const dateCompare = String(right?.date || '').localeCompare(String(left?.date || ''));
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return String(left?.employee || '').localeCompare(String(right?.employee || ''));
    });

  const summary = mergedRows.reduce(
    (accumulator, row) => {
      const isLate = String(row?.status || '').trim().toLowerCase() === 'late';
      accumulator.totalRows += 1;
      accumulator.lateCount += isLate ? 1 : 0;
      accumulator.totalLateMinutes += Math.max(0, toNumberValue(row?.lateMinutes));
      accumulator.totalDeductionAmount += Math.max(0, toNumberValue(row?.deductionAmount));
      return accumulator;
    },
    {
      totalRows: 0,
      lateCount: 0,
      totalLateMinutes: 0,
      totalDeductionAmount: 0,
    }
  );
  summary.onTimeCount = Math.max(0, summary.totalRows - summary.lateCount);

  const totalPages = Math.max(1, Math.ceil(summary.totalRows / pageSize));
  const safePage = Math.min(totalPages, page);
  const start = (safePage - 1) * pageSize;
  return {
    records: mergedRows.slice(start, start + pageSize),
    meta: {
      ...summary,
      page: safePage,
      pageSize,
      totalPages,
    },
  };
}

function buildAttendanceComplianceRows(records, query = {}, context = {}) {
  const searchText = String(query.search || '').trim().toLowerCase();
  const filterValue = String(query.filter || 'All').trim();
  const sortKey = ['date', 'employee', 'shift', 'checkIn', 'checkOut', 'dailyStatus', 'lateMinutes', 'deductionAmount'].includes(
    String(query.sortKey || '').trim()
  )
    ? String(query.sortKey || '').trim()
    : 'employee';
  const sortDirection = String(query.sortDirection || '').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  const settings = context?.settings || defaultAttendanceSettings;
  const targetDate = String(query.date || '').trim();
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const isPastDate = targetDate < todayIsoDate;
  const leaveRows = Array.isArray(context?.leaveRows) ? context.leaveRows : [];
  const payrollByEmployeeKey = context?.payrollByEmployeeKey instanceof Map ? context.payrollByEmployeeKey : new Map();
  const mergedRows = mergeDuplicateAttendanceRecords(records, context);
  return mergedRows
    .map((attendanceRow) => {
      const employeeId = String(attendanceRow?.employeeId || '').trim();
      const employeeName = String(attendanceRow?.employee || '').trim();
      const matchedEmployee =
        context?.employeeById?.get(employeeId) ||
        context?.employeeByEmployeeId?.get(employeeId) ||
        context?.employeeByName?.get(employeeName) || {
          id: employeeId,
          employeeId,
          fullName: employeeName,
          department: String(attendanceRow?.department || '').trim() || 'Unassigned',
          assignedShift: String(attendanceRow?.shift || '').trim(),
          status: 'Active',
          employmentState: 'Confirmed',
        };
      const effectiveAttendanceRow = attendanceRow?.__enriched
        ? attendanceRow
        : enrichAttendanceRecordWithContext(attendanceRow, context);
      const shiftSchedule = getShiftScheduleForAttendanceRecord(effectiveAttendanceRow, matchedEmployee, settings);
      const clockings = normalizeAttendanceClockings(effectiveAttendanceRow);
      const firstCheckIn = clockings.find((clocking) => clocking.mode === 'clock-in') || null;
      const lastCheckOut = [...clockings].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
      const checkIn = String(firstCheckIn?.time || effectiveAttendanceRow?.checkIn || '').trim();
      const checkOut = String(lastCheckOut?.time || effectiveAttendanceRow?.checkOut || '').trim();
      const checkInMinutes = toMinutesFromClock(checkIn);
      const rawCheckOut = String(checkOut || '').trim();
      const hasMidnightCheckout = rawCheckOut === '00:00' || rawCheckOut === '24:00';
      const checkOutMinutes = hasMidnightCheckout ? null : toMinutesFromClock(rawCheckOut);
      const hasClockIn = checkInMinutes !== null;
      const hasClockOut = checkOutMinutes !== null && checkOutMinutes > (checkInMinutes ?? 0);
      const lateMinutes = Math.max(0, toNumberValue(effectiveAttendanceRow?.lateMinutes));
      const lateDeductionBase = Math.max(0, toNumberValue(effectiveAttendanceRow?.deductionAmount));
      const payrollProfile =
        payrollByEmployeeKey.get(getRecordEmployeeKey(matchedEmployee)) ||
        payrollByEmployeeKey.get(getRecordEmployeeKey(effectiveAttendanceRow)) ||
        null;
      const basicPay = toNumberValue(payrollProfile?.basicPay || matchedEmployee?.basicPay);
      const workingDays = Math.max(
        1,
        Number(payrollProfile?.workingDays || matchedEmployee?.workingDays || settings?.payrollWorkingDays) || 1
      );
      const dailyWage = basicPay > 0 ? basicPay / workingDays : 0;
      const leaveMatch = leaveRows.find((leaveRow) => {
        const leaveEmployeeId = String(leaveRow?.employeeId || '').trim();
        const leaveEmployee = String(leaveRow?.employee || '').trim();
        const status = String(leaveRow?.status || '').trim().toLowerCase();
        const matchesEmployee =
          leaveEmployeeId === String(matchedEmployee?.id || '').trim() ||
          leaveEmployeeId === String(matchedEmployee?.employeeId || '').trim() ||
          leaveEmployee === String(matchedEmployee?.fullName || '').trim();
        return (
          matchesEmployee &&
          !isPermissionLeaveRecord(leaveRow) &&
          (status === 'approved' || status === 'active') &&
          String(leaveRow?.startDate || '').trim() <= targetDate &&
          String(leaveRow?.endDate || '').trim() >= targetDate
        );
      });
      const permissionMatch = leaveRows.find((leaveRow) => {
        const leaveEmployeeId = String(leaveRow?.employeeId || '').trim();
        const leaveEmployee = String(leaveRow?.employee || '').trim();
        const status = String(leaveRow?.status || '').trim().toLowerCase();
        const matchesEmployee =
          leaveEmployeeId === String(matchedEmployee?.id || '').trim() ||
          leaveEmployeeId === String(matchedEmployee?.employeeId || '').trim() ||
          leaveEmployee === String(matchedEmployee?.fullName || '').trim();
        return (
          matchesEmployee &&
          isPermissionLeaveRecord(leaveRow) &&
          (status === 'approved' || status === 'active') &&
          String(leaveRow?.startDate || '').trim() <= targetDate &&
          String(leaveRow?.endDate || '').trim() >= targetDate
        );
      });
      const permissionScope = permissionMatch ? getAttendancePermissionScope(permissionMatch) : '';
      const exemptLate = permissionScope === 'all' || permissionScope === 'late-only';
      const exemptNoClockIn =
        permissionScope === 'all' || permissionScope === 'missing-clock' || permissionScope === 'no-clock-in';
      const exemptNoClockOut =
        permissionScope === 'all' || permissionScope === 'missing-clock' || permissionScope === 'no-clock-out';
      const employeeStatus = String(matchedEmployee?.status || '').trim().toLowerCase();
      const employeeStage = String(matchedEmployee?.employmentState || '').trim().toLowerCase();
      const isOffDuty = employeeStatus !== 'active' || employeeStage === 'terminated' || employeeStage === 'suspended';
      const isOnLeave = Boolean(leaveMatch);
      const isOffScheduleDay = !shiftSchedule.isWorkingDay;
      const isExempt = isOffDuty || isOnLeave || isOffScheduleDay;
      const isLate = shiftSchedule.isWorkingDay && hasClockIn && checkInMinutes > shiftSchedule.lateAfterMinutes;
      const leftEarly =
        hasClockOut && shiftSchedule.shiftEndMinutes > 0 && checkOutMinutes < shiftSchedule.shiftEndMinutes;
      const overtimeMinutes =
        shiftSchedule.isWorkingDay && hasClockOut && shiftSchedule.overtimeEnabled
          ? Math.max(0, (checkOutMinutes ?? 0) - shiftSchedule.overtimeStartMinutes)
          : 0;
      const overtimeAmount = overtimeMinutes * Math.max(0, Number(shiftSchedule.overtimePayPerMinute) || 0);
      const countMissingClockIn =
        !isExempt &&
        !exemptNoClockIn &&
        !hasClockIn &&
        (isPastDate || (targetDate === todayIsoDate && nowMinutes >= shiftSchedule.lateAfterMinutes));
      const countMissingClockOut =
        !isExempt &&
        !exemptNoClockOut &&
        !hasClockOut &&
        (isPastDate || (targetDate === todayIsoDate && nowMinutes >= shiftSchedule.shiftEndWithGraceMinutes));
      const missingCount = Number(countMissingClockIn) + Number(countMissingClockOut);
      const noClockInPenalty =
        missingCount === 1 && countMissingClockIn
          ? dailyWage * (Math.max(0, Number(settings?.attendanceNoClockInPenaltyPercent) || 0) / 100)
          : 0;
      const noClockOutPenalty =
        missingCount === 1 && countMissingClockOut
          ? dailyWage * (Math.max(0, Number(settings?.attendanceNoClockOutPenaltyPercent) || 0) / 100)
          : 0;
      const absentPenalty =
        missingCount >= 2
          ? dailyWage * (Math.max(0, Number(settings?.attendanceAbsentPenaltyPercent) || 0) / 100)
          : 0;
      const pendingClockIn = !isExempt && !hasClockIn && !countMissingClockIn;
      const lateDeduction = exemptLate ? 0 : lateDeductionBase;
      const penalties = [];
      if (lateDeduction > 0) {
        penalties.push({ type: 'lateness', label: 'Late Clock In', amount: lateDeduction });
      }
      if (noClockInPenalty > 0) {
        penalties.push({ type: 'no-clock-in', label: 'No Clock In', amount: noClockInPenalty });
      }
      if (noClockOutPenalty > 0) {
        penalties.push({ type: 'no-clock-out', label: 'No Clock Out', amount: noClockOutPenalty });
      }
      if (absentPenalty > 0) {
        penalties.push({ type: 'absent', label: 'Absent', amount: absentPenalty });
      }
      let dailyStatus = 'On Time';
      if (isOnLeave) {
        dailyStatus = 'On Leave';
      } else if (isOffDuty) {
        dailyStatus = 'Off Duty';
      } else if (isOffScheduleDay) {
        dailyStatus = hasClockIn || hasClockOut
          ? shiftSchedule.isHoliday
            ? 'Holiday Worked'
            : 'Off Day Worked'
          : shiftSchedule.isHoliday
            ? 'Holiday'
            : 'Off Day';
      } else if (permissionMatch && !hasClockIn && !hasClockOut && (exemptNoClockIn || exemptNoClockOut)) {
        dailyStatus = 'Permission';
      } else if (absentPenalty > 0) {
        dailyStatus = 'Absent';
      } else if (!hasClockIn) {
        dailyStatus = exemptNoClockIn ? 'No Clock In (Permitted)' : pendingClockIn ? 'Pending Clock In' : 'No Clock In';
      } else if (!hasClockOut && exemptNoClockOut) {
        dailyStatus = 'No Clock Out (Permitted)';
      } else if (noClockOutPenalty > 0) {
        dailyStatus = 'Clocked In Once';
      } else if (isLate) {
        dailyStatus = exemptLate ? 'Late (Permitted)' : 'Late';
      }
      if (dailyStatus === 'On Time' && leftEarly) {
        dailyStatus = 'Left Early';
      }
      return {
        date: targetDate,
        employeeId: String(matchedEmployee?.id || matchedEmployee?.employeeId || effectiveAttendanceRow?.employeeId || '').trim(),
        employee: String(matchedEmployee?.fullName || effectiveAttendanceRow?.employee || '').trim(),
        department: String(matchedEmployee?.department || effectiveAttendanceRow?.department || '').trim() || 'Unassigned',
        shift: shiftSchedule.shiftName,
        checkIn,
        checkOut,
        clockings,
        firstCheckInPhoto: String(firstCheckIn?.photoDataUrl || ''),
        lastCheckOutPhoto: String(lastCheckOut?.photoDataUrl || ''),
        deductionAmount: lateDeduction,
        lateMinutes,
        dailyWage,
        dailyStatus,
        isLate,
        permissionId: String(permissionMatch?.id || ''),
        permissionScope,
        permissionReason: String(permissionMatch?.reason || ''),
        leftEarly,
        overtimeMinutes,
        overtimeAmount,
        penalties,
      };
    })
    .filter((row) => {
      const matchesFilter = filterValue === 'All' || String(row?.dailyStatus || '') === filterValue;
      const matchesSearch =
        !searchText ||
        String(row?.employee || '').toLowerCase().includes(searchText) ||
        String(row?.employeeId || '').toLowerCase().includes(searchText) ||
        String(row?.department || '').toLowerCase().includes(searchText);
      return matchesFilter && matchesSearch;
    })
    .sort((left, right) => {
      const primaryCompare = compareAttendanceSortValues(
        getComparableAttendanceValue(left, sortKey),
        getComparableAttendanceValue(right, sortKey),
        sortDirection
      );
      if (primaryCompare !== 0) {
        return primaryCompare;
      }
      return String(left?.employee || '').localeCompare(String(right?.employee || ''));
    });
}

function getAttendanceComplianceListView(records, query = {}, context = {}) {
  const pageSize = Math.min(250, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const sortKey = ['date', 'employee', 'shift', 'checkIn', 'checkOut', 'dailyStatus', 'lateMinutes', 'deductionAmount'].includes(
    String(query.sortKey || '').trim()
  )
    ? String(query.sortKey || '').trim()
    : 'employee';
  const sortDirection = String(query.sortDirection || '').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  const complianceRows = buildAttendanceComplianceRows(records, query, context);
  const statusCounts = complianceRows.reduce((accumulator, row) => {
    const statusKey = String(row?.dailyStatus || 'Unknown');
    accumulator[statusKey] = (accumulator[statusKey] || 0) + 1;
    return accumulator;
  }, {});
  const totalRows = complianceRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(totalPages, page);
  const start = (safePage - 1) * pageSize;
  return {
    records: complianceRows.slice(start, start + pageSize),
    meta: {
      totalRows,
      totalPages,
      page: safePage,
      pageSize,
      statusCounts,
      sortKey,
      sortDirection,
    },
  };
}

function getAttendancePerformanceListView(records, query = {}, context = {}) {
  const startDate = String(query.startDate || '').trim();
  const endDate = String(query.endDate || '').trim();
  const rankMetric = String(query.rankMetric || 'perfect-attendance').trim();
  const searchText = String(query.search || '').trim().toLowerCase();
  const departmentFilter = String(query.departmentFilter || 'All').trim();
  const sortKey = ['employee', 'department', 'onTimeCompleteDays', 'lateDays', 'absentDays', 'attendanceScore'].includes(
    String(query.sortKey || '').trim()
  )
    ? String(query.sortKey || '').trim()
    : 'attendanceScore';
  const sortDirection = String(query.sortDirection || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
  const pageSize = Math.min(250, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const settings = context?.settings || defaultAttendanceSettings;
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const todayIsoDate = toIsoDateString(new Date());
  const leaveRows = Array.isArray(context?.leaveRows) ? context.leaveRows : [];
  const scopedEmployees = Array.isArray(context?.employees) ? context.employees : [];
  const mergedRows = mergeDuplicateAttendanceRecords(records, context);
  const attendanceByEmployeeDate = new Map();
  mergedRows.forEach((row) => {
    const employeeId = String(row?.employeeId || '').trim();
    const employeeName = String(row?.employee || '').trim().toLowerCase();
    const date = String(row?.date || '').trim();
    if (!date) {
      return;
    }
    if (employeeId) {
      attendanceByEmployeeDate.set(`${employeeId}|${date}`, row);
    }
    if (employeeName) {
      attendanceByEmployeeDate.set(`${employeeName}|${date}`, row);
    }
  });

  const rows = scopedEmployees
    .map((employee) => {
      const employeeId = String(employee?.id || employee?.employeeId || '').trim();
      const employeeName = String(employee?.fullName || '').trim();
      const employeeNameKey = employeeName.toLowerCase();
      const employeeStatus = String(employee?.status || '').toLowerCase();
      const employeeStage = String(employee?.employmentState || '').toLowerCase();
      const isOffDuty = employeeStatus !== 'active' || employeeStage === 'terminated' || employeeStage === 'suspended';
      const leaveApplications = leaveRows.filter((leaveRow) => {
        const leaveEmployeeId = String(leaveRow?.employeeId || '').trim();
        const leaveEmployeeName = String(leaveRow?.employee || '').trim();
        const matches = leaveEmployeeId === employeeId || leaveEmployeeName === employeeName;
        return matches && String(leaveRow?.startDate || '') >= startDate && String(leaveRow?.startDate || '') <= endDate;
      });
      const leaveDays = leaveRows.reduce((total, leaveRow) => {
        const leaveEmployeeId = String(leaveRow?.employeeId || '').trim();
        const leaveEmployeeName = String(leaveRow?.employee || '').trim();
        const leaveStatus = String(leaveRow?.status || '').toLowerCase();
        const matches = leaveEmployeeId === employeeId || leaveEmployeeName === employeeName;
        if (!matches || !['approved', 'active', 'planned'].includes(leaveStatus)) {
          return total;
        }
        return total + overlapDaysInclusive(leaveRow?.startDate, leaveRow?.endDate, startDate, endDate);
      }, 0);
      let expectedWorkDays = 0;
      let onTimeCompleteDays = 0;
      let lateDays = 0;
      let absentDays = 0;
      let clockedOnceDays = 0;
      let leftEarlyDays = 0;
      let noClockInDays = 0;
      let noClockOutDays = 0;

      for (
        let cursor = parseIsoDateValue(startDate);
        cursor && cursor <= (parseIsoDateValue(endDate) || cursor);
        cursor = new Date(cursor.getTime() + DAY_IN_MS)
      ) {
        const currentDate = toIsoDateString(cursor);
        const isPastDate = currentDate < todayIsoDate;
        const leaveOnDate = leaveRows.find((leaveRow) => {
          const leaveEmployeeId = String(leaveRow?.employeeId || '').trim();
          const leaveEmployeeName = String(leaveRow?.employee || '').trim();
          const leaveStatus = String(leaveRow?.status || '').toLowerCase();
          const matches = leaveEmployeeId === employeeId || leaveEmployeeName === employeeName;
          return (
            matches &&
            ['approved', 'active', 'planned'].includes(leaveStatus) &&
            String(leaveRow?.startDate || '') <= currentDate &&
            String(leaveRow?.endDate || '') >= currentDate
          );
        });
        if (!isOffDuty && !leaveOnDate) {
          expectedWorkDays += 1;
          const attendanceRow =
            attendanceByEmployeeDate.get(`${employeeId}|${currentDate}`) ||
            attendanceByEmployeeDate.get(`${employeeNameKey}|${currentDate}`) ||
            null;
          const shiftSchedule = getShiftScheduleForAttendanceRecord(
            attendanceRow || {
              date: currentDate,
              employeeId,
              employee: employeeName,
              shift: String(employee?.assignedShift || '').trim(),
            },
            employee,
            settings
          );
          const checkIn = String(attendanceRow?.checkIn || '').trim();
          const checkOutRaw = String(attendanceRow?.checkOut || '').trim();
          const checkInMinutes = toMinutesFromClock(checkIn);
          const checkOutMinutes = toMinutesFromClock(checkOutRaw);
          const hasClockIn = checkInMinutes !== null;
          const hasClockOut =
            checkOutRaw !== '00:00' &&
            checkOutRaw !== '24:00' &&
            checkOutMinutes !== null &&
            checkOutMinutes > (checkInMinutes ?? 0);
          const isLate =
            hasClockIn &&
            shiftSchedule.lateAfterMinutes !== null &&
            checkInMinutes > shiftSchedule.lateAfterMinutes;
          const leftEarly =
            hasClockOut &&
            shiftSchedule.shiftEndMinutes > 0 &&
            checkOutMinutes < shiftSchedule.shiftEndMinutes;
          if (isLate) {
            lateDays += 1;
          }
          if (leftEarly) {
            leftEarlyDays += 1;
          }
          const missingClockIn =
            !hasClockIn &&
            shiftSchedule.lateAfterMinutes !== null &&
            (isPastDate || (currentDate === todayIsoDate && nowMinutes >= shiftSchedule.lateAfterMinutes));
          const missingClockOut =
            !hasClockOut &&
            (isPastDate || (currentDate === todayIsoDate && nowMinutes >= shiftSchedule.shiftEndWithGraceMinutes));
          if (missingClockIn) {
            noClockInDays += 1;
          }
          if (missingClockOut) {
            noClockOutDays += 1;
          }
          if (missingClockIn && missingClockOut) {
            absentDays += 1;
          } else if (missingClockIn || missingClockOut) {
            clockedOnceDays += 1;
          }
          if (hasClockIn && hasClockOut && !isLate && !leftEarly) {
            onTimeCompleteDays += 1;
          }
        }
      }
      const periodDays = Math.max(1, overlapDaysInclusive(startDate, endDate, startDate, endDate));
      const perfectAttendance =
        expectedWorkDays > 0 &&
        onTimeCompleteDays === expectedWorkDays &&
        leaveApplications.length === 0 &&
        absentDays === 0 &&
        lateDays === 0 &&
        clockedOnceDays === 0 &&
        leftEarlyDays === 0;
      const attendanceScore = expectedWorkDays > 0 ? (onTimeCompleteDays / expectedWorkDays) * 100 : 0;
      return {
        employeeId,
        employee: employeeName,
        department: String(employee?.department || '').trim() || 'Unassigned',
        periodStart: startDate,
        periodEnd: endDate,
        periodDays,
        expectedWorkDays,
        onTimeCompleteDays,
        lateDays,
        absentDays,
        clockedOnceDays,
        leftEarlyDays,
        leaveDays,
        leaveApplications: leaveApplications.length,
        perfectAttendance,
        attendanceScore,
        noClockInDays,
        noClockOutDays,
      };
    })
    .filter((row) => {
      const matchesDepartment = departmentFilter === 'All' || String(row?.department || '') === departmentFilter;
      if (!matchesDepartment) {
        return false;
      }
      if (!searchText) {
        return true;
      }
      return (
        String(row?.employee || '').toLowerCase().includes(searchText) ||
        String(row?.employeeId || '').toLowerCase().includes(searchText) ||
        String(row?.department || '').toLowerCase().includes(searchText)
      );
    })
    .sort((left, right) => {
      if (rankMetric === 'least-leave-applications') {
        return left.leaveApplications - right.leaveApplications || right.attendanceScore - left.attendanceScore;
      }
      if (rankMetric === 'most-leave-applications') {
        return right.leaveApplications - left.leaveApplications || left.attendanceScore - right.attendanceScore;
      }
      if (rankMetric === 'least-absent') {
        return left.absentDays - right.absentDays || right.attendanceScore - left.attendanceScore;
      }
      if (rankMetric === 'most-absent') {
        return right.absentDays - left.absentDays || left.attendanceScore - right.attendanceScore;
      }
      if (rankMetric === 'least-late') {
        return left.lateDays - right.lateDays || right.attendanceScore - left.attendanceScore;
      }
      if (rankMetric === 'most-late') {
        return right.lateDays - left.lateDays || left.attendanceScore - right.attendanceScore;
      }
      return right.attendanceScore - left.attendanceScore || Number(right.perfectAttendance) - Number(left.perfectAttendance);
    })
    .sort((left, right) => {
      const primaryCompare = compareAttendanceSortValues(left?.[sortKey], right?.[sortKey], sortDirection);
      if (primaryCompare !== 0) {
        return primaryCompare;
      }
      return String(left?.employee || '').localeCompare(String(right?.employee || ''));
    });

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(totalPages, page);
  const start = (safePage - 1) * pageSize;
  return {
    records: rows.slice(start, start + pageSize),
    meta: {
      totalRows,
      totalPages,
      page: safePage,
      pageSize,
      periodStart: startDate,
      periodEnd: endDate,
      departmentFilter,
      rankMetric,
      sortKey,
      sortDirection,
    },
  };
}

function getAttendancePenaltyListView(records, adjustments = [], query = {}, context = {}) {
  const searchText = String(query.search || '').trim().toLowerCase();
  const statusFilter = String(query.statusFilter || 'Outstanding').trim();
  const sortKey = ['employee', 'date', 'penaltyLabel', 'outstandingAmount', 'status'].includes(
    String(query.sortKey || '').trim()
  )
    ? String(query.sortKey || '').trim()
    : 'date';
  const sortDirection = String(query.sortDirection || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
  const pageSize = Math.min(250, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const complianceRows = buildAttendanceComplianceRows(
    records,
    {
      date: query.date,
      filter: 'All',
      search: '',
      sortKey: 'employee',
      sortDirection: 'asc',
    },
    context
  );
  const adjustmentsByPenaltyKey = new Map();
  (Array.isArray(adjustments) ? adjustments : []).forEach((adjustment) => {
    const penaltyKey = [
      String(adjustment?.employeeId || '').trim(),
      String(adjustment?.date || '').trim(),
      String(adjustment?.penaltyType || '').trim(),
    ].join('|');
    if (!adjustmentsByPenaltyKey.has(penaltyKey)) {
      adjustmentsByPenaltyKey.set(penaltyKey, []);
    }
    adjustmentsByPenaltyKey.get(penaltyKey).push(adjustment);
  });
  const penaltyRows = complianceRows
    .flatMap((row) =>
      (Array.isArray(row?.penalties) ? row.penalties : []).map((penalty) => {
        const penaltyKey = `${String(row.employeeId || '').trim()}|${String(row.date || '').trim()}|${String(penalty?.type || '').trim()}`;
        const penaltyAdjustments = [...(adjustmentsByPenaltyKey.get(penaltyKey) || [])].sort((left, right) =>
          String(right?.actedOn || right?.updatedAt || '').localeCompare(String(left?.actedOn || left?.updatedAt || ''))
        );
        const clearedAmount = penaltyAdjustments.reduce(
          (total, adjustment) => total + Math.max(0, toNumberValue(adjustment?.clearedAmount)),
          0
        );
        const outstandingAmount = Math.max(0, Math.max(0, toNumberValue(penalty?.amount)) - clearedAmount);
        return {
          key: penaltyKey,
          employeeId: row.employeeId,
          employee: row.employee,
          department: row.department,
          date: row.date,
          penaltyType: String(penalty?.type || '').trim(),
          penaltyLabel: String(penalty?.label || '').trim(),
          baseAmount: Math.max(0, toNumberValue(penalty?.amount)),
          clearedAmount,
          outstandingAmount,
          status: outstandingAmount > 0 ? 'Outstanding' : 'Cleared',
          adjustments: penaltyAdjustments,
        };
      })
    )
    .filter((row) => {
      const matchesStatus =
        statusFilter === 'All' ||
        (statusFilter === 'Outstanding' && row.outstandingAmount > 0) ||
        (statusFilter === 'Cleared' && row.outstandingAmount <= 0);
      const matchesSearch =
        !searchText ||
        String(row?.employee || '').toLowerCase().includes(searchText) ||
        String(row?.employeeId || '').toLowerCase().includes(searchText) ||
        String(row?.department || '').toLowerCase().includes(searchText) ||
        String(row?.penaltyLabel || '').toLowerCase().includes(searchText);
      return matchesStatus && matchesSearch;
    })
    .sort((left, right) => {
      const leftValue =
        sortKey === 'status'
          ? left.status
          : sortKey === 'outstandingAmount'
            ? left.outstandingAmount
            : left?.[sortKey];
      const rightValue =
        sortKey === 'status'
          ? right.status
          : sortKey === 'outstandingAmount'
            ? right.outstandingAmount
            : right?.[sortKey];
      const primaryCompare = compareAttendanceSortValues(leftValue, rightValue, sortDirection);
      if (primaryCompare !== 0) {
        return primaryCompare;
      }
      return String(left?.employee || '').localeCompare(String(right?.employee || ''));
    });

  const summary = penaltyRows.reduce(
    (accumulator, row) => {
      accumulator.totalRows += 1;
      accumulator.totalOutstandingAmount += Math.max(0, row.outstandingAmount);
      accumulator.totalClearedAmount += Math.max(0, row.clearedAmount);
      accumulator.outstandingCount += row.outstandingAmount > 0 ? 1 : 0;
      return accumulator;
    },
    {
      totalRows: 0,
      totalOutstandingAmount: 0,
      totalClearedAmount: 0,
      outstandingCount: 0,
    }
  );
  summary.clearedCount = Math.max(0, summary.totalRows - summary.outstandingCount);
  const totalPages = Math.max(1, Math.ceil(summary.totalRows / pageSize));
  const safePage = Math.min(totalPages, page);
  const start = (safePage - 1) * pageSize;
  return {
    records: penaltyRows.slice(start, start + pageSize),
    meta: {
      ...summary,
      page: safePage,
      pageSize,
      totalPages,
      sortKey,
      sortDirection,
      statusFilter,
    },
  };
}

function summarizeAttendanceByEmployee(records = []) {
  const summaryByEmployee = new Map();
  records.forEach((record) => {
    const employeeKey = String(record?.employeeId || record?.employee || '').trim();
    if (!employeeKey) {
      return;
    }
    const current = summaryByEmployee.get(employeeKey) || {
      employeeId: String(record?.employeeId || '').trim(),
      employee: String(record?.employee || '').trim(),
      lateMinutes: 0,
      deductionAmount: 0,
      hasClockIn: false,
      isLate: false,
    };
    current.lateMinutes = Math.max(current.lateMinutes, Math.max(0, toNumberValue(record?.lateMinutes)));
    current.deductionAmount += Math.max(0, toNumberValue(record?.deductionAmount));
    current.hasClockIn = current.hasClockIn || hasAttendanceClockIn(record);
    current.isLate =
      current.isLate ||
      String(record?.status || '').trim().toLowerCase() === 'late' ||
      Math.max(0, toNumberValue(record?.lateMinutes)) > 0;
    summaryByEmployee.set(employeeKey, current);
  });
  return Array.from(summaryByEmployee.values());
}

function sanitizePathSegment(value, fallback = 'file') {
  const normalized = String(value || '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function sanitizeFileName(value, fallback = 'file') {
  const baseName = String(value || fallback).split(/[\\/]/).pop() || fallback;
  return sanitizePathSegment(baseName, fallback);
}

function isDataUrl(value) {
  return /^data:[^;]+;base64,/i.test(String(value || '').trim());
}

function isTransientBrowserFileUrl(value) {
  return /^blob:/i.test(String(value || '').trim());
}

function isPortableMediaUrl(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue || isTransientBrowserFileUrl(rawValue)) {
    return false;
  }
  if (isDataUrl(rawValue) || extractStorageObjectPath(rawValue)) {
    return true;
  }
  return /^https?:\/\//i.test(rawValue);
}

function decodeDataUrl(value) {
  const rawValue = String(value || '').trim();
  const match = rawValue.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    mimeType: String(match[1] || 'application/octet-stream').toLowerCase(),
    buffer: Buffer.from(match[2], 'base64'),
  };
}

function extensionFromMimeType(mimeType) {
  const normalized = String(mimeType || '').trim().toLowerCase();
  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'application/pdf': 'pdf',
  };
  if (mimeMap[normalized]) {
    return mimeMap[normalized];
  }
  const generic = normalized.split('/')[1] || '';
  return generic.replace(/[^a-z0-9.+-]/g, '') || 'bin';
}

function ensureFileNameExtension(fileName, mimeType) {
  const normalized = sanitizeFileName(fileName, 'file');
  if (/\.[a-z0-9]{2,8}$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}.${extensionFromMimeType(mimeType)}`;
}

function buildStorageObjectPath(segments, fileName) {
  return [...(Array.isArray(segments) ? segments : []).map((segment) => sanitizePathSegment(segment)).filter(Boolean), sanitizeFileName(fileName, 'file')]
    .join('/');
}

function buildPublicStorageUrl(bucketName, objectPath) {
  const encodedPath = String(objectPath || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://storage.googleapis.com/${encodeURIComponent(bucketName)}/${encodedPath}`;
}

function extractStorageObjectPath(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }
  const gsMatch = rawValue.match(/^gs:\/\/([^/]+)\/(.+)$/i);
  if (gsMatch) {
    return gsMatch[1] === GCS_BUCKET_NAME ? gsMatch[2] : '';
  }
  try {
    const parsed = new URL(rawValue);
    if (parsed.hostname === 'storage.googleapis.com') {
      const trimmedPath = parsed.pathname.replace(/^\/+/, '');
      const [bucketName, ...rest] = trimmedPath.split('/');
      return bucketName === GCS_BUCKET_NAME ? rest.join('/') : '';
    }
  } catch (error) {
  }
  return '';
}

function getStorageBucket() {
  if (!GCS_BUCKET_NAME || !GCS_PROJECT_ID || !GCS_CLIENT_EMAIL || !GCS_PRIVATE_KEY) {
    return null;
  }
  if (gcsBucket) {
    return gcsBucket;
  }
  const storage = new Storage({
    projectId: GCS_PROJECT_ID,
    credentials: {
      project_id: GCS_PROJECT_ID,
      private_key_id: GCS_PRIVATE_KEY_ID || undefined,
      private_key: GCS_PRIVATE_KEY,
      client_email: GCS_CLIENT_EMAIL,
    },
  });
  gcsBucket = storage.bucket(GCS_BUCKET_NAME);
  return gcsBucket;
}

async function uploadBufferToStorage({ buffer, mimeType, objectPath, metadata }) {
  const bucket = getStorageBucket();
  if (!bucket || !buffer || !objectPath) {
    return '';
  }
  const file = bucket.file(String(objectPath));
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType || 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
      metadata: metadata || {},
    },
  });
  return buildPublicStorageUrl(GCS_BUCKET_NAME, objectPath);
}

async function createSignedStorageUrl(value) {
  const objectPath = extractStorageObjectPath(value);
  const bucket = getStorageBucket();
  if (!bucket || !objectPath) {
    return String(value || '').trim();
  }
  try {
    const [signedUrl] = await bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
    });
    return String(signedUrl || '').trim() || String(value || '').trim();
  } catch (error) {
    return String(value || '').trim();
  }
}

async function uploadDataUrlToStorage(value, options = {}) {
  const decoded = decodeDataUrl(value);
  if (!decoded) {
    return String(value || '').trim();
  }
  const fileName = ensureFileNameExtension(options.fileName || `upload-${Date.now()}`, decoded.mimeType);
  const objectPath = buildStorageObjectPath(options.pathSegments || [], fileName);
  try {
    const uploadedUrl = await uploadBufferToStorage({
      buffer: decoded.buffer,
      mimeType: decoded.mimeType,
      objectPath,
      metadata: options.metadata,
    });
    return uploadedUrl || String(value || '').trim();
  } catch (error) {
    return String(value || '').trim();
  }
}

async function normalizeEmployeeStoredFileItem(fileItem, context = {}) {
  const source = fileItem || {};
  const rawUrl = String(source.url || '').trim();
  if (isTransientBrowserFileUrl(rawUrl)) {
    return {
      ...source,
      name: ensureFileNameExtension(
        String(source.name || `${context.baseKey || 'file'}-${Number(context.index || 0) + 1}`),
        source.isImage ? 'image/jpeg' : 'application/octet-stream'
      ),
      url: '',
      isImage: Boolean(source.isImage),
      unavailable: true,
    };
  }
  const decoded = decodeDataUrl(rawUrl);
  const mimeType = decoded?.mimeType || (source.isImage ? 'image/jpeg' : 'application/octet-stream');
  const normalizedName = ensureFileNameExtension(
    String(source.name || `${context.baseKey || 'file'}-${Number(context.index || 0) + 1}`),
    mimeType
  );
  if (!decoded) {
    return {
      ...source,
      name: normalizedName,
      url: rawUrl,
      isImage: String(mimeType).startsWith('image/') || Boolean(source.isImage),
    };
  }
  const uploadedUrl = await uploadDataUrlToStorage(rawUrl, {
    fileName: `${Date.now()}-${Number(context.index || 0) + 1}-${normalizedName}`,
    pathSegments: [
      'tenants',
      context.tenantId || 'master',
      'employees',
      context.employeeId || 'unassigned',
      context.baseKey || 'files',
    ],
    metadata: {
      tenantId: context.tenantId || 'master',
      employeeId: context.employeeId || '',
      field: context.baseKey || 'files',
    },
  });
  return {
    ...source,
    name: normalizedName,
    url: uploadedUrl,
    isImage: String(mimeType).startsWith('image/') || Boolean(source.isImage),
  };
}

async function normalizePreviewValueForStorage(value, context = {}) {
  if (isTransientBrowserFileUrl(value)) {
    return '';
  }
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item, index) =>
        uploadDataUrlToStorage(item, {
          fileName: `${Date.now()}-${index + 1}-${context.baseKey || 'preview'}.jpg`,
          pathSegments: [
            'tenants',
            context.tenantId || 'master',
            'employees',
            context.employeeId || 'unassigned',
            context.baseKey || 'preview',
            'preview',
          ],
          metadata: {
            tenantId: context.tenantId || 'master',
            employeeId: context.employeeId || '',
            field: context.baseKey || 'preview',
          },
        })
      )
    );
  }
  return uploadDataUrlToStorage(value, {
    fileName: `${Date.now()}-${context.baseKey || 'preview'}.jpg`,
    pathSegments: [
      'tenants',
      context.tenantId || 'master',
      'employees',
      context.employeeId || 'unassigned',
      context.baseKey || 'preview',
    ],
    metadata: {
      tenantId: context.tenantId || 'master',
      employeeId: context.employeeId || '',
      field: context.baseKey || 'preview',
    },
  });
}

async function normalizeEmployeeStorageFields(record, context = {}) {
  const source = record || {};
  const next = { ...source };
  const processedPreviewKeys = new Set();
  const fileKeys = Object.keys(source).filter((key) => key.endsWith('Files') && Array.isArray(source[key]));

  for (const fileKey of fileKeys) {
    const baseKey = fileKey.slice(0, -5);
    const files = Array.isArray(source[fileKey]) ? source[fileKey] : [];
    const uploadedFiles = await Promise.all(
      files.map((fileItem, index) =>
        normalizeEmployeeStoredFileItem(fileItem, {
          ...context,
          baseKey,
          index,
        })
      )
    );
    next[fileKey] = uploadedFiles;
    const previewKey = `${baseKey}Preview`;
    processedPreviewKeys.add(previewKey);
    const imageFiles = uploadedFiles.filter((file) => file?.isImage && String(file?.url || '').trim());
    if (imageFiles.length > 0) {
      next[previewKey] = fileKey === 'otherDocumentsFiles' ? imageFiles.map((file) => file.url) : imageFiles[0].url;
    } else if (previewKey in source) {
      next[previewKey] = await normalizePreviewValueForStorage(source[previewKey], { ...context, baseKey });
    }
  }

  const previewKeys = Object.keys(source).filter((key) => key.endsWith('Preview') && !processedPreviewKeys.has(key));
  for (const previewKey of previewKeys) {
    const baseKey = previewKey.slice(0, -7);
    next[previewKey] = await normalizePreviewValueForStorage(source[previewKey], {
      ...context,
      baseKey,
    });
  }

  return next;
}

async function signEmployeeStorageFields(record) {
  const source = record || {};
  const next = { ...source };
  const mediaBaseKeys = new Set();
  const fileKeys = Object.keys(source).filter((key) => key.endsWith('Files') && Array.isArray(source[key]));
  for (const fileKey of fileKeys) {
    const baseKey = fileKey.slice(0, -5);
    mediaBaseKeys.add(baseKey);
    next[fileKey] = await Promise.all(
      (source[fileKey] || []).map(async (fileItem) => {
        const rawUrl = String(fileItem?.url || '').trim();
        if (!rawUrl || isTransientBrowserFileUrl(rawUrl)) {
          return {
            ...(fileItem || {}),
            url: '',
            unavailable: true,
          };
        }
        return {
          ...(fileItem || {}),
          url: await createSignedStorageUrl(rawUrl),
        };
      })
    );
    if (next[fileKey].some((fileItem) => fileItem?.unavailable)) {
      next[`${baseKey}MediaUnavailable`] = true;
    }
  }
  const previewKeys = Object.keys(source).filter((key) => key.endsWith('Preview'));
  for (const previewKey of previewKeys) {
    const baseKey = previewKey.slice(0, -7);
    mediaBaseKeys.add(baseKey);
    if (Array.isArray(source[previewKey])) {
      next[previewKey] = await Promise.all(
        (source[previewKey] || []).map((value) => (isTransientBrowserFileUrl(value) ? '' : createSignedStorageUrl(value)))
      );
    } else {
      const rawValue = String(source[previewKey] || '').trim();
      next[previewKey] = rawValue && !isTransientBrowserFileUrl(rawValue) ? await createSignedStorageUrl(rawValue) : '';
      if (rawValue && isTransientBrowserFileUrl(rawValue)) {
        next[`${baseKey}MediaUnavailable`] = true;
      }
    }
  }
  for (const baseKey of mediaBaseKeys) {
    const previewKey = `${baseKey}Preview`;
    const fileKey = `${baseKey}Files`;
    const currentPreview = next[previewKey];
    const currentFiles = Array.isArray(next[fileKey]) ? next[fileKey] : [];
    if ((!currentPreview || (Array.isArray(currentPreview) && currentPreview.every((value) => !String(value || '').trim()))) && currentFiles.every((fileItem) => !String(fileItem?.url || '').trim())) {
      const directValue = String(source[baseKey] || '').trim();
      if (isPortableMediaUrl(directValue)) {
        next[previewKey] = await createSignedStorageUrl(directValue);
      }
    }
  }
  return next;
}

async function signAttendanceRecordMedia(record) {
  const source = record || {};
  const next = { ...source };
  if (source.firstCheckInPhoto) {
    next.firstCheckInPhoto = await createSignedStorageUrl(source.firstCheckInPhoto);
  }
  if (source.lastCheckOutPhoto) {
    next.lastCheckOutPhoto = await createSignedStorageUrl(source.lastCheckOutPhoto);
  }
  if (Array.isArray(source.clockings)) {
    next.clockings = await Promise.all(
      source.clockings.map(async (clocking) => ({
        ...(clocking || {}),
        photoDataUrl: await createSignedStorageUrl(clocking?.photoDataUrl),
      }))
    );
  }
  return next;
}

async function hydrateModuleRecordMedia(moduleId, record) {
  if (!record) {
    return record;
  }
  if (moduleId === 'employee-management') {
    return signEmployeeStorageFields(record);
  }
  if (moduleId === 'attendance-time') {
    return signAttendanceRecordMedia(record);
  }
  return record;
}

function mergeEmployeeAuthAccess(record, user, tenant, tenantId) {
  if (!record) {
    return record;
  }
  if (!user) {
    return {
      ...record,
      role: normalizeUserRole(record.role, 'employee'),
      allowedModules: normalizeModuleIds(record.allowedModules),
    };
  }
  return {
    ...record,
    role: normalizeUserRole(user.role, record.role || 'employee'),
    allowedModules: resolveUserAllowedModulesForTenant({ user, tenant, tenantId, defaultEmployeeModules }),
    accountIsActive: user.isActive !== false,
  };
}

function normalizeHexColor(value, fallback = '#0a73d9') {
  const hex = String(value || '').trim().toLowerCase();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(hex);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return hex;
  }
  return fallback;
}

function normalizeIdentifierPresets(presets) {
  const seenIds = new Set();
  const normalized = Array.isArray(presets)
    ? presets
        .map((preset, index) => {
          const baseId =
            String(preset?.id || '')
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9-]+/g, '-') ||
            `preset-${index + 1}`;
          if (seenIds.has(baseId)) {
            return null;
          }
          seenIds.add(baseId);
          const name = String(preset?.name || '').trim();
          const pensionLabel = String(preset?.pensionLabel || '').trim();
          const taxLabel = String(preset?.taxLabel || '').trim();
          if (!name || !pensionLabel || !taxLabel) {
            return null;
          }
          return {
            id: baseId,
            name,
            pensionLabel,
            taxLabel,
          };
        })
        .filter(Boolean)
    : [];
  return normalized.length > 0 ? normalized : defaultIdentifierPresets;
}

function normalizeDepartments(departments) {
  const seenNames = new Set();
  const seenCodes = new Set();
  const normalized = Array.isArray(departments)
    ? departments
        .map((department) => {
          const name = String(department?.name || '').trim();
          const code = String(department?.code || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z]/g, '')
            .slice(0, 2);
          if (!name || code.length < 2) {
            return null;
          }
          const nameKey = name.toLowerCase();
          if (seenNames.has(nameKey) || seenCodes.has(code)) {
            return null;
          }
          seenNames.add(nameKey);
          seenCodes.add(code);
          return { name, code };
        })
        .filter(Boolean)
    : [];
  return normalized.length > 0 ? normalized : defaultGeneralSettings.departments;
}

function normalizeGeneralSettings(payload) {
  const source = payload || {};
  const currencies = Array.isArray(source.currencies)
    ? Array.from(
        new Set(
          source.currencies
            .map((currency) => String(currency || '').trim().toUpperCase())
            .filter(Boolean)
        )
      )
    : [];
  const normalizedCurrencies = currencies.length > 0 ? currencies : defaultGeneralSettings.currencies;
  const identifierPresets = normalizeIdentifierPresets(source.identifierPresets);
  const selectedPreset =
    identifierPresets.find((preset) => preset.id === String(source.identifierCountry || '').trim().toLowerCase()) ||
    identifierPresets[0];
  const employmentStages = Array.isArray(source.employmentStages)
    ? Array.from(
        new Set(
          source.employmentStages
            .map((stage) => String(stage || '').trim())
            .filter(Boolean)
        )
      )
    : [];

  return {
    appName: String(source.appName || defaultGeneralSettings.appName).trim() || defaultGeneralSettings.appName,
    sidebarColor: normalizeHexColor(source.sidebarColor, defaultGeneralSettings.sidebarColor),
    defaultCurrency: normalizedCurrencies.includes(String(source.defaultCurrency || '').trim().toUpperCase())
      ? String(source.defaultCurrency || '').trim().toUpperCase()
      : normalizedCurrencies[0],
    penaltyActorUsername:
      String(source.penaltyActorUsername || defaultGeneralSettings.penaltyActorUsername).trim() ||
      defaultGeneralSettings.penaltyActorUsername,
    currencies: normalizedCurrencies,
    identifierPresets,
    identifierCountry: selectedPreset.id,
    pensionFieldLabel:
      String(source.pensionFieldLabel || selectedPreset.pensionLabel).trim() || selectedPreset.pensionLabel,
    taxFieldLabel: String(source.taxFieldLabel || selectedPreset.taxLabel).trim() || selectedPreset.taxLabel,
    employmentStages: employmentStages.length > 0 ? employmentStages : defaultGeneralSettings.employmentStages,
    statutoryRules: {
      napsaMode: ['percent-basic', 'percent-gross', 'fixed'].includes(String(source?.statutoryRules?.napsaMode || ''))
        ? String(source.statutoryRules.napsaMode)
        : defaultGeneralSettings.statutoryRules.napsaMode,
      napsaValue: Math.max(0, Number(source?.statutoryRules?.napsaValue) || defaultGeneralSettings.statutoryRules.napsaValue),
      nhimaMode: ['percent-basic', 'percent-gross', 'fixed'].includes(String(source?.statutoryRules?.nhimaMode || ''))
        ? String(source.statutoryRules.nhimaMode)
        : defaultGeneralSettings.statutoryRules.nhimaMode,
      nhimaValue: Math.max(0, Number(source?.statutoryRules?.nhimaValue) || defaultGeneralSettings.statutoryRules.nhimaValue),
      taxMode: ['percent-basic', 'percent-gross', 'fixed'].includes(String(source?.statutoryRules?.taxMode || ''))
        ? String(source.statutoryRules.taxMode)
        : defaultGeneralSettings.statutoryRules.taxMode,
      taxValue: Math.max(0, Number(source?.statutoryRules?.taxValue) || defaultGeneralSettings.statutoryRules.taxValue),
      taxMinAmount: Math.max(
        0,
        Number(source?.statutoryRules?.taxMinAmount) || defaultGeneralSettings.statutoryRules.taxMinAmount
      ),
    },
    loanRules: {
      minTakeHomePercent: Math.max(
        1,
        Math.min(100, Number(source?.loanRules?.minTakeHomePercent) || defaultGeneralSettings.loanRules.minTakeHomePercent)
      ),
      maxLoanDeductionPercentOfGross: Math.max(
        0,
        Math.min(
          100,
          Number(source?.loanRules?.maxLoanDeductionPercentOfGross) ||
            defaultGeneralSettings.loanRules.maxLoanDeductionPercentOfGross
        )
      ),
      defaultInterestPercentPerMonth: Math.max(
        0,
        Number(source?.loanRules?.defaultInterestPercentPerMonth) ||
          defaultGeneralSettings.loanRules.defaultInterestPercentPerMonth
      ),
      overduePenaltyPercentPerDay: Math.max(
        0,
        Number(source?.loanRules?.overduePenaltyPercentPerDay) ||
          defaultGeneralSettings.loanRules.overduePenaltyPercentPerDay
      ),
    },
    idCardDesign: {
      companyName:
        String(source?.idCardDesign?.companyName || source.appName || defaultGeneralSettings.idCardDesign.companyName).trim() ||
        defaultGeneralSettings.idCardDesign.companyName,
      orientation: String(source?.idCardDesign?.orientation || '') === 'portrait' ? 'portrait' : 'landscape',
      borderRadius: Math.max(
        0,
        Math.min(40, Number(source?.idCardDesign?.borderRadius) || defaultGeneralSettings.idCardDesign.borderRadius)
      ),
      logoUrl: String(source?.idCardDesign?.logoUrl || '').trim(),
      primaryColor: normalizeHexColor(source?.idCardDesign?.primaryColor, defaultGeneralSettings.idCardDesign.primaryColor),
      secondaryColor: normalizeHexColor(
        source?.idCardDesign?.secondaryColor,
        defaultGeneralSettings.idCardDesign.secondaryColor
      ),
    },
    fingerprintIntegration: {
      mode: String(source?.fingerprintIntegration?.mode || '') === 'live' ? 'live' : 'simulation',
      gatewayUrl: String(source?.fingerprintIntegration?.gatewayUrl || '').trim(),
      apiVersion: String(source?.fingerprintIntegration?.apiVersion || '') === 'v2' ? 'v2' : 'v1',
      heartbeatSeconds: Math.max(
        5,
        Math.min(
          600,
          Number(source?.fingerprintIntegration?.heartbeatSeconds) ||
            defaultGeneralSettings.fingerprintIntegration.heartbeatSeconds
        )
      ),
    },
    departments: normalizeDepartments(source.departments),
  };
}

function normalizeAttendanceSettings(payload) {
  const source = payload || {};
  const holidayDates = parseHolidayDateList(source.attendanceHolidayDates);
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
          dayRules: normalizeShiftDayRules(shift?.dayRules, {
            reportTime: String(shift?.reportTime || '').trim(),
            shiftEnd: String(shift?.shiftEnd || '').trim(),
            graceInMinutes: Math.max(0, Number(shift?.graceInMinutes) || 0),
            graceOutMinutes: Math.max(0, Number(shift?.graceOutMinutes) || 0),
            overtimeEnabled: Boolean(shift?.overtimeEnabled),
            overtimeStartAfterMinutes: Math.max(0, Number(shift?.overtimeStartAfterMinutes) || 0),
            overtimePayPerMinute: Math.max(0, Number(shift?.overtimePayPerMinute) || 0),
          }),
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
    requireWebClockInPhoto:
      source.requireWebClockInPhoto === undefined
        ? defaultAttendanceSettings.requireWebClockInPhoto
        : Boolean(source.requireWebClockInPhoto),
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
    attendanceNoClockInPenaltyPercent: Math.max(
      0,
      Number(source.attendanceNoClockInPenaltyPercent) || defaultAttendanceSettings.attendanceNoClockInPenaltyPercent
    ),
    attendanceNoClockOutPenaltyPercent: Math.max(
      0,
      Number(source.attendanceNoClockOutPenaltyPercent) || defaultAttendanceSettings.attendanceNoClockOutPenaltyPercent
    ),
    attendanceAbsentPenaltyPercent: Math.max(
      0,
      Number(source.attendanceAbsentPenaltyPercent) || defaultAttendanceSettings.attendanceAbsentPenaltyPercent
    ),
    attendanceHolidayDates: holidayDates,
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

function getShiftScheduleForAttendanceRecord(source, employee, settings) {
  const shiftName = String(source?.shift || employee?.assignedShift || settings?.shifts?.[0]?.name || 'Default').trim();
  const shiftConfig =
    settings?.shifts?.find(
      (shift) => String(shift?.name || '').trim().toLowerCase() === shiftName.toLowerCase()
    ) || settings?.shifts?.[0];
  const scheduleDate = String(source?.date || '').trim();
  const holidayDates = Array.isArray(settings?.attendanceHolidayDates) ? settings.attendanceHolidayDates : [];
  const ruleKey = getAttendanceDayRuleKey(scheduleDate, holidayDates);
  const fallbackRules = buildDefaultShiftDayRules({
    reportTime: shiftConfig?.reportTime || settings?.attendanceReportTime,
    shiftEnd: shiftConfig?.shiftEnd || settings?.attendanceShiftEnd,
    graceInMinutes: Math.max(0, Number(shiftConfig?.graceInMinutes) || 0),
    graceOutMinutes: Math.max(0, Number(shiftConfig?.graceOutMinutes) || 0),
    overtimeEnabled: Boolean(shiftConfig?.overtimeEnabled),
    overtimeStartAfterMinutes: Math.max(0, Number(shiftConfig?.overtimeStartAfterMinutes) || 0),
    overtimePayPerMinute: Math.max(0, Number(shiftConfig?.overtimePayPerMinute) || 0),
  });
  const ruleSource = shiftConfig?.dayRules?.[ruleKey] || fallbackRules[ruleKey];
  const reportTime = String(ruleSource?.reportTime || shiftConfig?.reportTime || settings?.attendanceReportTime || '').trim();
  const shiftEnd = String(ruleSource?.shiftEnd || shiftConfig?.shiftEnd || settings?.attendanceShiftEnd || '').trim();
  const reportMinutes = toMinutesFromClock(reportTime);
  const graceInMinutes = Math.max(0, Number(ruleSource?.graceInMinutes) || 0);
  const shiftEndMinutes = toMinutesFromClock(shiftEnd);
  const graceOutMinutes = Math.max(0, Number(ruleSource?.graceOutMinutes) || 0);
  const overtimeStartAfterMinutes = Math.max(0, Number(ruleSource?.overtimeStartAfterMinutes) || 0);
  return {
    shiftName: shiftConfig?.name || shiftName,
    ruleKey,
    isHoliday: ruleKey === 'holiday',
    isWorkingDay: Boolean(ruleSource?.enabled),
    reportTime,
    shiftEnd,
    reportMinutes,
    graceInMinutes,
    lateAfterMinutes: reportMinutes === null ? null : reportMinutes + graceInMinutes,
    shiftEndMinutes,
    graceOutMinutes,
    shiftEndWithGraceMinutes: (shiftEndMinutes ?? 0) + graceOutMinutes,
    overtimeEnabled: Boolean(ruleSource?.overtimeEnabled),
    overtimeStartAfterMinutes,
    overtimeStartMinutes: (shiftEndMinutes ?? 0) + overtimeStartAfterMinutes,
    overtimePayPerMinute: Math.max(0, Number(ruleSource?.overtimePayPerMinute) || 0),
  };
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

function escapeSvgAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitStampLines(value, maxLineLength = 34) {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, 3);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function firstNonEmpty(values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function compactUnique(values) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function normalizeCountryCode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return normalized.length === 2 ? normalized : '';
}

function toFlagEmoji(countryCode) {
  const normalizedCode = normalizeCountryCode(countryCode).toUpperCase();
  if (!normalizedCode) {
    return '';
  }
  return normalizedCode
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function fetchJsonWithRelaxedTls(url, headers) {
  return new Promise((resolve) => {
    const request = https.get(
      url,
      {
        headers,
        rejectUnauthorized: false,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            resolve(null);
          }
        });
      }
    );
    request.setTimeout(12000, () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

function formatPhotoStampTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

const PHOTO_STAMP_VERSION = 1;
const reverseGeocodeCache = new Map();

function formatCoordinateLabel(lat, lng) {
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
    return `Lat ${lat.toFixed(6)}  Long ${lng.toFixed(6)}`;
  }
  return 'Coordinates unavailable';
}

function buildCoordinateFallbackLabel(lat, lng) {
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
  return 'Location unavailable';
}

function buildLocationStampParts(locationDetails, lat, lng) {
  const details = locationDetails || {};
  const address = details.address || {};
  const country = firstNonEmpty([address.country]);
  const region = firstNonEmpty([address.state, address.region, address.province]);
  const countryCode = normalizeCountryCode(address.country_code);
  const city = firstNonEmpty([address.city, address.town, address.village, address.municipality, address.county]);
  const suburb = firstNonEmpty([
    address.suburb,
    address.neighbourhood,
    address.city_district,
    address.quarter,
    address.residential,
    address.hamlet,
  ]);
  const district = firstNonEmpty([address.city_district, address.state_district, address.county]);
  const street = firstNonEmpty([address.road, address.street, address.pedestrian, address.footway, address.path]);
  const block = firstNonEmpty([address.house_number, address.block, address.building, address.house_name, address.amenity]);
  const locality = firstNonEmpty([suburb, city]);
  const preferredTitle = compactUnique([locality, locality === city ? '' : city, region]).join(', ');
  const fallbackDisplay = String(details.displayName || '').trim();
  const detailPrimary = compactUnique([street, block]).join(', ');
  const detailSecondary = compactUnique([district, country]).join(', ');
  const title = preferredTitle || fallbackDisplay || buildCoordinateFallbackLabel(lat, lng);
  const detailLines = compactUnique([detailPrimary, detailSecondary]).filter((line) => line && line !== title);
  return {
    title,
    detailLines,
    displayLabel: compactUnique([title, ...detailLines]).join(' • ') || buildCoordinateFallbackLabel(lat, lng),
    country,
    countryCode,
  };
}

async function fetchReverseGeocodeDetails(lat, lng) {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return { displayName: '', address: {} };
  }
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (reverseGeocodeCache.has(cacheKey)) {
    return reverseGeocodeCache.get(cacheKey);
  }
  const requestUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${encodeURIComponent(
    lat
  )}&lon=${encodeURIComponent(lng)}`;
  const requestHeaders = {
    'User-Agent': 'PTHR/1.0 support@pthr.app',
    Accept: 'application/json',
    'Accept-Language': 'en',
  };
  try {
    const response = await fetch(requestUrl, { headers: requestHeaders });
    if (!response.ok) {
      const relaxedData = await fetchJsonWithRelaxedTls(requestUrl, requestHeaders);
      const fallbackResult = {
        displayName: String(relaxedData?.display_name || '').trim(),
        address: relaxedData?.address || {},
      };
      reverseGeocodeCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }
    const data = await response.json();
    const result = {
      displayName: String(data?.display_name || '').trim(),
      address: data?.address || {},
    };
    reverseGeocodeCache.set(cacheKey, result);
    return result;
  } catch (error) {
    const relaxedData = await fetchJsonWithRelaxedTls(requestUrl, requestHeaders);
    const fallbackResult = {
      displayName: String(relaxedData?.display_name || '').trim(),
      address: relaxedData?.address || {},
    };
    reverseGeocodeCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }
}

async function buildStampedPhotoDataUrl({ photoDataUrl, locationAddress, locationDetails, lat, lng, capturedAt }) {
  const rawValue = String(photoDataUrl || '').trim();
  const match = rawValue.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return rawValue;
  }
  try {
    const inputBuffer = Buffer.from(match[2], 'base64');
    const sourceImage = sharp(inputBuffer, { failOnError: false }).rotate();
    const metadata = await sourceImage.metadata();
    const targetWidth =
      typeof metadata.width === 'number' && metadata.width > 0 ? Math.min(metadata.width, 1080) : 720;
    const targetHeight =
      typeof metadata.width === 'number' &&
      metadata.width > 0 &&
      typeof metadata.height === 'number' &&
      metadata.height > 0
        ? Math.max(480, Math.round((metadata.height / metadata.width) * targetWidth))
        : 960;
    const isLandscape = targetWidth >= targetHeight;
    const shortestEdge = Math.min(targetWidth, targetHeight);
    const resolvedLocationDetails =
      locationDetails ||
      (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)
        ? await fetchReverseGeocodeDetails(lat, lng)
        : String(locationAddress || '').trim()
          ? { displayName: String(locationAddress || '').trim(), address: {} }
          : { displayName: '', address: {} });
    const stampParts = buildLocationStampParts(resolvedLocationDetails, lat, lng);
    const flagEmoji = toFlagEmoji(stampParts.countryCode);
    const titleLines = splitStampLines(stampParts.title, isLandscape ? 30 : 22).slice(0, 2);
    const detailLines = stampParts.detailLines
      .flatMap((line) => splitStampLines(line, isLandscape ? 40 : 28))
      .slice(0, isLandscape ? 2 : 3);
    const margin = Math.round(shortestEdge * 0.04);
    const panelWidth = Math.round(targetWidth * (isLandscape ? 0.56 : 0.86));
    const padX = Math.round(shortestEdge * (isLandscape ? 0.035 : 0.045));
    const padY = Math.round(shortestEdge * (isLandscape ? 0.03 : 0.038));
    const headerFont = clamp(Math.round(shortestEdge * 0.026), 14, 24);
    const titleFont = clamp(Math.round(shortestEdge * (isLandscape ? 0.042 : 0.05)), 22, 40);
    const detailFont = clamp(Math.round(shortestEdge * 0.027), 15, 23);
    const metaFont = clamp(Math.round(shortestEdge * 0.024), 13, 20);
    const iconRadius = clamp(Math.round(shortestEdge * 0.017), 12, 20);
    const flagFont = clamp(Math.round(shortestEdge * 0.045), 20, 30);
    const flagWidth = flagEmoji ? Math.round(flagFont * 1.7) : 0;
    const headerLineHeight = Math.round(headerFont * 1.25);
    const titleLineHeight = Math.round(titleFont * 1.08);
    const detailLineHeight = Math.round(detailFont * 1.18);
    const metaLineHeight = Math.round(metaFont * 1.2);
    const lineGap = clamp(Math.round(shortestEdge * 0.008), 4, 10);
    const sectionGap = clamp(Math.round(shortestEdge * 0.014), 8, 16);
    const panelHeight =
      padY * 2 +
      Math.max(iconRadius * 2, headerLineHeight) +
      sectionGap +
      titleLines.length * titleLineHeight +
      Math.max(0, titleLines.length - 1) * lineGap +
      (detailLines.length > 0 ? sectionGap + detailLines.length * detailLineHeight + Math.max(0, detailLines.length - 1) * lineGap : 0) +
      sectionGap +
      metaLineHeight * 2 +
      lineGap;
    const panelX = Math.max(margin, targetWidth - panelWidth - margin);
    const panelY = Math.max(margin, targetHeight - panelHeight - margin);
    const headerTextX = panelX + padX + iconRadius * 2 + 16;
    const coordinateText = formatCoordinateLabel(lat, lng);
    const timeText = formatPhotoStampTime(capturedAt) || 'Time unavailable';
    const flagX = panelX + panelWidth - padX - flagWidth;
    const flagY = panelY + padY + Math.max(iconRadius * 2, headerLineHeight) * 0.78;
    let textCursorY = panelY + padY;
    const headerBaselineY = textCursorY + Math.max(iconRadius * 2, headerLineHeight) * 0.72;
    textCursorY += Math.max(iconRadius * 2, headerLineHeight) + sectionGap;
    const titleSvg = titleLines
      .map((line) => {
        const y = textCursorY + titleLineHeight * 0.84;
        textCursorY += titleLineHeight + lineGap;
        return `<text x="${panelX + padX}" y="${Math.round(y)}" fill="#ffffff" font-size="${titleFont}" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(
          line
        )}</text>`;
      })
      .join('');
    if (titleLines.length > 0) {
      textCursorY += sectionGap - lineGap;
    }
    const detailSvg = detailLines
      .map((line) => {
        const y = textCursorY + detailLineHeight * 0.82;
        textCursorY += detailLineHeight + lineGap;
        return `<text x="${panelX + padX}" y="${Math.round(y)}" fill="#d7e3ff" font-size="${detailFont}" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(
          line
        )}</text>`;
      })
      .join('');
    if (detailLines.length > 0) {
      textCursorY += sectionGap - lineGap;
    }
    const overlaySvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}">
        <defs>
          <linearGradient id="stampGlow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="rgba(11,18,32,0.96)" />
            <stop offset="100%" stop-color="rgba(15,23,42,0.88)" />
          </linearGradient>
        </defs>
        <g>
          <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="${Math.round(
      shortestEdge * 0.03
    )}" fill="url(#stampGlow)" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
          <circle cx="${panelX + padX + iconRadius}" cy="${panelY + padY + iconRadius}" r="${iconRadius}" fill="#ef4444" />
          <path d="M${panelX + padX + iconRadius} ${panelY + padY + Math.round(iconRadius * 0.22)} C${panelX + padX + Math.round(
      iconRadius * 1.55
    )} ${panelY + padY + Math.round(iconRadius * 0.22)} ${panelX + padX + Math.round(iconRadius * 1.95)} ${
      panelY + padY + Math.round(iconRadius * 0.62)
    } ${panelX + padX + Math.round(iconRadius * 1.95)} ${panelY + padY + Math.round(iconRadius * 1.08)} C${
      panelX + padX + Math.round(iconRadius * 1.95)
    } ${panelY + padY + Math.round(iconRadius * 1.72)} ${panelX + padX + iconRadius} ${
      panelY + padY + Math.round(iconRadius * 2.45)
    } ${panelX + padX + iconRadius} ${panelY + padY + Math.round(iconRadius * 2.45)} C${panelX + padX + iconRadius} ${
      panelY + padY + Math.round(iconRadius * 2.45)
    } ${panelX + padX + Math.round(iconRadius * 0.05)} ${panelY + padY + Math.round(iconRadius * 1.72)} ${
      panelX + padX + Math.round(iconRadius * 0.05)
    } ${panelY + padY + Math.round(iconRadius * 1.08)} C${panelX + padX + Math.round(iconRadius * 0.05)} ${
      panelY + padY + Math.round(iconRadius * 0.62)
    } ${panelX + padX + Math.round(iconRadius * 0.45)} ${panelY + padY + Math.round(iconRadius * 0.22)} ${
      panelX + padX + iconRadius
    } ${panelY + padY + Math.round(iconRadius * 0.22)} Z" fill="#ef4444" />
          <circle cx="${panelX + padX + iconRadius}" cy="${panelY + padY + Math.round(iconRadius * 0.95)}" r="${Math.max(
      5,
      Math.round(iconRadius * 0.42)
    )}" fill="#ffffff" />
          ${
            flagEmoji
              ? `<text x="${flagX}" y="${Math.round(flagY)}" font-size="${flagFont}" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${escapeSvgAttribute(
                  flagEmoji
                )}</text>`
              : ''
          }
          <text x="${headerTextX}" y="${Math.round(
      headerBaselineY
    )}" fill="#ffffff" font-size="${headerFont}" font-weight="700" font-family="Segoe UI, Arial, sans-serif">GPS Verified Clocking</text>
          ${titleSvg}
          ${detailSvg}
          <text x="${panelX + padX}" y="${Math.round(
      textCursorY + metaLineHeight * 0.82
    )}" fill="#d7e3ff" font-size="${metaFont}" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(coordinateText)}</text>
          <text x="${panelX + padX}" y="${Math.round(
      textCursorY + metaLineHeight + lineGap + metaLineHeight * 0.82
    )}" fill="#d7e3ff" font-size="${metaFont}" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(timeText)}</text>
        </g>
      </svg>
    `;
    const stampedBuffer = await sourceImage
      .resize({ width: targetWidth, withoutEnlargement: true })
      .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${stampedBuffer.toString('base64')}`;
  } catch (error) {
    return rawValue;
  }
}

async function processAttendanceClockings(clockings, context = {}) {
  const normalizedClockings = Array.isArray(clockings) ? clockings : [];
  return Promise.all(
    normalizedClockings.map(async (clocking, index) => {
      const lat = typeof clocking?.photoLat === 'number' ? clocking.photoLat : clocking?.lat;
      const lng = typeof clocking?.photoLng === 'number' ? clocking.photoLng : clocking?.lng;
      const photoDataUrl = String(clocking?.photoDataUrl || '').trim();
      const photoCapturedAt = String(clocking?.photoCapturedAt || clocking?.createdAt || new Date().toISOString());
      const hasCoordinates = typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng);
      const hasPhoto = Boolean(photoDataUrl);
      const photoStoredAsDataUrl = isDataUrl(photoDataUrl);
      const existingLocationAddress = String(clocking?.photoLocationAddress || '').trim();
      const isAlreadyStamped =
        hasPhoto &&
        !photoStoredAsDataUrl &&
        Number(clocking?.photoStampVersion || 0) >= PHOTO_STAMP_VERSION &&
        !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(existingLocationAddress);

      if (isAlreadyStamped) {
        return {
          ...clocking,
          photoLat: hasCoordinates ? lat : undefined,
          photoLng: hasCoordinates ? lng : undefined,
          photoCapturedAt,
          photoStampVersion: PHOTO_STAMP_VERSION,
        };
      }

      const locationDetails =
        hasCoordinates
          ? await fetchReverseGeocodeDetails(lat, lng)
          : existingLocationAddress
            ? { displayName: existingLocationAddress, address: {} }
            : { displayName: '', address: {} };
      const stampParts = buildLocationStampParts(locationDetails, lat, lng);
      return {
        ...clocking,
        photoLocationAddress: stampParts.displayLabel || buildCoordinateFallbackLabel(lat, lng),
        photoLat: hasCoordinates ? lat : undefined,
        photoLng: hasCoordinates ? lng : undefined,
        photoCapturedAt,
        photoStampVersion: hasPhoto ? PHOTO_STAMP_VERSION : undefined,
        photoDataUrl: hasPhoto
          ? await uploadDataUrlToStorage(
              await buildStampedPhotoDataUrl({
                photoDataUrl,
                locationAddress: stampParts.displayLabel,
                locationDetails,
                lat,
                lng,
                capturedAt: photoCapturedAt,
              }),
              {
                fileName: `${String(clocking?.mode || 'clock')}-${String(clocking?.id || index + 1)}.jpg`,
                pathSegments: [
                  'tenants',
                  context.tenantId || 'master',
                  'attendance',
                  context.employeeId || 'unknown-employee',
                  context.date || 'unknown-date',
                ],
                metadata: {
                  tenantId: context.tenantId || 'master',
                  employeeId: context.employeeId || '',
                  date: context.date || '',
                  recordId: context.recordId || '',
                  clockingId: String(clocking?.id || ''),
                },
              }
            )
          : photoDataUrl,
      };
    })
  );
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
          photoDataUrl: String(clocking?.photoDataUrl || '').trim(),
          photoLocationAddress: String(clocking?.photoLocationAddress || '').trim(),
          photoLat: typeof clocking?.photoLat === 'number' ? clocking.photoLat : undefined,
          photoLng: typeof clocking?.photoLng === 'number' ? clocking.photoLng : undefined,
          photoCapturedAt: String(clocking?.photoCapturedAt || clocking?.createdAt || ''),
          photoStampVersion: Number(clocking?.photoStampVersion || 0) || undefined,
          source: String(clocking?.source || row?.source || 'System'),
          createdAt: String(clocking?.createdAt || ''),
        }))
        .filter((clocking) => /^\d{1,2}:\d{2}$/.test(clocking.time))
    : [];
  const dedupeClockings = (clockings) => {
    const seen = new Set();
    return clockings
      .sort((left, right) => {
        const byTime = String(left.time || '').localeCompare(String(right.time || ''));
        if (byTime !== 0) {
          return byTime;
        }
        return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
      })
      .filter((clocking) => {
        const key = `${clocking.mode}|${clocking.time}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  };
  if (fromClockings.length > 0) {
    return dedupeClockings(fromClockings);
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
  return dedupeClockings(fallback);
}

function getAttendanceClockingsToValidate(nextRecord, existingRecord = null) {
  const nextClockings = normalizeAttendanceClockings(nextRecord);
  if (!existingRecord) {
    return nextClockings;
  }
  const existingClockings = normalizeAttendanceClockings(existingRecord);
  const existingById = new Map(
    existingClockings
      .map((clocking) => [String(clocking?.id || '').trim(), clocking])
      .filter(([clockingId]) => Boolean(clockingId))
  );
  return nextClockings.filter((clocking) => {
    const clockingId = String(clocking?.id || '').trim();
    const previousClocking = clockingId ? existingById.get(clockingId) : null;
    if (!previousClocking) {
      return true;
    }
    return (
      String(clocking?.time || '').trim() !== String(previousClocking?.time || '').trim() ||
      String(clocking?.mode || '').trim() !== String(previousClocking?.mode || '').trim() ||
      String(clocking?.photoDataUrl || '').trim() !== String(previousClocking?.photoDataUrl || '').trim()
    );
  });
}

async function validateAttendancePhotoRequirement(db, nextRecord, existingRecord = null) {
  const [attendanceSettingsRecord, mobileSettingsRecord] = await Promise.all([
    db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
    db.collection('appSettings').findOne({ _id: 'mobile-app' }),
  ]);
  const attendanceSettings = normalizeAttendanceSettings(attendanceSettingsRecord?.value);
  const requireClockPhoto =
    Boolean(attendanceSettings?.requireWebClockInPhoto) || Boolean(mobileSettingsRecord?.value?.requireClockInPhoto);
  if (!requireClockPhoto) {
    return;
  }
  const invalidClocking = getAttendanceClockingsToValidate(nextRecord, existingRecord).find(
    (clocking) => !String(clocking?.photoDataUrl || '').trim()
  );
  if (!invalidClocking) {
    return;
  }
  const modeLabel = invalidClocking.mode === 'clock-out' ? 'Clock-out' : 'Clock-in';
  const error = new Error(`${modeLabel} photo is required before saving attendance.`);
  error.statusCode = 400;
  throw error;
}

function mergeDuplicateAttendanceRecords(records, context) {
  const grouped = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const employeeId = String(record?.employeeId || '').trim();
    const employeeName = String(record?.employee || '').trim().toLowerCase();
    const date = String(record?.date || '').trim();
    const key = `${employeeId || employeeName}|${date}`;
    if (!date || (!employeeId && !employeeName)) {
      grouped.set(`row:${record?.id || Math.random()}`, [record]);
      return;
    }
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(record);
  });
  return [...grouped.values()].map((recordsForDay) => {
    if (recordsForDay.length === 1) {
      return enrichAttendanceRecordWithContext(recordsForDay[0], context);
    }
    const sorted = [...recordsForDay].sort((left, right) =>
      String(right?.updatedAt || right?.createdAt || '').localeCompare(String(left?.updatedAt || left?.createdAt || ''))
    );
    const base = sorted[0];
    const mergedClockings = sorted.flatMap((record) => normalizeAttendanceClockings(record));
    return enrichAttendanceRecordWithContext(
      {
        ...base,
        clockings: mergedClockings,
      },
      context
    );
  });
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
  const shiftSchedule = getShiftScheduleForAttendanceRecord(source, employee, settings);
  const clockings = normalizeAttendanceClockings(source);
  const firstClockIn = clockings.find((clocking) => clocking.mode === 'clock-in') || null;
  const lastClockOut = [...clockings].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
  const checkIn = firstClockIn?.time || String(source.checkIn || '').trim();
  const checkOut = lastClockOut?.time || String(source.checkOut || '').trim();
  const checkInMinutes = toMinutesFromClock(checkIn);
  const lateMinutes =
    !shiftSchedule.isWorkingDay || shiftSchedule.lateAfterMinutes === null || checkInMinutes === null
      ? 0
      : Math.max(0, checkInMinutes - shiftSchedule.lateAfterMinutes);
  const existingStatus = String(source.status || '').trim();
  let computedStatus = 'On Time';
  if (!shiftSchedule.isWorkingDay) {
    computedStatus = checkInMinutes === null ? (shiftSchedule.isHoliday ? 'Holiday' : 'Off Day') : shiftSchedule.isHoliday ? 'Holiday Worked' : 'Off Day Worked';
  } else if (checkInMinutes === null) {
    computedStatus = 'Absent';
  } else if (lateMinutes > 0) {
    computedStatus = 'Late';
  } else if (existingStatus === 'On Leave') {
    computedStatus = 'On Leave';
  }
  const status = existingStatus || computedStatus;
  const deductionRate = Number.isFinite(Number(source.deductionRatePerMinute)) && Number(source.deductionRatePerMinute) > 0
    ? Number(source.deductionRatePerMinute)
    : Number.isFinite(Number(settings.attendanceFixedDeductionPerMinute)) && Number(settings.attendanceFixedDeductionPerMinute) > 0
      ? Number(settings.attendanceFixedDeductionPerMinute)
      : 0;
  const existingDeduction = Number(source.deductionAmount);
  const computedDeduction = deductionRate > 0 && lateMinutes > 0 ? deductionRate * lateMinutes : 0;
  const deductionAmount =
    !shiftSchedule.isWorkingDay
      ? 0
      : Number.isFinite(existingDeduction) && existingDeduction > 0
        ? existingDeduction
        : computedDeduction;
  return {
    ...source,
    shift: shiftSchedule.shiftName,
    checkIn,
    checkOut,
    workedHours: checkIn && checkOut ? formatWorkedDuration(checkIn, checkOut) : String(source.workedHours || ''),
    lateMinutes: String(lateMinutes),
    status,
    clockings,
    attendanceRuleKey: shiftSchedule.ruleKey,
    isWorkingDay: shiftSchedule.isWorkingDay,
    deductionRatePerMinute: String(deductionRate),
    deductionAmount: String(deductionAmount),
  };
}

async function enrichAttendanceRecord(db, payload, options = {}) {
  const payloadSource = payload || {};
  const processedClockings = await processAttendanceClockings(payloadSource.clockings, {
    tenantId: options.tenantId || 'master',
    employeeId: String(payloadSource.employeeId || '').trim(),
    date: String(payloadSource.date || '').trim(),
    recordId: String(payloadSource.id || '').trim(),
  });
  const source =
    Array.isArray(payloadSource.clockings) && payloadSource.clockings.length > 0
      ? { ...payloadSource, clockings: processedClockings }
      : payloadSource;
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
const tenantDbCache = new Map();
const hotReadCache = new Map();
const dbIndexInitPromises = new Map();

function buildHotReadCacheKey(parts) {
  return parts.map((part) => String(part || '')).join('::');
}

function getHotReadCache(key) {
  const cached = hotReadCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    hotReadCache.delete(key);
    return null;
  }
  return cached.value;
}

function setHotReadCache(key, value, ttlMs = HOT_READ_CACHE_TTL_MS) {
  hotReadCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

function invalidateHotReadCache(predicate) {
  for (const key of hotReadCache.keys()) {
    if (predicate(key)) {
      hotReadCache.delete(key);
    }
  }
}

function invalidateTenantReadCaches(tenantId, moduleId = '') {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  invalidateHotReadCache((key) => {
    if (!key.includes(`tenant:${normalizedTenantId}`)) {
      return false;
    }
    if (!moduleId) {
      return true;
    }
    return key.includes(`module:${moduleId}`) || key.includes('dashboard:summary') || key.includes('module:employee-management');
  });
}

function serializeQueryForCache(query = {}) {
  return Object.entries(query)
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value || '')}`)
    .join('&');
}

async function ensureOperationalIndexes(db, dbName = '') {
  const normalizedDbName = String(dbName || db?.databaseName || '').trim() || MONGO_MASTER_DB_NAME;
  const existingInit = dbIndexInitPromises.get(normalizedDbName);
  if (existingInit) {
    return existingInit;
  }
  const initPromise = Promise.all([
    db.collection('employees').createIndex({ id: 1 }, { unique: true }),
    db.collection('employees').createIndex({ fullName: 1 }),
    db.collection('employees').createIndex({ department: 1, status: 1, employmentState: 1 }),
    db.collection('employees').createIndex({ contractEndDate: 1 }),
    db.collection('attendanceTime').createIndex({ employeeId: 1, date: -1 }),
    db.collection('attendanceTime').createIndex({ employee: 1, date: -1 }),
    db.collection('attendanceTime').createIndex({ date: -1 }),
    db.collection('attendanceTime').createIndex({ date: -1, updatedAt: -1 }),
    db.collection('attendancePenaltyAdjustments').createIndex({ employeeId: 1, date: -1, penaltyType: 1 }),
    db.collection('attendancePenaltyAdjustments').createIndex({ employee: 1, date: -1, penaltyType: 1 }),
    db.collection('loanRecords').createIndex({ employeeId: 1, updatedAt: -1 }),
    db.collection('loanRecords').createIndex({ status: 1, updatedAt: -1 }),
    db.collection('leaveRequests').createIndex({ employeeId: 1, startDate: -1, endDate: -1 }),
    db.collection('leaveRequests').createIndex({ employee: 1, startDate: -1, endDate: -1 }),
    db.collection('leaveRequests').createIndex({ status: 1, startDate: -1, endDate: -1 }),
    db.collection('payrollRecords').createIndex({ employeeId: 1, updatedAt: -1 }),
    db.collection('payrollRecords').createIndex({ employee: 1, updatedAt: -1 }),
  ]).catch((error) => {
    dbIndexInitPromises.delete(normalizedDbName);
    throw error;
  });
  dbIndexInitPromises.set(normalizedDbName, initPromise);
  return initPromise;
}

function stripEmployeeHeavyFields(record) {
  const next = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (key.endsWith('Files') || key.endsWith('Preview') || key.endsWith('MediaUnavailable')) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function isInactiveEmployeeLikeRecord(record) {
  const normalizedStatus = String(record?.status || '').trim().toLowerCase();
  const normalizedStage = String(record?.employmentState || '').trim().toLowerCase();
  return blockedEmployeeStatusValues.has(normalizedStatus) || blockedEmployeeStageValues.has(normalizedStage);
}

function getEmployeeListView(records, query = {}) {
  const searchText = String(query.search || '').trim().toLowerCase();
  const departmentFilter = String(query.filterValue || 'All').trim();
  const statusFilter = String(query.statusFilterValue || 'All').trim();
  const employmentStageFilter = String(query.employmentStageFilterValue || 'All').trim();
  const directoryTab = String(query.employeeDirectoryTab || 'active').trim().toLowerCase();
  const expiryFilter = String(query.expiryFilterValue || 'All').trim();
  const sortBy = String(query.sortByValue || 'default').trim();
  const pageSize = Math.min(250, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const todayIso = new Date().toISOString().slice(0, 10);
  const within30Iso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const filteredRows = (Array.isArray(records) ? records : []).filter((row) => {
    const matchesSearch =
      !searchText ||
      [
        row?.id,
        row?.fullName,
        row?.department,
        row?.position,
        row?.email,
        row?.assignedShift,
        row?.employmentState,
        row?.status,
      ].some((value) => String(value || '').toLowerCase().includes(searchText));
    const matchesDepartment = departmentFilter === 'All' || String(row?.department || '') === departmentFilter;
    const matchesStatus = statusFilter === 'All' || String(row?.status || '') === statusFilter;
    const matchesEmploymentStage =
      employmentStageFilter === 'All' || String(row?.employmentState || '') === employmentStageFilter;
    const isInactive = isInactiveEmployeeLikeRecord(row);
    const matchesDirectoryTab = directoryTab === 'inactive' ? isInactive : !isInactive;
    const contractEndDate = String(row?.contractEndDate || '').trim();
    const hasContractEndDate = /^\d{4}-\d{2}-\d{2}$/.test(contractEndDate);
    const matchesExpiryFilter =
      expiryFilter === 'All' ||
      (expiryFilter === 'within30' && hasContractEndDate && contractEndDate >= todayIso && contractEndDate <= within30Iso) ||
      (expiryFilter === 'after30' && hasContractEndDate && contractEndDate > within30Iso) ||
      (expiryFilter === 'expired' && hasContractEndDate && contractEndDate < todayIso) ||
      (expiryFilter === 'no-end-date' && !hasContractEndDate);
    return (
      matchesSearch &&
      matchesDepartment &&
      matchesStatus &&
      matchesEmploymentStage &&
      matchesDirectoryTab &&
      matchesExpiryFilter
    );
  });

  const sortedRows = [...filteredRows].sort((left, right) => {
    const leftEnd = String(left?.contractEndDate || '').trim();
    const rightEnd = String(right?.contractEndDate || '').trim();
    const leftComparable = /^\d{4}-\d{2}-\d{2}$/.test(leftEnd) ? leftEnd : '9999-12-31';
    const rightComparable = /^\d{4}-\d{2}-\d{2}$/.test(rightEnd) ? rightEnd : '9999-12-31';
    if (sortBy === 'closest-expiry') {
      return leftComparable.localeCompare(rightComparable) || String(left?.fullName || '').localeCompare(String(right?.fullName || ''));
    }
    if (sortBy === 'expiry-priority') {
      const getBucket = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return 3;
        }
        if (value < todayIso) {
          return 0;
        }
        if (value <= within30Iso) {
          return 1;
        }
        return 2;
      };
      const leftBucket = getBucket(leftEnd);
      const rightBucket = getBucket(rightEnd);
      if (leftBucket !== rightBucket) {
        return leftBucket - rightBucket;
      }
      return leftComparable.localeCompare(rightComparable) || String(left?.fullName || '').localeCompare(String(right?.fullName || ''));
    }
    return String(right?._id || '').localeCompare(String(left?._id || ''));
  });

  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(totalPages, page);
  const start = (safePage - 1) * pageSize;
  const directoryCounts = (Array.isArray(records) ? records : []).reduce(
    (accumulator, row) => {
      if (isInactiveEmployeeLikeRecord(row)) {
        accumulator.inactive += 1;
      } else {
        accumulator.active += 1;
      }
      return accumulator;
    },
    { active: 0, inactive: 0 }
  );
  return {
    records: sortedRows.slice(start, start + pageSize),
    meta: {
      totalRows,
      totalPages,
      page: safePage,
      pageSize,
      directoryCounts,
      filterOptions: [...new Set((records || []).map((row) => String(row?.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      statusOptions: [...new Set((records || []).map((row) => String(row?.status || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      employmentStageOptions: [...new Set((records || []).map((row) => String(row?.employmentState || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    },
  };
}

async function connectToMongo() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }
  if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
    return mongoClient.db(MONGO_MASTER_DB_NAME);
  }
  mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  return mongoClient.db(MONGO_MASTER_DB_NAME);
}

async function getTenantDatabase(masterDb, tenantIdRaw) {
  const normalizedTenantId = normalizeTenantId(tenantIdRaw);
  if (!normalizedTenantId) {
    throw new Error('tenantId is required');
  }
  if (normalizedTenantId === 'master') {
    await ensureOperationalIndexes(masterDb, MONGO_MASTER_DB_NAME);
    return { tenantId: 'master', dbName: MONGO_MASTER_DB_NAME, db: masterDb };
  }
  const tenant = await masterDb.collection('tenants').findOne({ tenantId: normalizedTenantId, status: 'active' });
  if (!tenant) {
    throw new Error('Unknown or inactive tenant');
  }
  const cached = tenantDbCache.get(normalizedTenantId);
  const dbName = String(tenant.dbName || '');
  if (cached && cached.dbName === dbName) {
    const refreshedContext = {
      ...cached,
      tenant,
      dbName,
    };
    tenantDbCache.set(normalizedTenantId, refreshedContext);
    return refreshedContext;
  }
  const tenantContext = {
    tenantId: normalizedTenantId,
    dbName,
    tenant,
    db: mongoClient.db(dbName),
  };
  await ensureOperationalIndexes(tenantContext.db, dbName);
  tenantDbCache.set(normalizedTenantId, tenantContext);
  return tenantContext;
}

function resolveTenantIdFromRequest(req) {
  const fromHeader = req.headers['x-tenant-id'];
  if (fromHeader) {
    return normalizeTenantId(fromHeader);
  }
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return normalizeTenantId(payload.tenantId) || 'master';
    } catch (error) {
    }
  }
  if (req.body && req.body.tenantId) {
    return normalizeTenantId(req.body.tenantId);
  }
  if (req.query && req.query.tenantId) {
    return normalizeTenantId(req.query.tenantId);
  }
  return 'master';
}

function getTenantSubscriptionDaysRemaining(value) {
  const normalized = String(value || '').slice(0, 10);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const expiryDate = new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  if (Number.isNaN(expiryDate.getTime())) {
    return null;
  }
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return Math.round((expiryDate.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));
}

const EMPLOYEE_PHONE_FIELDS = [
  'phonePrimary',
  'phoneSecondary',
  'phone',
  'contactNumber',
  'mobileNumber',
  'personalPhone',
  'emergencyContact1Phone',
  'emergencyContact2Phone',
  'referee1Phone',
  'referee2Phone',
];

function keepDigitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
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

function normalizeUserRole(value, fallback = 'employee') {
  const normalized = String(value || '').trim().toLowerCase();
  if (allowedUserRoles.has(normalized)) {
    return normalized;
  }
  return String(fallback || 'employee').trim().toLowerCase();
}

function normalizeEmployeePhoneFields(record) {
  const source = record || {};
  return EMPLOYEE_PHONE_FIELDS.reduce(
    (acc, field) => ({
      ...acc,
      [field]: field in source ? keepDigitsOnly(source[field]) : source[field],
    }),
    { ...source }
  );
}

function normalizeEmployeeAccountFields(record) {
  const source = record || {};
  return {
    ...source,
    role: normalizeUserRole(source.role, 'employee'),
    allowedModules: normalizeModuleIds(source.allowedModules),
  };
}

async function resolveNextEmployeeId(db, requestedId) {
  const normalizedId = String(requestedId || '').trim().toUpperCase();
  const match = normalizedId.match(/^([A-Z]{2})(\d{4,8})$/);
  if (!match) {
    return normalizedId;
  }
  const prefix = match[1];
  const employees = await db
    .collection('employees')
    .find({ id: { $regex: `^${prefix}\\d{4,8}$`, $options: 'i' } }, { projection: { id: 1 } })
    .toArray();
  const nextSequence =
    employees.reduce((acc, employee) => {
      const employeeMatch = String(employee?.id || '').trim().toUpperCase().match(/^([A-Z]{2})(\d{4,8})$/);
      if (!employeeMatch || employeeMatch[1] !== prefix) {
        return acc;
      }
      return Math.max(acc, Number(employeeMatch[2]));
    }, 0) + 1;
  return `${prefix}${String(nextSequence).padStart(match[2].length, '0')}`;
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
    const requestedRole = normalizeUserRole(
      Object.prototype.hasOwnProperty.call(employee || {}, 'role') ? employee.role : existing?.role || 'employee',
      existing?.role || 'employee'
    );
    const requestedAllowedModules = Object.prototype.hasOwnProperty.call(employee || {}, 'allowedModules')
      ? normalizeModuleIds(employee.allowedModules)
      : Array.isArray(existing?.allowedModules)
        ? existing.allowedModules
        : [];
    const employeeAccessBlocked = Boolean(getEmployeeAccessBlockReason(employee));
    const nextIsActive = employeeAccessBlocked ? false : existing?.isActive !== false;
    if (existing) {
      await users.updateOne(
        { _id: existing._id },
        {
          $set: {
            username,
            fullName: employee.fullName || username,
            employeeId,
            passwordHash,
            role: requestedRole,
            allowedModules: requestedAllowedModules,
            isActive: nextIsActive,
            updatedAt: now,
          },
        }
      );
      if (!nextIsActive) {
        await db.collection('authSessions').updateMany(
          { userId: String(existing._id), revokedAt: null },
          { $set: { revokedAt: now, updatedAt: now } }
        );
      }
    } else {
      await users.insertOne({
        username,
        fullName: employee.fullName || username,
        employeeId,
        passwordHash,
        role: requestedRole,
        allowedModules: requestedAllowedModules,
        isActive: !employeeAccessBlocked,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    console.error('Failed to sync employee user', error);
  }
}

async function deleteEmployeeUserAccess(db, employeeId) {
  const normalizedEmployeeId = String(employeeId || '').trim();
  if (!normalizedEmployeeId) {
    return;
  }
  const users = db.collection('users');
  const linkedUsers = await users
    .find(
      {
        $or: [{ employeeId: normalizedEmployeeId }, { username: normalizedEmployeeId }],
      },
      { projection: { _id: 1 } }
    )
    .toArray();
  if (linkedUsers.length === 0) {
    return;
  }
  const linkedUserIds = linkedUsers.map((user) => String(user._id));
  await users.deleteMany({
    _id: { $in: linkedUsers.map((user) => user._id) },
  });
  await db.collection('authSessions').deleteMany({
    userId: { $in: linkedUserIds },
  });
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

async function loadAuthUserFromRequest(req) {
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
  const users = req.db.collection('users');
  const user = await users.findOne({ _id: new ObjectId(payload.sub), isActive: true });
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
  if (String(user.role || '').toLowerCase() !== 'superadmin' || req.tenantId !== 'master') {
    const employee = user.employeeId
      ? await req.db.collection('employees').findOne(
          { id: String(user.employeeId || '').trim() },
          { projection: { status: 1, employmentState: 1 } }
        )
      : null;
    if (getEmployeeAccessBlockReason(employee)) {
      return null;
    }
  }
  return { ...user, tokenPayload: payload };
}

async function requireAuthenticatedTenantContext(req, res, next) {
  try {
    const authUser = await loadAuthUserFromRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const tokenTenantId = normalizeTenantId(authUser?.tokenPayload?.tenantId || '') || 'master';
    if (tokenTenantId !== req.tenantId) {
      res.status(403).json({ error: 'Tenant context mismatch' });
      return;
    }
    req.authUser = authUser;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization check failed' });
  }
}

app.get('/health', async (req, res) => {
  try {
    const masterDb = await connectToMongo();
    await masterDb.command({ ping: 1 });
    res.json({ status: 'ok', service: 'hr-backend', mongo: 'connected', mode: 'multitenant' });
  } catch (error) {
    res.status(500).json({ status: 'error', service: 'hr-backend', mongo: 'unavailable' });
  }
});

app.use(async (req, res, next) => {
  try {
    const masterDb = await connectToMongo();
    const requestedTenantId = resolveTenantIdFromRequest(req);
    const tenantContext = await getTenantDatabase(masterDb, requestedTenantId || 'master');
    req.masterDb = masterDb;
    req.tenantId = tenantContext.tenantId;
    req.tenant = tenantContext.tenant || null;
    req.getTenantDb = async (tenantId) => {
      const resolved = await getTenantDatabase(masterDb, tenantId);
      return resolved.db;
    };
    req.getDbByName = (dbName) => mongoClient.db(String(dbName || '').trim());
    req.db = tenantContext.db;
    req.db.bson = { ObjectId };
    next();
  } catch (error) {
    res.status(500).json({ error: error.message || 'Database connection failed' });
  }
});

app.use('/api/settings', requireAuthenticatedTenantContext);
app.use('/api/mobile/settings', requireAuthenticatedTenantContext);
app.use('/api/tracking/settings', requireAuthenticatedTenantContext);

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
    invalidateTenantReadCaches(req.tenantId || 'master');
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save attendance settings' });
  }
});

app.get('/api/settings/general', async (req, res) => {
  try {
    const record = await req.db.collection('appSettings').findOne({ _id: 'general-settings' });
    const settings = normalizeGeneralSettings(record?.value);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load general settings' });
  }
});

app.post('/api/settings/general', async (req, res) => {
  try {
    const settings = normalizeGeneralSettings(req.body);
    await req.db.collection('appSettings').updateOne(
      { _id: 'general-settings' },
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
    invalidateTenantReadCaches(req.tenantId || 'master');
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save general settings' });
  }
});

app.get('/api/dashboard/summary', requireAuthenticatedTenantContext, async (req, res) => {
  try {
    const authUser = req.authUser;
    const normalizedRole = String(authUser?.role || '').trim().toLowerCase();
    const isMasterSuperAdmin = normalizedRole === 'superadmin' && req.tenantId === 'master';
    const allowedModules = isMasterSuperAdmin
      ? allModules
      : resolveUserAllowedModulesForTenant({
          user: authUser,
          tenant: req.tenant,
          tenantId: req.tenantId,
          defaultEmployeeModules,
        });
    if (!allowedModules.includes('dashboard')) {
      res.status(403).json({ error: 'Forbidden: dashboard not enabled for this tenant/user' });
      return;
    }

    const selectedDate = normalizeIsoDateInput(req.query?.date);
    const monthStartDate = getMonthStartIsoDate(selectedDate);
    const dashboardCacheKey = buildHotReadCacheKey([
      'tenant',
      req.tenantId,
      'dashboard:summary',
      normalizedRole,
      authUser?.id || authUser?.username || '',
      selectedDate,
    ]);
    const cachedSummary = getHotReadCache(dashboardCacheKey);
    if (cachedSummary) {
      res.json(cachedSummary);
      return;
    }
    const employeeId = String(authUser?.employeeId || '').trim();
    const employeeName = String(authUser?.fullName || '').trim();
    const employeeMatchQuery =
      employeeId || employeeName
        ? {
            $or: [
              ...(employeeId ? [{ employeeId }] : []),
              ...(employeeName ? [{ employee: employeeName }] : []),
            ],
          }
        : null;
    const attendanceSummaryProjection = {
      employeeId: 1,
      employee: 1,
      lateMinutes: 1,
      deductionAmount: 1,
      checkIn: 1,
      status: 1,
      clockings: 1,
    };

    if (normalizedRole === 'employee' && employeeMatchQuery) {
      const [employeeRecord, dayAttendanceRows, monthAttendanceRows, employeeLoanRows, employeeLeaveRows, latestPayrollRow] =
        await Promise.all([
          req.db.collection('employees').findOne(
            { id: employeeId },
            {
              projection: {
                id: 1,
                fullName: 1,
                department: 1,
                position: 1,
                status: 1,
                employmentState: 1,
                leaveBalanceDays: 1,
                basicPay: 1,
                monthlyBonuses: 1,
                transportAllowance: 1,
                housingAllowance: 1,
                foodAllowance: 1,
              },
            }
          ),
          req.db.collection('attendanceTime').find(
            { ...employeeMatchQuery, date: selectedDate },
            { projection: attendanceSummaryProjection }
          ).toArray(),
          req.db
            .collection('attendanceTime')
            .find(
              { ...employeeMatchQuery, date: { $gte: monthStartDate, $lte: selectedDate } },
              { projection: { lateMinutes: 1, deductionAmount: 1 } }
            )
            .toArray(),
          req.db.collection('loanRecords').find(employeeMatchQuery, {
            projection: { status: 1, balance: 1, amount: 1 },
          }).toArray(),
          req.db.collection('leaveRequests').find(employeeMatchQuery, {
            projection: {
              departmentApproval: 1,
              supervisorApproval: 1,
              hrApproval: 1,
              managerApproval: 1,
              finalManagerApproval: 1,
              branchManagerApproval: 1,
              status: 1,
            },
          }).toArray(),
          req.db
            .collection('payrollRecords')
            .find(employeeMatchQuery, {
              projection: {
                totalDeductions: 1,
                netPayable: 1,
                grossPay: 1,
                payrollMonth: 1,
                period: 1,
                month: 1,
                date: 1,
                updatedAt: 1,
                createdAt: 1,
              },
            })
            .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
            .limit(1)
            .next(),
        ]);

      const dayAttendance = summarizeAttendanceByEmployee(dayAttendanceRows)[0] || {
        lateMinutes: 0,
        deductionAmount: 0,
        hasClockIn: false,
        isLate: false,
      };
      const monthToDateLateMinutes = monthAttendanceRows.reduce(
        (total, row) => total + Math.max(0, toNumberValue(row?.lateMinutes)),
        0
      );
      const monthToDateDeductionAmount = monthAttendanceRows.reduce(
        (total, row) => total + Math.max(0, toNumberValue(row?.deductionAmount)),
        0
      );
      const activeLoanRows = employeeLoanRows.filter(isLoanCountableRecord);
      const activeLoanBalance = activeLoanRows.reduce(
        (total, row) => total + Math.max(0, toNumberValue(row?.balance || row?.amount)),
        0
      );
      const approvedLeaveCount = employeeLeaveRows.filter(isLeaveFullyApprovedRecord).length;
      const pendingLeaveCount = employeeLeaveRows.filter(
        (row) => !isLeaveRejectedRecord(row) && !isLeaveFullyApprovedRecord(row)
      ).length;
      const grossPayEstimate =
        toNumberValue(employeeRecord?.basicPay) +
        toNumberValue(employeeRecord?.monthlyBonuses) +
        toNumberValue(employeeRecord?.transportAllowance) +
        toNumberValue(employeeRecord?.housingAllowance) +
        toNumberValue(employeeRecord?.foodAllowance);
      const totalDeductions = latestPayrollRow
        ? Math.max(0, toNumberValue(latestPayrollRow?.totalDeductions))
        : monthToDateDeductionAmount;
      const takeHomePay = latestPayrollRow
        ? Math.max(0, toNumberValue(latestPayrollRow?.netPayable))
        : Math.max(0, grossPayEstimate - monthToDateDeductionAmount);
      const payload = {
        view: 'employee',
        date: selectedDate,
        employee: {
          id: String(employeeRecord?.id || employeeId || ''),
          fullName: String(employeeRecord?.fullName || authUser?.fullName || ''),
          department: String(employeeRecord?.department || ''),
          position: String(employeeRecord?.position || ''),
          status: String(employeeRecord?.status || ''),
          employmentState: String(employeeRecord?.employmentState || ''),
          leaveBalanceDays: Math.max(0, toNumberValue(employeeRecord?.leaveBalanceDays)),
        },
        attendance: {
          status: dayAttendance.hasClockIn ? (dayAttendance.isLate ? 'Late' : 'On Time') : 'No Record',
          lateMinutes: Math.max(0, toNumberValue(dayAttendance.lateMinutes)),
          deductionAmount: Math.max(0, toNumberValue(dayAttendance.deductionAmount)),
        },
        monthToDate: {
          lateMinutes: monthToDateLateMinutes,
          deductionAmount: monthToDateDeductionAmount,
        },
        loans: {
          activeCount: activeLoanRows.length,
          outstandingAmount: activeLoanBalance,
        },
        leaves: {
          pendingCount: pendingLeaveCount,
          approvedCount: approvedLeaveCount,
        },
        compensation: {
          source: latestPayrollRow ? 'latest-payroll' : 'estimate',
          grossPay: latestPayrollRow ? Math.max(0, toNumberValue(latestPayrollRow?.grossPay)) : grossPayEstimate,
          totalDeductions,
          takeHomePay,
          payrollPeriod:
            String(
              latestPayrollRow?.payrollMonth ||
                latestPayrollRow?.period ||
                latestPayrollRow?.month ||
                latestPayrollRow?.date ||
                ''
            ).trim() || '',
        },
      };
      res.json(setHotReadCache(dashboardCacheKey, payload));
      return;
    }

    const [employeeRows, dayAttendanceRows, monthAttendanceRows, loanRows, leaveRows] = await Promise.all([
      req.db.collection('employees').find({}, {
        projection: { status: 1, employmentState: 1 },
      }).toArray(),
      req.db.collection('attendanceTime').find(
        { date: selectedDate },
        { projection: attendanceSummaryProjection }
      ).toArray(),
      req.db.collection('attendanceTime').find(
        { date: { $gte: monthStartDate, $lte: selectedDate } },
        { projection: { deductionAmount: 1 } }
      ).toArray(),
      req.db.collection('loanRecords').find({}, {
        projection: { status: 1, balance: 1, amount: 1 },
      }).toArray(),
      req.db.collection('leaveRequests').find({}, {
        projection: {
          departmentApproval: 1,
          supervisorApproval: 1,
          hrApproval: 1,
          managerApproval: 1,
          finalManagerApproval: 1,
          branchManagerApproval: 1,
          status: 1,
        },
      }).toArray(),
    ]);

    const activeEmployees = employeeRows.filter((row) => !getEmployeeAccessBlockReason(row));
    const inactiveEmployees = employeeRows.length - activeEmployees.length;
    const summarizedDailyAttendance = summarizeAttendanceByEmployee(dayAttendanceRows);
    const onTimeCount = summarizedDailyAttendance.filter((row) => row.hasClockIn && !row.isLate).length;
    const lateCount = summarizedDailyAttendance.filter((row) => row.hasClockIn && row.isLate).length;
    const dailyDeductionAmount = summarizedDailyAttendance.reduce(
      (total, row) => total + Math.max(0, toNumberValue(row.deductionAmount)),
      0
    );
    const monthToDateDeductionAmount = monthAttendanceRows.reduce(
      (total, row) => total + Math.max(0, toNumberValue(row?.deductionAmount)),
      0
    );
    const activeLoanRows = loanRows.filter(isLoanCountableRecord);
    const activeLoanOutstanding = activeLoanRows.reduce(
      (total, row) => total + Math.max(0, toNumberValue(row?.balance || row?.amount)),
      0
    );
    const pendingLeaveCount = leaveRows.filter(
      (row) => !isLeaveRejectedRecord(row) && !isLeaveFullyApprovedRecord(row)
    ).length;
    const approvedLeaveCount = leaveRows.filter(isLeaveFullyApprovedRecord).length;
    const payload = {
      view: 'admin',
      date: selectedDate,
      workforce: {
        totalEmployees: employeeRows.length,
        activeEmployees: activeEmployees.length,
        inactiveEmployees,
      },
      attendance: {
        onTimeCount,
        lateCount,
        clockedCount: summarizedDailyAttendance.filter((row) => row.hasClockIn).length,
        totalDeductionAmount: dailyDeductionAmount,
      },
      monthToDate: {
        totalDeductionAmount: monthToDateDeductionAmount,
      },
      loans: {
        activeCount: activeLoanRows.length,
        outstandingAmount: activeLoanOutstanding,
      },
      leaves: {
        pendingCount: pendingLeaveCount,
        approvedCount: approvedLeaveCount,
      },
    };
    res.json(setHotReadCache(dashboardCacheKey, payload));
  } catch (error) {
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

app.use('/api/modules/:moduleId', async (req, res, next) => {
  try {
    if (req.tenantId !== 'master') {
      const daysRemaining = getTenantSubscriptionDaysRemaining(req.tenant?.subscriptionExpiresAt);
      if (daysRemaining !== null && daysRemaining <= 0) {
        res.status(403).json({
          error:
            'Tenant subscription has expired. This tenant cannot sign in until payment is completed or a valid 12-character activation code is entered.',
          subscriptionExpired: true,
        });
        return;
      }
    }
    const user = await loadAuthUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const moduleId = req.params.moduleId;
    const accessModuleId = moduleId === 'attendance-penalty-adjustments' ? 'attendance-time' : moduleId;
    if (String(user.role || '').toLowerCase() === 'superadmin' && req.tenantId === 'master') {
      req.authUser = user;
      next();
      return;
    }
    const allowedModules = resolveUserAllowedModulesForTenant({ user, tenant: req.tenant, tenantId: req.tenantId, defaultEmployeeModules });
    if (!allowedModules.includes(accessModuleId)) {
      res.status(403).json({ error: 'Forbidden: module not enabled for this tenant/user' });
      return;
    }
    req.authUser = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization check failed' });
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
    const moduleCacheKey = buildHotReadCacheKey([
      'tenant',
      req.tenantId,
      'module',
      moduleId,
      serializeQueryForCache(req.query),
    ]);
    const cachedRecords = getHotReadCache(moduleCacheKey);
    if (cachedRecords) {
      res.json(cachedRecords);
      return;
    }
    const attendanceMode = String(req.query?.mode || '').trim().toLowerCase();
    const isAttendancePagedRequest =
      moduleId === 'attendance-time' && ['clock-page', 'compliance-page', 'penalty-page', 'performance-page'].includes(attendanceMode);
    const records = isAttendancePagedRequest
      ? []
      : moduleId === 'employee-management'
        ? await collection.find({}).toArray()
        : await collection.find({}).sort({ _id: -1 }).limit(500).toArray();
    if (moduleId !== 'attendance-time') {
      if (moduleId === 'loan-records' && String(req.query?.mode || '').trim().toLowerCase() === 'page') {
        const payload = getLoanListView(records, req.query, req.user);
        res.json(setHotReadCache(moduleCacheKey, payload));
        return;
      }
      if (moduleId === 'employee-management') {
        const users = await req.db.collection('users').find({ employeeId: { $ne: '' } }).toArray();
        const userByEmployeeId = new Map(
          users.map((user) => [String(user.employeeId || '').trim(), user]).filter(([employeeId]) => employeeId)
        );
        const lookupMode = String(req.query?.mode || '').trim().toLowerCase() === 'lookup';
        const employeeListView = lookupMode ? null : getEmployeeListView(records, req.query);
        const payload = {
          records: await Promise.all(
            (lookupMode ? records : employeeListView.records).map((record) =>
              lookupMode
                ? stripEmployeeHeavyFields(
                    mergeEmployeeAuthAccess(
                      record,
                      userByEmployeeId.get(String(record?.id || '').trim()) || null,
                      req.tenant,
                      req.tenantId
                    )
                  )
                : hydrateModuleRecordMedia(
                    moduleId,
                    mergeEmployeeAuthAccess(
                      record,
                      userByEmployeeId.get(String(record?.id || '').trim()) || null,
                      req.tenant,
                      req.tenantId
                    )
                  )
            )
          ),
          ...(employeeListView ? { meta: employeeListView.meta } : {}),
        };
        res.json(setHotReadCache(moduleCacheKey, payload));
        return;
      }
      const payload = {
        records: await Promise.all(records.map((record) => hydrateModuleRecordMedia(moduleId, record))),
      };
      res.json(setHotReadCache(moduleCacheKey, payload));
      return;
    }
    if (attendanceMode === 'clock-page') {
      const attendanceQuery = buildAttendanceClockRangeQuery(req.query, req.user);
      const [rangeRecords, settingsRecord, employees] = await Promise.all([
        collection.find(attendanceQuery).sort({ date: -1, updatedAt: -1, _id: -1 }).toArray(),
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
      const clockPageView = getAttendanceClockListView(
        rangeRecords,
        req.query,
        {
          settings,
          employeeById,
          employeeByEmployeeId,
          employeeByName,
        }
      );
      const payload = {
        records: await Promise.all(clockPageView.records.map((row) => hydrateModuleRecordMedia(moduleId, row))),
        meta: clockPageView.meta,
      };
      res.json(setHotReadCache(moduleCacheKey, payload));
      return;
    }
    if (attendanceMode === 'compliance-page') {
      const attendanceQuery = buildAttendanceComplianceQuery(req.query, req.user);
      const targetDate = String(req.query?.date || '').trim();
      const leaveScopeClauses = getAttendanceEmployeeMatchClauses(req.user, {
        idField: 'employeeId',
        nameField: 'employee',
      });
      const leaveQuery = {
        startDate: { $lte: targetDate },
        endDate: { $gte: targetDate },
        ...(leaveScopeClauses.length > 0 ? { $or: leaveScopeClauses } : {}),
      };
      const [rangeRecords, settingsRecord, employees, leaveRows] = await Promise.all([
        collection.find(attendanceQuery).sort({ date: -1, updatedAt: -1, _id: -1 }).toArray(),
        req.db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
        req.db.collection('employees').find(
          {},
          {
            projection: {
              id: 1,
              employeeId: 1,
              fullName: 1,
              department: 1,
              assignedShift: 1,
              status: 1,
              employmentState: 1,
              basicPay: 1,
              workingDays: 1,
            },
          }
        ).toArray(),
        req.db.collection('leaveRequests').find(leaveQuery, {
          projection: {
            id: 1,
            employeeId: 1,
            employee: 1,
            type: 1,
            status: 1,
            startDate: 1,
            endDate: 1,
            attendanceExemptionScope: 1,
            reason: 1,
          },
        }).toArray(),
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
      const payrollEmployeeClauses = [];
      const payrollSeenKeys = new Set();
      rangeRecords.forEach((record) => {
        const scopedEmployeeId = String(record?.employeeId || '').trim();
        const scopedEmployeeName = String(record?.employee || '').trim();
        if (scopedEmployeeId && !payrollSeenKeys.has(`id:${scopedEmployeeId}`)) {
          payrollSeenKeys.add(`id:${scopedEmployeeId}`);
          payrollEmployeeClauses.push({ employeeId: scopedEmployeeId });
        }
        if (scopedEmployeeName && !payrollSeenKeys.has(`name:${scopedEmployeeName}`)) {
          payrollSeenKeys.add(`name:${scopedEmployeeName}`);
          payrollEmployeeClauses.push({ employee: scopedEmployeeName });
        }
      });
      const payrollRows = payrollEmployeeClauses.length > 0
        ? await req.db.collection('payrollRecords').find(
            { $or: payrollEmployeeClauses },
            {
              projection: {
                employeeId: 1,
                employee: 1,
                basicPay: 1,
                workingDays: 1,
                updatedAt: 1,
                createdAt: 1,
              },
            }
          ).sort({ updatedAt: -1, createdAt: -1, _id: -1 }).toArray()
        : [];
      const payrollByEmployeeKey = new Map();
      payrollRows.forEach((row) => {
        const rowKey = getRecordEmployeeKey(row);
        if (rowKey && !payrollByEmployeeKey.has(rowKey)) {
          payrollByEmployeeKey.set(rowKey, row);
        }
      });
      const settings = normalizeAttendanceSettings(settingsRecord?.value);
      const compliancePageView = getAttendanceComplianceListView(
        rangeRecords,
        req.query,
        {
          settings,
          leaveRows,
          payrollByEmployeeKey,
          employeeById,
          employeeByEmployeeId,
          employeeByName,
        }
      );
      const payload = {
        records: await Promise.all(compliancePageView.records.map((row) => hydrateModuleRecordMedia(moduleId, row))),
        meta: compliancePageView.meta,
      };
      res.json(setHotReadCache(moduleCacheKey, payload));
      return;
    }
    if (attendanceMode === 'penalty-page') {
      const attendanceQuery = buildAttendanceComplianceQuery(req.query, req.user);
      const targetDate = String(req.query?.date || '').trim();
      const leaveScopeClauses = getAttendanceEmployeeMatchClauses(req.user, {
        idField: 'employeeId',
        nameField: 'employee',
      });
      const scopedOr = leaveScopeClauses.length > 0 ? { $or: leaveScopeClauses } : {};
      const [rangeRecords, settingsRecord, employees, leaveRows, adjustmentRows] = await Promise.all([
        collection.find(attendanceQuery).sort({ date: -1, updatedAt: -1, _id: -1 }).toArray(),
        req.db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
        req.db.collection('employees').find(
          {},
          {
            projection: {
              id: 1,
              employeeId: 1,
              fullName: 1,
              department: 1,
              assignedShift: 1,
              status: 1,
              employmentState: 1,
              basicPay: 1,
              workingDays: 1,
            },
          }
        ).toArray(),
        req.db.collection('leaveRequests').find(
          {
            startDate: { $lte: targetDate },
            endDate: { $gte: targetDate },
            ...scopedOr,
          },
          {
            projection: {
              id: 1,
              employeeId: 1,
              employee: 1,
              type: 1,
              status: 1,
              startDate: 1,
              endDate: 1,
              attendanceExemptionScope: 1,
              reason: 1,
            },
          }
        ).toArray(),
        req.db.collection('attendancePenaltyAdjustments').find(
          {
            date: targetDate,
            ...scopedOr,
          },
          {
            projection: {
              id: 1,
              employeeId: 1,
              employee: 1,
              date: 1,
              department: 1,
              penaltyType: 1,
              penaltyLabel: 1,
              clearanceMode: 1,
              clearedAmount: 1,
              remark: 1,
              actorUsername: 1,
              actedOn: 1,
              updatedAt: 1,
            },
          }
        ).sort({ actedOn: -1, updatedAt: -1, _id: -1 }).toArray(),
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
      const payrollEmployeeClauses = [];
      const payrollSeenKeys = new Set();
      rangeRecords.forEach((record) => {
        const scopedEmployeeId = String(record?.employeeId || '').trim();
        const scopedEmployeeName = String(record?.employee || '').trim();
        if (scopedEmployeeId && !payrollSeenKeys.has(`id:${scopedEmployeeId}`)) {
          payrollSeenKeys.add(`id:${scopedEmployeeId}`);
          payrollEmployeeClauses.push({ employeeId: scopedEmployeeId });
        }
        if (scopedEmployeeName && !payrollSeenKeys.has(`name:${scopedEmployeeName}`)) {
          payrollSeenKeys.add(`name:${scopedEmployeeName}`);
          payrollEmployeeClauses.push({ employee: scopedEmployeeName });
        }
      });
      const payrollRows = payrollEmployeeClauses.length > 0
        ? await req.db.collection('payrollRecords').find(
            { $or: payrollEmployeeClauses },
            {
              projection: {
                employeeId: 1,
                employee: 1,
                basicPay: 1,
                workingDays: 1,
                updatedAt: 1,
                createdAt: 1,
              },
            }
          ).sort({ updatedAt: -1, createdAt: -1, _id: -1 }).toArray()
        : [];
      const payrollByEmployeeKey = new Map();
      payrollRows.forEach((row) => {
        const rowKey = getRecordEmployeeKey(row);
        if (rowKey && !payrollByEmployeeKey.has(rowKey)) {
          payrollByEmployeeKey.set(rowKey, row);
        }
      });
      const settings = normalizeAttendanceSettings(settingsRecord?.value);
      const penaltyPageView = getAttendancePenaltyListView(
        rangeRecords,
        adjustmentRows,
        req.query,
        {
          settings,
          leaveRows,
          payrollByEmployeeKey,
          employeeById,
          employeeByEmployeeId,
          employeeByName,
        }
      );
      const payload = {
        records: await Promise.all(penaltyPageView.records.map((row) => hydrateModuleRecordMedia(moduleId, row))),
        meta: penaltyPageView.meta,
      };
      res.json(setHotReadCache(moduleCacheKey, payload));
      return;
    }
    if (attendanceMode === 'performance-page') {
      const performanceStartDate = String(req.query?.startDate || '').trim();
      const performanceEndDate = String(req.query?.endDate || '').trim();
      const attendanceQuery = buildAttendancePerformanceQuery(req.query, req.user);
      const leaveScopeClauses = getAttendanceEmployeeMatchClauses(req.user, {
        idField: 'employeeId',
        nameField: 'employee',
      });
      const employeeRole = String(req.user?.role || '').trim().toLowerCase() === 'employee';
      const employeeScopeClauses = [];
      if (employeeRole) {
        const employeeId = String(req.user?.employeeId || '').trim();
        const employeeName = String(req.user?.fullName || '').trim();
        if (employeeId) {
          employeeScopeClauses.push({ id: employeeId }, { employeeId });
        }
        if (employeeName) {
          employeeScopeClauses.push({ fullName: employeeName });
        }
      }
      const [rangeRecords, settingsRecord, employees, leaveRows] = await Promise.all([
        collection.find(attendanceQuery).sort({ date: -1, updatedAt: -1, _id: -1 }).toArray(),
        req.db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
        req.db.collection('employees').find(
          employeeScopeClauses.length > 0 ? { $or: employeeScopeClauses } : {},
          {
            projection: {
              id: 1,
              employeeId: 1,
              fullName: 1,
              department: 1,
              assignedShift: 1,
              status: 1,
              employmentState: 1,
            },
          }
        ).toArray(),
        req.db.collection('leaveRequests').find(
          {
            startDate: { $lte: performanceEndDate },
            endDate: { $gte: performanceStartDate },
            ...(leaveScopeClauses.length > 0 ? { $or: leaveScopeClauses } : {}),
          },
          {
            projection: {
              id: 1,
              employeeId: 1,
              employee: 1,
              status: 1,
              startDate: 1,
              endDate: 1,
            },
          }
        ).toArray(),
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
      const performancePageView = getAttendancePerformanceListView(
        rangeRecords,
        req.query,
        {
          settings,
          employees,
          leaveRows,
          employeeById,
          employeeByEmployeeId,
          employeeByName,
        }
      );
      const payload = {
        records: performancePageView.records,
        meta: performancePageView.meta,
      };
      res.json(setHotReadCache(moduleCacheKey, payload));
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
    const normalizedRecords = await Promise.all(
      mergeDuplicateAttendanceRecords(records, {
        settings,
        employeeById,
        employeeByEmployeeId,
        employeeByName,
      }).map((row) => hydrateModuleRecordMedia(moduleId, row))
    );
    res.json(setHotReadCache(moduleCacheKey, { records: normalizedRecords }));
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
    if (moduleId === 'employee-management' && req.tenantId !== 'master') {
      const limits = resolveTenantEffectiveLimits(req.tenant || {});
      const employeeLimit = Number(limits.employeeLimit) || 0;
      if (employeeLimit > 0) {
        const currentCount = await req.db.collection('employees').countDocuments({});
        if (currentCount >= employeeLimit) {
          res.status(403).json({ error: `Employee limit reached (${employeeLimit}) for this tenant plan.` });
          return;
        }
      }
    }
    let incoming =
      moduleId === 'attendance-time'
        ? await enrichAttendanceRecord(req.db, req.body, { tenantId: req.tenantId })
        : moduleId === 'employee-management'
          ? normalizeEmployeeAccountFields(normalizeEmployeePhoneFields(req.body))
          : req.body;
    if (moduleId === 'employee-management') {
      const incomingId = String(incoming?.id || '').trim().toUpperCase();
      if (!incomingId) {
        res.status(400).json({ error: 'Employee ID is required.' });
        return;
      }
      const existingEmployee = await req.db.collection('employees').findOne({ id: incomingId });
      if (existingEmployee) {
        incoming = {
          ...incoming,
          id: await resolveNextEmployeeId(req.db, incomingId),
        };
      }
      incoming = await normalizeEmployeeStorageFields(incoming, {
        tenantId: req.tenantId,
        employeeId: String(incoming.id || '').trim(),
      });
    }
    const payload = {
      ...incoming,
      moduleId,
      createdAt: incoming.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (moduleId === 'attendance-time') {
      const employeeId = String(payload.employeeId || '').trim();
      const employeeName = String(payload.employee || '').trim();
      const date = String(payload.date || '').trim();
      const attendanceMatch = [];
      if (employeeId) {
        attendanceMatch.push({ employeeId });
      }
      if (employeeName) {
        attendanceMatch.push({ employee: employeeName });
      }
      const existingAttendance =
        date && attendanceMatch.length > 0
          ? await collection.findOne({
              date,
              $or: attendanceMatch,
            })
          : null;
      await validateAttendancePhotoRequirement(req.db, payload, existingAttendance);
      if (existingAttendance) {
        const merged = await enrichAttendanceRecord(
          req.db,
          {
            ...existingAttendance,
            ...payload,
            id: existingAttendance.id,
            createdAt: existingAttendance.createdAt || payload.createdAt,
            clockings: [
              ...normalizeAttendanceClockings(existingAttendance),
              ...normalizeAttendanceClockings(payload),
            ],
          },
          { tenantId: req.tenantId }
        );
        const { _id: existingId, ...mergedWithoutId } = merged;
        void existingId;
        await collection.updateOne(
          { _id: existingAttendance._id },
          {
            $set: {
              ...mergedWithoutId,
              moduleId,
              updatedAt: new Date().toISOString(),
            },
          }
        );
        const updated = await collection.findOne({ _id: existingAttendance._id });
        invalidateTenantReadCaches(req.tenantId, moduleId);
        res.json({ record: await hydrateModuleRecordMedia(moduleId, updated) });
        return;
      }
    }
    let result;
    try {
      result = await collection.insertOne(payload);
    } catch (error) {
      if (moduleId === 'employee-management' && error?.code === 11000 && payload.id) {
        const retryPayload = {
          ...payload,
          id: await resolveNextEmployeeId(req.db, payload.id),
          updatedAt: new Date().toISOString(),
        };
        result = await collection.insertOne(retryPayload);
      } else {
        throw error;
      }
    }
    const inserted = await collection.findOne({ _id: result.insertedId });
    if (moduleId === 'employee-management' && inserted) {
      await syncEmployeeUser(req.db, inserted);
    }
    invalidateTenantReadCaches(req.tenantId, moduleId);
    res.status(201).json({ record: await hydrateModuleRecordMedia(moduleId, inserted) });
  } catch (error) {
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to create record' });
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
    const normalized =
      moduleId === 'attendance-time'
        ? await enrichAttendanceRecord(req.db, mergedRequest, { tenantId: req.tenantId })
        : moduleId === 'employee-management'
          ? await normalizeEmployeeStorageFields(normalizeEmployeeAccountFields(normalizeEmployeePhoneFields(mergedRequest)), {
              tenantId: req.tenantId,
              employeeId: String(recordId || mergedRequest?.id || '').trim(),
            })
          : mergedRequest;
    const normalizedWithoutId = { ...(normalized || {}) };
    delete normalizedWithoutId._id;
    const update = {
      ...normalizedWithoutId,
      moduleId,
      updatedAt: new Date().toISOString(),
    };
    if (moduleId === 'attendance-time') {
      await validateAttendancePhotoRequirement(req.db, update, existingRecord);
    }
    await collection.updateOne({ id: recordId }, { $set: update });
    const updated = await collection.findOne({ id: recordId });
    if (moduleId === 'employee-management') {
      await syncEmployeeUser(req.db, updated);
    }
    invalidateTenantReadCaches(req.tenantId, moduleId);
    res.json({ record: await hydrateModuleRecordMedia(moduleId, updated) });
  } catch (error) {
    console.error('Failed to update record', error);
    res.status(error?.statusCode || 500).json({ error: error?.message || 'Failed to update record' });
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
    const existingRecord = await collection.findOne({ id: recordId }, { projection: { id: 1 } });
    if (!existingRecord) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    const result = await collection.deleteOne({ id: recordId });
    if (moduleId === 'employee-management' && result.deletedCount > 0) {
      await deleteEmployeeUserAccess(req.db, recordId);
    }
    invalidateTenantReadCaches(req.tenantId, moduleId);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

app.use('/api/tracking', trackingRoutes);

async function start() {
  try {
    const masterDb = await connectToMongo();
    app.locals.masterDb = masterDb;
    await masterDb.collection('tenants').updateOne(
      { tenantId: 'master' },
      {
        $set: {
          name: 'Master Tenant',
          packageType: 'enterprise',
          dbName: MONGO_MASTER_DB_NAME,
          grantedModules: [],
          status: 'active',
          updatedAt: new Date().toISOString(),
        },
        $setOnInsert: {
          tenantId: 'master',
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    await ensureSuperAdmin(masterDb);
    await ensureOperationalIndexes(masterDb, MONGO_MASTER_DB_NAME);
    app.listen(PORT, () => {
      console.log(`Connected to MongoDB Atlas database "${MONGO_MASTER_DB_NAME}"`);
      console.log(`HR backend listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start backend', error);
    process.exit(1);
  }
}

start();
