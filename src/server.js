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
  requireWebClockInPhoto: false,
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
  const deductionRate = Number.isFinite(Number(source.deductionRatePerMinute)) && Number(source.deductionRatePerMinute) > 0
    ? Number(source.deductionRatePerMinute)
    : Number.isFinite(Number(settings.attendanceFixedDeductionPerMinute)) && Number(settings.attendanceFixedDeductionPerMinute) > 0
      ? Number(settings.attendanceFixedDeductionPerMinute)
      : 0;
  const existingDeduction = Number(source.deductionAmount);
  const computedDeduction = deductionRate > 0 && lateMinutes > 0 ? deductionRate * lateMinutes : 0;
  const deductionAmount = Number.isFinite(existingDeduction) && existingDeduction > 0 ? existingDeduction : computedDeduction;
  // #region debug-point A:attendance-enrich-summary
  (()=>{const fs=require('fs'),p='.dbg/attendance-compliance-tabs.env';let u='http://192.168.1.176:7778/event',s='attendance-compliance-tabs';try{const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'A',location:'backend/src/server.js:enrichAttendanceRecordWithContext',msg:'[DEBUG] Attendance enriched',data:{employeeId,employeeName,date:String(source.date||''),checkIn,checkOut,lateMinutes,rawLateMinutes:String(source.lateMinutes||''),rawDeductionAmount:String(source.deductionAmount||''),deductionRate,deductionAmount,clockingsCount:Array.isArray(clockings)?clockings.length:0,clockingPhotos:Array.isArray(clockings)?clockings.filter((c)=>Boolean(String(c?.photoDataUrl||'').trim())).length:0,fallbackClockingsUsed:!(Array.isArray(source?.clockings)&&source.clockings.length>0),shift:shiftConfig?.name||shiftName,status},ts:Date.now()})}).catch(()=>{})})();
  // #endregion
  return {
    ...source,
    shift: shiftConfig?.name || shiftName,
    checkIn,
    checkOut,
    workedHours: checkIn && checkOut ? formatWorkedDuration(checkIn, checkOut) : String(source.workedHours || ''),
    lateMinutes: String(lateMinutes),
    status,
    clockings,
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
  // #region debug-point A:attendance-enrich
  fetch("http://192.168.1.176:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"attendance-photo-clock",runId:"pre-fix",hypothesisId:"A",location:"backend/src/server.js:enrichAttendanceRecord",msg:"[DEBUG] enrich attendance payload",data:{tenantId:options.tenantId||"master",employeeId,employeeName,date:String(payloadSource.date||"").trim(),incomingClockings:Array.isArray(payloadSource.clockings)?payloadSource.clockings.length:0,incomingPhotos:Array.isArray(payloadSource.clockings)?payloadSource.clockings.filter((clocking)=>Boolean(String(clocking?.photoDataUrl||"").trim())).length:0,requireWebClockInPhoto:Boolean(settingsRecord?.value?.requireWebClockInPhoto)},ts:Date.now()})}).catch(()=>{});
  // #endregion
  return enrichAttendanceRecordWithContext(source, {
    settings: normalizeAttendanceSettings(settingsRecord?.value),
    employeeById: new Map(employee?.id ? [[String(employee.id), employee]] : []),
    employeeByEmployeeId: new Map(employee?.employeeId ? [[String(employee.employeeId), employee]] : []),
    employeeByName: new Map(employee?.fullName ? [[String(employee.fullName), employee]] : []),
  });
}

let mongoClient;
const tenantDbCache = new Map();

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
    // #region debug-point B:dashboard-route-entry
    (() => {
      try {
        const payload = JSON.stringify({
          sessionId: 'dashboard-summary-load',
          runId: 'post-fix',
          hypothesisId: 'B',
          location: 'backend/src/server.js:2079',
          msg: '[DEBUG] Dashboard summary route entered',
          data: {
            tenantId: String(req.tenantId || ''),
            role: normalizedRole,
            selectedDate: String(req.query?.date || ''),
            hasDashboardModule: allowedModules.includes('dashboard'),
            employeeId: String(authUser?.employeeId || ''),
          },
          ts: Date.now(),
        });
        fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(() => {});
      } catch (_) {}
    })();
    // #endregion
    if (!allowedModules.includes('dashboard')) {
      res.status(403).json({ error: 'Forbidden: dashboard not enabled for this tenant/user' });
      return;
    }

    const selectedDate = normalizeIsoDateInput(req.query?.date);
    const monthStartDate = getMonthStartIsoDate(selectedDate);
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
          req.db.collection('attendanceTime').find({ ...employeeMatchQuery, date: selectedDate }).toArray(),
          req.db
            .collection('attendanceTime')
            .find({ ...employeeMatchQuery, date: { $gte: monthStartDate, $lte: selectedDate } })
            .toArray(),
          req.db.collection('loanRecords').find(employeeMatchQuery).toArray(),
          req.db.collection('leaveRequests').find(employeeMatchQuery).toArray(),
          req.db
            .collection('payrollRecords')
            .find(employeeMatchQuery)
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
      // #region debug-point D:dashboard-employee-success
      (() => {
        try {
          const payload = JSON.stringify({
            sessionId: 'dashboard-summary-load',
            runId: 'post-fix',
            hypothesisId: 'D',
            location: 'backend/src/server.js:2167',
            msg: '[DEBUG] Dashboard summary employee payload ready',
            data: {
              employeeFound: Boolean(employeeRecord),
              attendanceRows: dayAttendanceRows.length,
              monthAttendanceRows: monthAttendanceRows.length,
              loanRows: employeeLoanRows.length,
              leaveRows: employeeLeaveRows.length,
              hasLatestPayroll: Boolean(latestPayrollRow),
            },
            ts: Date.now(),
          });
          fetch('http://127.0.0.1:7777/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          }).catch(() => {});
        } catch (_) {}
      })();
      // #endregion

      res.json({
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
      });
      return;
    }

    const [employeeRows, dayAttendanceRows, monthAttendanceRows, loanRows, leaveRows] = await Promise.all([
      req.db.collection('employees').find({}).toArray(),
      req.db.collection('attendanceTime').find({ date: selectedDate }).toArray(),
      req.db.collection('attendanceTime').find({ date: { $gte: monthStartDate, $lte: selectedDate } }).toArray(),
      req.db.collection('loanRecords').find({}).toArray(),
      req.db.collection('leaveRequests').find({}).toArray(),
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
    // #region debug-point D:dashboard-admin-success
    (() => {
      try {
        const payload = JSON.stringify({
          sessionId: 'dashboard-summary-load',
          runId: 'post-fix',
          hypothesisId: 'D',
          location: 'backend/src/server.js:2261',
          msg: '[DEBUG] Dashboard summary admin payload ready',
          data: {
            employees: employeeRows.length,
            attendanceRows: dayAttendanceRows.length,
            monthAttendanceRows: monthAttendanceRows.length,
            loanRows: loanRows.length,
            leaveRows: leaveRows.length,
            activeEmployees: activeEmployees.length,
          },
          ts: Date.now(),
        });
        fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(() => {});
      } catch (_) {}
    })();
    // #endregion

    res.json({
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
    });
  } catch (error) {
    // #region debug-point B:dashboard-route-error
    (() => {
      try {
        const payload = JSON.stringify({
          sessionId: 'dashboard-summary-load',
          runId: 'post-fix',
          hypothesisId: 'B',
          location: 'backend/src/server.js:2302',
          msg: '[DEBUG] Dashboard summary route failed',
          data: {
            message: String(error?.message || ''),
            stack: String(error?.stack || '').split('\n').slice(0, 6).join('\n'),
          },
          ts: Date.now(),
        });
        fetch('http://127.0.0.1:7777/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(() => {});
      } catch (_) {}
    })();
    // #endregion
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
    if (String(user.role || '').toLowerCase() === 'superadmin' && req.tenantId === 'master') {
      req.authUser = user;
      next();
      return;
    }
    const allowedModules = resolveUserAllowedModulesForTenant({ user, tenant: req.tenant, tenantId: req.tenantId, defaultEmployeeModules });
    if (!allowedModules.includes(moduleId)) {
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
    const records = await collection.find({}).sort({ _id: -1 }).limit(500).toArray();
    if (moduleId !== 'attendance-time') {
      if (moduleId === 'employee-management') {
        const users = await req.db.collection('users').find({ employeeId: { $ne: '' } }).toArray();
        const userByEmployeeId = new Map(
          users.map((user) => [String(user.employeeId || '').trim(), user]).filter(([employeeId]) => employeeId)
        );
        res.json({
          records: await Promise.all(
            records.map((record) =>
              hydrateModuleRecordMedia(
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
        });
        return;
      }
      res.json({
        records: await Promise.all(records.map((record) => hydrateModuleRecordMedia(moduleId, record))),
      });
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
    // #region debug-point C:attendance-get
    fetch("http://192.168.1.176:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"attendance-photo-clock",runId:"pre-fix",hypothesisId:"C",location:"backend/src/server.js:/api/modules/:moduleId GET attendance-time",msg:"[DEBUG] attendance records loaded",data:{rawCount:records.length,mergedCount:normalizedRecords.length,sample:normalizedRecords.slice(0,8).map((row)=>({id:String(row?.id||""),employeeId:String(row?.employeeId||""),employee:String(row?.employee||""),date:String(row?.date||""),checkIn:String(row?.checkIn||""),checkOut:String(row?.checkOut||""),clockings:Array.isArray(row?.clockings)?row.clockings.length:0}))},ts:Date.now()})}).catch(()=>{});
    // #endregion
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
      // #region debug-point B:attendance-post
      fetch("http://192.168.1.176:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"attendance-photo-clock",runId:"pre-fix",hypothesisId:"B",location:"backend/src/server.js:/api/modules/:moduleId POST attendance-time",msg:"[DEBUG] attendance post candidate",data:{employeeId,employeeName,date,hasExistingAttendance:Boolean(existingAttendance),payloadClockings:Array.isArray(payload.clockings)?payload.clockings.length:0,payloadPhotos:Array.isArray(payload.clockings)?payload.clockings.filter((clocking)=>Boolean(String(clocking?.photoDataUrl||"").trim())).length:0,payloadCheckIn:String(payload.checkIn||""),payloadCheckOut:String(payload.checkOut||"")},ts:Date.now()})}).catch(()=>{});
      // #endregion
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
    // #region debug-point B:attendance-put
    if (moduleId === 'attendance-time') { fetch("http://192.168.1.176:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"attendance-photo-clock",runId:"pre-fix",hypothesisId:"B",location:"backend/src/server.js:/api/modules/:moduleId/:recordId PUT attendance-time",msg:"[DEBUG] attendance put update",data:{recordId,employeeId:String(update.employeeId||""),employee:String(update.employee||""),date:String(update.date||""),clockings:Array.isArray(update.clockings)?update.clockings.length:0,photos:Array.isArray(update.clockings)?update.clockings.filter((clocking)=>Boolean(String(clocking?.photoDataUrl||"").trim())).length:0,checkIn:String(update.checkIn||""),checkOut:String(update.checkOut||"")},ts:Date.now()})}).catch(()=>{}); }
    // #endregion
    if (moduleId === 'attendance-time') {
      await validateAttendancePhotoRequirement(req.db, update, existingRecord);
    }
    const result = await collection.updateOne({ id: recordId }, { $set: update });
    const updated = await collection.findOne({ id: recordId });
    if (moduleId === 'employee-management') {
      await syncEmployeeUser(req.db, updated);
    }
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
