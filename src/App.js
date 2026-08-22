import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { moduleUiData, sidebarSections } from './config/moduleUiData';
import { toApiUrl } from './config/api';
import { clearAuth, getStoredAuth, storeAuth } from './auth';
import FingerprintPage from './pages/FingerprintPage';
import AttendanceTimePage from './pages/AttendanceTimePage';
import LeaveManagementPage from './pages/LeaveManagementPage';
import LoanRecordsPage from './pages/LoanRecordsPage';
import LoanManagementPage from './pages/LoanManagementPage';
import AdminTrackingPage from './pages/AdminTrackingPage';
import UserManagementPage from './pages/UserManagementPage';
import TenantManagementPage from './pages/TenantManagementPage';
import ManualPage from './pages/ManualPage';
import SubscriptionExtendModal from './components/SubscriptionExtendModal';
import { filterEmployeesBySearch, findExactEmployeeBySearch, resolveEmployeeKey } from './utils/employeeSearch';
import SidebarNav from './app/SidebarNav';
import LeaveApprovalPanel from './modules/leave/LeaveApprovalPanel';
import LoanApprovalPanel from './modules/loan/LoanApprovalPanel';
import { toNumberValue } from './utils/number';
import { useModuleAdapter } from './modules/adapters/useModuleAdapter';
import { getModuleEnhancers } from './modules/adapters/moduleEnhancers';
import { getEmployeePayrollProfile } from './utils/payrollProfile';

const getDepartmentPrefix = (department, availableDepartments) => {
  const normalizedDepartment = String(department || '').trim().toLowerCase();
  const matchedDepartment = availableDepartments.find(
    (item) => String(item.name || '').trim().toLowerCase() === normalizedDepartment
  );
  if (matchedDepartment?.code) {
    return String(matchedDepartment.code).trim().toUpperCase().slice(0, 2);
  }
  const words = normalizedDepartment.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
  }
  const fallback = normalizedDepartment.replace(/[^a-z]/g, '').slice(0, 2).toUpperCase();
  return fallback.padEnd(2, 'X');
};

const PHONE_FIELD_KEYS = new Set([
  'phonePrimary',
  'phoneSecondary',
  'emergencyContact1Phone',
  'emergencyContact2Phone',
  'referee1Phone',
  'referee2Phone',
  'phone',
  'contactNumber',
  'mobileNumber',
  'personalPhone',
]);

const keepDigitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Unable to read ${String(file?.name || 'file')}`));
    reader.readAsDataURL(file);
  });

const readFileForStorage = async (file) => {
  if (!file?.type?.startsWith('image/')) {
    return readFileAsDataUrl(file);
  }
  const sourceDataUrl = await readFileAsDataUrl(file);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxEdge = 1400;
      const scale = Math.min(1, maxEdge / Math.max(image.width || 1, image.height || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((image.width || 1) * scale));
      canvas.height = Math.max(1, Math.round((image.height || 1) * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(sourceDataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => resolve(sourceDataUrl);
    image.src = sourceDataUrl;
  });
};

const shouldDisplayField = (field, currentValues) => {
  if (!field.showWhen) {
    return true;
  }
  return String(currentValues[field.showWhen.field] || '') === String(field.showWhen.value);
};

const googleMapsTileKey = (process.env.REACT_APP_GOOGLE_MAPS_TILE_KEY || '').trim();
const googleTileBaseUrl = googleMapsTileKey
  ? `https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${encodeURIComponent(googleMapsTileKey)}`
  : 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';


const DAY_IN_MS = 24 * 60 * 60 * 1000;

const getContractCountdown = (contractEndDate) => {
  if (!contractEndDate) {
    return null;
  }
  const today = new Date();
  const endDate = new Date(`${contractEndDate}T00:00:00`);
  if (Number.isNaN(endDate.getTime())) {
    return null;
  }
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysLeft = Math.ceil((endDate.getTime() - todayStart.getTime()) / DAY_IN_MS);
  if (daysLeft < 0) {
    const elapsed = Math.abs(daysLeft);
    return {
      type: 'expired',
      shortLabel: `Expired ${elapsed}d ago`,
      detailLabel: `Contract expired ${elapsed} day${elapsed === 1 ? '' : 's'} ago`,
    };
  }
  if (daysLeft <= 30) {
    return {
      type: 'warning',
      shortLabel: `${daysLeft}d left`,
      detailLabel: `Contract ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    };
  }
  return null;
};

const getContractDaysLeft = (contractEndDate) => {
  if (!contractEndDate) {
    return Number.POSITIVE_INFINITY;
  }
  const endDate = new Date(`${contractEndDate}T00:00:00`);
  if (Number.isNaN(endDate.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((endDate.getTime() - todayStart.getTime()) / DAY_IN_MS);
};

const formatSubscriptionStatusLabel = (subscriptionDaysRemaining, subscriptionExpiresAt) => {
  const expiryLabel = subscriptionExpiresAt ? String(subscriptionExpiresAt).slice(0, 10) : '';
  if (typeof subscriptionDaysRemaining !== 'number') {
    return 'Checking subscription...';
  }
  if (subscriptionDaysRemaining <= 0) {
    return expiryLabel ? `Expired on ${expiryLabel}` : 'Expired';
  }
  return expiryLabel ? `${subscriptionDaysRemaining} day(s) left • ${expiryLabel}` : `${subscriptionDaysRemaining} day(s) left`;
};

const toMinutesFromClock = (value) => {
  const [hourPart = '', minutePart = ''] = String(value || '').split(':');
  const hours = Number(hourPart);
  const minutes = Number(minutePart);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
};

const getMinutesBetweenClocks = (startClock, endClock) => {
  const startMinutes = toMinutesFromClock(startClock);
  const endMinutes = toMinutesFromClock(endClock);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return 0;
  }
  return endMinutes - startMinutes;
};

const getCurrentClockValue = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const getTodayIsoDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getAllowedModuleSetForUser = (user) => {
  if (!user) {
    return new Set();
  }
  const normalizedRole = String(user.role || '').toLowerCase();
  const isMasterSuperAdmin = normalizedRole === 'superadmin' && String(user.tenantId || '').toLowerCase() === 'master';
  if (isMasterSuperAdmin) {
    return new Set(sidebarSections.flatMap((section) => section.items.map((item) => item.id)));
  }
  const isAdminRole = normalizedRole === 'admin' || normalizedRole === 'tenant-admin' || normalizedRole === 'superadmin';
  const adminBaseline = [
    'employee-management',
    'attendance-time',
    'loan-records',
    'fingerprint',
    'leave-management',
    'payroll-management',
    'documents-records',
    'reports-analytics',
    'monitoring-tracking',
    'user-management',
    'settings',
    'manual',
    'auth-roles',
    'recruitment',
    'performance',
    'training',
  ];
  if (isAdminRole) {
    const merged = new Set(adminBaseline);
    if (Array.isArray(user.allowedModules) && user.allowedModules.length > 0) {
      user.allowedModules.forEach((moduleId) => {
        if (moduleId !== 'tenant-management') {
          merged.add(String(moduleId));
        }
      });
    }
    return merged;
  }
  if (Array.isArray(user.allowedModules) && user.allowedModules.length > 0) {
    return new Set(user.allowedModules.filter((moduleId) => moduleId !== 'tenant-management'));
  }
  if (normalizedRole === 'employee') {
    return new Set(['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual']);
  }
  return new Set(['employee-management', 'attendance-time', 'leave-management', 'manual']);
};

const getLatestAllowedEmployeeDob = () => `${new Date().getFullYear() - 11}-12-31`;

const formatWorkedDuration = (startTime, endTime) => {
  const startMinutes = toMinutesFromClock(startTime);
  const endMinutes = toMinutesFromClock(endTime);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return '';
  }
  const totalMinutes = endMinutes - startMinutes;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const formatCardDate = (value) => {
  if (!value) {
    return 'N/A';
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const parseIsoDateValue = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toIsoDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isLeaveRejectedRecord = (row) => {
  const departmentApproval = String(row?.departmentApproval || row?.supervisorApproval || '').trim().toLowerCase();
  const hrApproval = String(row?.hrApproval || '').trim().toLowerCase();
  const managerApproval = String(row?.managerApproval || row?.finalManagerApproval || row?.branchManagerApproval || '').trim().toLowerCase();
  const status = String(row?.status || '').trim().toLowerCase();
  return departmentApproval === 'rejected' || hrApproval === 'rejected' || managerApproval === 'rejected' || status === 'rejected';
};

const isLeaveFullyApprovedRecord = (row) => {
  if (!row || isLeaveRejectedRecord(row)) {
    return false;
  }
  const departmentApproval = String(row?.departmentApproval || row?.supervisorApproval || '').trim().toLowerCase();
  const hrApproval = String(row?.hrApproval || '').trim().toLowerCase();
  const managerApproval = String(row?.managerApproval || row?.finalManagerApproval || row?.branchManagerApproval || '').trim().toLowerCase();
  return departmentApproval === 'approved' && hrApproval === 'approved' && managerApproval === 'approved';
};

const isLoanCountableRecord = (row) => {
  const status = String(row?.status || '').trim().toLowerCase();
  return status === 'active' || status === 'approved';
};

const overlapDaysInclusive = (startA, endA, startB, endB) => {
  const start = parseIsoDateValue(startA);
  const end = parseIsoDateValue(endA);
  const rangeStart = parseIsoDateValue(startB);
  const rangeEnd = parseIsoDateValue(endB);
  if (!start || !end || !rangeStart || !rangeEnd) {
    return 0;
  }
  const overlapStart = Math.max(start.getTime(), rangeStart.getTime());
  const overlapEnd = Math.min(end.getTime(), rangeEnd.getTime());
  if (overlapEnd < overlapStart) {
    return 0;
  }
  return Math.floor((overlapEnd - overlapStart) / DAY_IN_MS) + 1;
};

const getInclusiveDaysBetween = (startDateValue, endDateValue) => {
  const start = parseIsoDateValue(startDateValue);
  const end = parseIsoDateValue(endDateValue);
  if (!start || !end) {
    return 0;
  }
  const startTime = Math.min(start.getTime(), end.getTime());
  const endTime = Math.max(start.getTime(), end.getTime());
  return Math.floor((endTime - startTime) / DAY_IN_MS) + 1;
};

const fitText = (ctx, value, maxWidth) => {
  const text = String(value || '');
  if (!text) {
    return '—';
  }
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
};

const normalizeHexColor = (value, fallback = '#0a73d9') => {
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
};

const blendHexToBlack = (hex, blackRatio) => {
  const normalized = normalizeHexColor(hex);
  const ratio = Math.max(0, Math.min(1, Number(blackRatio) || 0));
  const toChannel = (index) => {
    const original = parseInt(normalized.slice(index, index + 2), 16);
    const blended = Math.round(original * (1 - ratio));
    return blended.toString(16).padStart(2, '0');
  };
  return `#${toChannel(1)}${toChannel(3)}${toChannel(5)}`;
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

const GENERAL_SETTINGS_TABS = new Set([
  'general',
  'payroll',
  'fingerprint',
  'labels',
  'currency',
  'departments',
  'employment',
  'id-card',
]);

const loadImageFromUrl = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = url;
  });

const getIdCardDimensions = (orientation) =>
  orientation === 'portrait'
    ? { width: 540, height: 860 }
    : { width: 860, height: 540 };

const drawRoundedRectPath = (ctx, x, y, width, height, radius) => {
  const normalizedRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + normalizedRadius, y);
  ctx.lineTo(x + width - normalizedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + normalizedRadius);
  ctx.lineTo(x + width, y + height - normalizedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - normalizedRadius, y + height);
  ctx.lineTo(x + normalizedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - normalizedRadius);
  ctx.lineTo(x, y + normalizedRadius);
  ctx.quadraticCurveTo(x, y, x + normalizedRadius, y);
  ctx.closePath();
};

const CODE39_PATTERNS = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn',
};

const toCode39Content = (value) => {
  const normalized = String(value || '')
    .toUpperCase()
    .split('')
    .map((char) => (CODE39_PATTERNS[char] ? char : '-'))
    .join('');
  return `*${normalized || 'EMPLOYEE'}*`;
};

const drawCode39Barcode = (ctx, value, x, y, width, height, color = '#132d63') => {
  const content = toCode39Content(value);
  const tokens = [];
  for (let index = 0; index < content.length; index += 1) {
    const pattern = CODE39_PATTERNS[content[index]] || CODE39_PATTERNS['-'];
    for (let bit = 0; bit < pattern.length; bit += 1) {
      const wide = pattern[bit] === 'w';
      tokens.push({
        isBar: bit % 2 === 0,
        units: wide ? 2.8 : 1.2,
      });
    }
    if (index < content.length - 1) {
      tokens.push({ isBar: false, units: 1.2 });
    }
  }
  const totalUnits = tokens.reduce((acc, token) => acc + token.units, 0);
  if (totalUnits <= 0) {
    return;
  }
  const unitWidth = width / totalUnits;
  let cursor = x;
  ctx.fillStyle = color;
  tokens.forEach((token) => {
    const tokenWidth = token.units * unitWidth;
    if (token.isBar) {
      ctx.fillRect(cursor, y, Math.max(1, tokenWidth), height);
    }
    cursor += tokenWidth;
  });
};

const createBarcodeDataUrl = (value, width = 360, height = 56, color = '#132d63') => {
  if (typeof document === 'undefined') {
    return '';
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(String(navigator.userAgent || ''))) {
    return '';
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let ctx = null;
  try {
    ctx = canvas.getContext('2d');
  } catch (error) {
    return '';
  }
  if (!ctx) {
    return '';
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  drawCode39Barcode(ctx, value, 10, 6, width - 20, height - 16, color);
  ctx.fillStyle = color;
  ctx.font = '600 10px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(String(value || '').toUpperCase(), width / 2, height - 2);
  return canvas.toDataURL('image/png');
};

function App({ initialModuleId }) {
  const firstModuleId = sidebarSections[0].items[0].id;
  const storedAuth = typeof window !== 'undefined' ? getStoredAuth() : null;
  const [currentUser, setCurrentUser] = useState(storedAuth?.user || null);
  const [authToken, setAuthToken] = useState(storedAuth?.token || '');
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [isInstallPromptAvailable, setIsInstallPromptAvailable] = useState(false);
  const [isInstallHelpOpen, setIsInstallHelpOpen] = useState(false);
  const canEditApplicationName =
    String(currentUser?.role || '').toLowerCase() === 'superadmin' &&
    String(currentUser?.tenantId || '').toLowerCase() === 'master';
  const [activeModuleId, setActiveModuleId] = useState(
    initialModuleId || storedAuth?.lastModuleId || firstModuleId
  );
  const [searchText, setSearchText] = useState('');
  const [filterValue, setFilterValue] = useState('All');
  const [statusFilterValue, setStatusFilterValue] = useState('All');
  const [employmentStageFilterValue, setEmploymentStageFilterValue] = useState('All');
  const [expiryFilterValue, setExpiryFilterValue] = useState('All');
  const [sortByValue, setSortByValue] = useState('default');
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [editRowId, setEditRowId] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [formError, setFormError] = useState('');
  const [recordSaving, setRecordSaving] = useState(false);
  const [departmentNameInput, setDepartmentNameInput] = useState('');
  const [departmentCodeInput, setDepartmentCodeInput] = useState('');
  const [departmentEditingName, setDepartmentEditingName] = useState('');
  const [departmentError, setDepartmentError] = useState('');
  const [employmentStageInput, setEmploymentStageInput] = useState('');
  const [employmentStageEditingValue, setEmploymentStageEditingValue] = useState('');
  const [employmentStageError, setEmploymentStageError] = useState('');
  const [identifierPresetNameInput, setIdentifierPresetNameInput] = useState('');
  const [identifierPensionLabelInput, setIdentifierPensionLabelInput] = useState('');
  const [identifierTaxLabelInput, setIdentifierTaxLabelInput] = useState('');
  const [identifierLabelError, setIdentifierLabelError] = useState('');
  const [employeeDetailRecordTab, setEmployeeDetailRecordTab] = useState('leave');
  const [showEmployeePortalPassword, setShowEmployeePortalPassword] = useState(false);
  const [attendanceClockDraft, setAttendanceClockDraft] = useState({
    employeeId: '',
    shift: 'Morning',
  });
  const [attendanceSearchText, setAttendanceSearchText] = useState('');
  const [attendanceViewTab, setAttendanceViewTab] = useState('clock');
  const [attendanceAuditDate, setAttendanceAuditDate] = useState(getTodayIsoDate());
  const [attendanceAuditFilter, setAttendanceAuditFilter] = useState('All');
  const [attendanceAuditSearchText, setAttendanceAuditSearchText] = useState('');
  const [attendancePenaltyStatusFilter, setAttendancePenaltyStatusFilter] = useState('Outstanding');
  const [selectedPenaltyKey, setSelectedPenaltyKey] = useState('');
  const [selectedComplianceKey, setSelectedComplianceKey] = useState('');
  const [attendancePerformancePeriod, setAttendancePerformancePeriod] = useState('monthly');
  const [attendancePerformanceStartDate, setAttendancePerformanceStartDate] = useState(getTodayIsoDate());
  const [attendancePerformanceEndDate, setAttendancePerformanceEndDate] = useState(getTodayIsoDate());
  const [attendancePerformanceRankMetric, setAttendancePerformanceRankMetric] = useState('perfect-attendance');
  const [attendancePerformanceDepartmentFilter, setAttendancePerformanceDepartmentFilter] = useState('All');
  const [attendancePerformanceSearchText, setAttendancePerformanceSearchText] = useState('');
  const [selectedPerformanceEmployeeId, setSelectedPerformanceEmployeeId] = useState('');
  const [attendanceDetailModal, setAttendanceDetailModal] = useState({ type: '', key: '' });
  const [attendancePhotoPreview, setAttendancePhotoPreview] = useState({ open: false, src: '', title: '' });
  const [attendancePhotoPreviewZoom, setAttendancePhotoPreviewZoom] = useState(1);
  const [complianceReplayActive, setComplianceReplayActive] = useState(false);
  const [complianceReplayIndex, setComplianceReplayIndex] = useState(0);
  const [complianceReplaySpeed, setComplianceReplaySpeed] = useState(1);
  const [complianceShowPointLabels, setComplianceShowPointLabels] = useState(true);
  const complianceTrailMapElementRef = useRef(null);
  const complianceTrailMapRef = useRef(null);
  const complianceTrailMapLayerRef = useRef(null);
  const [leaveViewTab, setLeaveViewTab] = useState('requests');
  const [leaveRequestPageTab, setLeaveRequestPageTab] = useState('requests');
  const [leaveMenuExpanded, setLeaveMenuExpanded] = useState(false);
  const [leaveSearchText, setLeaveSearchText] = useState('');
  const [leaveDepartmentFilter, setLeaveDepartmentFilter] = useState('All');
  const [leaveStatusFilter, setLeaveStatusFilter] = useState('All');
  const [leaveSortBy, setLeaveSortBy] = useState('date-desc');
  const [leaveActionMessage, setLeaveActionMessage] = useState('');
  const [leaveApprovalDrafts, setLeaveApprovalDrafts] = useState({});
  const [leaveApprovalSavingId, setLeaveApprovalSavingId] = useState(null);
  const [loanViewTab, setLoanViewTab] = useState('requests');
  const [loanMenuExpanded, setLoanMenuExpanded] = useState(false);
  const [loanSearchText, setLoanSearchText] = useState('');
  const [loanStatusFilter, setLoanStatusFilter] = useState('All');
  const [loanActionMessage, setLoanActionMessage] = useState('');
  const [loanApprovalDrafts, setLoanApprovalDrafts] = useState({});
  const [loanApprovalSavingId, setLoanApprovalSavingId] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [loginForm, setLoginForm] = useState({
    tenantId: storedAuth?.tenantId || storedAuth?.user?.tenantId || '',
    username: '',
    password: '',
  });
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginNotice, setLoginNotice] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [subscriptionExtendModal, setSubscriptionExtendModal] = useState({
    open: false,
    tenantId: '',
    tenant: null,
  });
  const [penaltyActionDraft, setPenaltyActionDraft] = useState({
    mode: 'partial',
    amount: '',
    remark: '',
  });
  const [fingerprintDraft, setFingerprintDraft] = useState({
    employeeId: '',
    deviceUserId: '',
  });
  const [settingsTab, setSettingsTab] = useState('general');
  const [modalState, setModalState] = useState({ mode: null, rowId: null });
  const [currencyInput, setCurrencyInput] = useState('');
  const [trackingSettingsLoading, setTrackingSettingsLoading] = useState(false);
  const [trackingSettingsError, setTrackingSettingsError] = useState('');
  const [trackingSettingsSaving, setTrackingSettingsSaving] = useState(false);
  const [trackingSettingsSavedMessage, setTrackingSettingsSavedMessage] = useState('');
  const [mobileSettingsLoading, setMobileSettingsLoading] = useState(false);
  const [mobileSettingsError, setMobileSettingsError] = useState('');
  const [mobileSettingsSaving, setMobileSettingsSaving] = useState(false);
  const [mobileSettingsSavedMessage, setMobileSettingsSavedMessage] = useState('');
  const [attendanceSettingsLoading, setAttendanceSettingsLoading] = useState(false);
  const [attendanceSettingsError, setAttendanceSettingsError] = useState('');
  const [attendanceSettingsSaving, setAttendanceSettingsSaving] = useState(false);
  const [attendanceSettingsSavedMessage, setAttendanceSettingsSavedMessage] = useState('');
  const [generalSettingsLoading, setGeneralSettingsLoading] = useState(false);
  const [generalSettingsError, setGeneralSettingsError] = useState('');
  const [generalSettingsSaving, setGeneralSettingsSaving] = useState(false);
  const [generalSettingsSavedMessage, setGeneralSettingsSavedMessage] = useState('');
  const [appSettings, setAppSettings] = useState({
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
    attendanceLateAfter: '08:15',
    attendanceReportTime: '08:00',
    attendanceShiftEnd: '17:00',
    requireWebClockInPhoto: false,
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
      {
        id: 'SHIFT-EVENING',
        name: 'Evening',
        reportTime: '14:00',
        shiftEnd: '22:00',
        graceInMinutes: 10,
        graceOutMinutes: 0,
        overtimeEnabled: false,
        overtimeStartAfterMinutes: 0,
        overtimePayPerMinute: 0,
      },
    ],
    payrollWorkingDays: 26,
    attendanceCalculationMode: 'auto',
    attendanceFixedDeductionPerMinute: 0.128,
    attendanceFixedScope: 'all',
    attendanceFixedDepartment: '',
    attendanceFixedEmployeeId: '',
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
      companyAddress: '',
      companyPhone: '',
      companyEmail: '',
      companyWebsite: '',
    },
    fingerprintIntegration: {
      mode: 'simulation',
      gatewayUrl: '',
      apiVersion: 'v1',
      heartbeatSeconds: 30,
    },
    trackingRules: {
      officeLat: null,
      officeLng: null,
      geofenceRadiusMeters: 100,
      geofenceEnabled: true,
      wifiValidationEnabled: false,
      activityMonitoringEnabled: false,
      randomSelfieEnabled: false,
      antiGpsSpoofingEnabled: false,
      whatsappAlertsEnabled: false,
      officeWifiSsids: [],
      officeWifiBssids: [],
      officeIpRanges: [],
      offlineMinutesThreshold: 15,
      locationOffAlertEnabled: true,
    },
    mobileApp: {
      enabledModules: ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking'],
      allowClockIn: true,
      allowClockOut: true,
      requireClockInPhoto: false,
      requireLocationOnClock: true,
      autoSendLocationOnClock: true,
      autoStartTrackingOnClockIn: true,
      allowLoanView: true,
      allowLoanRequest: true,
      allowLeaveView: true,
      allowLeaveRequest: true,
      allowTrackingView: true,
    },
    departments: [
      { name: 'Human Resources', code: 'HR' },
      { name: 'Engineering', code: 'EN' },
      { name: 'Finance', code: 'FN' },
      { name: 'Operations', code: 'OP' },
    ],
  });
  const employeeModuleLoadingRef = useRef(false);
  const generalSettingsLoadedRef = useRef(false);
  const lastAttendanceShiftAutoEmployeeIdRef = useRef('');
  const [moduleRowsState, setModuleRowsState] = useState(() => ({
    'attendance-penalty-adjustments': [],
  }));
  const [backendHealth, setBackendHealth] = useState({
    status: 'unknown',
    mongo: 'unknown',
  });

  const isSettingsPage = activeModuleId === 'settings';
  const isManualPage = activeModuleId === 'manual';
  const activeModuleConfig = isSettingsPage ? null : moduleUiData[activeModuleId];
  const isGeneralSettingsTab = GENERAL_SETTINGS_TABS.has(settingsTab);

  const allowedModulesByRole = useMemo(() => getAllowedModuleSetForUser(currentUser), [currentUser]);
  const downloadAttendancePreviewPhoto = useCallback(() => {
    if (!attendancePhotoPreview.src) {
      return;
    }
    const link = document.createElement('a');
    link.href = attendancePhotoPreview.src;
    link.download = `${String(attendancePhotoPreview.title || 'clock-photo')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'clock-photo'}.jpg`;
    link.click();
  }, [attendancePhotoPreview.src, attendancePhotoPreview.title]);

  const mobileModuleOptions = useMemo(
    () =>
      sidebarSections
        .flatMap((section) => section.items)
        .filter((item) => allowedModulesByRole.has(item.id))
        .map((item) => ({ id: item.id, label: item.label })),
    [allowedModulesByRole]
  );

  const installHelpSteps = useMemo(() => {
    if (typeof window === 'undefined') {
      return ['Open the site in a supported browser and use its install option.'];
    }
    const userAgent = String(window.navigator.userAgent || '').toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(userAgent);
    const isSafari = /safari/.test(userAgent) && !/chrome|crios|android|edg/.test(userAgent);
    const isFirefox = /firefox/.test(userAgent);

    if (isIos) {
      return ['Tap Share in Safari.', 'Choose Add to Home Screen.', 'Tap Add to install PTHR on the device.'];
    }

    if (isSafari) {
      return ['Open the Share menu in Safari.', 'Choose Add to Dock.', 'Confirm to install PTHR as an app.'];
    }

    if (isFirefox) {
      return ['Open the browser menu.', 'Look for Install or Add to Home Screen.', 'Confirm the install for PTHR.'];
    }

    return [
      'Open the browser menu or address bar install icon.',
      'Choose Install App or Add to Home Screen.',
      'Confirm the install to add PTHR to the device.',
    ];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const response = await fetch(toApiUrl('http://localhost:8000/health'));
        if (!response.ok) {
          throw new Error('Health check failed');
        }
        const data = await response.json();
        if (cancelled) {
          return;
        }
        setBackendHealth({
          status: data.status || 'error',
          mongo: data.mongo || 'unavailable',
        });
      } catch (error) {
        if (!cancelled) {
          setBackendHealth({
            status: 'error',
            mongo: 'unavailable',
          });
        }
      }
    };
    checkHealth();
    const intervalId = setInterval(checkHealth, 60000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const openSubscriptionExtendModal = useCallback((tenantId, tenant = null) => {
    const normalizedTenantId = String(tenantId || tenant?.tenantId || '').trim().toLowerCase();
    if (!normalizedTenantId) {
      return;
    }
    setSubscriptionExtendModal({
      open: true,
      tenantId: normalizedTenantId,
      tenant,
    });
  }, []);

  const closeSubscriptionExtendModal = useCallback(() => {
    setSubscriptionExtendModal((prev) => ({
      ...prev,
      open: false,
    }));
  }, []);

  const handleSubscriptionUpdated = useCallback(
    (tenantSummary) => {
      const normalizedTenantId = String(tenantSummary?.tenantId || '').trim().toLowerCase();
      if (normalizedTenantId) {
        setLoginForm((prev) => ({
          ...prev,
          tenantId: normalizedTenantId,
        }));
      }
      if (tenantSummary?.subscriptionDaysRemaining !== undefined) {
        setLoginNotice(
          `Subscription updated for ${tenantSummary?.tenantName || normalizedTenantId}. ${formatSubscriptionStatusLabel(
            tenantSummary?.subscriptionDaysRemaining,
            tenantSummary?.subscriptionExpiresAt
          )}.`
        );
      }
      setLoginError('');
      if (currentUser && normalizedTenantId && normalizedTenantId === String(currentUser.tenantId || '').trim().toLowerCase()) {
        setCurrentUser((prev) =>
          prev
            ? {
                ...prev,
                subscriptionDaysRemaining: tenantSummary?.subscriptionDaysRemaining ?? prev.subscriptionDaysRemaining,
                subscriptionExpiresAt: tenantSummary?.subscriptionExpiresAt || prev.subscriptionExpiresAt,
              }
            : prev
        );
      }
    },
    [currentUser]
  );

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setLoginError('');
    setLoginNotice('');
    setLoginLoading(true);
    try {
      const response = await fetch(toApiUrl('http://localhost:8000/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId: loginForm.tenantId.trim().toLowerCase(),
          username: loginForm.username.trim(),
          password: loginForm.password,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (data?.subscriptionExpired && data?.tenant) {
          setLoginError(
            `Subscription expired for ${data.tenant.tenantName || data.tenant.tenantId}. This tenant cannot sign in until payment is completed or a valid 12-character activation code is entered.`
          );
          setLoginNotice('');
        } else if (response.status === 401 || response.status === 400) {
          setLoginError(data?.error || 'Invalid tenant ID, username, or password');
        } else {
          setLoginError(data?.error || 'Login failed');
        }
        if (data?.subscriptionExpired && data?.tenant) {
          setSubscriptionExtendModal({
            open: false,
            tenantId: String(data.tenant.tenantId || loginForm.tenantId || '').trim().toLowerCase(),
            tenant: data.tenant,
          });
          setLoginForm((prev) => ({
            ...prev,
            tenantId: String(data.tenant.tenantId || prev.tenantId || '').trim().toLowerCase(),
          }));
        }
        return;
      }
      const data = await response.json();
      if (!data || !data.token || !data.user) {
        setLoginError('Unexpected login response');
        return;
      }
      setCurrentUser(data.user);
      setAuthToken(data.token);
      const payload = {
        token: data.token,
        user: data.user,
        tenantId: data.user.tenantId || loginForm.tenantId.trim().toLowerCase(),
        lastModuleId: activeModuleId,
      };
      storeAuth(payload);
      setLoginForm((prev) => ({ ...prev, username: '', password: '' }));
      setShowLoginPassword(false);
      setLoginNotice('');
      setSubscriptionExtendModal({ open: false, tenantId: '', tenant: null });
      const nextAllowedModules = getAllowedModuleSetForUser(data.user);
      const firstAllowed = sidebarSections
        .flatMap((section) => section.items)
        .find((item) => nextAllowedModules.has(item.id));
      if (firstAllowed) {
        setActiveModuleId(firstAllowed.id);
      }
    } catch (error) {
      setLoginError('Unable to reach server');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    fetch(toApiUrl('http://localhost:8000/api/auth/logout'), {
      method: 'POST',
      headers: authToken
        ? {
            Authorization: `Bearer ${authToken}`,
          }
        : undefined,
    }).catch(() => null);
    setCurrentUser(null);
    setAuthToken('');
    clearAuth();
  };

  const handleInstallApp = useCallback(async () => {
    if (!deferredInstallPrompt) {
      return;
    }
    try {
      await deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      if (result?.outcome === 'accepted') {
        setIsInstallPromptAvailable(false);
      }
    } catch (error) {
    } finally {
      setDeferredInstallPrompt(null);
    }
  }, [deferredInstallPrompt]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const installed =
      window.matchMedia('(display-mode: standalone)').matches || Boolean(window.navigator.standalone);
    if (installed) {
      setIsAppInstalled(true);
      setIsInstallPromptAvailable(false);
    }

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event);
      setIsInstallPromptAvailable(true);
    };

    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setDeferredInstallPrompt(null);
      setIsInstallPromptAvailable(false);
      setIsInstallHelpOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const requestTenantId = String(currentUser?.tenantId || storedAuth?.tenantId || '').trim().toLowerCase();

  const authHeaders = useMemo(() => {
    if (!authToken) {
      return {};
    }
    return {
      Authorization: `Bearer ${authToken}`,
      ...(requestTenantId ? { 'X-Tenant-Id': requestTenantId } : {}),
    };
  }, [authToken, requestTenantId]);

  const jsonAuthHeaders = useMemo(() => {
    if (!authToken) {
      return { 'Content-Type': 'application/json' };
    }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(requestTenantId ? { 'X-Tenant-Id': requestTenantId } : {}),
    };
  }, [authToken, requestTenantId]);

  const buildGeneralSettingsPayload = useCallback((source) => {
    const next = source || {};
    return {
      appName: String(next.appName || '').trim() || 'PTHR',
      sidebarColor: normalizeHexColor(next.sidebarColor, '#0a73d9'),
      defaultCurrency: String(next.defaultCurrency || '').trim().toUpperCase() || 'USD',
      penaltyActorUsername: String(next.penaltyActorUsername || '').trim() || 'admin',
      currencies: Array.isArray(next.currencies) ? next.currencies : [],
      identifierPresets: Array.isArray(next.identifierPresets) ? next.identifierPresets : defaultIdentifierPresets,
      identifierCountry: String(next.identifierCountry || '').trim().toLowerCase(),
      pensionFieldLabel: String(next.pensionFieldLabel || '').trim(),
      taxFieldLabel: String(next.taxFieldLabel || '').trim(),
      employmentStages: Array.isArray(next.employmentStages) ? next.employmentStages : [],
      statutoryRules: {
        ...(next.statutoryRules || {}),
      },
      loanRules: {
        ...(next.loanRules || {}),
      },
      idCardDesign: {
        ...(next.idCardDesign || {}),
      },
      fingerprintIntegration: {
        ...(next.fingerprintIntegration || {}),
      },
      departments: Array.isArray(next.departments) ? next.departments : [],
    };
  }, []);

  const mergeGeneralSettingsIntoAppSettings = useCallback((prev, incoming) => {
    const next = incoming || {};
    return {
      ...prev,
      ...next,
      statutoryRules: {
        ...prev.statutoryRules,
        ...(next.statutoryRules || {}),
      },
      loanRules: {
        ...prev.loanRules,
        ...(next.loanRules || {}),
      },
      idCardDesign: {
        ...prev.idCardDesign,
        ...(next.idCardDesign || {}),
      },
      fingerprintIntegration: {
        ...prev.fingerprintIntegration,
        ...(next.fingerprintIntegration || {}),
      },
    };
  }, []);

  const saveGeneralSettings = useCallback(
    async (nextSettings, options = {}) => {
      const { silent = false, successMessage = 'General settings saved to backend' } = options;
      try {
        setGeneralSettingsSaving(true);
        setGeneralSettingsError('');
        if (!silent) {
          setGeneralSettingsSavedMessage('');
        }
        const payload = buildGeneralSettingsPayload(nextSettings || appSettings);
        const response = await fetch(toApiUrl('http://localhost:8000/api/settings/general'), {
          method: 'POST',
          headers: jsonAuthHeaders,
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error('Failed to save general settings');
        }
        const data = await response.json();
        if (data?.settings) {
          setAppSettings((prev) => mergeGeneralSettingsIntoAppSettings(prev, data.settings));
        }
        setGeneralSettingsSavedMessage(successMessage);
        return true;
      } catch (error) {
        setGeneralSettingsError('Unable to save general settings to backend');
        return false;
      } finally {
        setGeneralSettingsSaving(false);
      }
    },
    [appSettings, buildGeneralSettingsPayload, jsonAuthHeaders, mergeGeneralSettingsIntoAppSettings]
  );

  useEffect(() => {
    if (!authToken) {
      return undefined;
    }
    let cancelled = false;
    const fetchGeneralSettings = async () => {
      try {
        setGeneralSettingsLoading(true);
        const response = await fetch(toApiUrl('http://localhost:8000/api/settings/general'), {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error('Failed to load general settings');
        }
        const data = await response.json();
        if (!cancelled && data) {
          setAppSettings((prev) => mergeGeneralSettingsIntoAppSettings(prev, data));
          setGeneralSettingsError('');
        }
      } catch (error) {
        if (!cancelled) {
          setGeneralSettingsError('Unable to load general settings from backend');
        }
      } finally {
        if (!cancelled) {
          setGeneralSettingsLoading(false);
          generalSettingsLoadedRef.current = true;
        }
      }
    };

    fetchGeneralSettings();
    return () => {
      cancelled = true;
    };
  }, [authHeaders, authToken, mergeGeneralSettingsIntoAppSettings]);

  useEffect(() => {
    if (!authToken) {
      return;
    }
    let cancelled = false;
    const validateSession = async () => {
      try {
        const response = await fetch(toApiUrl('http://localhost:8000/api/auth/me'), {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          if ((response.status === 401 || response.status === 403) && !cancelled) {
            if (data?.subscriptionExpired && data?.tenant) {
              setLoginError(
                `Subscription expired for ${data.tenant.tenantName || data.tenant.tenantId}. This tenant cannot sign in until payment is completed or a valid 12-character activation code is entered.`
              );
              setLoginNotice('');
              setSubscriptionExtendModal({
                open: false,
                tenantId: String(data.tenant.tenantId || '').trim().toLowerCase(),
                tenant: data.tenant,
              });
              setLoginForm((prev) => ({
                ...prev,
                tenantId: String(data.tenant.tenantId || prev.tenantId || '').trim().toLowerCase(),
              }));
            }
            setCurrentUser(null);
            setAuthToken('');
            clearAuth();
          }
          return;
        }
        const data = await response.json();
        if (!cancelled && data?.user) {
          setCurrentUser(data.user);
          storeAuth({
            token: authToken,
            user: data.user,
            tenantId: data.user.tenantId || '',
            lastModuleId: activeModuleId,
          });
        }
      } catch (error) {
      }
    };
    validateSession();
    const intervalId = window.setInterval(validateSession, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeModuleId, authToken]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const searchParams = new URLSearchParams(window.location.search);
    const paystackReference = String(searchParams.get('paystackReference') || '').trim();
    const tenantIdFromUrl = String(searchParams.get('tenantId') || '').trim().toLowerCase();
    if (!paystackReference || !tenantIdFromUrl) {
      return;
    }
    let cancelled = false;
    const verifyPayment = async () => {
      try {
        const response = await fetch(
          toApiUrl(
            `http://localhost:8000/api/auth/subscription/paystack/verify?reference=${encodeURIComponent(
              paystackReference
            )}`
          )
        );
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || 'Unable to verify subscription payment');
        }
        if (!cancelled && data?.tenant) {
          handleSubscriptionUpdated(data.tenant);
          setSubscriptionExtendModal({
            open: false,
            tenantId: tenantIdFromUrl,
            tenant: data.tenant,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLoginError(error instanceof Error ? error.message : 'Unable to verify subscription payment');
        }
      } finally {
        if (!cancelled) {
          searchParams.delete('paystackReference');
          searchParams.delete('tenantId');
          const nextSearch = searchParams.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`);
        }
      }
    };
    verifyPayment();
    return () => {
      cancelled = true;
    };
  }, [handleSubscriptionUpdated]);

  useEffect(() => {
    const tenantId = String(currentUser?.tenantId || '').trim().toLowerCase();
    if (!tenantId || tenantId === 'master') {
      return undefined;
    }
    let cancelled = false;
    const refreshSubscriptionStatus = async () => {
      try {
        const response = await fetch(
          toApiUrl(`http://localhost:8000/api/auth/subscription/public-status?tenantId=${encodeURIComponent(tenantId)}`)
        );
        if (!response.ok) {
          return;
        }
        const data = await response.json().catch(() => null);
        if (!cancelled && data?.tenant) {
          setCurrentUser((prev) =>
            prev
              ? {
                  ...prev,
                  subscriptionDaysRemaining: data.tenant.subscriptionDaysRemaining,
                  subscriptionExpiresAt: data.tenant.subscriptionExpiresAt,
                  packageType: data.tenant.packageType || prev.packageType,
                  tenantName: data.tenant.tenantName || prev.tenantName,
                }
              : prev
          );
        }
      } catch (error) {
      }
    };
    refreshSubscriptionStatus();
    const intervalId = window.setInterval(refreshSubscriptionStatus, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentUser?.tenantId]);

  useEffect(() => {
    if (
      !currentUser ||
      !authToken ||
      !activeModuleId ||
      isSettingsPage ||
      activeModuleId === 'monitoring-tracking' ||
      activeModuleId === 'user-management' ||
      activeModuleId === 'tenant-management'
    ) {
      return;
    }
    let cancelled = false;
    const loadModuleRows = async () => {
      try {
        const response = await fetch(toApiUrl(`http://localhost:8000/api/modules/${activeModuleId}`), {
          headers: authHeaders,
        });
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (cancelled) {
          return;
        }
        const records = Array.isArray(data.records) ? data.records : [];
        // #region debug-point D:attendance-fetch
        if (activeModuleId === 'attendance-time') { fetch("http://192.168.1.176:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"attendance-photo-clock",runId:"pre-fix",hypothesisId:"D",location:"frontend/src/App.js:loadModuleRows",msg:"[DEBUG] attendance records fetched",data:{recordCount:records.length,sample:records.slice(0,8).map((row)=>({id:String(row?.id||""),employeeId:String(row?.employeeId||""),employee:String(row?.employee||""),date:String(row?.date||""),checkIn:String(row?.checkIn||""),checkOut:String(row?.checkOut||""),clockings:Array.isArray(row?.clockings)?row.clockings.length:0}))},ts:Date.now()})}).catch(()=>{}); }
        // #endregion
        setModuleRowsState((prev) => ({
          ...prev,
          [activeModuleId]: records,
        }));
      } catch (error) {
      }
    };
    loadModuleRows();
    return () => {
      cancelled = true;
    };
  }, [activeModuleId, authHeaders, authToken, currentUser, isSettingsPage]);
  const employeeRowsCount = (moduleRowsState['employee-management'] || []).length;
  useEffect(() => {
    if (!currentUser) {
      return;
    }
    if (employeeRowsCount > 0) {
      return;
    }
    if (employeeModuleLoadingRef.current) {
      return;
    }
    let cancelled = false;
    employeeModuleLoadingRef.current = true;
    const loadEmployees = async () => {
      try {
        const response = await fetch(toApiUrl('http://localhost:8000/api/modules/employee-management'), {
          headers: authHeaders,
        });
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (cancelled) {
          return;
        }
        const records = Array.isArray(data.records) ? data.records : [];
        setModuleRowsState((prev) => ({
          ...prev,
          'employee-management': records,
        }));
      } catch (error) {
      } finally {
        employeeModuleLoadingRef.current = false;
      }
    };
    loadEmployees();
    return () => {
      cancelled = true;
    };
  }, [authHeaders, currentUser, employeeRowsCount]);

  useEffect(() => {
    if (!authToken) {
      return undefined;
    }
    const fetchTrackingSettings = async () => {
      try {
        setTrackingSettingsLoading(true);
        const response = await fetch(toApiUrl('http://localhost:8000/api/tracking/settings'), {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error('Failed to load tracking settings');
        }
        const data = await response.json();
        setAppSettings((prev) => ({
          ...prev,
          trackingRules: {
            ...prev.trackingRules,
            officeLat:
              data.officeLat === null || data.officeLat === undefined
                ? prev.trackingRules.officeLat
                : data.officeLat,
            officeLng:
              data.officeLng === null || data.officeLng === undefined
                ? prev.trackingRules.officeLng
                : data.officeLng,
            geofenceRadiusMeters:
              data.geofenceRadiusMeters === null || data.geofenceRadiusMeters === undefined
                ? prev.trackingRules.geofenceRadiusMeters
                : data.geofenceRadiusMeters,
            geofenceEnabled:
              data.geofenceEnabled === undefined
                ? prev.trackingRules.geofenceEnabled
                : Boolean(data.geofenceEnabled),
            wifiValidationEnabled:
              data.wifiValidationEnabled === undefined
                ? prev.trackingRules.wifiValidationEnabled
                : Boolean(data.wifiValidationEnabled),
            activityMonitoringEnabled:
              data.activityMonitoringEnabled === undefined
                ? prev.trackingRules.activityMonitoringEnabled
                : Boolean(data.activityMonitoringEnabled),
            randomSelfieEnabled:
              data.randomSelfieEnabled === undefined
                ? prev.trackingRules.randomSelfieEnabled
                : Boolean(data.randomSelfieEnabled),
            antiGpsSpoofingEnabled:
              data.antiGpsSpoofingEnabled === undefined
                ? prev.trackingRules.antiGpsSpoofingEnabled
                : Boolean(data.antiGpsSpoofingEnabled),
            whatsappAlertsEnabled:
              data.whatsappAlertsEnabled === undefined
                ? prev.trackingRules.whatsappAlertsEnabled
                : Boolean(data.whatsappAlertsEnabled),
            officeWifiSsids: Array.isArray(data.officeWifiSsids)
              ? data.officeWifiSsids
              : prev.trackingRules.officeWifiSsids,
            officeWifiBssids: Array.isArray(data.officeWifiBssids)
              ? data.officeWifiBssids
              : prev.trackingRules.officeWifiBssids,
            officeIpRanges: Array.isArray(data.officeIpRanges)
              ? data.officeIpRanges
              : prev.trackingRules.officeIpRanges,
            offlineMinutesThreshold:
              data.offlineMinutesThreshold === null || data.offlineMinutesThreshold === undefined
                ? prev.trackingRules.offlineMinutesThreshold
                : data.offlineMinutesThreshold,
            locationOffAlertEnabled:
              data.locationOffAlertEnabled === undefined
                ? prev.trackingRules.locationOffAlertEnabled
                : Boolean(data.locationOffAlertEnabled),
          },
        }));
        setTrackingSettingsError('');
      } catch (error) {
        setTrackingSettingsError('Unable to load tracking settings from backend');
      } finally {
        setTrackingSettingsLoading(false);
      }
    };

    fetchTrackingSettings();
  }, [authHeaders, authToken]);

  useEffect(() => {
    if (!authToken) {
      return undefined;
    }
    const fetchAttendanceSettings = async () => {
      try {
        setAttendanceSettingsLoading(true);
        const response = await fetch(toApiUrl('http://localhost:8000/api/settings/attendance'), {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error('Failed to load attendance settings');
        }
        const data = await response.json();
        setAppSettings((prev) => ({
          ...prev,
          attendanceLateAfter: String(data?.attendanceLateAfter || prev.attendanceLateAfter || '08:15'),
          attendanceReportTime: String(data?.attendanceReportTime || prev.attendanceReportTime || '08:00'),
          attendanceShiftEnd: String(data?.attendanceShiftEnd || prev.attendanceShiftEnd || '17:00'),
          requireWebClockInPhoto:
            data?.requireWebClockInPhoto === undefined
              ? Boolean(prev.requireWebClockInPhoto)
              : Boolean(data.requireWebClockInPhoto),
          payrollWorkingDays: Math.max(1, Number(data?.payrollWorkingDays) || prev.payrollWorkingDays || 26),
          attendanceCalculationMode: data?.attendanceCalculationMode === 'fixed' ? 'fixed' : 'auto',
          attendanceFixedDeductionPerMinute: Math.max(
            0,
            Number(data?.attendanceFixedDeductionPerMinute) || prev.attendanceFixedDeductionPerMinute || 0
          ),
          attendanceFixedScope: ['all', 'department', 'individual'].includes(String(data?.attendanceFixedScope || ''))
            ? String(data.attendanceFixedScope)
            : prev.attendanceFixedScope || 'all',
          attendanceFixedDepartment: String(data?.attendanceFixedDepartment || prev.attendanceFixedDepartment || ''),
          attendanceFixedEmployeeId: String(data?.attendanceFixedEmployeeId || prev.attendanceFixedEmployeeId || ''),
          shifts: Array.isArray(data?.shifts) && data.shifts.length > 0 ? data.shifts : prev.shifts,
        }));
        setAttendanceSettingsError('');
      } catch (error) {
        setAttendanceSettingsError('Unable to load attendance settings from backend');
      } finally {
        setAttendanceSettingsLoading(false);
      }
    };

    fetchAttendanceSettings();
  }, [authHeaders, authToken]);

  const buildAttendanceSettingsPayload = useCallback((source) => {
    return {
      attendanceLateAfter: source.attendanceLateAfter,
      attendanceReportTime: source.attendanceReportTime,
      attendanceShiftEnd: source.attendanceShiftEnd,
      requireWebClockInPhoto: Boolean(source.requireWebClockInPhoto),
      payrollWorkingDays: source.payrollWorkingDays,
      attendanceCalculationMode: source.attendanceCalculationMode,
      attendanceFixedDeductionPerMinute: source.attendanceFixedDeductionPerMinute,
      attendanceFixedScope: source.attendanceFixedScope,
      attendanceFixedDepartment: source.attendanceFixedDepartment,
      attendanceFixedEmployeeId: source.attendanceFixedEmployeeId,
      shifts: Array.isArray(source.shifts) ? source.shifts : [],
    };
  }, []);

  const saveAttendanceSettings = useCallback(
    async (nextSettings) => {
      try {
        setAttendanceSettingsSaving(true);
        setAttendanceSettingsSavedMessage('');
        setAttendanceSettingsError('');
        const payload = buildAttendanceSettingsPayload(nextSettings || appSettings);
        const response = await fetch(toApiUrl('http://localhost:8000/api/settings/attendance'), {
          method: 'POST',
          headers: jsonAuthHeaders,
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error('Failed to save attendance settings');
        }
        const data = await response.json();
        if (data?.settings) {
          setAppSettings((prev) => ({
            ...prev,
            ...buildAttendanceSettingsPayload({
              ...prev,
              ...data.settings,
            }),
          }));
        }
        setAttendanceSettingsSavedMessage('Attendance settings saved to backend');
      } catch (error) {
        setAttendanceSettingsError('Unable to save attendance settings to backend');
      } finally {
        setAttendanceSettingsSaving(false);
      }
    },
    [appSettings, buildAttendanceSettingsPayload, jsonAuthHeaders]
  );

  useEffect(() => {
    if (!authToken) {
      return undefined;
    }
    const fetchMobileSettings = async () => {
      try {
        setMobileSettingsLoading(true);
        const response = await fetch(toApiUrl('http://localhost:8000/api/mobile/settings'), {
          headers: authHeaders,
        });
        if (!response.ok) {
          throw new Error('Failed to load mobile settings');
        }
        const data = await response.json();
        setAppSettings((prev) => ({
          ...prev,
          mobileApp: {
            ...prev.mobileApp,
            ...(data || {}),
            enabledModules: Array.isArray(data?.enabledModules)
              ? data.enabledModules.map((value) => String(value || '').trim()).filter(Boolean)
              : prev.mobileApp.enabledModules,
          },
        }));
        setMobileSettingsError('');
      } catch (error) {
        setMobileSettingsError('Unable to load mobile settings from backend');
      } finally {
        setMobileSettingsLoading(false);
      }
    };

    fetchMobileSettings();
  }, [authHeaders, authToken]);

  const handleSaveTrackingSettings = async () => {
    try {
      setTrackingSettingsSaving(true);
      setTrackingSettingsSavedMessage('');
      setTrackingSettingsError('');
      const response = await fetch(toApiUrl('http://localhost:8000/api/tracking/settings'), {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify(appSettings.trackingRules),
      });
      if (!response.ok) {
        throw new Error('Failed to save tracking settings');
      }
      const data = await response.json();
      if (data && data.settings) {
        setAppSettings((prev) => ({
          ...prev,
          trackingRules: {
            ...prev.trackingRules,
            officeLat:
              data.settings.officeLat === null || data.settings.officeLat === undefined
                ? prev.trackingRules.officeLat
                : data.settings.officeLat,
            officeLng:
              data.settings.officeLng === null || data.settings.officeLng === undefined
                ? prev.trackingRules.officeLng
                : data.settings.officeLng,
            geofenceRadiusMeters:
              data.settings.geofenceRadiusMeters === null ||
              data.settings.geofenceRadiusMeters === undefined
                ? prev.trackingRules.geofenceRadiusMeters
                : data.settings.geofenceRadiusMeters,
            geofenceEnabled:
              data.settings.geofenceEnabled === undefined
                ? prev.trackingRules.geofenceEnabled
                : Boolean(data.settings.geofenceEnabled),
            wifiValidationEnabled:
              data.settings.wifiValidationEnabled === undefined
                ? prev.trackingRules.wifiValidationEnabled
                : Boolean(data.settings.wifiValidationEnabled),
            activityMonitoringEnabled:
              data.settings.activityMonitoringEnabled === undefined
                ? prev.trackingRules.activityMonitoringEnabled
                : Boolean(data.settings.activityMonitoringEnabled),
            randomSelfieEnabled:
              data.settings.randomSelfieEnabled === undefined
                ? prev.trackingRules.randomSelfieEnabled
                : Boolean(data.settings.randomSelfieEnabled),
            antiGpsSpoofingEnabled:
              data.settings.antiGpsSpoofingEnabled === undefined
                ? prev.trackingRules.antiGpsSpoofingEnabled
                : Boolean(data.settings.antiGpsSpoofingEnabled),
            whatsappAlertsEnabled:
              data.settings.whatsappAlertsEnabled === undefined
                ? prev.trackingRules.whatsappAlertsEnabled
                : Boolean(data.settings.whatsappAlertsEnabled),
            officeWifiSsids: Array.isArray(data.settings.officeWifiSsids)
              ? data.settings.officeWifiSsids
              : prev.trackingRules.officeWifiSsids,
            officeWifiBssids: Array.isArray(data.settings.officeWifiBssids)
              ? data.settings.officeWifiBssids
              : prev.trackingRules.officeWifiBssids,
            officeIpRanges: Array.isArray(data.settings.officeIpRanges)
              ? data.settings.officeIpRanges
              : prev.trackingRules.officeIpRanges,
            offlineMinutesThreshold:
              data.settings.offlineMinutesThreshold === null ||
              data.settings.offlineMinutesThreshold === undefined
                ? prev.trackingRules.offlineMinutesThreshold
                : data.settings.offlineMinutesThreshold,
            locationOffAlertEnabled:
              data.settings.locationOffAlertEnabled === undefined
                ? prev.trackingRules.locationOffAlertEnabled
                : Boolean(data.settings.locationOffAlertEnabled),
          },
        }));
      }
      setTrackingSettingsSavedMessage('Tracking settings saved to backend');
    } catch (error) {
      setTrackingSettingsError('Unable to save tracking settings to backend');
    } finally {
      setTrackingSettingsSaving(false);
    }
  };

  const handleSaveMobileSettings = async () => {
    try {
      setMobileSettingsSaving(true);
      setMobileSettingsSavedMessage('');
      setMobileSettingsError('');
      const response = await fetch(toApiUrl('http://localhost:8000/api/mobile/settings'), {
        method: 'POST',
        headers: jsonAuthHeaders,
        body: JSON.stringify(appSettings.mobileApp),
      });
      if (!response.ok) {
        throw new Error('Failed to save mobile settings');
      }
      const data = await response.json();
      setAppSettings((prev) => ({
        ...prev,
        mobileApp: {
          ...prev.mobileApp,
          ...(data?.settings || {}),
          enabledModules: Array.isArray(data?.settings?.enabledModules)
            ? data.settings.enabledModules.map((value) => String(value || '').trim()).filter(Boolean)
            : prev.mobileApp.enabledModules,
        },
      }));
      setMobileSettingsSavedMessage('Mobile settings saved to backend');
    } catch (error) {
      setMobileSettingsError('Unable to save mobile settings to backend');
    } finally {
      setMobileSettingsSaving(false);
    }
  };

  const loanRows = useMemo(() => moduleRowsState['loan-records'] || [], [moduleRowsState]);
  const loanRowsScopedByRole = useMemo(() => {
    if (!currentUser || currentUser.role !== 'employee') {
      return loanRows;
    }
    const employeeId = String(currentUser.employeeId || '').trim();
    const employeeName = String(currentUser.fullName || '').trim();
    return loanRows.filter((row) => {
      const rowEmployeeId = String(row.employeeId || '').trim();
      const rowEmployeeName = String(row.employee || '').trim();
      if (employeeId) {
        return rowEmployeeId === employeeId;
      }
      if (employeeName) {
        return rowEmployeeName === employeeName;
      }
      return false;
    });
  }, [currentUser, loanRows]);

  const rows = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    const baseRows = moduleRowsState[activeModuleId] || [];
    if (activeModuleId === 'loan-records') {
      return loanRowsScopedByRole;
    }
    const enhancers = getModuleEnhancers(activeModuleId);
    if (enhancers && typeof enhancers.getRows === 'function') {
      return enhancers.getRows({
        baseRows,
        moduleRowsState,
        appSettings,
        getTodayIsoDate,
        getCurrentClockValue,
        toMinutesFromClock,
        getMinutesBetweenClocks,
        isLoanCountableRecord,
      });
    }
    return baseRows;
  }, [activeModuleConfig, activeModuleId, appSettings, loanRowsScopedByRole, moduleRowsState]);
  const isModalOpen = modalState.mode !== null;
  const isFormModal = modalState.mode === 'form';
  const modalRow = rows.find((row) => row.id === modalState.rowId) || null;
  const appInitial = appSettings.appName.trim().charAt(0).toUpperCase() || 'P';
  const sidebarBaseColor = normalizeHexColor(appSettings.sidebarColor, '#0a73d9');
  const sidebarStyle = useMemo(
    () => ({
      '--sidebar-glow': sidebarBaseColor,
      '--sidebar-bg-top': blendHexToBlack(sidebarBaseColor, 0.62),
      '--sidebar-bg-mid': blendHexToBlack(sidebarBaseColor, 0.74),
      '--sidebar-bg-bottom': blendHexToBlack(sidebarBaseColor, 0.82),
    }),
    [sidebarBaseColor]
  );
  const activeFilterField = activeModuleConfig?.filterField || '';
  const employeeImageFields = ['passportPhoto', 'idFront', 'idBack'];
  const employeeFileFields = useMemo(
    () =>
      activeModuleConfig?.formFields
        ?.filter((field) => field.type === 'file')
        .map((field) => field.key) || [],
    [activeModuleConfig]
  );
  const tableColumns = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    let columns = activeModuleConfig.columns || [];
    if (activeModuleId === 'employee-management') {
      if (columns.some((column) => column.key === 'contractAlert')) {
        return columns;
      }
      return [
        ...columns,
        { key: 'contractAlert', label: 'Contract Alert' },
      ];
    }
    const enhancers = getModuleEnhancers(activeModuleId);
    if (enhancers && typeof enhancers.augmentColumns === 'function') {
      return enhancers.augmentColumns(columns);
    }
    return columns;
  }, [activeModuleConfig, activeModuleId]);
  const modalContractCountdown = useMemo(() => {
    if (activeModuleId !== 'employee-management' || !modalRow) {
      return null;
    }
    return getContractCountdown(modalRow.contractEndDate);
  }, [activeModuleId, modalRow]);
  const modalPassportPhotoUrl = useMemo(() => {
    if (activeModuleId !== 'employee-management' || !modalRow) {
      return '';
    }
    const files = Array.isArray(modalRow.passportPhotoFiles) ? modalRow.passportPhotoFiles : [];
    const imageFile = files.find((file) => file.isImage);
    return imageFile?.url || modalRow.passportPhotoPreview || '';
  }, [activeModuleId, modalRow]);
  const modalBarcodeValue = useMemo(() => {
    if (activeModuleId !== 'employee-management' || !modalRow) {
      return '';
    }
    return String(modalRow.id || modalRow.fullName || 'EMPLOYEE');
  }, [activeModuleId, modalRow]);
  const modalBarcodeDataUrl = useMemo(
    () => createBarcodeDataUrl(modalBarcodeValue, 320, 44, '#132d63'),
    [modalBarcodeValue]
  );

  const visibleFormFields = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    return activeModuleConfig.formFields.filter((field) => shouldDisplayField(field, formValues));
  }, [activeModuleConfig, formValues]);
  const currentDepartmentOptions = useMemo(
    () => appSettings.departments.map((department) => department.name),
    [appSettings.departments]
  );
  const currentEmploymentStageOptions = useMemo(
    () => appSettings.employmentStages,
    [appSettings.employmentStages]
  );
  const attendanceShiftOptions = useMemo(() => {
    const normalized = Array.isArray(appSettings.shifts)
      ? appSettings.shifts
          .map((shift, index) => {
            const name = String(shift?.name || '').trim();
            const reportTime = String(shift?.reportTime || appSettings.attendanceReportTime || '08:00').trim();
            const shiftEnd = String(shift?.shiftEnd || appSettings.attendanceShiftEnd || '17:00').trim();
            if (!name || !/^\d{2}:\d{2}$/.test(reportTime) || !/^\d{2}:\d{2}$/.test(shiftEnd)) {
              return null;
            }
            return {
              id: String(shift?.id || `SHIFT-${index + 1}`),
              name,
              reportTime,
              shiftEnd,
              graceInMinutes: Math.max(0, Number(shift?.graceInMinutes) || 0),
              graceOutMinutes: Math.max(0, Number(shift?.graceOutMinutes) || 0),
              overtimeEnabled: Boolean(shift?.overtimeEnabled),
              overtimeStartAfterMinutes: Math.max(0, Number(shift?.overtimeStartAfterMinutes) || 0),
              overtimePayPerMinute: Math.max(0, Number(shift?.overtimePayPerMinute) || 0),
            };
          })
          .filter(Boolean)
      : [];
    if (normalized.length > 0) {
      return normalized;
    }
    return [
      {
        id: 'SHIFT-DEFAULT',
        name: 'Default',
        reportTime: appSettings.attendanceReportTime || '08:00',
        shiftEnd: appSettings.attendanceShiftEnd || '17:00',
        graceInMinutes: Math.max(
          0,
          (toMinutesFromClock(appSettings.attendanceLateAfter) ?? 0) -
            (toMinutesFromClock(appSettings.attendanceReportTime) ?? 0)
        ),
        graceOutMinutes: 0,
        overtimeEnabled: false,
        overtimeStartAfterMinutes: 0,
        overtimePayPerMinute: 0,
      },
    ];
  }, [
    appSettings.attendanceLateAfter,
    appSettings.attendanceReportTime,
    appSettings.attendanceShiftEnd,
    appSettings.shifts,
  ]);
  const resolveShiftConfig = useCallback(
    (shiftName) => {
      const normalizedName = String(shiftName || '').trim().toLowerCase();
      const exact = attendanceShiftOptions.find(
        (shift) => String(shift.name || '').trim().toLowerCase() === normalizedName
      );
      if (exact) {
        return exact;
      }
      return attendanceShiftOptions[0] || null;
    },
    [attendanceShiftOptions]
  );
  const getFieldLabel = (field) => {
    if (!field) {
      return '';
    }
    if (activeModuleId === 'employee-management' && field.key === 'pensionId') {
      return appSettings.pensionFieldLabel || 'Pension Number';
    }
    if (activeModuleId === 'employee-management' && field.key === 'taxId') {
      return appSettings.taxFieldLabel || 'Tax ID Number';
    }
    return field.label;
  };
  const isEmployeeModule = activeModuleId === 'employee-management';
  const employeeFormSections = useMemo(
    () =>
      isEmployeeModule
        ? [
            {
              id: 'personal-ids',
              title: 'Personal & IDs',
              fields: [
                'fullName',
                'dob',
                'gender',
                'idCardType',
                'idCardNumber',
                'nhimaNumber',
                'pensionId',
                'taxId',
                'password',
                'status',
                'employmentState',
              ],
            },
            {
              id: 'wallet-bank',
              title: 'Wallet & Bank',
              fields: [
                'mobileMoneyNumber',
                'mobileMoneyNetwork',
                'mobileMoneyName',
                'bankName',
                'bankAccountNumber',
                'bankAccountName',
                'bankBranchName',
                'bankBranchCode',
                'basicPay',
                'monthlyBonuses',
                'transportAllowance',
                'housingAllowance',
                'foodAllowance',
              ],
            },
            {
              id: 'contacts',
              title: 'Contacts & Emergency',
              fields: [
                'phonePrimary',
                'phoneSecondary',
                'email',
                'address',
                'emergencyContact1Name',
                'emergencyContact1Phone',
                'emergencyContact2Name',
                'emergencyContact2Phone',
                'referee1',
                'referee1Phone',
                'referee1Email',
                'referee2',
                'referee2Phone',
                'referee2Email',
              ],
            },
            {
              id: 'employment-docs',
              title: 'Employment & Documents',
              fields: [
                'department',
                'assignedShift',
                'position',
                'lineManager',
                'leaveBalanceDays',
                'contractType',
                'contractTypeOther',
                'contractStartDate',
                'contractEndDate',
                'passportPhoto',
                'idFront',
                'idBack',
                'otherDocuments',
                'otherDocumentsNote',
              ],
            },
          ]
        : [],
    [isEmployeeModule]
  );
  const employeeFormFieldMap = useMemo(() => {
    if (!isEmployeeModule) {
      return {};
    }
    const map = {};
    visibleFormFields.forEach((field) => {
      map[field.key] = field;
    });
    return map;
  }, [isEmployeeModule, visibleFormFields]);
  const genericFormSections = useMemo(() => {
    if (isEmployeeModule || !activeModuleConfig) {
      return [];
    }
    const fields = visibleFormFields;
    if (!fields || fields.length === 0) {
      return [];
    }
    if (fields.length <= 8) {
      return [
        {
          id: 'main-details',
          title: `${activeModuleConfig.entityLabel} Details`,
          fields: fields.map((field) => field.key),
        },
      ];
    }
    const midpoint = Math.ceil(fields.length / 2);
    return [
      {
        id: 'main-details',
        title: `${activeModuleConfig.entityLabel} Details`,
        fields: fields.slice(0, midpoint).map((field) => field.key),
      },
      {
        id: 'more-details',
        title: 'More Details',
        fields: fields.slice(midpoint).map((field) => field.key),
      },
    ];
  }, [activeModuleConfig, isEmployeeModule, visibleFormFields]);
  const employeeStatusOptions = useMemo(() => {
    if (!isEmployeeModule) {
      return ['All'];
    }
    return ['All', ...new Set(rows.map((row) => String(row.status || '').trim()).filter(Boolean))];
  }, [isEmployeeModule, rows]);
  const employeeStageOptions = useMemo(() => {
    if (!isEmployeeModule) {
      return ['All'];
    }
    return ['All', ...new Set(rows.map((row) => String(row.employmentState || '').trim()).filter(Boolean))];
  }, [isEmployeeModule, rows]);
  const leaveRows = useMemo(() => moduleRowsState['leave-management'] || [], [moduleRowsState]);
  const employeeLeaveRequests = useMemo(() => {
    if (!isEmployeeModule || !modalRow) {
      return [];
    }
    return leaveRows
      .filter((leaveRow) => String(leaveRow.employee) === String(modalRow.fullName))
      .sort((a, b) => new Date(b.startDate || '1900-01-01').getTime() - new Date(a.startDate || '1900-01-01').getTime());
  }, [isEmployeeModule, leaveRows, modalRow]);
  const employeeLoanRecords = useMemo(() => {
    if (!isEmployeeModule || !modalRow) {
      return [];
    }
    return loanRows
      .filter((loanRow) => String(loanRow.employee) === String(modalRow.fullName))
      .sort((a, b) => new Date(b.issuedOn || '1900-01-01').getTime() - new Date(a.issuedOn || '1900-01-01').getTime());
  }, [isEmployeeModule, loanRows, modalRow]);
  const loanInstallmentPreview = useMemo(() => {
    if (activeModuleId !== 'loan-records') {
      return null;
    }
    const principal = toNumberValue(formValues.amount);
    const rawInterestPercent =
      formValues.interestPercent !== undefined && formValues.interestPercent !== null
        ? Number(formValues.interestPercent)
        : appSettings.loanRules.defaultInterestPercentPerMonth;
    const interestPercent = Math.max(0, Number(rawInterestPercent) || 0);
    const tenorMonths = Math.max(1, toNumberValue(formValues.tenorMonths) || 1);
    if (!principal || !tenorMonths || !interestPercent) {
      return null;
    }
    const totalInterest = (principal * interestPercent * tenorMonths) / 100;
    const totalRepay = principal + totalInterest;
    const monthlyInstallment = totalRepay / tenorMonths;
    return {
      principal,
      interestPercent,
      tenorMonths,
      totalInterest,
      totalRepay,
      monthlyInstallment,
    };
  }, [
    activeModuleId,
    appSettings.loanRules.defaultInterestPercentPerMonth,
    formValues.amount,
    formValues.interestPercent,
    formValues.tenorMonths,
  ]);
  const employeeBaseRows = useMemo(() => moduleRowsState['employee-management'] || [], [moduleRowsState]);
  const attendanceRows = useMemo(() => moduleRowsState['attendance-time'] || [], [moduleRowsState]);
  const fingerprintRows = useMemo(() => moduleRowsState.fingerprint || [], [moduleRowsState]);
  const leaveRequestRows = useMemo(
    () =>
      leaveRows
        .map((leaveRow) => {
          const matchedEmployee =
            employeeBaseRows.find((employee) => String(employee.id || '') === String(leaveRow.employeeId || '')) ||
            employeeBaseRows.find((employee) => String(employee.fullName || '') === String(leaveRow.employee || '')) ||
            null;
          const statusLower = String(leaveRow.status || '').trim().toLowerCase();
          const departmentApproval =
            leaveRow.departmentApproval ||
            leaveRow.supervisorApproval ||
            leaveRow.managerApproval ||
            (statusLower === 'approved' || statusLower === 'active' || statusLower === 'planned'
              ? 'Approved'
              : statusLower === 'rejected'
                ? 'Rejected'
                : 'Pending');
          const hrApproval =
            leaveRow.hrApproval ||
            (statusLower === 'approved' || statusLower === 'active' || statusLower === 'planned'
              ? 'Approved'
              : statusLower === 'rejected'
                ? 'Rejected'
                : 'Pending');
          const managerApproval =
            leaveRow.finalManagerApproval ||
            leaveRow.branchManagerApproval ||
            (statusLower === 'approved' || statusLower === 'active' ? 'Approved' : statusLower === 'rejected' ? 'Rejected' : 'Pending');
          const normalizedStatus =
            departmentApproval === 'Rejected' || hrApproval === 'Rejected' || managerApproval === 'Rejected'
              ? 'Rejected'
              : departmentApproval === 'Pending'
                ? 'Pending Department'
                : hrApproval === 'Pending'
                  ? 'Pending HR'
                  : managerApproval === 'Pending'
                    ? 'Pending Manager'
                    : 'Approved';
          const daysRequested =
            Math.max(0, toNumberValue(leaveRow.daysRequested)) || getInclusiveDaysBetween(leaveRow.startDate, leaveRow.endDate);
          return {
            ...leaveRow,
            employeeId: leaveRow.employeeId || matchedEmployee?.id || '',
            employee: leaveRow.employee || matchedEmployee?.fullName || '',
            department: leaveRow.department || matchedEmployee?.department || 'Unassigned',
            reason: leaveRow.reason || '',
            departmentApproval,
            departmentApprover: leaveRow.departmentApprover || '',
            departmentComment: leaveRow.departmentComment || leaveRow.managerRemark || '',
            departmentApprovedOn: leaveRow.departmentApprovedOn || leaveRow.managerApprovedOn || '',
            hrApprover: leaveRow.hrApprover || '',
            hrComment: leaveRow.hrComment || leaveRow.hrRemark || '',
            hrApprovedOn: leaveRow.hrApprovedOn || '',
            managerApproval,
            managerApprover: leaveRow.managerApprover || '',
            managerComment: leaveRow.managerComment || '',
            managerApprovedOn: leaveRow.managerApprovedOn || '',
            hrApproval,
            status: normalizedStatus,
            daysRequested,
          };
        })
        .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || ''))),
    [employeeBaseRows, leaveRows]
  );
  const loanRequestRows = useMemo(() => {
    const rowsForRole = loanRowsScopedByRole || [];
    return rowsForRole
      .map((loanRow) => {
        const matchedEmployee =
          employeeBaseRows.find((employee) => String(employee.id || '') === String(loanRow.employeeId || '')) ||
          findExactEmployeeBySearch(employeeBaseRows, loanRow.employee) ||
          null;
        const statusLower = String(loanRow.status || '').trim().toLowerCase();
        const departmentApproval =
          loanRow.departmentApproval ||
          (statusLower === 'approved' || statusLower === 'active' || statusLower === 'closed'
            ? 'Approved'
            : statusLower === 'rejected'
              ? 'Rejected'
              : 'Pending');
        const hrApproval =
          loanRow.hrApproval ||
          (statusLower === 'approved' || statusLower === 'active' || statusLower === 'closed'
            ? 'Approved'
            : statusLower === 'rejected'
              ? 'Rejected'
              : 'Pending');
        const managerApproval =
          loanRow.managerApproval ||
          (statusLower === 'approved' || statusLower === 'active' || statusLower === 'closed'
            ? 'Approved'
            : statusLower === 'rejected'
              ? 'Rejected'
              : 'Pending');
        const normalizedStatus =
          statusLower === 'closed'
            ? 'Closed'
            : departmentApproval === 'Rejected' || hrApproval === 'Rejected' || managerApproval === 'Rejected'
              ? 'Rejected'
              : departmentApproval === 'Pending'
                ? 'Pending Department'
                : hrApproval === 'Pending'
                  ? 'Pending HR'
                  : managerApproval === 'Pending'
                    ? 'Pending Manager'
                    : 'Approved';
        const resolvedEmployeeId = resolveEmployeeKey(employeeBaseRows, loanRow.employeeId, loanRow.employee);
        return {
          ...loanRow,
          employeeId: loanRow.employeeId || matchedEmployee?.id || resolvedEmployeeId || '',
          employee: loanRow.employee || matchedEmployee?.fullName || '',
          department: loanRow.department || matchedEmployee?.department || 'Unassigned',
          departmentApproval,
          departmentApprover: loanRow.departmentApprover || '',
          departmentComment: loanRow.departmentComment || '',
          departmentApprovedOn: loanRow.departmentApprovedOn || '',
          hrApproval,
          hrApprover: loanRow.hrApprover || '',
          hrComment: loanRow.hrComment || '',
          hrApprovedOn: loanRow.hrApprovedOn || '',
          managerApproval,
          managerApprover: loanRow.managerApprover || '',
          managerComment: loanRow.managerComment || '',
          managerApprovedOn: loanRow.managerApprovedOn || '',
          status: normalizedStatus,
        };
      })
      .sort((a, b) => String(b.issuedOn || '').localeCompare(String(a.issuedOn || '')));
  }, [employeeBaseRows, loanRowsScopedByRole]);
  const leaveBalanceRows = useMemo(
    () =>
      employeeBaseRows.map((employee) => {
        const approvedDays = leaveRequestRows
          .filter(
            (row) =>
              String(row.employeeId || '') === String(employee.id || '') &&
              isLeaveFullyApprovedRecord(row)
          )
          .reduce((total, row) => total + row.daysRequested, 0);
        const pendingDays = leaveRequestRows
          .filter(
            (row) =>
              String(row.employeeId || '') === String(employee.id || '') &&
              !isLeaveRejectedRecord(row) &&
              !isLeaveFullyApprovedRecord(row)
          )
          .reduce((total, row) => total + row.daysRequested, 0);
        const employeeKey = resolveEmployeeKey(employeeBaseRows, employee.id, employee.fullName);
        const payrollProfile = getEmployeePayrollProfile({
          moduleRowsState,
          employeeBaseRows,
          employeeId: employeeKey,
          employeeName: employee.fullName,
        });
        const openingBalance = Math.max(0, toNumberValue(employee.leaveBalanceDays));
        const availableBalance = Math.max(0, openingBalance - approvedDays);
        const basicPay = Math.max(0, toNumberValue(payrollProfile?.basicPay));
        const workingDays = Math.max(1, Number(payrollProfile?.workingDays || appSettings.payrollWorkingDays) || 1);
        const dailyBasicPay = basicPay > 0 ? basicPay / workingDays : 0;
        const unusedLeaveDays = availableBalance;
        const estimatedPayoutAmount = unusedLeaveDays * dailyBasicPay;
        const contractEndDate = String(employee.contractEndDate || '');
        const isContractEnded = Boolean(contractEndDate) && contractEndDate <= getTodayIsoDate();
        return {
          employeeId: employee.id,
          employee: employee.fullName,
          department: employee.department || 'Unassigned',
          contractEndDate: contractEndDate || 'No End Date',
          openingBalance,
          approvedDays,
          pendingDays,
          availableBalance,
          dailyBasicPay,
          unusedLeaveDays,
          leavePayoutAmount: estimatedPayoutAmount,
          payoutStatus: isContractEnded ? 'Payable Now' : 'Payable At Contract End',
        };
      }),
    [appSettings.payrollWorkingDays, employeeBaseRows, leaveRequestRows, moduleRowsState]
  );
  const leaveDepartmentOptions = useMemo(() => {
    const options = [...new Set(leaveBalanceRows.map((row) => String(row.department || '').trim()).filter(Boolean))];
    return ['All', ...options.sort((a, b) => a.localeCompare(b))];
  }, [leaveBalanceRows]);
  const getLeaveViewStatus = useCallback(
    (row, viewTab = leaveViewTab) => {
      if (viewTab === 'department') {
        return String(row.departmentApproval || 'Pending');
      }
      if (viewTab === 'hr') {
        return String(row.hrApproval || 'Pending');
      }
      if (viewTab === 'manager') {
        return String(row.managerApproval || 'Pending');
      }
      return String(row.status || 'Pending');
    },
    [leaveViewTab]
  );
  const leaveStatusOptions = useMemo(() => {
    const options = [
      ...new Set(
        leaveRequestRows
          .map((row) => getLeaveViewStatus(row, leaveViewTab))
          .filter((value) => String(value || '').trim().length > 0)
      ),
    ];
    return ['All', ...options.sort((a, b) => a.localeCompare(b))];
  }, [getLeaveViewStatus, leaveRequestRows, leaveViewTab]);
  const leaveRequestFilteredRows = useMemo(() => {
    const query = leaveSearchText.trim().toLowerCase();
    let scopedRows = leaveRequestRows.filter((row) => {
      if (leaveViewTab === 'hr') {
        return String(row.departmentApproval || '') === 'Approved';
      }
      if (leaveViewTab === 'manager') {
        return String(row.departmentApproval || '') === 'Approved' && String(row.hrApproval || '') === 'Approved';
      }
      return true;
    });
    if (currentUser && currentUser.role === 'employee') {
      const employeeId = String(currentUser.employeeId || '').trim();
      const employeeName = String(currentUser.fullName || '').trim();
      scopedRows = scopedRows.filter((row) => {
        const rowEmployeeId = String(row.employeeId || '').trim();
        const rowEmployeeName = String(row.employee || '').trim();
        if (employeeId) {
          return rowEmployeeId === employeeId;
        }
        if (employeeName) {
          return rowEmployeeName === employeeName;
        }
        return false;
      });
    }
    const filteredRows = scopedRows.filter((row) => {
      const matchesDepartment =
        leaveDepartmentFilter === 'All' || String(row.department || '') === String(leaveDepartmentFilter);
      if (!matchesDepartment) {
        return false;
      }
      const statusLabel = getLeaveViewStatus(row);
      const matchesStatus = leaveStatusFilter === 'All' || String(statusLabel) === String(leaveStatusFilter);
      if (!matchesStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        String(row.employee || '').toLowerCase().includes(query) ||
        String(row.employeeId || '').toLowerCase().includes(query) ||
        String(row.type || '').toLowerCase().includes(query) ||
        String(row.department || '').toLowerCase().includes(query)
      );
    });
    if (leaveSortBy === 'date-asc') {
      return [...filteredRows].sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
    }
    if (leaveSortBy === 'employee-asc') {
      return [...filteredRows].sort((a, b) => String(a.employee || '').localeCompare(String(b.employee || '')));
    }
    if (leaveSortBy === 'employee-desc') {
      return [...filteredRows].sort((a, b) => String(b.employee || '').localeCompare(String(a.employee || '')));
    }
    if (leaveSortBy === 'days-asc') {
      return [...filteredRows].sort((a, b) => Number(a.daysRequested || 0) - Number(b.daysRequested || 0));
    }
    if (leaveSortBy === 'days-desc') {
      return [...filteredRows].sort((a, b) => Number(b.daysRequested || 0) - Number(a.daysRequested || 0));
    }
    return [...filteredRows].sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }, [
    currentUser,
    getLeaveViewStatus,
    leaveDepartmentFilter,
    leaveRequestRows,
    leaveSearchText,
    leaveSortBy,
    leaveStatusFilter,
    leaveViewTab,
  ]);
  const getLoanViewStatus = useCallback(
    (row, viewTab = loanViewTab) => {
      if (viewTab === 'department') {
        return String(row.departmentApproval || 'Pending');
      }
      if (viewTab === 'hr') {
        return String(row.hrApproval || 'Pending');
      }
      if (viewTab === 'manager') {
        return String(row.managerApproval || 'Pending');
      }
      return String(row.status || 'Pending');
    },
    [loanViewTab]
  );
  const loanStatusOptions = useMemo(() => {
    const options = [
      ...new Set(
        loanRequestRows
          .map((row) => getLoanViewStatus(row, loanViewTab))
          .filter((value) => String(value || '').trim().length > 0)
      ),
    ];
    return ['All', ...options.sort((a, b) => a.localeCompare(b))];
  }, [getLoanViewStatus, loanRequestRows, loanViewTab]);
  const loanRequestFilteredRows = useMemo(() => {
    const query = loanSearchText.trim().toLowerCase();
    let scopedRows = loanRequestRows.filter((row) => {
      if (loanViewTab === 'hr') {
        return String(row.departmentApproval || '') === 'Approved';
      }
      if (loanViewTab === 'manager') {
        return String(row.departmentApproval || '') === 'Approved' && String(row.hrApproval || '') === 'Approved';
      }
      return true;
    });
    if (currentUser && currentUser.role === 'employee') {
      const employeeId = String(currentUser.employeeId || '').trim();
      const employeeName = String(currentUser.fullName || '').trim();
      scopedRows = scopedRows.filter((row) => {
        const rowEmployeeId = String(row.employeeId || '').trim();
        const rowEmployeeName = String(row.employee || '').trim();
        if (employeeId) {
          return rowEmployeeId === employeeId;
        }
        if (employeeName) {
          return rowEmployeeName === employeeName;
        }
        return false;
      });
    }
    return scopedRows.filter((row) => {
      const statusLabel = getLoanViewStatus(row);
      const matchesStatus = loanStatusFilter === 'All' || String(statusLabel) === String(loanStatusFilter);
      if (!matchesStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        String(row.employee || '').toLowerCase().includes(query) ||
        String(row.employeeId || '').toLowerCase().includes(query) ||
        String(row.type || '').toLowerCase().includes(query) ||
        String(row.department || '').toLowerCase().includes(query) ||
        String(row.status || '').toLowerCase().includes(query)
      );
    });
  }, [currentUser, getLoanViewStatus, loanRequestRows, loanSearchText, loanStatusFilter, loanViewTab]);
  const leaveBalanceFilteredRows = useMemo(() => {
    const query = leaveSearchText.trim().toLowerCase();
    const scopedRows = leaveBalanceRows.filter((row) => {
      if (currentUser && currentUser.role === 'employee') {
        const employeeId = String(currentUser.employeeId || '').trim();
        const employeeName = String(currentUser.fullName || '').trim();
        const rowEmployeeId = String(row.employeeId || '').trim();
        const rowEmployeeName = String(row.employee || '').trim();
        if (employeeId) {
          return rowEmployeeId === employeeId;
        }
        if (employeeName) {
          return rowEmployeeName === employeeName;
        }
        return false;
      }
      return true;
    });
    const filteredRows = scopedRows.filter((row) => {
      const matchesDepartment =
        leaveDepartmentFilter === 'All' || String(row.department || '') === String(leaveDepartmentFilter);
      if (!matchesDepartment) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        String(row.employee || '').toLowerCase().includes(query) ||
        String(row.employeeId || '').toLowerCase().includes(query) ||
        String(row.department || '').toLowerCase().includes(query)
      );
    });
    if (leaveSortBy === 'employee-asc') {
      return [...filteredRows].sort((a, b) => String(a.employee || '').localeCompare(String(b.employee || '')));
    }
    if (leaveSortBy === 'employee-desc') {
      return [...filteredRows].sort((a, b) => String(b.employee || '').localeCompare(String(a.employee || '')));
    }
    if (leaveSortBy === 'days-asc') {
      return [...filteredRows].sort((a, b) => Number(a.availableBalance || 0) - Number(b.availableBalance || 0));
    }
    if (leaveSortBy === 'days-desc') {
      return [...filteredRows].sort((a, b) => Number(b.availableBalance || 0) - Number(a.availableBalance || 0));
    }
    return filteredRows;
  }, [currentUser, leaveBalanceRows, leaveDepartmentFilter, leaveSearchText, leaveSortBy]);
  const getCurrentEmployeeRow = useCallback(() => {
    if (!currentUser || currentUser.role !== 'employee') {
      return null;
    }
    const employeeId = String(currentUser.employeeId || '').trim();
    const employeeName = String(currentUser.fullName || '').trim();
    const fromList =
      employeeBaseRows.find((employee) => String(employee.id || '').trim() === employeeId) ||
      employeeBaseRows.find((employee) => String(employee.fullName || '').trim() === employeeName) ||
      null;
    if (fromList) {
      return fromList;
    }
    if (!employeeId && !employeeName) {
      return null;
    }
    return {
      id: employeeId || currentUser.username || '',
      fullName: employeeName || currentUser.username || '',
      department: '',
    };
  }, [currentUser, employeeBaseRows]);

  const leaveFormEmployeeMatches = useMemo(() => {
    if (currentUser && currentUser.role === 'employee') {
      const row = getCurrentEmployeeRow();
      return row ? [row] : [];
    }
    return filterEmployeesBySearch(employeeBaseRows, formValues.leaveEmployeeSearch);
  }, [currentUser, employeeBaseRows, formValues.leaveEmployeeSearch, getCurrentEmployeeRow]);

  const loanFormEmployeeMatches = useMemo(() => {
    if (activeModuleId !== 'loan-records') {
      return [];
    }
    if (currentUser && currentUser.role === 'employee') {
      const row = getCurrentEmployeeRow();
      return row ? [row] : [];
    }
    return filterEmployeesBySearch(employeeBaseRows, formValues.loanEmployeeSearch);
  }, [activeModuleId, currentUser, employeeBaseRows, formValues.loanEmployeeSearch, getCurrentEmployeeRow]);
  const selectedLoanFormEmployee = useMemo(
    () =>
      employeeBaseRows.find((employee) => String(employee.id || '') === String(formValues.employeeId || '')) ||
      employeeBaseRows.find((employee) => String(employee.fullName || '') === String(formValues.employee || '')) ||
      findExactEmployeeBySearch(employeeBaseRows, formValues.loanEmployeeSearch) ||
      null,
    [employeeBaseRows, formValues.employee, formValues.employeeId, formValues.loanEmployeeSearch]
  );
  const selectedLeaveFormEmployee = useMemo(
    () =>
      employeeBaseRows.find((employee) => String(employee.id || '') === String(formValues.employeeId || '')) ||
      employeeBaseRows.find((employee) => String(employee.fullName || '') === String(formValues.employee || '')) ||
      null,
    [employeeBaseRows, formValues.employee, formValues.employeeId]
  );
  const selectedLeaveFormBalance = useMemo(() => {
    let employeeIdForBalance = selectedLeaveFormEmployee?.id;
    if (!employeeIdForBalance && currentUser && currentUser.role === 'employee') {
      const row = getCurrentEmployeeRow();
      employeeIdForBalance = row?.id;
    }
    if (!employeeIdForBalance) {
      return null;
    }
    return (
      leaveBalanceRows.find(
        (row) => String(row.employeeId || '') === String(employeeIdForBalance || '')
      ) || null
    );
  }, [currentUser, getCurrentEmployeeRow, leaveBalanceRows, selectedLeaveFormEmployee]);
  const leaveFormAutoDaysRequested = useMemo(
    () => getInclusiveDaysBetween(formValues.startDate, formValues.endDate),
    [formValues.endDate, formValues.startDate]
  );
  const todayIsoDate = useMemo(() => getTodayIsoDate(), []);
  const selectedLeaveDetailRow = useMemo(() => {
    if (activeModuleId !== 'leave-management') {
      return null;
    }
    return leaveRequestRows.find((row) => String(row.id || '') === String(modalState.rowId || '')) || null;
  }, [activeModuleId, leaveRequestRows, modalState.rowId]);
  const selectedLoanDetailRow = useMemo(() => {
    if (activeModuleId !== 'loan-records') {
      return null;
    }
    return loanRequestRows.find((row) => String(row.id || '') === String(modalState.rowId || '')) || null;
  }, [activeModuleId, loanRequestRows, modalState.rowId]);
  useEffect(() => {
    if (activeModuleId !== 'leave-management' || modalState.mode !== 'form') {
      return;
    }
    if (currentUser && currentUser.role === 'employee') {
      return;
    }
    const matchedEmployee = findExactEmployeeBySearch(employeeBaseRows, formValues.leaveEmployeeSearch);
    if (!matchedEmployee) {
      return;
    }
    if (String(formValues.employeeId || '') === String(matchedEmployee.id || '')) {
      return;
    }
    setFormValues((prev) => ({
      ...prev,
      leaveEmployeeSearch: `${matchedEmployee.fullName} (${matchedEmployee.id})`,
      employee: matchedEmployee.fullName,
      employeeId: matchedEmployee.id,
      department: matchedEmployee.department || 'Unassigned',
    }));
  }, [activeModuleId, currentUser, employeeBaseRows, formValues.employeeId, formValues.leaveEmployeeSearch, modalState.mode]);
  useEffect(() => {
    if (activeModuleId !== 'loan-records' || modalState.mode !== 'form') {
      return;
    }
    if (currentUser && currentUser.role === 'employee') {
      return;
    }
    const matchedEmployee = findExactEmployeeBySearch(employeeBaseRows, formValues.loanEmployeeSearch);
    if (!matchedEmployee) {
      return;
    }
    if (String(formValues.employeeId || '') === String(matchedEmployee.id || '')) {
      return;
    }
    setFormValues((prev) => ({
      ...prev,
      loanEmployeeSearch: `${matchedEmployee.fullName} (${matchedEmployee.id})`,
      employee: matchedEmployee.fullName,
      employeeId: matchedEmployee.id,
    }));
  }, [activeModuleId, currentUser, employeeBaseRows, formValues.employeeId, formValues.loanEmployeeSearch, modalState.mode]);
  const getApprovalBadgeClass = (approvalValue) => {
    const normalized = String(approvalValue || '').trim().toLowerCase();
    if (normalized === 'approved') {
      return 'is-approved';
    }
    if (normalized === 'rejected') {
      return 'is-rejected';
    }
    return 'is-pending';
  };
  const renderDetailFieldCell = (field) => {
    if (!field || employeeImageFields.includes(field.key)) {
      return null;
    }
    const detailValue = modalRow[field.key];
    return (
      <div className="detail-cell" key={field.key}>
        <span>{getFieldLabel(field)}</span>
        {field.type === 'file' &&
        Array.isArray(modalRow[`${field.key}Files`]) &&
        modalRow[`${field.key}Files`].length > 0 ? (
          <div className="file-link-list details-file-list">
            {modalRow[`${field.key}Files`].map((fileItem, index) => (
              <div className="file-entry-card" key={`${field.key}-details-${fileItem.name}-${index}`}>
                <div className="file-link-row details-file-row">
                  <a className="file-link details-file-link" href={fileItem.url} target="_blank" rel="noreferrer">
                    {fileItem.name}
                  </a>
                  <a className="file-download" href={fileItem.url} download={fileItem.name}>
                    Download
                  </a>
                </div>
                {fileItem.note ? <span className="file-note-text">{fileItem.note}</span> : null}
              </div>
            ))}
          </div>
        ) : (
          field.key === 'password' && activeModuleId === 'employee-management' ? (
            <div className="row-actions">
              <strong>
                {detailValue !== null && detailValue !== undefined && detailValue !== ''
                  ? showEmployeePortalPassword
                    ? detailValue
                    : '••••••••'
                  : '—'}
              </strong>
              {detailValue !== null && detailValue !== undefined && detailValue !== '' ? (
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => setShowEmployeePortalPassword((prev) => !prev)}
                >
                  {showEmployeePortalPassword ? 'Hide' : 'Show'}
                </button>
              ) : null}
            </div>
          ) : (
            <strong>{detailValue !== null && detailValue !== undefined && detailValue !== '' ? detailValue : '—'}</strong>
          )
        )}
      </div>
    );
  };
  const renderFormFieldControl = (field) => {
    if (!field) {
      return null;
    }
    const inputMax =
      activeModuleId === 'employee-management' && field.key === 'dob' && field.type === 'date'
        ? getLatestAllowedEmployeeDob()
        : undefined;
    const isPhoneField = PHONE_FIELD_KEYS.has(String(field.key || ''));
    const isEmployeeSelfServiceLoan =
      activeModuleId === 'loan-records' && currentUser && currentUser.role === 'employee';
    if (
      isEmployeeSelfServiceLoan &&
      (field.key === 'employee' ||
        field.key === 'employeeId' ||
        field.key === 'status' ||
        field.key === 'balance' ||
        field.key === 'interestPercent' ||
        field.key === 'overduePenaltyPercentPerDay')
    ) {
      return (
        <label key={field.key}>
          <span>{getFieldLabel(field)}</span>
          <input value={formValues[field.key] ?? ''} readOnly />
        </label>
      );
    }
    return (
      <label key={field.key}>
        <span>
          {getFieldLabel(field)}
          {field.required ? ' *' : ''}
        </span>
        {field.type === 'select' ? (
          <select
            className="filter-select"
            value={formValues[field.key] ?? ''}
            onChange={(event) =>
              setFormValues((prev) => ({
                ...prev,
                [field.key]: event.target.value,
              }))
            }
          >
            <option value="">Select {getFieldLabel(field)}</option>
            {(
              field.key === 'department' && activeModuleId === 'employee-management'
                ? currentDepartmentOptions
                : field.key === 'employmentState' && activeModuleId === 'employee-management'
                  ? currentEmploymentStageOptions
                  : field.key === 'assignedShift' && activeModuleId === 'employee-management'
                    ? attendanceShiftOptions.map((shift) => shift.name)
                    : field.key === 'shift' && activeModuleId === 'attendance-time'
                      ? attendanceShiftOptions.map((shift) => shift.name)
                  : field.options || []
            ).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.type === 'textarea' ? (
          <textarea
            className="form-textarea"
            value={formValues[field.key] ?? ''}
            onChange={(event) =>
              setFormValues((prev) => ({
                ...prev,
                [field.key]: event.target.value,
              }))
            }
          />
        ) : field.type === 'file' ? (
          <>
            <input
              type="file"
              multiple={field.multiple}
              onChange={async (event) => {
                const selectedFiles = Array.from(event.target.files || []);
                if (selectedFiles.length === 0) {
                  return;
                }
                const selectedFilesMeta = await Promise.all(
                  selectedFiles.map(async (file) => ({
                    name: file.name,
                    url: await readFileForStorage(file),
                    isImage: file.type.startsWith('image/'),
                    note: '',
                  }))
                );
                setFormValues((prev) => {
                  const previousFiles = Array.isArray(prev[`${field.key}Files`]) ? prev[`${field.key}Files`] : [];
                  const mergedFiles = field.multiple ? [...previousFiles, ...selectedFilesMeta] : selectedFilesMeta;
                  const mergedImagePreviews = mergedFiles.filter((file) => file.isImage).map((file) => file.url);
                  return {
                    ...prev,
                    [field.key]: mergedFiles.map((file) => file.name).join(', '),
                    [`${field.key}Preview`]: field.multiple
                      ? mergedImagePreviews
                      : mergedImagePreviews[0] || '',
                    [`${field.key}Files`]: mergedFiles,
                  };
                });
              }}
            />
            {formValues[field.key] ? <span className="file-name">{formValues[field.key]}</span> : null}
            {Array.isArray(formValues[`${field.key}Files`]) && formValues[`${field.key}Files`].length > 0 ? (
              <div className="file-link-list">
                {formValues[`${field.key}Files`].map((fileItem, index) => (
                  <div className="file-entry-card" key={`${field.key}-${fileItem.name}-${index}`}>
                    <div className="file-link-row">
                      <a className="file-link" href={fileItem.url} target="_blank" rel="noreferrer">
                        {fileItem.name}
                      </a>
                      <div className="file-inline-actions">
                        <a className="file-download" href={fileItem.url} download={fileItem.name}>
                          Download
                        </a>
                        <button
                          type="button"
                          className="file-remove-btn"
                          onClick={() =>
                            setFormValues((prev) => {
                              const previousFiles = Array.isArray(prev[`${field.key}Files`])
                                ? prev[`${field.key}Files`]
                                : [];
                              const updatedFiles = previousFiles.filter((_, itemIndex) => itemIndex !== index);
                              const updatedPreviews = updatedFiles
                                .filter((file) => file.isImage)
                                .map((file) => file.url);
                              return {
                                ...prev,
                                [field.key]: updatedFiles.map((file) => file.name).join(', '),
                                [`${field.key}Preview`]: field.multiple
                                  ? updatedPreviews
                                  : updatedPreviews[0] || '',
                                [`${field.key}Files`]: updatedFiles,
                              };
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <input
                      className="file-note-input"
                      placeholder="Document note (e.g. School Certificate, Contract)"
                      value={fileItem.note || ''}
                      onChange={(event) =>
                        setFormValues((prev) => {
                          const previousFiles = Array.isArray(prev[`${field.key}Files`])
                            ? prev[`${field.key}Files`]
                            : [];
                          const updatedFiles = previousFiles.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, note: event.target.value } : item
                          );
                          return {
                            ...prev,
                            [`${field.key}Files`]: updatedFiles,
                          };
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {!field.multiple && formValues[`${field.key}Preview`] ? (
              <img
                src={formValues[`${field.key}Preview`]}
                alt={`${getFieldLabel(field)} preview`}
                className="upload-preview"
              />
            ) : null}
          </>
        ) : field.type === 'month' ? (
          <input
            type="month"
            value={formValues[field.key] ?? ''}
            onChange={(event) =>
              setFormValues((prev) => ({
                ...prev,
                [field.key]: event.target.value,
              }))
            }
          />
        ) : (
          <input
            type={field.type || 'text'}
            value={formValues[field.key] ?? ''}
            max={inputMax}
            inputMode={isPhoneField ? 'numeric' : undefined}
            pattern={isPhoneField ? '[0-9]*' : undefined}
            onChange={(event) =>
              setFormValues((prev) => ({
                ...prev,
                [field.key]: isPhoneField ? keepDigitsOnly(event.target.value) : event.target.value,
              }))
            }
          />
        )}
      </label>
    );
  };
  const normalizeAttendanceClockings = useCallback((row) => {
    if (!row) {
      return [];
    }
    if (Array.isArray(row.clockings) && row.clockings.length > 0) {
      return row.clockings
        .map((clocking) => ({
          id: String(clocking.id || `CLK-${Date.now()}`),
          mode: clocking.mode === 'clock-out' ? 'clock-out' : 'clock-in',
          time: String(clocking.time || '').trim(),
          lat: typeof clocking.lat === 'number' ? clocking.lat : undefined,
          lng: typeof clocking.lng === 'number' ? clocking.lng : undefined,
          accuracy: typeof clocking.accuracy === 'number' ? clocking.accuracy : null,
          photoDataUrl: String(clocking.photoDataUrl || '').trim(),
          photoLocationAddress: String(clocking.photoLocationAddress || '').trim(),
          photoLat: typeof clocking.photoLat === 'number' ? clocking.photoLat : undefined,
          photoLng: typeof clocking.photoLng === 'number' ? clocking.photoLng : undefined,
          photoCapturedAt: String(clocking.photoCapturedAt || clocking.createdAt || ''),
          source: String(clocking.source || row.source || 'System'),
          createdAt: String(clocking.createdAt || ''),
        }))
        .filter((clocking) => /^\d{2}:\d{2}$/.test(clocking.time))
        .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }
    const fallbackClockings = [];
    if (row.checkIn) {
      fallbackClockings.push({
        id: `CLK-IN-${row.id || row.employeeId || Date.now()}`,
        mode: 'clock-in',
        time: String(row.checkIn),
        lat: typeof row.checkInLat === 'number' ? row.checkInLat : undefined,
        lng: typeof row.checkInLng === 'number' ? row.checkInLng : undefined,
        accuracy: typeof row.checkInAccuracy === 'number' ? row.checkInAccuracy : null,
        source: String(row.source || 'System'),
        createdAt: '',
      });
    }
    if (row.checkOut) {
      fallbackClockings.push({
        id: `CLK-OUT-${row.id || row.employeeId || Date.now()}`,
        mode: 'clock-out',
        time: String(row.checkOut),
        lat: typeof row.checkOutLat === 'number' ? row.checkOutLat : undefined,
        lng: typeof row.checkOutLng === 'number' ? row.checkOutLng : undefined,
        accuracy: typeof row.checkOutAccuracy === 'number' ? row.checkOutAccuracy : null,
        source: String(row.source || 'System'),
        createdAt: '',
      });
    }
    return fallbackClockings.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  }, []);
  const getAttendanceClockSummary = useCallback(
    (row) => {
      const clockings = normalizeAttendanceClockings(row);
      const firstClockIn = clockings.find((clocking) => clocking.mode === 'clock-in') || null;
      const lastClockOut = [...clockings].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
      const openClockInCount = clockings.reduce(
        (acc, clocking) => (clocking.mode === 'clock-in' ? acc + 1 : Math.max(0, acc - 1)),
        0
      );
      return {
        clockings,
        checkIn: firstClockIn?.time || '',
        checkOut: lastClockOut?.time || '',
        checkInLat: firstClockIn?.lat,
        checkInLng: firstClockIn?.lng,
        checkOutLat: lastClockOut?.lat,
        checkOutLng: lastClockOut?.lng,
        openClockInCount,
      };
    },
    [normalizeAttendanceClockings]
  );
  const doesAttendanceRowMatchEmployee = useCallback((row, employee) => {
    if (!row || !employee) {
      return false;
    }
    const rowEmployeeId = String(row.employeeId || '').trim();
    const rowEmployeeName = String(row.employee || '').trim().toLowerCase();
    const candidateIds = new Set(
      [String(employee.id || '').trim(), String(employee.employeeId || '').trim()].filter(Boolean)
    );
    if (rowEmployeeId && candidateIds.has(rowEmployeeId)) {
      return true;
    }
    return Boolean(rowEmployeeName) && rowEmployeeName === String(employee.fullName || '').trim().toLowerCase();
  }, []);
  const mergeMatchingAttendanceRows = useCallback(
    (matchingRows) => {
      if (!Array.isArray(matchingRows) || matchingRows.length === 0) {
        return null;
      }
      if (matchingRows.length === 1) {
        return matchingRows[0];
      }
      const sortedRows = [...matchingRows].sort((left, right) =>
        String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || ''))
      );
      const baseRow = sortedRows[0];
      const seenClockings = new Set();
      const mergedClockings = sortedRows
        .flatMap((row) => normalizeAttendanceClockings(row))
        .filter((clocking) => {
          const key = [
            String(clocking.mode || '').trim(),
            String(clocking.time || '').trim(),
            String(clocking.createdAt || '').trim(),
            String(clocking.photoCapturedAt || '').trim(),
          ].join('|');
          if (seenClockings.has(key)) {
            return false;
          }
          seenClockings.add(key);
          return true;
        })
        .sort((left, right) => {
          const timeCompare = String(left.time || '').localeCompare(String(right.time || ''));
          if (timeCompare !== 0) {
            return timeCompare;
          }
          return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
        });
      const mergedSummary = getAttendanceClockSummary({ ...baseRow, clockings: mergedClockings });
      return {
        ...baseRow,
        clockings: mergedSummary.clockings,
        checkIn: mergedSummary.checkIn || String(baseRow.checkIn || '').trim(),
        checkOut: mergedSummary.checkOut || String(baseRow.checkOut || '').trim(),
        workedHours:
          mergedSummary.checkIn && mergedSummary.checkOut
            ? formatWorkedDuration(mergedSummary.checkIn, mergedSummary.checkOut)
            : String(baseRow.workedHours || ''),
        checkInLat: mergedSummary.checkInLat,
        checkInLng: mergedSummary.checkInLng,
        checkOutLat: mergedSummary.checkOutLat,
        checkOutLng: mergedSummary.checkOutLng,
      };
    },
    [getAttendanceClockSummary, normalizeAttendanceClockings]
  );
  const getMergedAttendanceRowsForDate = useCallback(
    (targetDate) => {
      const scopedRows = attendanceRows.filter((row) => {
        if (String(row.date || '').trim() !== String(targetDate || '').trim()) {
          return false;
        }
        if (currentUser && currentUser.role === 'employee') {
          const employeeId = String(currentUser.employeeId || '').trim();
          const employeeName = String(currentUser.fullName || '').trim().toLowerCase();
          const rowEmployeeId = String(row.employeeId || '').trim();
          const rowEmployeeName = String(row.employee || '').trim().toLowerCase();
          if (employeeId) {
            return rowEmployeeId === employeeId;
          }
          if (employeeName) {
            return rowEmployeeName === employeeName;
          }
          return false;
        }
        return true;
      });
      const groupedRows = new Map();
      scopedRows.forEach((row) => {
        const matchedEmployee =
          employeeBaseRows.find((employee) => doesAttendanceRowMatchEmployee(row, employee)) || null;
        const groupingKey = matchedEmployee
          ? String(matchedEmployee.id || matchedEmployee.employeeId || matchedEmployee.fullName || '').trim().toLowerCase()
          : `${String(row.employeeId || '').trim().toLowerCase()}|${String(row.employee || '').trim().toLowerCase()}`;
        if (!groupedRows.has(groupingKey)) {
          groupedRows.set(groupingKey, []);
        }
        groupedRows.get(groupingKey).push(row);
      });
      return Array.from(groupedRows.values())
        .map((rows) => mergeMatchingAttendanceRows(rows))
        .filter(Boolean);
    },
    [attendanceRows, currentUser, doesAttendanceRowMatchEmployee, employeeBaseRows, mergeMatchingAttendanceRows]
  );
  const findAttendanceRowForEmployeeOnDate = useCallback(
    (employee, targetDate) =>
      mergeMatchingAttendanceRows(
        attendanceRows.filter(
          (row) => String(row.date || '').trim() === String(targetDate || '').trim() && doesAttendanceRowMatchEmployee(row, employee)
        )
      ),
    [attendanceRows, doesAttendanceRowMatchEmployee, mergeMatchingAttendanceRows]
  );
  const attendanceTodayRows = useMemo(() => {
    return getMergedAttendanceRowsForDate(todayIsoDate).sort((a, b) => {
      const aSummary = getAttendanceClockSummary(a);
      const bSummary = getAttendanceClockSummary(b);
      return (toMinutesFromClock(bSummary.checkIn) || -1) - (toMinutesFromClock(aSummary.checkIn) || -1);
    });
  }, [getMergedAttendanceRowsForDate, getAttendanceClockSummary, todayIsoDate]);
  useEffect(() => {
    // #region debug-point D:attendance-today
    if (activeModuleId === 'attendance-time') {
      fetch("http://192.168.1.176:7777/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "attendance-photo-clock",
          runId: "pre-fix",
          hypothesisId: "D",
          location: "frontend/src/App.js:attendanceTodayRows",
          msg: "[DEBUG] attendance today rows derived",
          data: {
            todayIsoDate,
            rowCount: attendanceTodayRows.length,
            rows: attendanceTodayRows.slice(0, 12).map((row) => {
              const summary = getAttendanceClockSummary(row);
              return {
                id: String(row?.id || ''),
                employeeId: String(row?.employeeId || ''),
                employee: String(row?.employee || ''),
                date: String(row?.date || ''),
                status: String(row?.status || ''),
                checkIn: String(summary.checkIn || ''),
                checkOut: String(summary.checkOut || ''),
                clockings: Array.isArray(summary.clockings) ? summary.clockings.length : 0,
              };
            }),
          },
          ts: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion
  }, [activeModuleId, attendanceTodayRows, getAttendanceClockSummary, todayIsoDate]);
  const attendanceLateCount = useMemo(
    () => attendanceTodayRows.filter((row) => String(row.status || '').toLowerCase() === 'late').length,
    [attendanceTodayRows]
  );
  const selectedAttendanceEmployee = useMemo(() => {
    if (currentUser && currentUser.role === 'employee') {
      return getCurrentEmployeeRow();
    }
    return employeeBaseRows.find((employee) => employee.id === attendanceClockDraft.employeeId) || null;
  }, [attendanceClockDraft.employeeId, currentUser, employeeBaseRows, getCurrentEmployeeRow]);
  useEffect(() => {
    const selectedEmployeeId = String(selectedAttendanceEmployee?.id || '').trim();
    if (!selectedEmployeeId) {
      if (!attendanceClockDraft.shift && attendanceShiftOptions.length > 0) {
        setAttendanceClockDraft((prev) => ({ ...prev, shift: attendanceShiftOptions[0].name }));
      }
      return;
    }
    if (lastAttendanceShiftAutoEmployeeIdRef.current === selectedEmployeeId) {
      return;
    }
    const preferredShift = String(selectedAttendanceEmployee?.assignedShift || '').trim();
    if (preferredShift) {
      setAttendanceClockDraft((prev) => ({ ...prev, shift: preferredShift }));
      lastAttendanceShiftAutoEmployeeIdRef.current = selectedEmployeeId;
      return;
    }
    if (!attendanceClockDraft.shift && attendanceShiftOptions.length > 0) {
      setAttendanceClockDraft((prev) => ({ ...prev, shift: attendanceShiftOptions[0].name }));
    }
    lastAttendanceShiftAutoEmployeeIdRef.current = selectedEmployeeId;
  }, [attendanceClockDraft.shift, attendanceShiftOptions, selectedAttendanceEmployee]);
  const attendanceSearchMatches = useMemo(() => {
    if (currentUser && currentUser.role === 'employee') {
      return [];
    }
    return filterEmployeesBySearch(employeeBaseRows, attendanceSearchText);
  }, [attendanceSearchText, currentUser, employeeBaseRows]);
  const selectedFingerprintEmployee = useMemo(
    () => employeeBaseRows.find((employee) => employee.id === fingerprintDraft.employeeId) || null,
    [employeeBaseRows, fingerprintDraft.employeeId]
  );
  const getShiftScheduleForAttendance = useCallback(
    ({ attendanceRow, employee }) => {
      const shiftName =
        String(attendanceRow?.shift || '').trim() ||
        String(employee?.assignedShift || '').trim() ||
        attendanceShiftOptions[0]?.name ||
        'Default';
      const shiftConfig = resolveShiftConfig(shiftName);
      const reportMinutes = toMinutesFromClock(shiftConfig?.reportTime || appSettings.attendanceReportTime) ?? 0;
      const lateAfterMinutes = reportMinutes + Math.max(0, Number(shiftConfig?.graceInMinutes) || 0);
      const shiftEndMinutes = toMinutesFromClock(shiftConfig?.shiftEnd || appSettings.attendanceShiftEnd) ?? 0;
      const clockOutGraceMinutes = Math.max(0, Number(shiftConfig?.graceOutMinutes) || 0);
      const overtimeStartAfterMinutes = Math.max(0, Number(shiftConfig?.overtimeStartAfterMinutes) || 0);
      return {
        shiftName: shiftConfig?.name || shiftName,
        reportMinutes,
        lateAfterMinutes,
        shiftEndMinutes,
        shiftEndWithGraceMinutes: shiftEndMinutes + clockOutGraceMinutes,
        overtimeEnabled: Boolean(shiftConfig?.overtimeEnabled),
        overtimeStartAfterMinutes,
        overtimeStartMinutes: shiftEndMinutes + overtimeStartAfterMinutes,
        overtimePayPerMinute: Math.max(0, Number(shiftConfig?.overtimePayPerMinute) || 0),
      };
    },
    [
      appSettings.attendanceReportTime,
      appSettings.attendanceShiftEnd,
      attendanceShiftOptions,
      resolveShiftConfig,
    ]
  );
  const penaltyAdjustmentRows = useMemo(() => moduleRowsState['attendance-penalty-adjustments'] || [], [moduleRowsState]);
  const attendanceComplianceRows = useMemo(() => {
    const targetDate = attendanceAuditDate || todayIsoDate;
    const nowMinutes = toMinutesFromClock(getCurrentClockValue()) || 0;
    const isPastDate = targetDate < todayIsoDate;
    const scopedEmployees = employeeBaseRows.filter((employee) => {
      if (currentUser && currentUser.role === 'employee') {
        const employeeId = String(currentUser.employeeId || '').trim();
        const employeeName = String(currentUser.fullName || '').trim();
        const rowEmployeeId = String(employee.id || '').trim();
        const rowEmployeeName = String(employee.fullName || '').trim();
        if (employeeId) {
          return rowEmployeeId === employeeId;
        }
        if (employeeName) {
          return rowEmployeeName === employeeName;
        }
        return false;
      }
      return true;
    });
    const buildComplianceRow = (employee, matchedAttendanceRow = null) => {
      const attendanceSummary = getAttendanceClockSummary(matchedAttendanceRow);
      const shiftSchedule = getShiftScheduleForAttendance({ attendanceRow: matchedAttendanceRow, employee });
      const payrollProfile = getEmployeePayrollProfile({
        moduleRowsState,
        employeeBaseRows,
        employeeId: employee.id,
        employeeName: employee.fullName,
      });
      const basicPay = toNumberValue(payrollProfile?.basicPay);
      const workingDays = Math.max(1, toNumberValue(payrollProfile?.workingDays) || 26);
      const dailyWage = basicPay > 0 ? basicPay / workingDays : 0;
      const leaveMatch = leaveRows.find((leaveRow) => {
        const leaveEmployeeId = String(leaveRow.employeeId || '').trim();
        const leaveEmployee = String(leaveRow.employee || '').trim();
        const status = String(leaveRow.status || '').toLowerCase();
        const matchesEmployee =
          leaveEmployeeId === String(employee.id || '') || leaveEmployee === String(employee.fullName || '');
        return (
          matchesEmployee &&
          (status === 'approved' || status === 'active') &&
          String(leaveRow.startDate || '') <= targetDate &&
          String(leaveRow.endDate || '') >= targetDate
        );
      });
      const employeeStatus = String(employee.status || '').toLowerCase();
      const employeeStage = String(employee.employmentState || '').toLowerCase();
      const isOffDuty = employeeStatus !== 'active' || employeeStage === 'terminated' || employeeStage === 'suspended';
      const isOnLeave = Boolean(leaveMatch);
      const isExempt = isOffDuty || isOnLeave;
      const checkInMinutes = toMinutesFromClock(attendanceSummary.checkIn);
      const rawCheckOut = String(attendanceSummary.checkOut || '');
      const hasMidnightCheckout = rawCheckOut === '00:00' || rawCheckOut === '24:00';
      const checkOutMinutes = hasMidnightCheckout ? null : toMinutesFromClock(rawCheckOut);
      const hasClockIn = checkInMinutes !== null;
      const hasClockOut = checkOutMinutes !== null && checkOutMinutes > (checkInMinutes ?? 0);
      const isLate = hasClockIn && checkInMinutes > shiftSchedule.lateAfterMinutes;
      const leftEarly =
        hasClockOut && shiftSchedule.shiftEndMinutes > 0 && checkOutMinutes < shiftSchedule.shiftEndMinutes;
      const overtimeMinutes =
        hasClockOut && shiftSchedule.overtimeEnabled
          ? Math.max(0, (checkOutMinutes ?? 0) - shiftSchedule.overtimeStartMinutes)
          : 0;
      const overtimeAmount = overtimeMinutes * Math.max(0, Number(shiftSchedule.overtimePayPerMinute) || 0);
      const lateDeduction = toNumberValue(matchedAttendanceRow?.deductionAmount);
      const countMissingClockIn =
        !isExempt &&
        !hasClockIn &&
        (isPastDate || (targetDate === todayIsoDate && nowMinutes >= shiftSchedule.lateAfterMinutes));
      const countMissingClockOut =
        !isExempt &&
        !hasClockOut &&
        (isPastDate || (targetDate === todayIsoDate && nowMinutes >= shiftSchedule.shiftEndWithGraceMinutes));
      const missingCount = Number(countMissingClockIn) + Number(countMissingClockOut);
      const noClockInPenalty = missingCount === 1 && countMissingClockIn ? dailyWage / 2 : 0;
      const noClockOutPenalty = missingCount === 1 && countMissingClockOut ? dailyWage / 2 : 0;
      const absentPenalty = missingCount >= 2 ? dailyWage : 0;
      const pendingClockIn = !isExempt && !hasClockIn && !countMissingClockIn;
      const penalties = [];
      if (lateDeduction > 0) {
        penalties.push({
          type: 'lateness',
          label: 'Late Clock In',
          amount: lateDeduction,
        });
      }
      if (noClockInPenalty > 0) {
        penalties.push({
          type: 'no-clock-in',
          label: 'No Clock In (Half Day)',
          amount: noClockInPenalty,
        });
      }
      if (noClockOutPenalty > 0) {
        penalties.push({
          type: 'no-clock-out',
          label: 'No Clock Out (Half Day)',
          amount: noClockOutPenalty,
        });
      }
      if (absentPenalty > 0) {
        penalties.push({
          type: 'absent',
          label: 'Absent (Full Day)',
          amount: absentPenalty,
        });
      }
      let dailyStatus = 'On Time';
      if (isExempt) {
        dailyStatus = isOnLeave ? 'On Leave' : 'Off Duty';
      } else if (absentPenalty > 0) {
        dailyStatus = 'Absent';
      } else if (!hasClockIn) {
        dailyStatus = pendingClockIn ? 'Pending Clock In' : 'No Clock In';
      } else if (noClockOutPenalty > 0) {
        dailyStatus = 'Clocked In Once';
      } else if (isLate) {
        dailyStatus = 'Late';
      }
      if (dailyStatus === 'On Time' && leftEarly) {
        dailyStatus = 'Left Early';
      }
      return {
        date: targetDate,
        employeeId: employee.id,
        employee: employee.fullName,
        department: employee.department || 'Unassigned',
        shift: shiftSchedule.shiftName,
        checkIn: attendanceSummary.checkIn,
        checkOut: attendanceSummary.checkOut,
        clockings: attendanceSummary.clockings,
        dailyWage,
        dailyStatus,
        isLate,
        leftEarly,
        overtimeMinutes,
        overtimeAmount,
        penalties,
      };
    };
    const attendanceRowsForDate = getMergedAttendanceRowsForDate(targetDate);
    const usedEmployeeIds = new Set();
    const rowsFromAttendance = attendanceRowsForDate
      .map((attendanceRow) => {
        const matchedEmployee =
          scopedEmployees.find((employee) => doesAttendanceRowMatchEmployee(attendanceRow, employee)) || null;
        if (!matchedEmployee) {
          return null;
        }
        usedEmployeeIds.add(String(matchedEmployee.id || '').trim());
        return buildComplianceRow(matchedEmployee, attendanceRow);
      })
      .filter(Boolean);
    const missingEmployeeRows = scopedEmployees
      .filter((employee) => !usedEmployeeIds.has(String(employee.id || '').trim()))
      .map((employee) => buildComplianceRow(employee, null));
    return [...rowsFromAttendance, ...missingEmployeeRows];
  }, [
    currentUser,
    attendanceAuditDate,
    doesAttendanceRowMatchEmployee,
    employeeBaseRows,
    getMergedAttendanceRowsForDate,
    getShiftScheduleForAttendance,
    getAttendanceClockSummary,
    leaveRows,
    moduleRowsState,
    todayIsoDate,
  ]);
  const attendanceComplianceFilteredRows = useMemo(() => {
    const query = attendanceAuditSearchText.trim().toLowerCase();
    return attendanceComplianceRows.filter((row) => {
      const matchesFilter = attendanceAuditFilter === 'All' || String(row.dailyStatus) === String(attendanceAuditFilter);
      const matchesSearch =
        !query ||
        String(row.employee || '').toLowerCase().includes(query) ||
        String(row.employeeId || '').toLowerCase().includes(query) ||
        String(row.department || '').toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [attendanceAuditFilter, attendanceAuditSearchText, attendanceComplianceRows]);
  const attendancePenaltyLedgerRows = useMemo(() => {
    const scopedComplianceRows = attendanceComplianceRows.filter((row) => {
      if (currentUser && currentUser.role === 'employee') {
        const employeeId = String(currentUser.employeeId || '').trim();
        const employeeName = String(currentUser.fullName || '').trim();
        const rowEmployeeId = String(row.employeeId || '').trim();
        const rowEmployeeName = String(row.employee || '').trim();
        if (employeeId) {
          return rowEmployeeId === employeeId;
        }
        if (employeeName) {
          return rowEmployeeName === employeeName;
        }
        return false;
      }
      return true;
    });
    const ledger = [];
    scopedComplianceRows.forEach((row) => {
      row.penalties.forEach((penalty) => {
        const adjustments = penaltyAdjustmentRows.filter(
          (item) =>
            String(item.employeeId || '') === String(row.employeeId || '') &&
            String(item.date || '') === String(row.date || '') &&
            String(item.penaltyType || '') === String(penalty.type || '')
        );
        const clearedAmount = adjustments.reduce((total, item) => total + toNumberValue(item.clearedAmount), 0);
        const outstandingAmount = Math.max(0, penalty.amount - clearedAmount);
        ledger.push({
          key: `${row.employeeId}|${row.date}|${penalty.type}`,
          employeeId: row.employeeId,
          employee: row.employee,
          department: row.department,
          date: row.date,
          penaltyType: penalty.type,
          penaltyLabel: penalty.label,
          baseAmount: penalty.amount,
          clearedAmount,
          outstandingAmount,
          adjustments,
        });
      });
    });
    return ledger;
  }, [attendanceComplianceRows, currentUser, penaltyAdjustmentRows]);
  const attendancePenaltyFilteredRows = useMemo(() => {
    const query = attendanceAuditSearchText.trim().toLowerCase();
    return attendancePenaltyLedgerRows.filter((row) => {
      const matchesDate = String(row.date || '') === String(attendanceAuditDate || todayIsoDate);
      const matchesStatus =
        attendancePenaltyStatusFilter === 'All' ||
        (attendancePenaltyStatusFilter === 'Outstanding' && row.outstandingAmount > 0) ||
        (attendancePenaltyStatusFilter === 'Cleared' && row.outstandingAmount <= 0);
      const matchesSearch =
        !query ||
        String(row.employee || '').toLowerCase().includes(query) ||
        String(row.employeeId || '').toLowerCase().includes(query) ||
        String(row.department || '').toLowerCase().includes(query);
      return matchesDate && matchesStatus && matchesSearch;
    });
  }, [
    attendanceAuditDate,
    attendanceAuditSearchText,
    attendancePenaltyLedgerRows,
    attendancePenaltyStatusFilter,
    todayIsoDate,
  ]);
  const selectedPenaltyRow = useMemo(
    () => attendancePenaltyLedgerRows.find((row) => String(row.key) === String(selectedPenaltyKey)) || null,
    [attendancePenaltyLedgerRows, selectedPenaltyKey]
  );
  const selectedComplianceRow = useMemo(
    () => attendanceComplianceRows.find((row) => `${row.employeeId}-${row.date}` === selectedComplianceKey) || null,
    [attendanceComplianceRows, selectedComplianceKey]
  );
  const attendancePerformanceRange = useMemo(() => {
    const todayDate = parseIsoDateValue(todayIsoDate) || new Date();
    if (attendancePerformancePeriod === 'weekly') {
      const start = new Date(todayDate.getTime() - 6 * DAY_IN_MS);
      return { startDate: toIsoDateString(start), endDate: toIsoDateString(todayDate) };
    }
    if (attendancePerformancePeriod === 'monthly') {
      const start = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
      return { startDate: toIsoDateString(start), endDate: toIsoDateString(todayDate) };
    }
    if (attendancePerformancePeriod === 'yearly') {
      const start = new Date(todayDate.getFullYear(), 0, 1);
      return { startDate: toIsoDateString(start), endDate: toIsoDateString(todayDate) };
    }
    const startDate = attendancePerformanceStartDate || todayIsoDate;
    const endDate = attendancePerformanceEndDate || startDate;
    return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
  }, [
    attendancePerformanceEndDate,
    attendancePerformancePeriod,
    attendancePerformanceStartDate,
    todayIsoDate,
  ]);
  const attendancePerformanceRows = useMemo(() => {
    const nowMinutes = toMinutesFromClock(getCurrentClockValue()) || 0;
    const rangeStart = attendancePerformanceRange.startDate;
    const rangeEnd = attendancePerformanceRange.endDate;
    const attendanceByEmployeeDate = attendanceRows.reduce((acc, row) => {
      const key = `${String(row.employeeId || '')}|${String(row.date || '')}`;
      acc[key] = row;
      return acc;
    }, {});
    const periodDays = Math.max(
      1,
      Math.floor(
        ((parseIsoDateValue(rangeEnd)?.getTime() || 0) - (parseIsoDateValue(rangeStart)?.getTime() || 0)) / DAY_IN_MS
      ) + 1
    );
    const scopedEmployees = employeeBaseRows.filter((employee) => {
      if (currentUser && currentUser.role === 'employee') {
        const employeeId = String(currentUser.employeeId || '').trim();
        const employeeName = String(currentUser.fullName || '').trim();
        const rowEmployeeId = String(employee.id || '').trim();
        const rowEmployeeName = String(employee.fullName || '').trim();
        if (employeeId) {
          return rowEmployeeId === employeeId;
        }
        if (employeeName) {
          return rowEmployeeName === employeeName;
        }
        return false;
      }
      return true;
    });
    return scopedEmployees
      .map((employee) => {
        const employeeStatus = String(employee.status || '').toLowerCase();
        const employeeStage = String(employee.employmentState || '').toLowerCase();
        const isOffDuty = employeeStatus !== 'active' || employeeStage === 'terminated' || employeeStage === 'suspended';
        const leaveApplications = leaveRows.filter((leaveRow) => {
          const leaveEmployeeId = String(leaveRow.employeeId || '').trim();
          const leaveEmployeeName = String(leaveRow.employee || '').trim();
          const matches =
            leaveEmployeeId === String(employee.id || '') || leaveEmployeeName === String(employee.fullName || '');
          return matches && String(leaveRow.startDate || '') >= rangeStart && String(leaveRow.startDate || '') <= rangeEnd;
        });
        const leaveDays = leaveRows.reduce((total, leaveRow) => {
          const leaveEmployeeId = String(leaveRow.employeeId || '').trim();
          const leaveEmployeeName = String(leaveRow.employee || '').trim();
          const leaveStatus = String(leaveRow.status || '').toLowerCase();
          const matches =
            leaveEmployeeId === String(employee.id || '') || leaveEmployeeName === String(employee.fullName || '');
          if (!matches || !['approved', 'active', 'planned'].includes(leaveStatus)) {
            return total;
          }
          return total + overlapDaysInclusive(leaveRow.startDate, leaveRow.endDate, rangeStart, rangeEnd);
        }, 0);
        let expectedWorkDays = 0;
        let onTimeCompleteDays = 0;
        let lateDays = 0;
        let absentDays = 0;
        let clockedOnceDays = 0;
        let leftEarlyDays = 0;
        let noClockInDays = 0;
        let noClockOutDays = 0;
        for (let cursor = parseIsoDateValue(rangeStart); cursor && cursor <= (parseIsoDateValue(rangeEnd) || cursor); ) {
          const currentDate = toIsoDateString(cursor);
          const isPastDate = currentDate < todayIsoDate;
          const leaveOnDate = leaveRows.find((leaveRow) => {
            const leaveEmployeeId = String(leaveRow.employeeId || '').trim();
            const leaveEmployeeName = String(leaveRow.employee || '').trim();
            const leaveStatus = String(leaveRow.status || '').toLowerCase();
            const matches =
              leaveEmployeeId === String(employee.id || '') || leaveEmployeeName === String(employee.fullName || '');
            return (
              matches &&
              ['approved', 'active', 'planned'].includes(leaveStatus) &&
              String(leaveRow.startDate || '') <= currentDate &&
              String(leaveRow.endDate || '') >= currentDate
            );
          });
          if (!isOffDuty && !leaveOnDate) {
            expectedWorkDays += 1;
            const attendanceRow = attendanceByEmployeeDate[`${String(employee.id || '')}|${currentDate}`];
            const attendanceSummary = getAttendanceClockSummary(attendanceRow);
            const shiftSchedule = getShiftScheduleForAttendance({ attendanceRow, employee });
            const checkInMinutes = toMinutesFromClock(attendanceSummary.checkIn);
            const checkOutRaw = String(attendanceSummary.checkOut || '');
            const checkOutMinutes = toMinutesFromClock(checkOutRaw);
            const hasClockIn = checkInMinutes !== null;
            const hasClockOut =
              checkOutRaw !== '00:00' &&
              checkOutRaw !== '24:00' &&
              checkOutMinutes !== null &&
              checkOutMinutes > (checkInMinutes ?? 0);
            const isLate = hasClockIn && checkInMinutes > shiftSchedule.lateAfterMinutes;
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
              (isPastDate || (currentDate === todayIsoDate && nowMinutes >= shiftSchedule.lateAfterMinutes));
            const missingClockOut =
              !hasClockOut &&
              (isPastDate ||
                (currentDate === todayIsoDate && nowMinutes >= shiftSchedule.shiftEndWithGraceMinutes));
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
          cursor = new Date(cursor.getTime() + DAY_IN_MS);
        }
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
          employeeId: employee.id,
          employee: employee.fullName,
          department: employee.department || 'Unassigned',
          periodStart: rangeStart,
          periodEnd: rangeEnd,
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
        const matchesDepartment =
          attendancePerformanceDepartmentFilter === 'All' ||
          String(row.department || '') === String(attendancePerformanceDepartmentFilter);
        if (!matchesDepartment) {
          return false;
        }
        const query = attendancePerformanceSearchText.trim().toLowerCase();
        if (!query) {
          return true;
        }
        return (
          String(row.employee || '').toLowerCase().includes(query) ||
          String(row.employeeId || '').toLowerCase().includes(query) ||
          String(row.department || '').toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        if (attendancePerformanceRankMetric === 'least-leave-applications') {
          return a.leaveApplications - b.leaveApplications || b.attendanceScore - a.attendanceScore;
        }
        if (attendancePerformanceRankMetric === 'most-leave-applications') {
          return b.leaveApplications - a.leaveApplications || a.attendanceScore - b.attendanceScore;
        }
        if (attendancePerformanceRankMetric === 'least-absent') {
          return a.absentDays - b.absentDays || b.attendanceScore - a.attendanceScore;
        }
        if (attendancePerformanceRankMetric === 'most-absent') {
          return b.absentDays - a.absentDays || a.attendanceScore - b.attendanceScore;
        }
        if (attendancePerformanceRankMetric === 'least-late') {
          return a.lateDays - b.lateDays || b.attendanceScore - a.attendanceScore;
        }
        if (attendancePerformanceRankMetric === 'most-late') {
          return b.lateDays - a.lateDays || a.attendanceScore - b.attendanceScore;
        }
        return b.attendanceScore - a.attendanceScore || Number(b.perfectAttendance) - Number(a.perfectAttendance);
      });
  }, [
    currentUser,
    attendancePerformanceRange,
    attendancePerformanceRankMetric,
    attendancePerformanceDepartmentFilter,
    attendancePerformanceSearchText,
    attendanceRows,
    employeeBaseRows,
    getShiftScheduleForAttendance,
    getAttendanceClockSummary,
    leaveRows,
    todayIsoDate,
  ]);
  const attendancePerformanceDepartmentOptions = useMemo(() => {
    const options = [...new Set(employeeBaseRows.map((row) => String(row.department || '').trim()).filter(Boolean))];
    return ['All', ...options.sort((a, b) => a.localeCompare(b))];
  }, [employeeBaseRows]);
  const selectedPerformanceRow = useMemo(
    () =>
      attendancePerformanceRows.find((row) => String(row.employeeId || '') === String(selectedPerformanceEmployeeId || '')) ||
      null,
    [attendancePerformanceRows, selectedPerformanceEmployeeId]
  );
  const selectedComplianceAttendanceRow = useMemo(() => {
    if (!selectedComplianceRow) {
      return null;
    }
    const matchedEmployee =
      employeeBaseRows.find((employee) => String(employee.id || '').trim() === String(selectedComplianceRow.employeeId || '').trim()) ||
      employeeBaseRows.find(
        (employee) => String(employee.fullName || '').trim().toLowerCase() === String(selectedComplianceRow.employee || '').trim().toLowerCase()
      ) ||
      null;
    return (
      (matchedEmployee
        ? findAttendanceRowForEmployeeOnDate(matchedEmployee, selectedComplianceRow.date)
        : attendanceRows.find(
            (attendanceRow) =>
              String(attendanceRow.date || '').trim() === String(selectedComplianceRow.date || '').trim() &&
              String(attendanceRow.employee || '').trim().toLowerCase() ===
                String(selectedComplianceRow.employee || '').trim().toLowerCase()
          )) || null
    );
  }, [attendanceRows, employeeBaseRows, findAttendanceRowForEmployeeOnDate, selectedComplianceRow]);
  const selectedComplianceClockings = useMemo(() => {
    if (selectedComplianceAttendanceRow) {
      return normalizeAttendanceClockings(selectedComplianceAttendanceRow);
    }
    if (selectedComplianceRow) {
      return normalizeAttendanceClockings(selectedComplianceRow);
    }
    return [];
  }, [normalizeAttendanceClockings, selectedComplianceAttendanceRow, selectedComplianceRow]);
  const selectedComplianceClockingMapPoints = useMemo(
    () =>
      selectedComplianceClockings.filter(
        (clocking) => typeof clocking.lat === 'number' && !Number.isNaN(clocking.lat) && typeof clocking.lng === 'number' && !Number.isNaN(clocking.lng)
      ),
    [selectedComplianceClockings]
  );
  const selectedComplianceClockingBounds = useMemo(() => {
    if (selectedComplianceClockingMapPoints.length === 0) {
      return null;
    }
    let minLat = selectedComplianceClockingMapPoints[0].lat;
    let maxLat = selectedComplianceClockingMapPoints[0].lat;
    let minLng = selectedComplianceClockingMapPoints[0].lng;
    let maxLng = selectedComplianceClockingMapPoints[0].lng;
    selectedComplianceClockingMapPoints.forEach((point) => {
      if (point.lat < minLat) {
        minLat = point.lat;
      }
      if (point.lat > maxLat) {
        maxLat = point.lat;
      }
      if (point.lng < minLng) {
        minLng = point.lng;
      }
      if (point.lng > maxLng) {
        maxLng = point.lng;
      }
    });
    return {
      minLat,
      maxLat,
      minLng,
      maxLng,
    };
  }, [selectedComplianceClockingMapPoints]);
  const selectedComplianceClockingMapNodes = useMemo(() => {
    if (!selectedComplianceClockingBounds) {
      return [];
    }
    const latRange = selectedComplianceClockingBounds.maxLat - selectedComplianceClockingBounds.minLat || 0.000001;
    const lngRange = selectedComplianceClockingBounds.maxLng - selectedComplianceClockingBounds.minLng || 0.000001;
    return selectedComplianceClockingMapPoints.map((point, index) => {
      const x = ((point.lng - selectedComplianceClockingBounds.minLng) / lngRange) * 100;
      const y = ((selectedComplianceClockingBounds.maxLat - point.lat) / latRange) * 100;
      return {
        ...point,
        x: Math.max(2, Math.min(98, x)),
        y: Math.max(2, Math.min(98, y)),
        index,
      };
    });
  }, [selectedComplianceClockingBounds, selectedComplianceClockingMapPoints]);
  const displayedComplianceTrailNodes = useMemo(() => {
    if (selectedComplianceClockingMapNodes.length === 0) {
      return [];
    }
    if (!complianceReplayActive && complianceReplayIndex === 0) {
      return selectedComplianceClockingMapNodes;
    }
    return selectedComplianceClockingMapNodes.slice(0, complianceReplayIndex + 1);
  }, [complianceReplayActive, complianceReplayIndex, selectedComplianceClockingMapNodes]);
  const displayedComplianceTrailMapPoints = useMemo(
    () =>
      displayedComplianceTrailNodes.filter(
        (point) => typeof point.lat === 'number' && !Number.isNaN(point.lat) && typeof point.lng === 'number' && !Number.isNaN(point.lng)
      ),
    [displayedComplianceTrailNodes]
  );
  const selectedComplianceClockingSessions = useMemo(() => {
    const sessions = [];
    let activeClockIn = null;
    selectedComplianceClockings.forEach((clocking) => {
      if (clocking.mode === 'clock-in') {
        activeClockIn = clocking;
        return;
      }
      if (clocking.mode === 'clock-out' && activeClockIn) {
        const minutesWorked = getMinutesBetweenClocks(activeClockIn.time, clocking.time);
        sessions.push({
          id: `${activeClockIn.id || activeClockIn.time}-${clocking.id || clocking.time}`,
          startTime: activeClockIn.time,
          endTime: clocking.time,
          duration:
            minutesWorked > 0
              ? formatWorkedDuration(activeClockIn.time, clocking.time)
              : '00:00',
          startLat: activeClockIn.lat,
          startLng: activeClockIn.lng,
          endLat: clocking.lat,
          endLng: clocking.lng,
        });
        activeClockIn = null;
      }
    });
    return sessions;
  }, [selectedComplianceClockings]);
  useEffect(() => {
    if (attendanceDetailModal.type !== 'compliance' || selectedComplianceClockingMapNodes.length === 0) {
      setComplianceReplayActive(false);
      setComplianceReplayIndex(0);
      return;
    }
    setComplianceReplayIndex((prev) => Math.min(prev, selectedComplianceClockingMapNodes.length - 1));
  }, [attendanceDetailModal.type, selectedComplianceClockingMapNodes.length]);
  useEffect(() => {
    if (!complianceReplayActive || selectedComplianceClockingMapNodes.length === 0) {
      return;
    }
    const intervalMs = Math.max(200, Math.round(700 / Math.max(0.5, complianceReplaySpeed)));
    const intervalId = setInterval(() => {
      setComplianceReplayIndex((prev) => Math.min(prev + 1, selectedComplianceClockingMapNodes.length - 1));
    }, intervalMs);
    return () => clearInterval(intervalId);
  }, [complianceReplayActive, complianceReplaySpeed, selectedComplianceClockingMapNodes.length]);
  useEffect(() => {
    if (
      complianceReplayActive &&
      selectedComplianceClockingMapNodes.length > 0 &&
      complianceReplayIndex >= selectedComplianceClockingMapNodes.length - 1
    ) {
      setComplianceReplayActive(false);
    }
  }, [complianceReplayActive, complianceReplayIndex, selectedComplianceClockingMapNodes.length]);
  useEffect(() => {
    if (attendanceDetailModal.type !== 'compliance' || !complianceTrailMapElementRef.current) {
      return;
    }
    const boundsSource = selectedComplianceClockingMapPoints.filter(
      (point) => typeof point.lat === 'number' && !Number.isNaN(point.lat) && typeof point.lng === 'number' && !Number.isNaN(point.lng)
    );
    if (boundsSource.length === 0) {
      if (complianceTrailMapLayerRef.current && complianceTrailMapRef.current) {
        complianceTrailMapRef.current.removeLayer(complianceTrailMapLayerRef.current);
        complianceTrailMapLayerRef.current = null;
      }
      return;
    }
    if (!complianceTrailMapRef.current) {
      complianceTrailMapRef.current = L.map(complianceTrailMapElementRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([boundsSource[0].lat, boundsSource[0].lng], 16);
      L.tileLayer(googleTileBaseUrl, {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        attribution: '&copy; Google Maps',
      }).addTo(complianceTrailMapRef.current);
    }
    const map = complianceTrailMapRef.current;
    requestAnimationFrame(() => map.invalidateSize());
    if (complianceTrailMapLayerRef.current) {
      map.removeLayer(complianceTrailMapLayerRef.current);
      complianceTrailMapLayerRef.current = null;
    }
    const layerGroup = L.layerGroup();
    if (displayedComplianceTrailMapPoints.length > 1) {
      L.polyline(
        displayedComplianceTrailMapPoints.map((point) => [point.lat, point.lng]),
        {
          color: '#0a73d9',
          weight: 4,
          opacity: 0.92,
        }
      ).addTo(layerGroup);
    }
    displayedComplianceTrailMapPoints.forEach((point) => {
      L.circleMarker([point.lat, point.lng], {
        radius: 7,
        weight: 2,
        color: '#ffffff',
        fillColor: point.mode === 'clock-in' ? '#0f9d58' : '#db4437',
        fillOpacity: 0.95,
      })
        .bindTooltip(`${point.mode === 'clock-in' ? 'IN' : 'OUT'} ${point.time || ''}`, {
          permanent: Boolean(complianceShowPointLabels),
          direction: 'top',
          offset: [0, -8],
          opacity: 0.92,
        })
        .addTo(layerGroup);
    });
    const activePoint = selectedComplianceClockingMapNodes[Math.min(complianceReplayIndex, Math.max(0, selectedComplianceClockingMapNodes.length - 1))];
    if (activePoint && typeof activePoint.lat === 'number' && typeof activePoint.lng === 'number') {
      L.circleMarker([activePoint.lat, activePoint.lng], {
        radius: 10,
        weight: 4,
        color: '#0a73d9',
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).addTo(layerGroup);
    }
    layerGroup.addTo(map);
    complianceTrailMapLayerRef.current = layerGroup;
    map.fitBounds(
      boundsSource.map((point) => [point.lat, point.lng]),
      { padding: [32, 32], maxZoom: 18 }
    );
  }, [
    attendanceDetailModal.type,
    complianceReplayIndex,
    complianceShowPointLabels,
    displayedComplianceTrailMapPoints,
    selectedComplianceClockingMapNodes,
    selectedComplianceClockingMapPoints,
  ]);
  useEffect(() => {
    return () => {
      if (complianceTrailMapRef.current) {
        complianceTrailMapRef.current.remove();
        complianceTrailMapRef.current = null;
      }
    };
  }, []);
  const selectedPerformanceAttendanceRows = useMemo(() => {
    if (!selectedPerformanceRow) {
      return [];
    }
    return attendanceRows
      .filter(
        (attendanceRow) =>
          String(attendanceRow.employeeId || '') === String(selectedPerformanceRow.employeeId || '') &&
          String(attendanceRow.date || '') >= String(selectedPerformanceRow.periodStart || '') &&
          String(attendanceRow.date || '') <= String(selectedPerformanceRow.periodEnd || '')
      )
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [attendanceRows, selectedPerformanceRow]);
  const downloadCsv = (fileName, headers, rowsToExport) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.map((header) => escape(header.label)).join(',')];
    rowsToExport.forEach((row) => {
      lines.push(headers.map((header) => escape(row[header.key])).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const downloadPdf = (title, headers, rowsToExport) => {
    if (typeof window === 'undefined') {
      return;
    }
    const safeCell = (value) =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    const tableHead = headers.map((header) => `<th>${safeCell(header.label)}</th>`).join('');
    const tableRows = rowsToExport
      .map((row) => `<tr>${headers.map((header) => `<td>${safeCell(row[header.key])}</td>`).join('')}</tr>`)
      .join('');
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      return;
    }
    printWindow.document.write(
      `<html><head><title>${safeCell(title)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;padding:16px}h2{margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d5dff2;padding:8px;font-size:12px;text-align:left}</style></head><body><h2>${safeCell(
        title
      )}</h2><table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`
    );
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };
  const hideModuleTableForAttendanceEmployee =
    activeModuleId === 'attendance-time' && currentUser && currentUser.role === 'employee';
  const showMainModuleTable =
    !hideModuleTableForAttendanceEmployee &&
    (activeModuleId !== 'attendance-time' || attendanceViewTab === 'clock') &&
    activeModuleId !== 'leave-management' &&
    activeModuleId !== 'monitoring-tracking' &&
    activeModuleId !== 'user-management' &&
    activeModuleId !== 'tenant-management' &&
    activeModuleId !== 'manual';
  const fingerprintConnectionState = useMemo(() => {
    if (appSettings.fingerprintIntegration.mode === 'simulation') {
      return 'Simulation Ready';
    }
    return appSettings.fingerprintIntegration.gatewayUrl.trim() ? 'Gateway Configured' : 'Gateway URL Needed';
  }, [appSettings.fingerprintIntegration.gatewayUrl, appSettings.fingerprintIntegration.mode]);

  const filterOptions = useMemo(() => {
    if (!activeModuleConfig) {
      return ['All'];
    }
    const optionValues = [...new Set(rows.map((row) => row[activeFilterField]).filter(Boolean))];
    return ['All', ...optionValues];
  }, [activeFilterField, activeModuleConfig, rows]);

  const filteredRows = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    const query = searchText.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const matchesSearch =
        query.length === 0 ||
        Object.values(row).some((value) => String(value).toLowerCase().includes(query));
      const matchesFilter = filterValue === 'All' || String(row[activeFilterField]) === String(filterValue);
      if (!isEmployeeModule) {
        return matchesSearch && matchesFilter;
      }
      const matchesStatus = statusFilterValue === 'All' || String(row.status) === String(statusFilterValue);
      const matchesEmploymentStage =
        employmentStageFilterValue === 'All' || String(row.employmentState) === String(employmentStageFilterValue);
      const daysLeft = getContractDaysLeft(row.contractEndDate);
      const matchesExpiryFilter =
        expiryFilterValue === 'All' ||
        (expiryFilterValue === 'within30' && Number.isFinite(daysLeft) && daysLeft >= 0 && daysLeft <= 30) ||
        (expiryFilterValue === 'after30' && Number.isFinite(daysLeft) && daysLeft > 30) ||
        (expiryFilterValue === 'expired' && Number.isFinite(daysLeft) && daysLeft < 0) ||
        (expiryFilterValue === 'no-end-date' && !Number.isFinite(daysLeft));
      return matchesSearch && matchesFilter && matchesStatus && matchesEmploymentStage && matchesExpiryFilter;
    });
    if (!isEmployeeModule || sortByValue === 'default') {
      return filtered;
    }
    if (sortByValue === 'expiry-priority') {
      return [...filtered].sort((a, b) => {
        const aDays = getContractDaysLeft(a.contractEndDate);
        const bDays = getContractDaysLeft(b.contractEndDate);
        const aBucket = !Number.isFinite(aDays) ? 3 : aDays < 0 ? 0 : aDays <= 30 ? 1 : 2;
        const bBucket = !Number.isFinite(bDays) ? 3 : bDays < 0 ? 0 : bDays <= 30 ? 1 : 2;
        if (aBucket !== bBucket) {
          return aBucket - bBucket;
        }
        return aDays - bDays;
      });
    }
    if (sortByValue === 'closest-expiry') {
      return [...filtered].sort(
        (a, b) => getContractDaysLeft(a.contractEndDate) - getContractDaysLeft(b.contractEndDate)
      );
    }
    return filtered;
  }, [
    activeFilterField,
    activeModuleConfig,
    employmentStageFilterValue,
    expiryFilterValue,
    filterValue,
    isEmployeeModule,
    rows,
    searchText,
    sortByValue,
    statusFilterValue,
  ]);

  const closeModal = () => {
    setModalState({ mode: null, rowId: null });
    setEditRowId(null);
    setFormValues({});
    setFormError('');
    setRecordSaving(false);
    setShowEmployeePortalPassword(false);
  };
  const leaveSubmenuItems = useMemo(() => {
    const items = [
      { key: 'requests', label: 'Leave Requests' },
      { key: 'department', label: 'Department Approval' },
      { key: 'hr', label: 'HR Approval' },
      { key: 'manager', label: 'Manager Approval' },
    ];
    if (!currentUser || currentUser.role === 'employee') {
      return items.filter((item) => item.key === 'requests');
    }
    return items;
  }, [currentUser]);
  const loanSubmenuItems = useMemo(() => {
    const items = [
      { key: 'requests', label: 'Loan Requests' },
      { key: 'department', label: 'Department Approval' },
      { key: 'hr', label: 'HR Approval' },
      { key: 'manager', label: 'Manager Approval' },
    ];
    if (!currentUser || currentUser.role === 'employee') {
      return items.filter((item) => item.key === 'requests');
    }
    return items;
  }, [currentUser]);
  const showToast = (message, type = 'info') => {
    const toastId = `TST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setToasts((prev) => [...prev, { id: toastId, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    }, 3200);
  };
  const handleAssignEmployeeShift = useCallback(
    async (employeeId, shiftName) => {
      const normalizedEmployeeId = String(employeeId || '').trim();
      const normalizedShiftName = String(shiftName || '').trim();
      if (!normalizedEmployeeId || !normalizedShiftName) {
        showToast('Employee and shift are required.', 'error');
        return false;
      }
      const shiftExists = attendanceShiftOptions.some(
        (shift) => String(shift.name || '').trim() === normalizedShiftName
      );
      if (!shiftExists) {
        showToast(`Shift "${normalizedShiftName}" does not exist in settings.`, 'error');
        return false;
      }
      const currentRows = moduleRowsState['employee-management'] || [];
      const existingEmployee = currentRows.find((row) => String(row.id || '').trim() === normalizedEmployeeId);
      if (!existingEmployee) {
        showToast('Employee record not found.', 'error');
        return false;
      }
      const nextRow = {
        ...existingEmployee,
        assignedShift: normalizedShiftName,
      };
      setModuleRowsState((prev) => ({
        ...prev,
        'employee-management': (prev['employee-management'] || []).map((row) =>
          String(row.id || '').trim() === normalizedEmployeeId ? nextRow : row
        ),
      }));
      try {
        const response = await fetch(
          toApiUrl(`http://localhost:8000/api/modules/employee-management/${encodeURIComponent(normalizedEmployeeId)}`),
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nextRow),
          }
        );
        if (!response.ok) {
          throw new Error('Failed to save shift assignment');
        }
        const data = await response.json();
        const saved = data?.record || nextRow;
        setModuleRowsState((prev) => ({
          ...prev,
          'employee-management': (prev['employee-management'] || []).map((row) =>
            String(row.id || '').trim() === normalizedEmployeeId ? saved : row
          ),
        }));
        showToast(`Shift updated for ${saved.fullName || normalizedEmployeeId}.`, 'success');
        return true;
      } catch (error) {
        setModuleRowsState((prev) => ({
          ...prev,
          'employee-management': (prev['employee-management'] || []).map((row) =>
            String(row.id || '').trim() === normalizedEmployeeId ? existingEmployee : row
          ),
        }));
        showToast('Unable to save shift assignment.', 'error');
        return false;
      }
    },
    [attendanceShiftOptions, moduleRowsState]
  );
  const moduleAdapter = useModuleAdapter({
    activeModuleId,
    activeModuleConfig,
    appSettings,
    currentUser,
    employeeBaseRows,
    formValues,
    modalState,
    moduleRowsState,
    setFormError,
    setFormValues,
    setModuleRowsState,
    showToast,
    getTodayIsoDate,
    getCurrentClockValue,
    toMinutesFromClock,
    getMinutesBetweenClocks,
    isLoanCountableRecord,
  });

  const handleModuleChange = (moduleId) => {
    setActiveModuleId(moduleId);
    setLeaveMenuExpanded(moduleId === 'leave-management');
    setLoanMenuExpanded(moduleId === 'loan-records');
    if (moduleId === 'settings') {
      setSettingsTab('general');
    }
    setSearchText('');
    setFilterValue('All');
    setStatusFilterValue('All');
    setEmploymentStageFilterValue('All');
    setExpiryFilterValue('All');
    setSortByValue('default');
    setSelectedRowId(null);
    setAttendanceSearchText('');
    setAttendanceViewTab('clock');
    setAttendanceAuditDate(getTodayIsoDate());
    setAttendanceAuditFilter('All');
    setAttendanceAuditSearchText('');
    setAttendancePenaltyStatusFilter('Outstanding');
    setSelectedComplianceKey('');
    setSelectedPenaltyKey('');
    setAttendancePerformancePeriod('monthly');
    setAttendancePerformanceStartDate(getTodayIsoDate());
    setAttendancePerformanceEndDate(getTodayIsoDate());
    setAttendancePerformanceRankMetric('perfect-attendance');
    setAttendancePerformanceDepartmentFilter('All');
    setAttendancePerformanceSearchText('');
    setSelectedPerformanceEmployeeId('');
    setAttendanceDetailModal({ type: '', key: '' });
    setLeaveViewTab('requests');
    setLeaveRequestPageTab('requests');
    setLeaveSearchText('');
    setLeaveDepartmentFilter('All');
    setLeaveStatusFilter('All');
    setLeaveSortBy('date-desc');
    setLeaveActionMessage('');
    setLeaveApprovalDrafts({});
    setPenaltyActionDraft({
      mode: 'partial',
      amount: '',
      remark: '',
    });
    closeModal();
  };
  const getWebClockLocationMetadata = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.geolocation) {
      return null;
    }
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        });
      });
      const lat = Number(position?.coords?.latitude);
      const lng = Number(position?.coords?.longitude);
      const accuracy = Number(position?.coords?.accuracy);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
      };
    } catch (error) {
      return null;
    }
  }, []);
  const buildAttendanceFromClockings = (baseRow, clockings) => {
    const sortedClockings = [...clockings].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    const firstClockIn = sortedClockings.find((clocking) => clocking.mode === 'clock-in') || null;
    const lastClockOut = [...sortedClockings].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
    return {
      ...baseRow,
      clockings: sortedClockings,
      checkIn: firstClockIn?.time || '',
      checkOut: lastClockOut?.time || '',
      workedHours:
        firstClockIn?.time && lastClockOut?.time
          ? formatWorkedDuration(firstClockIn.time, lastClockOut.time)
          : baseRow.workedHours || '',
      checkInLat: firstClockIn?.lat,
      checkInLng: firstClockIn?.lng,
      checkInAccuracy: firstClockIn?.accuracy ?? null,
      checkOutLat: lastClockOut?.lat,
      checkOutLng: lastClockOut?.lng,
      checkOutAccuracy: lastClockOut?.accuracy ?? null,
    };
  };
  const handleClockIn = async (options = {}) => {
    const photoDataUrl = String(options?.photoDataUrl || '').trim();
    let effectiveEmployee = selectedAttendanceEmployee || getCurrentEmployeeRow();
    if (!effectiveEmployee || !effectiveEmployee.id) {
      showToast('Select an employee before clock in.', 'error');
      return false;
    }
    if (Boolean(appSettings.requireWebClockInPhoto) && !photoDataUrl) {
      showToast('Clock-in selfie is required before clocking in on web.', 'error');
      return false;
    }
    const checkInTime = getCurrentClockValue();
    const nowDate = getTodayIsoDate();
    const selectedShiftName =
      String(attendanceClockDraft.shift || '').trim() ||
      String(effectiveEmployee.assignedShift || '').trim() ||
      attendanceShiftOptions[0]?.name ||
      'Default';
    const selectedShiftConfig = resolveShiftConfig(selectedShiftName);
    const lateRuleMinutes =
      (toMinutesFromClock(selectedShiftConfig?.reportTime) ?? toMinutesFromClock(appSettings.attendanceReportTime) ?? 0) +
      Math.max(0, Number(selectedShiftConfig?.graceInMinutes) || 0);
    const checkInMinutes = toMinutesFromClock(checkInTime);
    const lateMinutes =
      lateRuleMinutes === null || checkInMinutes === null ? 0 : Math.max(0, checkInMinutes - lateRuleMinutes);
    const status = lateMinutes > 0 ? 'Late' : 'On Time';
    const rowId = `ATT-${Date.now().toString().slice(-6)}`;
    const payrollProfile = getEmployeePayrollProfile({
      moduleRowsState,
      employeeBaseRows,
      employeeId: effectiveEmployee.id,
      employeeName: effectiveEmployee.fullName,
    });
    const basicPay = toNumberValue(payrollProfile?.basicPay);
    const workingDays = Math.max(1, Number(payrollProfile?.workingDays || appSettings.payrollWorkingDays) || 1);
    const scheduledMinutes = Math.max(
      1,
      getMinutesBetweenClocks(
        selectedShiftConfig?.reportTime || appSettings.attendanceReportTime,
        selectedShiftConfig?.shiftEnd || appSettings.attendanceShiftEnd
      )
    );
    const autoMinuteRate = basicPay > 0 ? basicPay / workingDays / scheduledMinutes : 0;
    const fixedMinuteRate = Math.max(0, Number(appSettings.attendanceFixedDeductionPerMinute) || 0);
    const fixedScope = String(appSettings.attendanceFixedScope || 'all');
    const fixedApplies =
      fixedScope === 'all' ||
      (fixedScope === 'department' &&
        String(effectiveEmployee.department || '') === String(appSettings.attendanceFixedDepartment || '')) ||
      (fixedScope === 'individual' &&
        String(effectiveEmployee.id || '') === String(appSettings.attendanceFixedEmployeeId || ''));
    const deductionRatePerMinute =
      appSettings.attendanceCalculationMode === 'fixed' && fixedApplies ? fixedMinuteRate : autoMinuteRate;
    const deductionAmount = lateMinutes * deductionRatePerMinute;

    const currentRows = moduleRowsState['attendance-time'] || [];
    const previousAttendanceRows = [...currentRows];
    const existingRowIndex = currentRows.findIndex(
      (row) => doesAttendanceRowMatchEmployee(row, effectiveEmployee) && String(row.date || '') === nowDate
    );
    const existingRow = existingRowIndex >= 0 ? currentRows[existingRowIndex] : null;
    const existingClockings = normalizeAttendanceClockings(existingRow);
    const openClockInCount = existingClockings.reduce(
      (acc, clocking) => (clocking.mode === 'clock-in' ? acc + 1 : Math.max(0, acc - 1)),
      0
    );
    if (openClockInCount > 0) {
      showToast('Clock out the last active session before clocking in again.', 'error');
      return false;
    }
    const capturedAt = new Date().toISOString();
    const locationMetadata = await getWebClockLocationMetadata();
    const baseRow = {
      id: existingRowIndex >= 0 ? currentRows[existingRowIndex].id : rowId,
      employee: effectiveEmployee.fullName,
      employeeId: effectiveEmployee.id,
      date: nowDate,
      shift: selectedShiftConfig?.name || selectedShiftName,
      checkIn: '',
      checkOut: '',
      workedHours: existingRow?.workedHours || '',
      lateMinutes: String(lateMinutes),
      deductionRatePerMinute: deductionRatePerMinute.toFixed(3),
      deductionAmount: deductionAmount.toFixed(2),
      source: appSettings.fingerprintIntegration.mode === 'live' ? 'Fingerprint Device' : 'Manual Clock',
      status,
    };
    const newClocking = {
      id: `CLK-${Date.now().toString().slice(-7)}`,
      mode: 'clock-in',
      time: checkInTime,
      lat: Number.isFinite(locationMetadata?.lat) ? locationMetadata.lat : null,
      lng: Number.isFinite(locationMetadata?.lng) ? locationMetadata.lng : null,
      accuracy: typeof locationMetadata?.accuracy === 'number' ? locationMetadata.accuracy : null,
      photoDataUrl,
      photoLocationAddress: String(locationMetadata?.locationAddress || '').trim(),
      photoLat: Number.isFinite(locationMetadata?.lat) ? locationMetadata.lat : undefined,
      photoLng: Number.isFinite(locationMetadata?.lng) ? locationMetadata.lng : undefined,
      photoCapturedAt: capturedAt,
      source: baseRow.source,
      createdAt: capturedAt,
    };
    const newRow = buildAttendanceFromClockings(baseRow, [...existingClockings, newClocking]);

    setModuleRowsState((prev) => {
      const prevRows = prev['attendance-time'] || [];
      if (existingRowIndex >= 0) {
        const updatedRows = [...prevRows];
        updatedRows[existingRowIndex] = { ...prevRows[existingRowIndex], ...newRow };
        return { ...prev, 'attendance-time': updatedRows };
      }
      return { ...prev, 'attendance-time': [newRow, ...prevRows] };
    });

    try {
      const url =
        existingRowIndex >= 0
          ? toApiUrl(`http://localhost:8000/api/modules/attendance-time/${encodeURIComponent(newRow.id)}`)
          : toApiUrl('http://localhost:8000/api/modules/attendance-time');
      const method = existingRowIndex >= 0 ? 'PUT' : 'POST';
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(newRow),
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to save clock-in record');
      }
      const data = await response.json();
      const savedRecord = data?.record || newRow;
      setModuleRowsState((prev) => ({
        ...prev,
        'attendance-time': (prev['attendance-time'] || []).map((row) =>
          String(row.id || '') === String(savedRecord.id || newRow.id) ? savedRecord : row
        ),
      }));
    } catch (error) {
      setModuleRowsState((prev) => ({
        ...prev,
        'attendance-time': previousAttendanceRows,
      }));
      showToast(error instanceof Error ? error.message : 'Clock-in was not saved. Please try again.', 'error');
      return false;
    }
    showToast(`Thank you ${effectiveEmployee.fullName}, clock in captured successfully.`, 'success');
    return true;
  };

  const handleClockOut = async (clockOutTarget = null, options = {}) => {
    const photoDataUrl = String(options?.photoDataUrl || '').trim();
    const targetEmployeeId = String(clockOutTarget?.employeeId || '').trim();
    const targetDate = String(clockOutTarget?.date || getTodayIsoDate()).trim();
    const effectiveEmployee =
      (targetEmployeeId
        ? employeeBaseRows.find((employee) => String(employee.id || '') === targetEmployeeId)
        : null) || selectedAttendanceEmployee;
    if (!effectiveEmployee) {
      showToast('Select an employee before clock out.', 'error');
      return false;
    }
    if (Boolean(appSettings.requireWebClockInPhoto) && !photoDataUrl) {
      showToast('Clock-out selfie is required before clocking out on web.', 'error');
      return false;
    }
    const checkOutTime = getCurrentClockValue();
    const currentRows = moduleRowsState['attendance-time'] || [];
    const previousAttendanceRows = [...currentRows];
    const existingRow = currentRows.find(
      (row) => doesAttendanceRowMatchEmployee(row, effectiveEmployee) && String(row.date || '') === targetDate
    );
    if (!existingRow) {
      showToast(`No clock-in record found for ${effectiveEmployee.fullName} on ${targetDate}.`, 'error');
      return false;
    }
    const stateRows = moduleRowsState['attendance-time'] || [];
    const existingRowIndex = stateRows.findIndex(
      (row) => doesAttendanceRowMatchEmployee(row, effectiveEmployee) && String(row.date || '') === targetDate
    );
    if (existingRowIndex < 0) {
      showToast(`No clock-in record found for ${effectiveEmployee.fullName} on ${targetDate}.`, 'error');
      return false;
    }
    const matchedRow = stateRows[existingRowIndex];
    const existingClockings = normalizeAttendanceClockings(matchedRow);
    const openClockInCount = existingClockings.reduce(
      (acc, clocking) => (clocking.mode === 'clock-in' ? acc + 1 : Math.max(0, acc - 1)),
      0
    );
    if (openClockInCount <= 0) {
      showToast('No open clock-in session found for clock-out.', 'error');
      return false;
    }
    const lastClockIn = [...existingClockings].reverse().find((clocking) => clocking.mode === 'clock-in') || null;
    if (!lastClockIn || getMinutesBetweenClocks(lastClockIn.time, checkOutTime) <= 0) {
      showToast('Clock out time is invalid. Ensure check-in exists and time is after check-in.', 'error');
      return false;
    }
    const capturedAt = new Date().toISOString();
    const locationMetadata = await getWebClockLocationMetadata();
    const nextClocking = {
      id: `CLK-${Date.now().toString().slice(-7)}`,
      mode: 'clock-out',
      time: checkOutTime,
      lat: Number.isFinite(locationMetadata?.lat) ? locationMetadata.lat : null,
      lng: Number.isFinite(locationMetadata?.lng) ? locationMetadata.lng : null,
      accuracy: typeof locationMetadata?.accuracy === 'number' ? locationMetadata.accuracy : null,
      photoDataUrl,
      photoLocationAddress: String(locationMetadata?.locationAddress || '').trim(),
      photoLat: Number.isFinite(locationMetadata?.lat) ? locationMetadata.lat : undefined,
      photoLng: Number.isFinite(locationMetadata?.lng) ? locationMetadata.lng : undefined,
      photoCapturedAt: capturedAt,
      source: matchedRow.source || 'Manual Clock',
      createdAt: capturedAt,
    };
    const updatedRow = buildAttendanceFromClockings(
      {
        ...matchedRow,
      },
      [...existingClockings, nextClocking]
    );
    const shiftSchedule = getShiftScheduleForAttendance({ attendanceRow: matchedRow, employee: selectedAttendanceEmployee });
    const checkOutMinutes = toMinutesFromClock(checkOutTime) ?? 0;
    const overtimeMinutes = shiftSchedule.overtimeEnabled
      ? Math.max(0, checkOutMinutes - shiftSchedule.overtimeStartMinutes)
      : 0;
    const overtimeAmount = overtimeMinutes * Math.max(0, Number(shiftSchedule.overtimePayPerMinute) || 0);
    const normalizedUpdatedRow = {
      ...matchedRow,
      ...updatedRow,
      overtimeMinutes,
      overtimeAmount: overtimeAmount.toFixed(2),
    };

    setModuleRowsState((prev) => {
      const prevRows = prev['attendance-time'] || [];
      const idx = prevRows.findIndex(
        (row) => doesAttendanceRowMatchEmployee(row, effectiveEmployee) && String(row.date || '') === targetDate
      );
      if (idx < 0) {
        return prev;
      }
      const rowsCopy = [...prevRows];
      rowsCopy[idx] = normalizedUpdatedRow;
      return { ...prev, 'attendance-time': rowsCopy };
    });

    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/modules/attendance-time/${encodeURIComponent(normalizedUpdatedRow.id)}`),
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(normalizedUpdatedRow),
        }
      );
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error || 'Failed to save clock-out record');
      }
    } catch (error) {
      setModuleRowsState((prev) => ({
        ...prev,
        'attendance-time': previousAttendanceRows,
      }));
      showToast(error instanceof Error ? error.message : 'Clock-out was not saved. Please try again.', 'error');
      return false;
    }
    showToast(`Thank you ${effectiveEmployee.fullName}, clock out captured successfully.`, 'success');
    return true;
  };

  const handleEnrollFingerprint = () => {
    if (!selectedFingerprintEmployee) {
      return;
    }
    const normalizedDeviceUserId = fingerprintDraft.deviceUserId.trim();
    if (!normalizedDeviceUserId) {
      return;
    }
    const now = new Date();
    const enrolledOn = `${getTodayIsoDate()} ${getCurrentClockValue()}`;
    const enrollmentId = `FPT-${String(now.getTime()).slice(-6)}`;

    setModuleRowsState((prev) => {
      const currentRows = prev.fingerprint || [];
      const existingRowIndex = currentRows.findIndex((row) => row.employeeId === selectedFingerprintEmployee.id);
      const payload = {
        id: existingRowIndex >= 0 ? currentRows[existingRowIndex].id : enrollmentId,
        employee: selectedFingerprintEmployee.fullName,
        employeeId: selectedFingerprintEmployee.id,
        deviceUserId: normalizedDeviceUserId,
        templateQuality: 'Pending Capture',
        enrolledOn,
        syncStatus: appSettings.fingerprintIntegration.mode === 'live' ? 'Queued' : 'Simulated',
        status: 'Enrolled',
      };
      if (existingRowIndex >= 0) {
        const updatedRows = [...currentRows];
        updatedRows[existingRowIndex] = { ...currentRows[existingRowIndex], ...payload };
        return { ...prev, fingerprint: updatedRows };
      }
      return { ...prev, fingerprint: [payload, ...currentRows] };
    });
    setFingerprintDraft((prev) => ({ ...prev, deviceUserId: '' }));
  };

  const handleQueueFingerprintSync = () => {
    setModuleRowsState((prev) => ({
      ...prev,
      fingerprint: (prev.fingerprint || []).map((row) => ({
        ...row,
        syncStatus: appSettings.fingerprintIntegration.mode === 'live' ? 'Queued' : 'Simulated',
      })),
    }));
  };
  const getLeaveApprovalInput = (leaveId) => {
    const input = leaveApprovalDrafts[leaveId] || {};
    return {
      actorName: String(input.actorName || appSettings.penaltyActorUsername || '').trim(),
      comment: String(input.comment || '').trim(),
    };
  };
  const handleDepartmentLeaveDecision = async (leaveId, decision) => {
    if (!leaveId) {
      return;
    }
    const input = getLeaveApprovalInput(leaveId);
    if (!input.actorName || !input.comment) {
      setLeaveActionMessage('Actor name and comment are required before approval.');
      showToast('Actor name and comment are required before approval.', 'error');
      return;
    }
    const normalizedDecision = decision === 'Rejected' ? 'Rejected' : 'Approved';
    const rows = moduleRowsState['leave-management'] || [];
    const existingRow =
      rows.find((row) => String(row.id || '') === String(leaveId || '')) || null;
    if (!existingRow) {
      showToast(`Leave request ${leaveId} not found.`, 'error');
      return;
    }
    const currentApproval =
      existingRow.departmentApproval || existingRow.supervisorApproval || existingRow.managerApproval || 'Pending';
    if (String(currentApproval) !== 'Pending') {
      showToast(`Leave request ${leaveId} is already processed by department.`, 'error');
      return;
    }
    const nextRow = {
      ...existingRow,
      departmentApproval: normalizedDecision,
      departmentApprover: input.actorName,
      departmentComment: input.comment,
      departmentApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
      hrApproval: normalizedDecision === 'Rejected' ? 'Rejected' : existingRow.hrApproval || 'Pending',
      managerApproval: normalizedDecision === 'Rejected' ? 'Rejected' : existingRow.managerApproval || 'Pending',
      status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Pending HR',
    };
    setLeaveApprovalSavingId(leaveId);
    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/modules/leave-management/${encodeURIComponent(nextRow.id)}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextRow),
        }
      );
      if (!response.ok) {
        showToast(`Failed to save department decision for ${leaveId}.`, 'error');
        return;
      }
      const data = await response.json();
      const persisted = data.record || nextRow;
      setModuleRowsState((prev) => ({
        ...prev,
        'leave-management': (prev['leave-management'] || []).map((row) =>
          String(row.id || '') === String(leaveId || '') ? persisted : row
        ),
      }));
    } catch (error) {
      showToast(`Error saving department decision for ${leaveId}.`, 'error');
    } finally {
      setLeaveApprovalSavingId(null);
    }
    setLeaveApprovalDrafts((prev) => ({ ...prev, [leaveId]: { actorName: input.actorName, comment: '' } }));
    showToast(
      normalizedDecision === 'Rejected'
        ? `Department rejected leave request ${leaveId}.`
        : `Department approved leave request ${leaveId}.`,
      normalizedDecision === 'Rejected' ? 'error' : 'success'
    );
    setLeaveActionMessage(
      normalizedDecision === 'Rejected'
        ? 'Department approval rejected the leave request.'
        : 'Department approval completed. Request moved to HR.'
    );
  };
  const handleHrLeaveDecision = async (leaveId, decision) => {
    if (!leaveId) {
      return;
    }
    const input = getLeaveApprovalInput(leaveId);
    if (!input.actorName || !input.comment) {
      setLeaveActionMessage('Actor name and comment are required before approval.');
      showToast('Actor name and comment are required before approval.', 'error');
      return;
    }
    const normalizedDecision = decision === 'Rejected' ? 'Rejected' : 'Approved';
    const rows = moduleRowsState['leave-management'] || [];
    const existingRow =
      rows.find((row) => String(row.id || '') === String(leaveId || '')) || null;
    if (!existingRow) {
      showToast(`Leave request ${leaveId} not found.`, 'error');
      return;
    }
    if (String(existingRow.departmentApproval || '') !== 'Approved' || String(existingRow.hrApproval || 'Pending') !== 'Pending') {
      showToast(`Leave request ${leaveId} is not ready for HR decision.`, 'error');
      return;
    }
    const nextRow = {
      ...existingRow,
      hrApproval: normalizedDecision,
      hrApprover: input.actorName,
      hrComment: input.comment,
      hrApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
      managerApproval: normalizedDecision === 'Rejected' ? 'Rejected' : existingRow.managerApproval || 'Pending',
      status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Pending Manager',
    };
    setLeaveApprovalSavingId(leaveId);
    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/modules/leave-management/${encodeURIComponent(nextRow.id)}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextRow),
        }
      );
      if (!response.ok) {
        showToast(`Failed to save HR decision for ${leaveId}.`, 'error');
        return;
      }
      const data = await response.json();
      const persisted = data.record || nextRow;
      setModuleRowsState((prev) => ({
        ...prev,
        'leave-management': (prev['leave-management'] || []).map((row) =>
          String(row.id || '') === String(leaveId || '') ? persisted : row
        ),
      }));
    } catch (error) {
      showToast(`Error saving HR decision for ${leaveId}.`, 'error');
    } finally {
      setLeaveApprovalSavingId(null);
    }
    setLeaveApprovalDrafts((prev) => ({ ...prev, [leaveId]: { actorName: input.actorName, comment: '' } }));
    showToast(
      normalizedDecision === 'Rejected' ? `HR rejected leave request ${leaveId}.` : `HR approved leave request ${leaveId}.`,
      normalizedDecision === 'Rejected' ? 'error' : 'success'
    );
    setLeaveActionMessage(
      normalizedDecision === 'Rejected' ? 'HR rejected the leave request.' : 'HR approved. Request moved to branch manager.'
    );
  };
  const handleManagerLeaveDecision = async (leaveId, decision) => {
    if (!leaveId) {
      return;
    }
    const input = getLeaveApprovalInput(leaveId);
    if (!input.actorName || !input.comment) {
      setLeaveActionMessage('Actor name and comment are required before approval.');
      showToast('Actor name and comment are required before approval.', 'error');
      return;
    }
    const normalizedDecision = decision === 'Rejected' ? 'Rejected' : 'Approved';
    const rows = moduleRowsState['leave-management'] || [];
    const existingRow =
      rows.find((row) => String(row.id || '') === String(leaveId || '')) || null;
    if (!existingRow) {
      showToast(`Leave request ${leaveId} not found.`, 'error');
      return;
    }
    if (
      String(existingRow.departmentApproval || '') !== 'Approved' ||
      String(existingRow.hrApproval || '') !== 'Approved'
    ) {
      showToast(`Leave request ${leaveId} is not ready for manager decision.`, 'error');
      return;
    }
    if (String(existingRow.managerApproval || 'Pending') !== 'Pending') {
      showToast(`Leave request ${leaveId} already has a manager decision.`, 'error');
      return;
    }
    const nextRow = {
      ...existingRow,
      managerApproval: normalizedDecision,
      managerApprover: input.actorName,
      managerComment: input.comment,
      managerApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
      status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Approved',
    };
    setLeaveApprovalSavingId(leaveId);
    try {
      const response = await fetch(
        toApiUrl(`http://localhost:8000/api/modules/leave-management/${encodeURIComponent(nextRow.id)}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextRow),
        }
      );
      if (!response.ok) {
        showToast(`Failed to save manager decision for ${leaveId}.`, 'error');
        return;
      }
      const data = await response.json();
      const persisted = data.record || nextRow;
      setModuleRowsState((prev) => ({
        ...prev,
        'leave-management': (prev['leave-management'] || []).map((row) =>
          String(row.id || '') === String(leaveId || '') ? persisted : row
        ),
      }));
    } catch (error) {
      showToast(`Error saving manager decision for ${leaveId}.`, 'error');
    } finally {
      setLeaveApprovalSavingId(null);
    }
    setLeaveApprovalDrafts((prev) => ({ ...prev, [leaveId]: { actorName: input.actorName, comment: '' } }));
    showToast(
      normalizedDecision === 'Rejected'
        ? `Manager rejected leave request ${leaveId}.`
        : `Manager approved leave request ${leaveId}.`,
      normalizedDecision === 'Rejected' ? 'error' : 'success'
    );
    setLeaveActionMessage(
      normalizedDecision === 'Rejected'
        ? 'Branch manager rejected the leave request.'
        : 'Branch manager approved the leave request. Balance now takes effect.'
    );
  };
  const getLoanApprovalInput = (loanId) => {
    const input = loanApprovalDrafts[loanId] || {};
    return {
      actorName: String(input.actorName || appSettings.penaltyActorUsername || '').trim(),
      comment: String(input.comment || '').trim(),
    };
  };
  const handleDepartmentLoanDecision = async (loanId, decision) => {
    if (!loanId) {
      return;
    }
    const input = getLoanApprovalInput(loanId);
    if (!input.actorName || !input.comment) {
      setLoanActionMessage('Actor name and comment are required before approval.');
      showToast('Actor name and comment are required before approval.', 'error');
      return;
    }
    const normalizedDecision = decision === 'Rejected' ? 'Rejected' : 'Approved';
    const rows = moduleRowsState['loan-records'] || [];
    const existingRow = rows.find((row) => String(row.id || '') === String(loanId || '')) || null;
    if (!existingRow) {
      showToast(`Loan request ${loanId} not found.`, 'error');
      return;
    }
    if (String(existingRow.departmentApproval || 'Pending') !== 'Pending') {
      showToast(`Loan request ${loanId} is already processed by department.`, 'error');
      return;
    }
    const nextRow = {
      ...existingRow,
      departmentApproval: normalizedDecision,
      departmentApprover: input.actorName,
      departmentComment: input.comment,
      departmentApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
      hrApproval: normalizedDecision === 'Rejected' ? 'Rejected' : existingRow.hrApproval || 'Pending',
      managerApproval: normalizedDecision === 'Rejected' ? 'Rejected' : existingRow.managerApproval || 'Pending',
      status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Pending HR',
    };
    setLoanApprovalSavingId(loanId);
    try {
      const response = await fetch(toApiUrl(`http://localhost:8000/api/modules/loan-records/${encodeURIComponent(nextRow.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextRow),
      });
      if (!response.ok) {
        showToast(`Failed to save department decision for ${loanId}.`, 'error');
        return;
      }
      const data = await response.json();
      const persisted = data.record || nextRow;
      setModuleRowsState((prev) => ({
        ...prev,
        'loan-records': (prev['loan-records'] || []).map((row) =>
          String(row.id || '') === String(loanId || '') ? persisted : row
        ),
      }));
    } catch (error) {
      showToast(`Error saving department decision for ${loanId}.`, 'error');
    } finally {
      setLoanApprovalSavingId(null);
    }
    setLoanApprovalDrafts((prev) => ({ ...prev, [loanId]: { actorName: input.actorName, comment: '' } }));
    showToast(
      normalizedDecision === 'Rejected'
        ? `Department rejected loan request ${loanId}.`
        : `Department approved loan request ${loanId}.`,
      normalizedDecision === 'Rejected' ? 'error' : 'success'
    );
    setLoanActionMessage(
      normalizedDecision === 'Rejected'
        ? 'Department approval rejected the loan request.'
        : 'Department approval completed. Request moved to HR.'
    );
  };
  const handleHrLoanDecision = async (loanId, decision) => {
    if (!loanId) {
      return;
    }
    const input = getLoanApprovalInput(loanId);
    if (!input.actorName || !input.comment) {
      setLoanActionMessage('Actor name and comment are required before approval.');
      showToast('Actor name and comment are required before approval.', 'error');
      return;
    }
    const normalizedDecision = decision === 'Rejected' ? 'Rejected' : 'Approved';
    const rows = moduleRowsState['loan-records'] || [];
    const existingRow = rows.find((row) => String(row.id || '') === String(loanId || '')) || null;
    if (!existingRow) {
      showToast(`Loan request ${loanId} not found.`, 'error');
      return;
    }
    if (String(existingRow.departmentApproval || '') !== 'Approved' || String(existingRow.hrApproval || 'Pending') !== 'Pending') {
      showToast(`Loan request ${loanId} is not ready for HR decision.`, 'error');
      return;
    }
    const nextRow = {
      ...existingRow,
      hrApproval: normalizedDecision,
      hrApprover: input.actorName,
      hrComment: input.comment,
      hrApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
      managerApproval: normalizedDecision === 'Rejected' ? 'Rejected' : existingRow.managerApproval || 'Pending',
      status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Pending Manager',
    };
    setLoanApprovalSavingId(loanId);
    try {
      const response = await fetch(toApiUrl(`http://localhost:8000/api/modules/loan-records/${encodeURIComponent(nextRow.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextRow),
      });
      if (!response.ok) {
        showToast(`Failed to save HR decision for ${loanId}.`, 'error');
        return;
      }
      const data = await response.json();
      const persisted = data.record || nextRow;
      setModuleRowsState((prev) => ({
        ...prev,
        'loan-records': (prev['loan-records'] || []).map((row) =>
          String(row.id || '') === String(loanId || '') ? persisted : row
        ),
      }));
    } catch (error) {
      showToast(`Error saving HR decision for ${loanId}.`, 'error');
    } finally {
      setLoanApprovalSavingId(null);
    }
    setLoanApprovalDrafts((prev) => ({ ...prev, [loanId]: { actorName: input.actorName, comment: '' } }));
    showToast(
      normalizedDecision === 'Rejected' ? `HR rejected loan request ${loanId}.` : `HR approved loan request ${loanId}.`,
      normalizedDecision === 'Rejected' ? 'error' : 'success'
    );
    setLoanActionMessage(
      normalizedDecision === 'Rejected' ? 'HR rejected the loan request.' : 'HR approved. Request moved to branch manager.'
    );
  };
  const handleManagerLoanDecision = async (loanId, decision) => {
    if (!loanId) {
      return;
    }
    const input = getLoanApprovalInput(loanId);
    if (!input.actorName || !input.comment) {
      setLoanActionMessage('Actor name and comment are required before approval.');
      showToast('Actor name and comment are required before approval.', 'error');
      return;
    }
    const normalizedDecision = decision === 'Rejected' ? 'Rejected' : 'Approved';
    const rows = moduleRowsState['loan-records'] || [];
    const existingRow = rows.find((row) => String(row.id || '') === String(loanId || '')) || null;
    if (!existingRow) {
      showToast(`Loan request ${loanId} not found.`, 'error');
      return;
    }
    if (String(existingRow.departmentApproval || '') !== 'Approved' || String(existingRow.hrApproval || '') !== 'Approved') {
      showToast(`Loan request ${loanId} is not ready for manager decision.`, 'error');
      return;
    }
    if (String(existingRow.managerApproval || 'Pending') !== 'Pending') {
      showToast(`Loan request ${loanId} already has a manager decision.`, 'error');
      return;
    }
    const nextRow = {
      ...existingRow,
      managerApproval: normalizedDecision,
      managerApprover: input.actorName,
      managerComment: input.comment,
      managerApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
      status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Approved',
    };
    setLoanApprovalSavingId(loanId);
    try {
      const response = await fetch(toApiUrl(`http://localhost:8000/api/modules/loan-records/${encodeURIComponent(nextRow.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextRow),
      });
      if (!response.ok) {
        showToast(`Failed to save manager decision for ${loanId}.`, 'error');
        return;
      }
      const data = await response.json();
      const persisted = data.record || nextRow;
      setModuleRowsState((prev) => ({
        ...prev,
        'loan-records': (prev['loan-records'] || []).map((row) =>
          String(row.id || '') === String(loanId || '') ? persisted : row
        ),
      }));
    } catch (error) {
      showToast(`Error saving manager decision for ${loanId}.`, 'error');
    } finally {
      setLoanApprovalSavingId(null);
    }
    setLoanApprovalDrafts((prev) => ({ ...prev, [loanId]: { actorName: input.actorName, comment: '' } }));
    showToast(
      normalizedDecision === 'Rejected'
        ? `Manager rejected loan request ${loanId}.`
        : `Manager approved loan request ${loanId}.`,
      normalizedDecision === 'Rejected' ? 'error' : 'success'
    );
    setLoanActionMessage(
      normalizedDecision === 'Rejected'
        ? 'Branch manager rejected the loan request.'
        : 'Branch manager approved the loan request.'
    );
  };
  const handlePenaltyActionSave = () => {
    if (!selectedPenaltyRow || selectedPenaltyRow.outstandingAmount <= 0) {
      return;
    }
    const actor = String(appSettings.penaltyActorUsername || '').trim();
    const remark = String(penaltyActionDraft.remark || '').trim();
    if (!actor || !remark) {
      return;
    }
    const isFull = penaltyActionDraft.mode === 'full';
    const requestedAmount = isFull
      ? selectedPenaltyRow.outstandingAmount
      : Math.max(0, toNumberValue(penaltyActionDraft.amount || 0));
    const clearedAmount = Math.min(selectedPenaltyRow.outstandingAmount, requestedAmount);
    if (clearedAmount <= 0) {
      return;
    }
    const actionId = `PCLR-${Date.now().toString().slice(-7)}`;
    setModuleRowsState((prev) => ({
      ...prev,
      'attendance-penalty-adjustments': [
        {
          id: actionId,
          employeeId: selectedPenaltyRow.employeeId,
          employee: selectedPenaltyRow.employee,
          date: selectedPenaltyRow.date,
          department: selectedPenaltyRow.department,
          penaltyType: selectedPenaltyRow.penaltyType,
          penaltyLabel: selectedPenaltyRow.penaltyLabel,
          clearanceMode: penaltyActionDraft.mode,
          clearedAmount,
          remark,
          actorUsername: actor,
          actedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
        },
        ...(prev['attendance-penalty-adjustments'] || []),
      ],
    }));
    setPenaltyActionDraft({
      mode: 'partial',
      amount: '',
      remark: '',
    });
  };

  const openDetails = (rowId) => {
    setSelectedRowId(rowId);
    setModalState({ mode: 'details', rowId });
    setEmployeeDetailRecordTab('leave');
    setShowEmployeePortalPassword(false);
  };

  const startCreate = () => {
    const employeeRowForSelf = getCurrentEmployeeRow();
    const adapterInitialValues =
      moduleAdapter && moduleAdapter.active && typeof moduleAdapter.getInitialFormValues === 'function'
        ? moduleAdapter.getInitialFormValues()
        : null;
    setEditRowId('new');
    setFormValues(
      activeModuleId === 'leave-management'
        ? currentUser && currentUser.role === 'employee' && employeeRowForSelf
          ? {
              leaveEmployeeSearch: `${employeeRowForSelf.fullName} (${employeeRowForSelf.id})`,
              employee: employeeRowForSelf.fullName,
              employeeId: employeeRowForSelf.id,
              department: employeeRowForSelf.department || '',
              type: 'Annual',
              startDate: getTodayIsoDate(),
              endDate: getTodayIsoDate(),
              reason: '',
            }
          : {
              leaveEmployeeSearch: '',
              employee: '',
              employeeId: '',
              department: '',
              type: 'Annual',
              startDate: getTodayIsoDate(),
              endDate: getTodayIsoDate(),
              reason: '',
            }
        : activeModuleId === 'loan-records'
          ? currentUser && currentUser.role === 'employee' && employeeRowForSelf
            ? {
                loanEmployeeSearch: `${employeeRowForSelf.fullName} (${employeeRowForSelf.id})`,
                employee: employeeRowForSelf.fullName,
                employeeId: employeeRowForSelf.id,
                amount: '',
                interestPercent: appSettings.loanRules.defaultInterestPercentPerMonth,
                tenorMonths: '',
                monthlyInstallment: '',
                issuedOn: getTodayIsoDate(),
                balance: '',
                departmentApproval: 'Pending',
                hrApproval: 'Pending',
                managerApproval: 'Pending',
                status: 'Pending Department',
              }
            : {
                loanEmployeeSearch: '',
                employee: '',
                employeeId: '',
                amount: '',
                interestPercent: appSettings.loanRules.defaultInterestPercentPerMonth,
                balance: '',
                departmentApproval: 'Pending',
                hrApproval: 'Pending',
                managerApproval: 'Pending',
                status: 'Pending Department',
              }
          : adapterInitialValues || {}
    );
    setFormError('');
    setModalState({ mode: 'form', rowId: null });
  };

  const startEdit = (row) => {
    if (activeModuleId === 'loan-records' && currentUser && currentUser.role === 'employee') {
      showToast('Loan records are view-only in employee self-service.', 'error');
      return;
    }
    const adapterEditValues =
      moduleAdapter && moduleAdapter.active && typeof moduleAdapter.getEditFormValues === 'function'
        ? moduleAdapter.getEditFormValues(row)
        : null;
    setEditRowId(row.id);
    setFormValues(
      activeModuleId === 'leave-management'
        ? { ...row, leaveEmployeeSearch: `${row.employee || ''} ${row.employeeId || ''}`.trim() }
        : adapterEditValues || { ...row }
    );
    setFormError('');
    setModalState({ mode: 'form', rowId: row.id });
  };

  const handleDelete = (row) => {
    const rowId = row?.id;
    if (activeModuleId === 'loan-records' && currentUser && currentUser.role === 'employee') {
      showToast('Loan records cannot be deleted in employee self-service.', 'error');
      return;
    }
    if (!activeModuleId || !rowId) {
      return;
    }
    const currentRows = moduleRowsState[activeModuleId] || [];
    const matchedRow = currentRows.find((row) => row.id === rowId) || null;
    const entityLabel = activeModuleConfig?.entityLabel || 'record';
    const labelValue = matchedRow?.fullName || matchedRow?.name || matchedRow?.employee || matchedRow?.id || rowId;
    const confirmed = window.confirm(`Delete this ${entityLabel}: ${labelValue}?`);
    if (!confirmed) {
      return;
    }
    if (activeModuleId !== 'attendance-penalty-adjustments') {
      fetch(toApiUrl(`http://localhost:8000/api/modules/${activeModuleId}/${encodeURIComponent(rowId)}`), {
        method: 'DELETE',
        headers: authHeaders,
      }).catch(() => {});
    }
    setModuleRowsState((prev) => {
      const currentRows = prev[activeModuleId] || [];
      return {
        ...prev,
        [activeModuleId]: currentRows.filter((row) => row.id !== rowId),
      };
    });
    if (selectedRowId === rowId) {
      setSelectedRowId(null);
    }
    if (editRowId === rowId || modalState.rowId === rowId) {
      closeModal();
    }
  };

  const handleSave = async () => {
    if (!activeModuleConfig || recordSaving) {
      return;
    }
    setRecordSaving(true);
    try {
      const missingRequiredField = visibleFormFields.find(
        (field) => field.required && !String(formValues[field.key] || '').trim()
      );
      if (missingRequiredField) {
        setFormError(`${getFieldLabel(missingRequiredField)} is required.`);
        return;
      }
      if (activeModuleId === 'employee-management') {
        const latestAllowedEmployeeDob = getLatestAllowedEmployeeDob();
        if (String(formValues.dob || '') > latestAllowedEmployeeDob) {
          setFormError(`Date of Birth must be ${latestAllowedEmployeeDob} or earlier.`);
          return;
        }
      }
      if (activeModuleId === 'employee-management') {
        const normalizedPassword = String(formValues.password || '').trim();
        const hasLetter = /[A-Za-z]/.test(normalizedPassword);
        const hasNumber = /\d/.test(normalizedPassword);
        if (normalizedPassword.length < 8 || !hasLetter || !hasNumber) {
          setFormError('Portal Password must be at least 8 characters and include letters and numbers.');
          return;
        }
      }
      if (activeModuleId === 'attendance-time') {
        setFormError('Manual attendance edits are disabled. Use Clock In / Clock Out only.');
        return;
      }
      let computedPayrollValues = {};
      let computedLoanValues = {};
      if (moduleAdapter && moduleAdapter.active && typeof moduleAdapter.beforeSave === 'function') {
        const adapterResult = moduleAdapter.beforeSave();
        if (!adapterResult || adapterResult.ok === false) {
          return;
        }
        computedPayrollValues = adapterResult.computedValues || {};
      }
      if (activeModuleId === 'loan-records') {
      const principal = toNumberValue(formValues.amount);
      let rawInterestPercent =
        formValues.interestPercent !== undefined && formValues.interestPercent !== null
          ? Number(formValues.interestPercent)
          : appSettings.loanRules.defaultInterestPercentPerMonth;
      if (currentUser && currentUser.role === 'employee') {
        rawInterestPercent = appSettings.loanRules.defaultInterestPercentPerMonth;
      }
      const interestPercent = Math.max(0, Number(rawInterestPercent) || 0);
      const tenorMonths = Math.max(1, toNumberValue(formValues.tenorMonths) || 1);
      let monthlyInstallment = toNumberValue(formValues.monthlyInstallment);
      if (principal > 0 && tenorMonths > 0 && monthlyInstallment === 0) {
        const totalInterest = (principal * interestPercent * tenorMonths) / 100;
        const totalRepay = principal + totalInterest;
        monthlyInstallment = totalRepay / tenorMonths;
      }

      if (currentUser && currentUser.role === 'employee') {
        const employeeId = String(currentUser.employeeId || '').trim();
        const employeeName = String(currentUser.fullName || '').trim();
        const payrollProfile = getEmployeePayrollProfile({
          moduleRowsState,
          employeeBaseRows,
          employeeId,
          employeeName,
        });
        if (!payrollProfile) {
          const message = 'No payroll profile found. Contact HR before applying for a loan.';
          setFormError(message);
          showToast(message, 'error');
          return;
        }
        const basicPay = toNumberValue(payrollProfile.basicPay);
        const monthlyBonuses = toNumberValue(payrollProfile.monthlyBonuses);
        const transportAllowance = toNumberValue(payrollProfile.transportAllowance);
        const housingAllowance = toNumberValue(payrollProfile.housingAllowance);
        const foodAllowance = toNumberValue(payrollProfile.foodAllowance);
        const grossPay = basicPay + monthlyBonuses + transportAllowance + housingAllowance + foodAllowance;
        const loanRules = appSettings.loanRules || {};
        const maxPercent = Math.max(
          0,
          Math.min(100, Number(loanRules.maxLoanDeductionPercentOfGross) || 0)
        );
        const monthlyLimit = (grossPay * maxPercent) / 100;
        if (monthlyInstallment > monthlyLimit) {
          const message = `Requested loan exceeds your credit limit. Max monthly installment allowed is ${monthlyLimit.toFixed(
            2
          )}.`;
          setFormError(message);
          showToast(message, 'error');
          return;
        }
      }

      computedLoanValues = {
        interestPercent: interestPercent || '',
        tenorMonths: tenorMonths || '',
        monthlyInstallment: monthlyInstallment ? monthlyInstallment.toFixed(2) : '',
        balance: formValues.balance || principal ? String(formValues.balance || principal) : '',
        overduePenaltyPercentPerDay: appSettings.loanRules.overduePenaltyPercentPerDay,
      };
      const requestedDepartmentApproval =
        currentUser && currentUser.role === 'employee'
          ? 'Pending'
          : String(formValues.departmentApproval || '').trim() || 'Pending';
      const requestedHrApproval =
        currentUser && currentUser.role === 'employee'
          ? 'Pending'
          : String(formValues.hrApproval || '').trim() || 'Pending';
      const requestedManagerApproval =
        currentUser && currentUser.role === 'employee'
          ? 'Pending'
          : String(formValues.managerApproval || '').trim() || 'Pending';
      const derivedLoanStatus =
        requestedDepartmentApproval === 'Rejected' ||
        requestedHrApproval === 'Rejected' ||
        requestedManagerApproval === 'Rejected'
          ? 'Rejected'
          : requestedDepartmentApproval !== 'Approved'
            ? 'Pending Department'
            : requestedHrApproval !== 'Approved'
              ? 'Pending HR'
              : requestedManagerApproval !== 'Approved'
                ? 'Pending Manager'
                : 'Approved';
      computedLoanValues = {
        ...computedLoanValues,
        departmentApproval: requestedDepartmentApproval,
        hrApproval: requestedHrApproval,
        managerApproval: requestedManagerApproval,
        status: derivedLoanStatus,
      };
      if (currentUser && currentUser.role === 'employee') {
        computedLoanValues = {
          ...computedLoanValues,
          employee: currentUser.fullName || '',
          employeeId: currentUser.employeeId || '',
          issuedOn: formValues.issuedOn || todayIsoDate,
        };
      }
      }
      if (activeModuleId === 'leave-management') {
        let employeeForLeave = selectedLeaveFormEmployee;
        if (currentUser && currentUser.role === 'employee') {
          employeeForLeave = getCurrentEmployeeRow();
        }
        if (!employeeForLeave) {
          setFormError('Select a valid employee from search.');
          showToast('Select a valid employee from search.', 'error');
          return;
        }
        const reason = String(formValues.reason || '').trim();
        if (!reason) {
          setFormError('Reason is required.');
          showToast('Reason is required.', 'error');
          return;
        }
        if (String(formValues.startDate || '') < todayIsoDate || String(formValues.endDate || '') < todayIsoDate) {
          setFormError('Past dates are not allowed for leave request.');
          showToast('Past dates are not allowed for leave request.', 'error');
          return;
        }
        const leaveDays = getInclusiveDaysBetween(formValues.startDate, formValues.endDate);
        if (leaveDays <= 0) {
          setFormError('Select a valid start and end date.');
          showToast('Select a valid start and end date.', 'error');
          return;
        }
        if (selectedLeaveFormBalance && leaveDays > selectedLeaveFormBalance.availableBalance) {
          setFormError(
            `Requested ${leaveDays} day(s) exceeds remaining ${selectedLeaveFormBalance.availableBalance.toFixed(1)} day(s).`
          );
          showToast(
            `Requested ${leaveDays} day(s) exceeds remaining ${selectedLeaveFormBalance.availableBalance.toFixed(1)} day(s).`,
            'error'
          );
          return;
        }
        const rowId =
          editRowId === 'new' ? `LEV-${Date.now().toString().slice(-7)}` : formValues.id || editRowId;
        const requestPayload = {
          id: rowId,
          employee: selectedLeaveFormEmployee.fullName,
          employeeId: selectedLeaveFormEmployee.id,
          department: selectedLeaveFormEmployee.department || 'Unassigned',
          type: formValues.type || 'Annual',
          startDate: formValues.startDate,
          endDate: formValues.endDate,
          daysRequested: leaveDays,
          reason,
          requestedOn: formValues.requestedOn || `${getTodayIsoDate()} ${getCurrentClockValue()}`,
          departmentApproval: formValues.departmentApproval || 'Pending',
          departmentApprover: formValues.departmentApprover || '',
          departmentComment: formValues.departmentComment || '',
          departmentApprovedOn: formValues.departmentApprovedOn || '',
          hrApproval: formValues.hrApproval || 'Pending',
          hrApprover: formValues.hrApprover || '',
          hrComment: formValues.hrComment || '',
          hrApprovedOn: formValues.hrApprovedOn || '',
          managerApproval: formValues.managerApproval || 'Pending',
          managerApprover: formValues.managerApprover || '',
          managerComment: formValues.managerComment || '',
          managerApprovedOn: formValues.managerApprovedOn || '',
          status:
            formValues.status ||
            (formValues.departmentApproval === 'Rejected' || formValues.hrApproval === 'Rejected' || formValues.managerApproval === 'Rejected'
              ? 'Rejected'
              : formValues.departmentApproval === 'Approved'
                ? formValues.hrApproval === 'Approved'
                  ? formValues.managerApproval === 'Approved'
                    ? 'Approved'
                    : 'Pending Manager'
                  : 'Pending HR'
                : 'Pending Department'),
        };
        try {
          const url =
            editRowId === 'new'
              ? 'http://localhost:8000/api/modules/leave-management'
              : `http://localhost:8000/api/modules/leave-management/${encodeURIComponent(rowId)}`;
          const method = editRowId === 'new' ? 'POST' : 'PUT';
          const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify(requestPayload),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => null);
            const message = data?.error || 'Unable to save leave request.';
            setFormError(message);
            showToast(message, 'error');
            return;
          }
          const data = await response.json().catch(() => null);
          const saved = data?.record || requestPayload;
          setModuleRowsState((prev) => {
            const currentRows = prev['leave-management'] || [];
            if (editRowId === 'new') {
              return {
                ...prev,
                'leave-management': [saved, ...currentRows.filter((row) => row.id !== saved.id)],
              };
            }
            return {
              ...prev,
              'leave-management': currentRows.map((row) => (row.id === rowId ? saved : row)),
            };
          });
        } catch (error) {
          const message = 'Unable to save leave request.';
          setFormError(message);
          showToast(message, 'error');
          return;
        }
        setLeaveActionMessage(
          editRowId === 'new'
            ? 'Leave request submitted to department approval.'
            : 'Leave request updated successfully.'
        );
        showToast(
          editRowId === 'new'
            ? `Leave request submitted for ${employeeForLeave.fullName}.`
            : 'Leave request updated successfully.',
          'success'
        );
        setSelectedRowId(rowId);
        closeModal();
        return;
      }

      const existingEditRow =
        editRowId && editRowId !== 'new'
          ? (moduleRowsState[activeModuleId] || []).find((row) => row.id === editRowId) || null
          : null;
      const payload = activeModuleConfig.formFields.reduce((acc, field) => {
        const fieldValue = Object.prototype.hasOwnProperty.call(formValues, field.key)
          ? formValues[field.key]
          : existingEditRow?.[field.key];
        if (computedPayrollValues[field.key] !== undefined) {
          return {
            ...acc,
            [field.key]: computedPayrollValues[field.key],
          };
        }
        if (computedLoanValues[field.key] !== undefined) {
          return {
            ...acc,
            [field.key]: computedLoanValues[field.key],
          };
        }
        return {
          ...acc,
          [field.key]: fieldValue ?? '',
        };
      }, {});
      const employeeImagePreviewsPayload =
        activeModuleId === 'employee-management'
          ? employeeImageFields.reduce(
              (acc, key) => ({
                ...acc,
                [`${key}Preview`]:
                  (Object.prototype.hasOwnProperty.call(formValues, `${key}Preview`)
                    ? formValues[`${key}Preview`]
                    : existingEditRow?.[`${key}Preview`]) ?? '',
              }),
              {}
            )
          : {};
      const employeeFilesPayload =
        activeModuleId === 'employee-management'
          ? employeeFileFields.reduce(
              (acc, key) => ({
                ...acc,
                [`${key}Files`]: Array.isArray(formValues[`${key}Files`])
                  ? formValues[`${key}Files`]
                  : Array.isArray(existingEditRow?.[`${key}Files`])
                    ? existingEditRow[`${key}Files`]
                    : [],
              }),
              {}
            )
          : {};
      const moduleIdPrefix = activeModuleId.slice(0, 3).toUpperCase();
      const fallbackId = `${moduleIdPrefix}-${Math.floor(Math.random() * 900 + 100)}`;
      let employeeGeneratedId = '';
      const normalizedPayload =
        activeModuleId === 'employee-management'
          ? Object.entries(payload).reduce(
              (acc, [key, value]) => ({
                ...acc,
                [key]: PHONE_FIELD_KEYS.has(key) ? keepDigitsOnly(value) : value,
              }),
              {}
            )
          : payload;

      if (activeModuleId === 'employee-management' && editRowId === 'new') {
        const prefix = getDepartmentPrefix(normalizedPayload.department, appSettings.departments);
        const currentEmployeeRows = moduleRowsState['employee-management'] || [];
        const highestSequenceForDepartment = currentEmployeeRows
          .filter((row) => row.department === normalizedPayload.department)
          .reduce((acc, row) => {
            const match = String(row.id || '').match(/(\d{4,8})$/);
            if (!match) {
              return acc;
            }
            return Math.max(acc, Number(match[1]));
          }, 0);
        employeeGeneratedId = `${prefix}${String(highestSequenceForDepartment + 1).padStart(4, '0')}`;
      }

      const rowWithId = {
        ...normalizedPayload,
        ...employeeImagePreviewsPayload,
        ...employeeFilesPayload,
        id:
          editRowId === 'new'
            ? activeModuleId === 'employee-management'
              ? employeeGeneratedId
              : formValues.id || fallbackId
            : formValues.id || editRowId,
      };

      if (activeModuleId !== 'attendance-penalty-adjustments') {
        try {
          const url =
            editRowId === 'new'
              ? toApiUrl(`http://localhost:8000/api/modules/${activeModuleId}`)
              : toApiUrl(`http://localhost:8000/api/modules/${activeModuleId}/${encodeURIComponent(rowWithId.id)}`);
          const method = editRowId === 'new' ? 'POST' : 'PUT';
          const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify(rowWithId),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => null);
            const message = data?.error || 'Unable to save record.';
            setFormError(message);
            showToast(message, 'error');
            return;
          }
          const data = await response.json().catch(() => null);
          const saved = data?.record || rowWithId;
          setModuleRowsState((prev) => {
            const currentRows = prev[activeModuleId] || [];
            if (editRowId === 'new') {
              return {
                ...prev,
                [activeModuleId]: [saved, ...currentRows.filter((row) => row.id !== saved.id)],
              };
            }
            return {
              ...prev,
              [activeModuleId]: currentRows.map((row) => (row.id === rowWithId.id ? saved : row)),
            };
          });
        } catch (error) {
          const message = 'Unable to save record.';
          setFormError(message);
          showToast(message, 'error');
          return;
        }
      } else {
        setModuleRowsState((prev) => {
          const currentRows = prev[activeModuleId] || [];
          if (editRowId === 'new') {
            return {
              ...prev,
              [activeModuleId]: [rowWithId, ...currentRows],
            };
          }
          return {
            ...prev,
            [activeModuleId]: currentRows.map((row) => (row.id === rowWithId.id ? rowWithId : row)),
          };
        });
      }
      setSelectedRowId(rowWithId.id);
      closeModal();
    } finally {
      setRecordSaving(false);
    }
  };

  const handleAddCurrency = () => {
    const normalizedCurrency = currencyInput.trim().toUpperCase();
    if (!normalizedCurrency) {
      return;
    }
    setAppSettings((prev) => {
      if (prev.currencies.includes(normalizedCurrency)) {
        return prev;
      }
      const updatedCurrencies = [...prev.currencies, normalizedCurrency];
      return {
        ...prev,
        currencies: updatedCurrencies,
        defaultCurrency: prev.defaultCurrency || updatedCurrencies[0],
      };
    });
    setCurrencyInput('');
  };

  const handleRemoveCurrency = (currency) => {
    setAppSettings((prev) => {
      if (prev.currencies.length === 1) {
        return prev;
      }
      const updatedCurrencies = prev.currencies.filter((item) => item !== currency);
      return {
        ...prev,
        currencies: updatedCurrencies,
        defaultCurrency:
          prev.defaultCurrency === currency ? updatedCurrencies[0] || '' : prev.defaultCurrency,
      };
    });
  };

  const resetDepartmentForm = () => {
    setDepartmentNameInput('');
    setDepartmentCodeInput('');
    setDepartmentEditingName('');
    setDepartmentError('');
  };

  const handleAddOrUpdateDepartment = () => {
    const normalizedName = departmentNameInput.trim();
    const normalizedCode = (departmentCodeInput.trim() || normalizedName.slice(0, 2))
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 2);

    if (!normalizedName || normalizedCode.length < 2) {
      setDepartmentError('Department name and 2-letter prefix are required.');
      return;
    }

    const existingByName = appSettings.departments.find(
      (department) =>
        department.name.toLowerCase() === normalizedName.toLowerCase() &&
        department.name.toLowerCase() !== departmentEditingName.toLowerCase()
    );
    if (existingByName) {
      setDepartmentError('Department name already exists.');
      return;
    }

    const existingByCode = appSettings.departments.find(
      (department) =>
        department.code.toLowerCase() === normalizedCode.toLowerCase() &&
        department.name.toLowerCase() !== departmentEditingName.toLowerCase()
    );
    if (existingByCode) {
      setDepartmentError('Department prefix already exists.');
      return;
    }

    if (departmentEditingName) {
      setAppSettings((prev) => ({
        ...prev,
        departments: prev.departments.map((department) =>
          department.name === departmentEditingName
            ? { ...department, name: normalizedName, code: normalizedCode }
            : department
        ),
      }));
      setModuleRowsState((prev) => ({
        ...prev,
        'employee-management': (prev['employee-management'] || []).map((row) =>
          row.department === departmentEditingName ? { ...row, department: normalizedName } : row
        ),
      }));
      if (formValues.department === departmentEditingName) {
        setFormValues((prev) => ({ ...prev, department: normalizedName }));
      }
    } else {
      setAppSettings((prev) => ({
        ...prev,
        departments: [...prev.departments, { name: normalizedName, code: normalizedCode }],
      }));
    }

    resetDepartmentForm();
  };

  const handleEditDepartment = (department) => {
    setDepartmentEditingName(department.name);
    setDepartmentNameInput(department.name);
    setDepartmentCodeInput(department.code);
    setDepartmentError('');
  };

  const handleDeleteDepartment = (departmentName) => {
    if (appSettings.departments.length === 1) {
      setDepartmentError('At least one department must remain.');
      return;
    }
    const isDepartmentUsed = (moduleRowsState['employee-management'] || []).some(
      (row) => row.department === departmentName
    );
    if (isDepartmentUsed) {
      setDepartmentError('Cannot delete a department that has employee records.');
      return;
    }
    setAppSettings((prev) => ({
      ...prev,
      departments: prev.departments.filter((department) => department.name !== departmentName),
    }));
    if (formValues.department === departmentName) {
      setFormValues((prev) => ({ ...prev, department: '' }));
    }
    if (departmentEditingName === departmentName) {
      resetDepartmentForm();
    }
  };

  const resetEmploymentStageForm = () => {
    setEmploymentStageInput('');
    setEmploymentStageEditingValue('');
    setEmploymentStageError('');
  };

  const handleAddOrUpdateEmploymentStage = () => {
    const normalizedStage = employmentStageInput.trim();
    if (!normalizedStage) {
      setEmploymentStageError('Employment stage is required.');
      return;
    }

    const duplicateStage = appSettings.employmentStages.find(
      (stage) =>
        stage.toLowerCase() === normalizedStage.toLowerCase() &&
        stage.toLowerCase() !== employmentStageEditingValue.toLowerCase()
    );
    if (duplicateStage) {
      setEmploymentStageError('Employment stage already exists.');
      return;
    }

    if (employmentStageEditingValue) {
      setAppSettings((prev) => ({
        ...prev,
        employmentStages: prev.employmentStages.map((stage) =>
          stage === employmentStageEditingValue ? normalizedStage : stage
        ),
      }));
      setModuleRowsState((prev) => ({
        ...prev,
        'employee-management': (prev['employee-management'] || []).map((row) =>
          row.employmentState === employmentStageEditingValue
            ? { ...row, employmentState: normalizedStage }
            : row
        ),
      }));
      if (formValues.employmentState === employmentStageEditingValue) {
        setFormValues((prev) => ({ ...prev, employmentState: normalizedStage }));
      }
    } else {
      setAppSettings((prev) => ({
        ...prev,
        employmentStages: [...prev.employmentStages, normalizedStage],
      }));
    }

    resetEmploymentStageForm();
  };

  const handleEditEmploymentStage = (stage) => {
    setEmploymentStageEditingValue(stage);
    setEmploymentStageInput(stage);
    setEmploymentStageError('');
  };

  const handleDeleteEmploymentStage = (stage) => {
    if (appSettings.employmentStages.length === 1) {
      setEmploymentStageError('At least one employment stage must remain.');
      return;
    }
    const isStageUsed = (moduleRowsState['employee-management'] || []).some(
      (row) => row.employmentState === stage
    );
    if (isStageUsed) {
      setEmploymentStageError('Cannot delete a stage that has employee records.');
      return;
    }
    setAppSettings((prev) => ({
      ...prev,
      employmentStages: prev.employmentStages.filter((item) => item !== stage),
    }));
    if (formValues.employmentState === stage) {
      setFormValues((prev) => ({ ...prev, employmentState: '' }));
    }
    if (employmentStageEditingValue === stage) {
      resetEmploymentStageForm();
    }
  };

  const handleSelectIdentifierPreset = (presetId) => {
    setIdentifierLabelError('');
    setAppSettings((prev) => {
      const selectedPreset = prev.identifierPresets.find((preset) => preset.id === presetId);
      if (!selectedPreset) {
        return prev;
      }
      return {
        ...prev,
        identifierCountry: selectedPreset.id,
        pensionFieldLabel: selectedPreset.pensionLabel,
        taxFieldLabel: selectedPreset.taxLabel,
      };
    });
  };

  const handleAddIdentifierPreset = () => {
    const normalizedName = identifierPresetNameInput.trim();
    const normalizedPensionLabel = identifierPensionLabelInput.trim();
    const normalizedTaxLabel = identifierTaxLabelInput.trim();
    if (!normalizedName || !normalizedPensionLabel || !normalizedTaxLabel) {
      setIdentifierLabelError('Preset name, pension label, and tax label are required.');
      return;
    }
    const duplicatePreset = appSettings.identifierPresets.find(
      (preset) => preset.name.toLowerCase() === normalizedName.toLowerCase()
    );
    if (duplicatePreset) {
      setIdentifierLabelError('Preset name already exists.');
      return;
    }
    const baseId = normalizedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setAppSettings((prev) => {
      const existingIds = new Set(prev.identifierPresets.map((preset) => preset.id));
      let candidateId = baseId || 'preset';
      let sequence = 1;
      while (existingIds.has(candidateId)) {
        candidateId = `${baseId || 'preset'}-${sequence}`;
        sequence += 1;
      }
      const newPreset = {
        id: candidateId,
        name: normalizedName,
        pensionLabel: normalizedPensionLabel,
        taxLabel: normalizedTaxLabel,
      };
      return {
        ...prev,
        identifierPresets: [...prev.identifierPresets, newPreset],
        identifierCountry: newPreset.id,
        pensionFieldLabel: newPreset.pensionLabel,
        taxFieldLabel: newPreset.taxLabel,
      };
    });
    setIdentifierPresetNameInput('');
    setIdentifierPensionLabelInput('');
    setIdentifierTaxLabelInput('');
    setIdentifierLabelError('');
  };

  const handleRemoveIdentifierPreset = (presetId) => {
    if (appSettings.identifierPresets.length === 1) {
      setIdentifierLabelError('At least one preset must remain.');
      return;
    }
    setIdentifierLabelError('');
    setAppSettings((prev) => {
      const updatedPresets = prev.identifierPresets.filter((preset) => preset.id !== presetId);
      if (updatedPresets.length === prev.identifierPresets.length) {
        return prev;
      }
      if (prev.identifierCountry !== presetId) {
        return {
          ...prev,
          identifierPresets: updatedPresets,
        };
      }
      const fallbackPreset = updatedPresets[0];
      return {
        ...prev,
        identifierPresets: updatedPresets,
        identifierCountry: fallbackPreset.id,
        pensionFieldLabel: fallbackPreset.pensionLabel,
        taxFieldLabel: fallbackPreset.taxLabel,
      };
    });
  };

  const handleDownloadEmployeeId = async (employeeRow, side) => {
    if (!employeeRow) {
      return;
    }
    const cardOrientation = appSettings.idCardDesign?.orientation || 'landscape';
    const companyName = appSettings.idCardDesign?.companyName || appSettings.appName || 'PTHR';
    const primaryColor = appSettings.idCardDesign?.primaryColor || '#0f4ca3';
    const secondaryColor = appSettings.idCardDesign?.secondaryColor || '#21aa9c';
    const logoUrl = appSettings.idCardDesign?.logoUrl || '';
    const borderRadius = Math.max(
      0,
      Math.min(50, Number(appSettings.idCardDesign?.borderRadius) || 0)
    );
    const { width, height } = getIdCardDimensions(cardOrientation);
    const isPortrait = cardOrientation === 'portrait';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const photoFiles = Array.isArray(employeeRow.passportPhotoFiles) ? employeeRow.passportPhotoFiles : [];
    const photoFile = photoFiles.find((file) => file.isImage);
    const photoUrl = photoFile?.url || employeeRow.passportPhotoPreview || '';
    const expiryText = formatCardDate(employeeRow.contractEndDate);
    const barcodeValue = String(employeeRow.id || employeeRow.fullName || 'EMPLOYEE');
    const emergencyContact = `${employeeRow.emergencyContact1Name || 'N/A'} • ${
      employeeRow.emergencyContact1Phone || 'N/A'
    }`;
    const cardSide = side === 'back' ? 'back' : 'front';
    const titleText = cardSide === 'back' ? 'OFFICIAL BACK' : 'EMPLOYEE ID CARD';
    const logoImage = logoUrl
      ? await loadImageFromUrl(logoUrl).catch(() => null)
      : null;
    const photoImage = photoUrl
      ? await loadImageFromUrl(photoUrl).catch(() => null)
      : null;

    drawRoundedRectPath(ctx, 0, 0, width, height, borderRadius);
    ctx.clip();

    const baseGradient = ctx.createLinearGradient(0, 0, width, height);
    baseGradient.addColorStop(0, '#ffffff');
    baseGradient.addColorStop(1, '#f4f9ff');
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#bcd3f3';
    ctx.lineWidth = Math.max(2, Math.round(width * 0.003));
    drawRoundedRectPath(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth, borderRadius);
    ctx.stroke();

    const headerHeight = Math.round(height * 0.14);
    const subheadHeight = Math.round(height * 0.095);
    const footerHeight = cardSide === 'front' ? Math.round(height * 0.155) : 0;
    const bodyY = headerHeight + subheadHeight;
    const bodyHeight = height - bodyY - footerHeight;
    const bodyPadding = Math.round(width * 0.03);
    const contentWidth = width - bodyPadding * 2;
    const accentGradient = ctx.createLinearGradient(0, 0, width, 0);
    accentGradient.addColorStop(0, primaryColor);
    accentGradient.addColorStop(1, secondaryColor);

    ctx.fillStyle = accentGradient;
    ctx.fillRect(0, 0, width, headerHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${isPortrait ? 24 : 26}px "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(titleText, bodyPadding, Math.round(height * 0.028));
    ctx.font = `700 ${isPortrait ? 16 : 17}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(companyName, bodyPadding, Math.round(height * 0.078));

    if (logoImage) {
      const logoBoxHeight = isPortrait ? 42 : 34;
      const logoRatio = logoImage.width > 0 && logoImage.height > 0 ? logoImage.width / logoImage.height : 1;
      const logoWidth = Math.min(isPortrait ? 108 : 112, logoBoxHeight * logoRatio);
      const logoX = width - bodyPadding - logoWidth;
      const logoY = Math.round(height * 0.03);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      drawRoundedRectPath(ctx, logoX - 5, logoY - 3, logoWidth + 10, logoBoxHeight + 6, 8);
      ctx.fill();
      ctx.drawImage(logoImage, logoX, logoY, logoWidth, logoBoxHeight);
    }

    ctx.fillStyle = '#e8edf6';
    ctx.fillRect(0, headerHeight, width, subheadHeight);
    ctx.fillStyle = '#37517e';
    ctx.font = `700 ${isPortrait ? 14 : 16}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(
      fitText(ctx, String(employeeRow.department || 'Department').toUpperCase(), width - bodyPadding * 2),
      bodyPadding,
      headerHeight + Math.round(subheadHeight * 0.25)
    );

    const drawInfoRows = (rows, startX, startY, maxValueWidth, rowGap, variant = 'default') => {
      const labelSize = variant === 'compact' ? (isPortrait ? 12 : 11) : isPortrait ? 13 : 12;
      const valueSize = variant === 'compact' ? (isPortrait ? 19 : 17) : isPortrait ? 21 : 20;
      const valueOffset = variant === 'compact' ? (isPortrait ? 14 : 12) : isPortrait ? 18 : 16;
      rows.forEach(([label, value], index) => {
        const y = startY + index * rowGap;
        ctx.fillStyle = '#6780ab';
        ctx.font = `600 ${labelSize}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(String(label).toUpperCase(), startX, y);
        ctx.fillStyle = '#1c376e';
        ctx.font = `700 ${valueSize}px "Segoe UI", Arial, sans-serif`;
        ctx.fillText(fitText(ctx, value, maxValueWidth), startX, y + valueOffset);
      });
    };

    if (cardSide === 'front') {
      const photoBoxWidth = isPortrait ? Math.round(contentWidth * 0.58) : Math.round(contentWidth * 0.3);
      const photoBoxHeight = isPortrait ? Math.round(bodyHeight * 0.27) : Math.round(bodyHeight * 0.82);
      const photoX = isPortrait ? Math.round((width - photoBoxWidth) / 2) : bodyPadding;
      const photoY = bodyY + Math.round(height * 0.03);

      ctx.fillStyle = '#e7f1ff';
      ctx.strokeStyle = '#cad9ef';
      ctx.lineWidth = 1.4;
      drawRoundedRectPath(ctx, photoX, photoY, photoBoxWidth, photoBoxHeight, 14);
      ctx.fill();
      ctx.stroke();

      if (photoImage) {
        ctx.drawImage(photoImage, photoX + 1, photoY + 1, photoBoxWidth - 2, photoBoxHeight - 2);
      } else {
        ctx.fillStyle = '#56739d';
        ctx.font = `700 ${isPortrait ? 17 : 16}px "Segoe UI", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('PHOTO', photoX + photoBoxWidth / 2, photoY + photoBoxHeight / 2 - 10);
        ctx.textAlign = 'left';
      }

      const rows = [
        ['Name', employeeRow.fullName || '—'],
        ['Position', employeeRow.position || '—'],
        ['Employee Number', employeeRow.id || '—'],
        ['Date of Expiry', expiryText],
      ];

      if (isPortrait) {
        const rowStartY = photoY + photoBoxHeight + Math.round(height * 0.03);
        drawInfoRows(rows, bodyPadding, rowStartY, width - bodyPadding * 2, Math.round(height * 0.073));
      } else {
        const infoX = photoX + photoBoxWidth + Math.round(width * 0.02);
        const maxValueWidth = width - infoX - bodyPadding;
        const rowGap = Math.max(42, Math.round(photoBoxHeight * 0.2));
        drawInfoRows(rows, infoX, photoY + 2, maxValueWidth, rowGap, 'compact');
      }

      const footerY = height - footerHeight;
      ctx.fillStyle = '#f7fbff';
      ctx.fillRect(0, footerY, width, footerHeight);
      ctx.fillStyle = '#d9e4f8';
      ctx.fillRect(0, footerY, width, 2);

      const barcodeWidth = isPortrait ? Math.round(width * 0.72) : Math.round(width * 0.45);
      const barcodeHeight = isPortrait ? Math.round(footerHeight * 0.36) : Math.round(footerHeight * 0.42);
      const barcodeX = Math.round((width - barcodeWidth) / 2);
      const barcodeY = footerY + Math.round(footerHeight * 0.25);
      drawCode39Barcode(ctx, barcodeValue, barcodeX, barcodeY, barcodeWidth, barcodeHeight, '#132d63');
      ctx.fillStyle = '#132d63';
      ctx.font = `600 ${isPortrait ? 11 : 10}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(barcodeValue.toUpperCase(), width / 2, barcodeY + barcodeHeight + 12);
      ctx.textAlign = 'left';
    } else {
      const rows = [
        ['ID', employeeRow.id || '—'],
        ['Name', employeeRow.fullName || '—'],
        ['Department', employeeRow.department || '—'],
        ['Emergency Contact', emergencyContact],
        ['Expiry', expiryText],
      ];
      const rowStartX = bodyPadding;
      const rowStartY = bodyY + Math.round(height * 0.03);
      const rowGap = Math.round(height * 0.102);

      let valueWidth = width - bodyPadding * 2;
      if (logoImage) {
        valueWidth = width - bodyPadding * 2 - (isPortrait ? 130 : 110);
      }
      drawInfoRows(rows, rowStartX, rowStartY, valueWidth, rowGap);

      if (logoImage) {
        const bodyLogoHeight = isPortrait ? 58 : 46;
        const bodyLogoRatio = logoImage.width > 0 && logoImage.height > 0 ? logoImage.width / logoImage.height : 1;
        const bodyLogoWidth = Math.min(isPortrait ? 140 : 124, bodyLogoHeight * bodyLogoRatio);
        const bodyLogoX = width - bodyPadding - bodyLogoWidth;
        const bodyLogoY = rowStartY + Math.round(height * 0.03);
        ctx.fillStyle = '#f7fbff';
        drawRoundedRectPath(ctx, bodyLogoX - 6, bodyLogoY - 4, bodyLogoWidth + 12, bodyLogoHeight + 8, 8);
        ctx.fill();
        ctx.strokeStyle = '#cad9ef';
        ctx.lineWidth = 1;
        drawRoundedRectPath(ctx, bodyLogoX - 6, bodyLogoY - 4, bodyLogoWidth + 12, bodyLogoHeight + 8, 8);
        ctx.stroke();
        ctx.drawImage(logoImage, bodyLogoX, bodyLogoY, bodyLogoWidth, bodyLogoHeight);
      }

      const footerAreaY = bodyY + Math.round(bodyHeight * 0.76);
      const qrSize = isPortrait ? 90 : 72;
      const qrX = bodyPadding;
      const qrY = footerAreaY;
      ctx.fillStyle = '#132d63';
      ctx.fillRect(qrX, qrY, qrSize, qrSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qrX + 10, qrY + 10, qrSize - 20, qrSize - 20);
      ctx.fillStyle = '#132d63';
      for (let i = 0; i < 10; i += 1) {
        const px = qrX + 14 + ((i * 9) % (qrSize - 28));
        const py = qrY + 14 + ((i * 11) % (qrSize - 28));
        const sq = i % 2 === 0 ? 9 : 6;
        ctx.fillRect(px, py, sq, sq);
      }

      const signatureX = qrX + qrSize + Math.round(width * 0.03);
      const signatureWidth = width - signatureX - bodyPadding;
      const signatureTop = qrY + Math.round(qrSize * 0.55);
      ctx.strokeStyle = '#bfd0ef';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(signatureX, signatureTop);
      ctx.lineTo(signatureX + signatureWidth * 0.46, signatureTop);
      ctx.moveTo(signatureX + signatureWidth * 0.54, signatureTop);
      ctx.lineTo(signatureX + signatureWidth, signatureTop);
      ctx.stroke();
      ctx.fillStyle = '#6780ab';
      ctx.font = `700 ${isPortrait ? 11 : 10}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText('EMPLOYEE SIGNATURE', signatureX + 4, signatureTop + 6);
      ctx.fillText('HR MANAGER', signatureX + signatureWidth * 0.56, signatureTop + 6);
    }

    const fileNameBase = String(employeeRow.fullName || employeeRow.id || 'employee')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'employee';
    const downloadLink = document.createElement('a');
    downloadLink.href = canvas.toDataURL('image/png');
    downloadLink.download =
      cardSide === 'back' ? `${fileNameBase}-employee-id-back.png` : `${fileNameBase}-employee-id.png`;
    downloadLink.click();
  };

  const handleIdCardLogoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAppSettings((prev) => ({
        ...prev,
        idCardDesign: {
          ...prev.idCardDesign,
          logoUrl: String(reader.result || ''),
        },
      }));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleDownloadBothEmployeeIdSides = async (employeeRow) => {
    await handleDownloadEmployeeId(employeeRow, 'front');
    await handleDownloadEmployeeId(employeeRow, 'back');
  };

  if (!currentUser) {
    return (
      <div className="App login-mode">
        <div className="login-shell">
          <div className="login-panel">
            <h1>{appSettings.appName || 'PTHR'} HR Workspace</h1>
            <p>Sign in to continue.</p>
            <form onSubmit={handleLoginSubmit} className="login-form">
              <label>
                  <span>Tenant ID</span>
                  <input
                    autoComplete="organization"
                    value={loginForm.tenantId}
                    onChange={(event) =>
                      setLoginForm((prev) => ({ ...prev, tenantId: event.target.value }))
                    }
                    placeholder="master or acme-ghana"
                    required
                  />
                </label>
                <label>
                <span>Username or Employee ID</span>
                <input
                  autoComplete="username"
                  value={loginForm.username}
                  onChange={(event) =>
                    setLoginForm((prev) => ({ ...prev, username: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Password</span>
                <div className="password-input-wrap">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={loginForm.password}
                    onChange={(event) =>
                      setLoginForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                    title={showLoginPassword ? 'Hide password' : 'Show password'}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 5C6.6 5 2.4 8.2 1 12c1.4 3.8 5.6 7 11 7s9.6-3.2 11-7c-1.4-3.8-5.6-7-11-7Zm0 11.2A4.2 4.2 0 1 1 12 7.8a4.2 4.2 0 0 1 0 8.4Zm0-6.6A2.4 2.4 0 1 0 12 14.4a2.4 2.4 0 0 0 0-4.8Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
              </label>
              {loginError ? <div className="form-error">{loginError}</div> : null}
              {loginNotice ? (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: '#eaf8ef',
                    color: '#17603a',
                    fontSize: 14,
                  }}
                >
                  {loginNotice}
                </div>
              ) : null}
            <button type="submit" className="primary-btn" disabled={loginLoading}>
              {loginLoading ? 'Signing In...' : 'Sign In'}
              </button>
              {String(loginForm.tenantId || '').trim() ? (
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() =>
                    openSubscriptionExtendModal(
                      loginForm.tenantId,
                      subscriptionExtendModal.tenantId === String(loginForm.tenantId || '').trim().toLowerCase()
                        ? subscriptionExtendModal.tenant
                        : null
                    )
                  }
                >
                  Extend Days
                </button>
              ) : null}
              {backendHealth.status === 'error' ? (
                <div className="login-hint">
                  Backend or database is not connected. Check the server before logging in.
                </div>
              ) : null}
            </form>
          </div>
        </div>
        <SubscriptionExtendModal
          open={subscriptionExtendModal.open}
          tenantId={subscriptionExtendModal.tenantId}
          initialTenant={subscriptionExtendModal.tenant}
          onClose={closeSubscriptionExtendModal}
          onSubscriptionUpdated={handleSubscriptionUpdated}
        />
      </div>
    );
  }

  return (
    <div className="App">
      <SidebarNav
        sidebarSections={sidebarSections}
        allowedModulesByRole={allowedModulesByRole}
        activeModuleId={activeModuleId}
        setActiveModuleId={setActiveModuleId}
        handleModuleChange={handleModuleChange}
        sidebarStyle={sidebarStyle}
        appInitial={appInitial}
        appSettings={appSettings}
        leaveMenuExpanded={leaveMenuExpanded}
        setLeaveMenuExpanded={setLeaveMenuExpanded}
        leaveSubmenuItems={leaveSubmenuItems}
        leaveViewTab={leaveViewTab}
        setLeaveViewTab={setLeaveViewTab}
        setLeaveRequestPageTab={setLeaveRequestPageTab}
        loanMenuExpanded={loanMenuExpanded}
        setLoanMenuExpanded={setLoanMenuExpanded}
        loanSubmenuItems={loanSubmenuItems}
        loanViewTab={loanViewTab}
        setLoanViewTab={setLoanViewTab}
      />

      <div className="app-shell">
        <header className="hero">
          <div className="hero-right">
            <div className="user-header">
              <div className="user-avatar">
                {(currentUser.fullName || currentUser.username || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="user-header-main">
                <div className="user-header-name">
                  {currentUser.fullName || currentUser.username}
                </div>
                <div className="user-header-role">
                  {currentUser.role || 'user'}
                </div>
              </div>
              {!isAppInstalled ? (
                isInstallPromptAvailable ? (
                  <button type="button" className="secondary-btn small install-btn" onClick={handleInstallApp}>
                    Install App
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-btn small install-btn"
                    onClick={() => setIsInstallHelpOpen(true)}
                  >
                    Install Help
                  </button>
                )
              ) : null}
              <button type="button" className="secondary-btn small" onClick={handleLogout}>
                Sign out
              </button>
            </div>
            <div className="hero-status-row">
              <span
                className="hero-status-chip"
                style={{
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  backgroundColor:
                    backendHealth.mongo === 'connected' ? '#e6f4ea' : '#fdecea',
                  color: backendHealth.mongo === 'connected' ? '#1e8e3e' : '#b00020',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor:
                      backendHealth.mongo === 'connected' ? '#1e8e3e' : '#b00020',
                  }}
                />
                {backendHealth.mongo === 'connected'
                  ? 'Connected'
                  : 'Not connected'}
              </span>
              {currentUser.tenantId && currentUser.tenantId !== 'master' ? (
                <>
                  <span
                    className="hero-status-chip"
                    style={{
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 10px',
                      borderRadius: 999,
                      fontSize: 12,
                      backgroundColor:
                        typeof currentUser.subscriptionDaysRemaining === 'number' && currentUser.subscriptionDaysRemaining <= 7
                          ? '#fff2df'
                          : '#eaf2ff',
                      color:
                        typeof currentUser.subscriptionDaysRemaining === 'number' && currentUser.subscriptionDaysRemaining <= 7
                          ? '#8a4c0f'
                          : '#1b3f8d',
                    }}
                  >
                    {String(currentUser.packageType || 'plan').toLowerCase()} •{' '}
                    {formatSubscriptionStatusLabel(
                      currentUser.subscriptionDaysRemaining,
                      currentUser.subscriptionExpiresAt
                    )}
                  </span>
                  <button
                    type="button"
                    className="secondary-btn small hero-status-action"
                    onClick={() =>
                      openSubscriptionExtendModal(currentUser.tenantId, {
                        tenantId: currentUser.tenantId,
                        tenantName: currentUser.tenantName,
                        packageType: currentUser.packageType,
                        subscriptionExpiresAt: currentUser.subscriptionExpiresAt,
                        subscriptionDaysRemaining: currentUser.subscriptionDaysRemaining,
                      })
                    }
                  >
                    Extend Days
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </header>

        {!isSettingsPage ? (
          <div className="mobile-quick-bar">
            <div className="mobile-quick-bar-row">
              <label>
                <span>Module</span>
                <select
                  className="filter-select"
                  value={activeModuleId}
                  onChange={(event) => handleModuleChange(event.target.value)}
                >
                  {mobileModuleOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {showMainModuleTable ? (
                <label>
                  <span>Quick Search</span>
                  <input
                    className="search-input"
                    placeholder="Search records..."
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>
        ) : null}

        <main className="content-grid">
          {isSettingsPage ? (
            <section className="panel settings-panel">
              <div className="panel-title-row">
                <div>
                  <h2>Settings</h2>
                  <p>Manage app values, departments, employment stages, and ID card design</p>
                </div>
              </div>
              <div className="settings-tab-strip">
                {[
                  { id: 'general', label: 'General' },
                  { id: 'attendance', label: 'Attendance Rules' },
                  { id: 'tracking', label: 'Presence Tracking' },
                  { id: 'mobile', label: 'Mobile App' },
                  { id: 'payroll', label: 'Payroll & Loans' },
                  { id: 'fingerprint', label: 'Fingerprint' },
                  { id: 'labels', label: 'Employee Labels' },
                  { id: 'currency', label: 'Currency' },
                  { id: 'departments', label: 'Departments' },
                  { id: 'employment', label: 'Employment Stages' },
                  { id: 'id-card', label: 'ID Card' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`settings-tab-btn ${settingsTab === tab.id ? 'active' : ''}`}
                    onClick={() => setSettingsTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="settings-grid">
                {isGeneralSettingsTab ? (
                  <div className="settings-action-row" style={{ gridColumn: '1 / -1' }}>
                    {generalSettingsLoading ? <span className="settings-action-status">Loading general settings from backend...</span> : null}
                    {generalSettingsError ? <span className="form-error">{generalSettingsError}</span> : null}
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => saveGeneralSettings(appSettings)}
                      disabled={generalSettingsLoading || generalSettingsSaving}
                    >
                      {generalSettingsSaving ? 'Saving General Settings...' : 'Save General Settings'}
                    </button>
                    {generalSettingsSavedMessage ? <span className="settings-action-status">{generalSettingsSavedMessage}</span> : null}
                  </div>
                ) : null}
                {settingsTab === 'general' ? (
                  <>
                    <label>
                      <span>Application Name</span>
                      <input
                        value={appSettings.appName}
                        disabled={!canEditApplicationName}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            appName: event.target.value,
                          }))
                        }
                      />
                      {!canEditApplicationName ? (
                        <small style={{ color: '#627099' }}>
                          Only the master super admin can edit the application name.
                        </small>
                      ) : null}
                    </label>
                    <label>
                      <span>Default Currency</span>
                      <select
                        className="filter-select"
                        value={appSettings.defaultCurrency}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            defaultCurrency: event.target.value,
                          }))
                        }
                      >
                        {appSettings.currencies.map((currency) => (
                          <option key={currency} value={currency}>
                            {currency}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Penalty Actor Username</span>
                      <input
                        value={appSettings.penaltyActorUsername}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            penaltyActorUsername: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Sidebar Color</span>
                      <input
                        type="color"
                        value={sidebarBaseColor}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            sidebarColor: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Letterhead Company Name</span>
                      <input
                        value={appSettings.idCardDesign.companyName}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyName: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Letterhead Address</span>
                      <textarea
                        rows="3"
                        value={appSettings.idCardDesign.companyAddress}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyAddress: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Letterhead Phone</span>
                      <input
                        value={appSettings.idCardDesign.companyPhone}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyPhone: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Letterhead Email</span>
                      <input
                        type="email"
                        value={appSettings.idCardDesign.companyEmail}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyEmail: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Letterhead Website</span>
                      <input
                        value={appSettings.idCardDesign.companyWebsite}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyWebsite: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  </>
                ) : null}
                {settingsTab === 'attendance' ? (
                  <>
                    {attendanceSettingsLoading ? <p>Loading attendance settings from backend...</p> : null}
                    {attendanceSettingsError ? <p className="form-error">{attendanceSettingsError}</p> : null}
                    <label>
                      <span>Reporting Time</span>
                      <input
                        type="time"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                        value={appSettings.attendanceReportTime}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceReportTime: event.target.value || '08:00',
                          }))
                        }
                        onBlur={() => saveAttendanceSettings({ ...appSettings })}
                      />
                    </label>
                    <label>
                      <span>Free Late Until</span>
                      <input
                        type="time"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                        value={appSettings.attendanceLateAfter}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceLateAfter: event.target.value || '08:15',
                          }))
                        }
                        onBlur={() => saveAttendanceSettings({ ...appSettings })}
                      />
                    </label>
                    <label>
                      <span>Shift End Time</span>
                      <input
                        type="time"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                        value={appSettings.attendanceShiftEnd}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceShiftEnd: event.target.value || '17:00',
                          }))
                        }
                        onBlur={() => saveAttendanceSettings({ ...appSettings })}
                      />
                    </label>
                    <label className="inline-field">
                      <span>Require Selfie On Web Clock In/Out</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.requireWebClockInPhoto)}
                        onChange={(event) => {
                          const nextSettings = {
                            ...appSettings,
                            requireWebClockInPhoto: event.target.checked,
                          };
                          setAppSettings(nextSettings);
                          void saveAttendanceSettings(nextSettings);
                        }}
                      />
                    </label>
                    <div className="attendance-audit-wrap" style={{ gridColumn: '1 / -1' }}>
                      <div className="attendance-audit-head">
                        <h4>Shift Templates</h4>
                        <div className="attendance-audit-actions">
                          <button
                            type="button"
                            className="neutral-btn"
                            disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                            onClick={() =>
                              setAppSettings((prev) => {
                                const nextSettings = {
                                  ...prev,
                                  shifts: [
                                    ...(Array.isArray(prev.shifts) ? prev.shifts : []),
                                    {
                                      id: `SHIFT-${Date.now()}`,
                                      name: `Shift ${Math.max(1, (Array.isArray(prev.shifts) ? prev.shifts.length : 0) + 1)}`,
                                      reportTime: prev.attendanceReportTime || '08:00',
                                      shiftEnd: prev.attendanceShiftEnd || '17:00',
                                      graceInMinutes: 15,
                                      graceOutMinutes: 0,
                                      overtimeEnabled: false,
                                      overtimeStartAfterMinutes: 0,
                                      overtimePayPerMinute: 0,
                                    },
                                  ],
                                };
                                void saveAttendanceSettings(nextSettings);
                                return nextSettings;
                              })
                            }
                          >
                            {attendanceSettingsSaving ? 'Saving...' : 'Add Shift'}
                          </button>
                        </div>
                      </div>
                      <p className="muted-note">
                        Shift rules apply only to employees assigned to that shift. Configure overtime per shift using toggle, start-after minutes, and pay per minute.
                      </p>
                      <div className="attendance-audit-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Shift Name</th>
                              <th>Time In</th>
                              <th>Time Out</th>
                              <th>Grace In (min)</th>
                              <th>Grace Out (min)</th>
                              <th>Overtime</th>
                              <th>OT Start After (min)</th>
                              <th>OT Pay / Min</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attendanceShiftOptions.map((shift, index) => (
                              <tr key={shift.id || `${shift.name}-${index}`}>
                                <td>
                                  <input
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.name}
                                    onChange={(event) => {
                                      const previousName = String(shift.name || '').trim();
                                      const nextName = String(event.target.value || '').trim();
                                      if (!nextName) {
                                        return;
                                      }
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index ? { ...item, name: nextName } : item
                                        ),
                                      }));
                                      if (previousName && nextName && previousName !== nextName) {
                                        setModuleRowsState((prev) => ({
                                          ...prev,
                                          'employee-management': (prev['employee-management'] || []).map((employeeRow) =>
                                            String(employeeRow.assignedShift || '').trim() === previousName
                                              ? { ...employeeRow, assignedShift: nextName }
                                              : employeeRow
                                          ),
                                          'attendance-time': (prev['attendance-time'] || []).map((attendanceRow) =>
                                            String(attendanceRow.shift || '').trim() === previousName
                                              ? { ...attendanceRow, shift: nextName }
                                              : attendanceRow
                                          ),
                                        }));
                                        setAttendanceClockDraft((prev) =>
                                          String(prev.shift || '').trim() === previousName
                                            ? { ...prev, shift: nextName }
                                            : prev
                                        );
                                      }
                                    }}
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="time"
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.reportTime}
                                    onChange={(event) =>
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index
                                            ? { ...item, reportTime: event.target.value || '08:00' }
                                            : item
                                        ),
                                      }))
                                    }
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="time"
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.shiftEnd}
                                    onChange={(event) =>
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index
                                            ? { ...item, shiftEnd: event.target.value || '17:00' }
                                            : item
                                        ),
                                      }))
                                    }
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.graceInMinutes}
                                    onChange={(event) =>
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index
                                            ? { ...item, graceInMinutes: Math.max(0, Number(event.target.value) || 0) }
                                            : item
                                        ),
                                      }))
                                    }
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.graceOutMinutes}
                                    onChange={(event) =>
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index
                                            ? { ...item, graceOutMinutes: Math.max(0, Number(event.target.value) || 0) }
                                            : item
                                        ),
                                      }))
                                    }
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  />
                                </td>
                                <td>
                                  <select
                                    className="filter-select"
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.overtimeEnabled ? 'on' : 'off'}
                                    onChange={(event) =>
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index
                                            ? { ...item, overtimeEnabled: event.target.value === 'on' }
                                            : item
                                        ),
                                      }))
                                    }
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  >
                                    <option value="off">Off</option>
                                    <option value="on">On</option>
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.overtimeStartAfterMinutes}
                                    onChange={(event) =>
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index
                                            ? { ...item, overtimeStartAfterMinutes: Math.max(0, Number(event.target.value) || 0) }
                                            : item
                                        ),
                                      }))
                                    }
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                                    value={shift.overtimePayPerMinute}
                                    onChange={(event) =>
                                      setAppSettings((prev) => ({
                                        ...prev,
                                        shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).map((item, itemIndex) =>
                                          item.id === shift.id || itemIndex === index
                                            ? { ...item, overtimePayPerMinute: Math.max(0, Number(event.target.value) || 0) }
                                            : item
                                        ),
                                      }))
                                    }
                                    onBlur={() => saveAttendanceSettings({ ...appSettings })}
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="danger-btn"
                                    onClick={() =>
                                      (() => {
                                        const removingName = String(shift.name || '').trim();
                                        const fallbackShiftName =
                                          attendanceShiftOptions.find((item) => String(item.name || '').trim() !== removingName)?.name ||
                                          '';
                                        setAppSettings((prev) => {
                                          const nextSettings = {
                                            ...prev,
                                            shifts: (Array.isArray(prev.shifts) ? prev.shifts : []).filter(
                                              (item, itemIndex) => !(item.id === shift.id || itemIndex === index)
                                            ),
                                          };
                                          void saveAttendanceSettings(nextSettings);
                                          return nextSettings;
                                        });
                                        setModuleRowsState((prev) => ({
                                          ...prev,
                                          'employee-management': (prev['employee-management'] || []).map((employeeRow) =>
                                            String(employeeRow.assignedShift || '').trim() === removingName
                                              ? { ...employeeRow, assignedShift: fallbackShiftName }
                                              : employeeRow
                                          ),
                                        }));
                                        setAttendanceClockDraft((prev) =>
                                          String(prev.shift || '').trim() === removingName
                                            ? { ...prev, shift: fallbackShiftName }
                                            : prev
                                        );
                                      })()
                                    }
                                    disabled={attendanceShiftOptions.length <= 1 || attendanceSettingsLoading || attendanceSettingsSaving}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <label>
                      <span>Payroll Working Days</span>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                        value={appSettings.payrollWorkingDays}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            payrollWorkingDays: Math.max(1, Number(event.target.value) || 1),
                          }))
                        }
                        onBlur={() => saveAttendanceSettings({ ...appSettings })}
                      />
                    </label>
                    <label>
                      <span>Deduction Mode</span>
                      <select
                        className="filter-select"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                        value={appSettings.attendanceCalculationMode}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceCalculationMode: event.target.value === 'fixed' ? 'fixed' : 'auto',
                          }))
                        }
                        onBlur={() => saveAttendanceSettings({ ...appSettings })}
                      >
                        <option value="auto">System Calculation</option>
                        <option value="fixed">Fixed Per Minute</option>
                      </select>
                    </label>
                    <label>
                      <span>Fixed Deduction Per Minute</span>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving || appSettings.attendanceCalculationMode !== 'fixed'}
                        value={appSettings.attendanceFixedDeductionPerMinute}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceFixedDeductionPerMinute: Math.max(0, Number(event.target.value) || 0),
                          }))
                        }
                        onBlur={() => saveAttendanceSettings({ ...appSettings })}
                      />
                    </label>
                    <label>
                      <span>Fixed Scope</span>
                      <select
                        className="filter-select"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving || appSettings.attendanceCalculationMode !== 'fixed'}
                        value={appSettings.attendanceFixedScope}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceFixedScope: event.target.value,
                          }))
                        }
                        onBlur={() => saveAttendanceSettings({ ...appSettings })}
                      >
                        <option value="all">All Employees</option>
                        <option value="department">By Department</option>
                        <option value="individual">By Individual</option>
                      </select>
                    </label>
                    {appSettings.attendanceCalculationMode === 'fixed' && appSettings.attendanceFixedScope === 'department' ? (
                      <label>
                        <span>Fixed Department</span>
                        <select
                          className="filter-select"
                          disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                          value={appSettings.attendanceFixedDepartment}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              attendanceFixedDepartment: event.target.value,
                            }))
                          }
                          onBlur={() => saveAttendanceSettings({ ...appSettings })}
                        >
                          <option value="">Select department</option>
                          {currentDepartmentOptions.map((department) => (
                            <option key={department} value={department}>
                              {department}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {appSettings.attendanceCalculationMode === 'fixed' && appSettings.attendanceFixedScope === 'individual' ? (
                      <label>
                        <span>Fixed Employee</span>
                        <select
                          className="filter-select"
                          disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                          value={appSettings.attendanceFixedEmployeeId}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              attendanceFixedEmployeeId: event.target.value,
                            }))
                          }
                          onBlur={() => saveAttendanceSettings({ ...appSettings })}
                        >
                          <option value="">Select employee</option>
                          {employeeBaseRows.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.fullName} ({employee.id})
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <div className="attendance-audit-actions" style={{ gridColumn: '1 / -1' }}>
                      <button
                        type="button"
                        className="primary-btn"
                        disabled={attendanceSettingsLoading || attendanceSettingsSaving}
                        onClick={() => saveAttendanceSettings({ ...appSettings })}
                      >
                        {attendanceSettingsSaving ? 'Saving Attendance Settings...' : 'Save Attendance Settings'}
                      </button>
                      {attendanceSettingsSavedMessage ? <span>{attendanceSettingsSavedMessage}</span> : null}
                    </div>
                  </>
                ) : null}
                {settingsTab === 'tracking' ? (
                  <>
                    <h4 className="settings-subtitle">Presence Tracking Rules</h4>
                    {trackingSettingsLoading ? <p>Loading tracking settings from backend...</p> : null}
                    {trackingSettingsError ? <p className="form-error">{trackingSettingsError}</p> : null}
                    <label>
                      <span>Office Latitude</span>
                      <input
                        type="number"
                        step="0.000001"
                        value={appSettings.trackingRules.officeLat ?? ''}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              officeLat:
                                event.target.value === '' ? null : Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Office Longitude</span>
                      <input
                        type="number"
                        step="0.000001"
                        value={appSettings.trackingRules.officeLng ?? ''}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              officeLng:
                                event.target.value === '' ? null : Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Geofence Radius (meters)</span>
                      <input
                        type="number"
                        min="10"
                        step="1"
                        value={appSettings.trackingRules.geofenceRadiusMeters}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              geofenceRadiusMeters: Math.max(
                                10,
                                Number(event.target.value) || 10
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Enforce GPS Geofence</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.trackingRules.geofenceEnabled)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              geofenceEnabled: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Require Office WiFi</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.trackingRules.wifiValidationEnabled)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              wifiValidationEnabled: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Allowed WiFi SSIDs (comma-separated)</span>
                      <input
                        value={appSettings.trackingRules.officeWifiSsids.join(', ')}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              officeWifiSsids: event.target.value
                                .split(',')
                                .map((value) => value.trim())
                                .filter((value) => value.length > 0),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Allowed WiFi BSSIDs (comma-separated)</span>
                      <input
                        value={appSettings.trackingRules.officeWifiBssids.join(', ')}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              officeWifiBssids: event.target.value
                                .split(',')
                                .map((value) => value.trim())
                                .filter((value) => value.length > 0),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Office IP ranges (comma-separated)</span>
                      <input
                        value={appSettings.trackingRules.officeIpRanges.join(', ')}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              officeIpRanges: event.target.value
                                .split(',')
                                .map((value) => value.trim())
                                .filter((value) => value.length > 0),
                            },
                          }))
                        }
                      />
                    </label>
                    <p style={{ marginTop: -4, color: '#4b6090', fontSize: 12 }}>
                      VPN does not change GPS coordinates, but it can hide real network origin. Use Office WiFi and Office IP ranges together
                      to flag network-risk when VPN/proxy is used.
                    </p>
                    <label className="inline-field">
                      <span>Monitor Activity</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.trackingRules.activityMonitoringEnabled)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              activityMonitoringEnabled: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Random Selfie Verification</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.trackingRules.randomSelfieEnabled)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              randomSelfieEnabled: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Anti-GPS Spoofing</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.trackingRules.antiGpsSpoofingEnabled)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              antiGpsSpoofingEnabled: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>WhatsApp Alerts to Managers</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.trackingRules.whatsappAlertsEnabled)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              whatsappAlertsEnabled: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Alert When Location Is Turned Off</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.trackingRules.locationOffAlertEnabled)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              locationOffAlertEnabled: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Offline After (minutes)</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={appSettings.trackingRules.offlineMinutesThreshold}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            trackingRules: {
                              ...prev.trackingRules,
                              offlineMinutesThreshold: Math.max(
                                1,
                                Number(event.target.value) || 1
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                    <div className="attendance-ops-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={handleSaveTrackingSettings}
                        disabled={trackingSettingsSaving}
                      >
                        {trackingSettingsSaving ? 'Saving...' : 'Save Tracking Settings'}
                      </button>
                    </div>
                    {trackingSettingsSavedMessage ? <p>{trackingSettingsSavedMessage}</p> : null}
                  </>
                ) : null}
                {settingsTab === 'mobile' ? (
                  <>
                    <h4 className="settings-subtitle">Mobile App Management</h4>
                    {mobileSettingsLoading ? <p>Loading mobile settings from backend...</p> : null}
                    {mobileSettingsError ? <p className="form-error">{mobileSettingsError}</p> : null}
                    <label>
                      <span>Enabled Mobile Modules</span>
                      <select
                        multiple
                        value={appSettings.mobileApp.enabledModules}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              enabledModules: Array.from(event.target.selectedOptions).map((option) => option.value),
                            },
                          }))
                        }
                      >
                        <option value="attendance-time">Attendance</option>
                        <option value="loan-records">Loan Records</option>
                        <option value="leave-management">Leave Management</option>
                        <option value="monitoring-tracking">Live Tracking</option>
                      </select>
                    </label>
                    <label className="inline-field">
                      <span>Allow Clock In</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.allowClockIn)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              allowClockIn: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Allow Clock Out</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.allowClockOut)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              allowClockOut: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Require Selfie On Mobile Clock In/Out</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.requireClockInPhoto)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              requireClockInPhoto: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Require Location When Clocking</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.requireLocationOnClock)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              requireLocationOnClock: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Auto Send Live Location On Clock</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.autoSendLocationOnClock)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              autoSendLocationOnClock: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Auto Start Tracking On Clock In</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.autoStartTrackingOnClockIn)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              autoStartTrackingOnClockIn: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Allow Loan Records View</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.allowLoanView)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              allowLoanView: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Allow Loan Requests</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.allowLoanRequest)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              allowLoanRequest: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Allow Leave Records View</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.allowLeaveView)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              allowLeaveView: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Allow Leave Requests</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.allowLeaveRequest)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              allowLeaveRequest: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="inline-field">
                      <span>Allow Tracking Module</span>
                      <input
                        type="checkbox"
                        checked={Boolean(appSettings.mobileApp.allowTrackingView)}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            mobileApp: {
                              ...prev.mobileApp,
                              allowTrackingView: event.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                    <div className="attendance-ops-actions">
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={handleSaveMobileSettings}
                        disabled={mobileSettingsSaving}
                      >
                        {mobileSettingsSaving ? 'Saving...' : 'Save Mobile Settings'}
                      </button>
                    </div>
                    {mobileSettingsSavedMessage ? <p>{mobileSettingsSavedMessage}</p> : null}
                  </>
                ) : null}
                {settingsTab === 'payroll' ? (
                  <>
                    <h4 className="settings-subtitle">Payroll Rules</h4>
                    <label>
                      <span>Payroll Working Days</span>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={appSettings.payrollWorkingDays}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            payrollWorkingDays: Math.max(1, Number(event.target.value) || 1),
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>NAPSA Rule</span>
                      <div className="inline-field">
                        <select
                          className="filter-select"
                          value={appSettings.statutoryRules.napsaMode}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              statutoryRules: {
                                ...prev.statutoryRules,
                                napsaMode: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="percent-basic">Percent of Basic Pay</option>
                          <option value="percent-gross">Percent of Gross Pay</option>
                          <option value="fixed">Fixed Amount</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={appSettings.statutoryRules.napsaValue}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              statutoryRules: {
                                ...prev.statutoryRules,
                                napsaValue: Math.max(0, Number(event.target.value) || 0),
                              },
                            }))
                          }
                        />
                      </div>
                    </label>
                    <label>
                      <span>NHIMA Rule</span>
                      <div className="inline-field">
                        <select
                          className="filter-select"
                          value={appSettings.statutoryRules.nhimaMode}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              statutoryRules: {
                                ...prev.statutoryRules,
                                nhimaMode: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="percent-basic">Percent of Basic Pay</option>
                          <option value="percent-gross">Percent of Gross Pay</option>
                          <option value="fixed">Fixed Amount</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={appSettings.statutoryRules.nhimaValue}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              statutoryRules: {
                                ...prev.statutoryRules,
                                nhimaValue: Math.max(0, Number(event.target.value) || 0),
                              },
                            }))
                          }
                        />
                      </div>
                    </label>
                    <label>
                      <span>Tax Rule</span>
                      <div className="inline-field">
                        <select
                          className="filter-select"
                          value={appSettings.statutoryRules.taxMode}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              statutoryRules: {
                                ...prev.statutoryRules,
                                taxMode: event.target.value,
                              },
                            }))
                          }
                        >
                          <option value="percent-basic">Percent of Basic Pay</option>
                          <option value="percent-gross">Percent of Gross Pay</option>
                          <option value="fixed">Fixed Amount</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={appSettings.statutoryRules.taxValue}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              statutoryRules: {
                                ...prev.statutoryRules,
                                taxValue: Math.max(0, Number(event.target.value) || 0),
                              },
                            }))
                          }
                        />
                      </div>
                    </label>
                    <label>
                      <span>Tax Minimum Amount (start threshold)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={appSettings.statutoryRules.taxMinAmount}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            statutoryRules: {
                              ...prev.statutoryRules,
                              taxMinAmount: Math.max(0, Number(event.target.value) || 0),
                            },
                          }))
                        }
                      />
                    </label>
                    <h4 className="settings-subtitle">Loan Rules</h4>
                    <label>
                      <span>Minimum Take-Home %</span>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={appSettings.loanRules.minTakeHomePercent}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            loanRules: {
                              ...prev.loanRules,
                              minTakeHomePercent: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Max Loan Deduction % of Gross</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={appSettings.loanRules.maxLoanDeductionPercentOfGross}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            loanRules: {
                              ...prev.loanRules,
                              maxLoanDeductionPercentOfGross: Math.max(
                                0,
                                Math.min(100, Number(event.target.value) || 0)
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Default Loan Interest % / Month</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={appSettings.loanRules.defaultInterestPercentPerMonth}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            loanRules: {
                              ...prev.loanRules,
                              defaultInterestPercentPerMonth: Math.max(
                                0,
                                Number(event.target.value) || 0
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Overdue Penalty % / Day</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={appSettings.loanRules.overduePenaltyPercentPerDay}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            loanRules: {
                              ...prev.loanRules,
                              overduePenaltyPercentPerDay: Math.max(
                                0,
                                Number(event.target.value) || 0
                              ),
                            },
                          }))
                        }
                      />
                    </label>
                  </>
                ) : null}
                {settingsTab === 'fingerprint' ? (
                  <>
                    <label>
                      <span>Fingerprint Mode</span>
                      <select
                        className="filter-select"
                        value={appSettings.fingerprintIntegration.mode}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            fingerprintIntegration: {
                              ...prev.fingerprintIntegration,
                              mode: event.target.value === 'live' ? 'live' : 'simulation',
                            },
                          }))
                        }
                      >
                        <option value="simulation">Simulation</option>
                        <option value="live">Live Device</option>
                      </select>
                    </label>
                    <label>
                      <span>Fingerprint Gateway URL</span>
                      <input
                        placeholder="https://gateway.local/api/fingerprint"
                        value={appSettings.fingerprintIntegration.gatewayUrl}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            fingerprintIntegration: {
                              ...prev.fingerprintIntegration,
                              gatewayUrl: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Fingerprint API Version</span>
                      <select
                        className="filter-select"
                        value={appSettings.fingerprintIntegration.apiVersion}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            fingerprintIntegration: {
                              ...prev.fingerprintIntegration,
                              apiVersion: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="v1">v1</option>
                        <option value="v2">v2</option>
                      </select>
                    </label>
                    <label>
                      <span>Fingerprint Heartbeat (Seconds)</span>
                      <input
                        type="number"
                        min="5"
                        max="600"
                        value={appSettings.fingerprintIntegration.heartbeatSeconds}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            fingerprintIntegration: {
                              ...prev.fingerprintIntegration,
                              heartbeatSeconds: Math.max(5, Number(event.target.value) || 5),
                            },
                          }))
                        }
                      />
                    </label>
                  </>
                ) : null}
                {settingsTab === 'labels' ? (
                  <>
                    <label>
                      <span>Employee ID Label Preset</span>
                      <div className="inline-field">
                        <select
                          className="filter-select"
                          value={appSettings.identifierCountry}
                          onChange={(event) => handleSelectIdentifierPreset(event.target.value)}
                        >
                          {appSettings.identifierPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="mini-btn danger"
                          onClick={() => handleRemoveIdentifierPreset(appSettings.identifierCountry)}
                          disabled={appSettings.identifierPresets.length === 1}
                        >
                          Remove
                        </button>
                      </div>
                    </label>
                    <label>
                      <span>Add Employee Label Preset</span>
                      <div className="inline-field identifier-preset-inline">
                        <input
                          placeholder="Preset name"
                          value={identifierPresetNameInput}
                          onChange={(event) => setIdentifierPresetNameInput(event.target.value)}
                        />
                        <input
                          placeholder="Pension label"
                          value={identifierPensionLabelInput}
                          onChange={(event) => setIdentifierPensionLabelInput(event.target.value)}
                        />
                        <input
                          placeholder="Tax label"
                          value={identifierTaxLabelInput}
                          onChange={(event) => setIdentifierTaxLabelInput(event.target.value)}
                        />
                        <button type="button" className="primary-btn" onClick={handleAddIdentifierPreset}>
                          Add
                        </button>
                      </div>
                    </label>
                    {identifierLabelError ? <p className="form-error">{identifierLabelError}</p> : null}
                    <label>
                      <span>Employee Pension Field Label</span>
                      <input
                        value={appSettings.pensionFieldLabel}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            pensionFieldLabel: event.target.value,
                            identifierPresets: prev.identifierPresets.map((preset) =>
                              preset.id === prev.identifierCountry
                                ? { ...preset, pensionLabel: event.target.value }
                                : preset
                            ),
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Employee Tax Field Label</span>
                      <input
                        value={appSettings.taxFieldLabel}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            taxFieldLabel: event.target.value,
                            identifierPresets: prev.identifierPresets.map((preset) =>
                              preset.id === prev.identifierCountry
                                ? { ...preset, taxLabel: event.target.value }
                                : preset
                            ),
                          }))
                        }
                      />
                    </label>
                  </>
                ) : null}
                {settingsTab === 'currency' ? (
                  <>
                    <label>
                      <span>Add Currency</span>
                      <div className="inline-field">
                        <input
                          placeholder="e.g. NGN"
                          value={currencyInput}
                          onChange={(event) => setCurrencyInput(event.target.value)}
                        />
                        <button type="button" className="primary-btn" onClick={handleAddCurrency}>
                          Add
                        </button>
                      </div>
                    </label>
                    <div>
                      <span className="field-title">Available Currencies</span>
                      <div className="currency-list">
                        {appSettings.currencies.map((currency) => (
                          <div key={currency} className="currency-chip">
                            <span>{currency}</span>
                            <button
                              type="button"
                              className="mini-btn danger"
                              onClick={() => handleRemoveCurrency(currency)}
                              disabled={appSettings.currencies.length === 1}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                {settingsTab === 'departments' ? (
                  <>
                    <label>
                      <span>{departmentEditingName ? 'Edit Department' : 'Add Department'}</span>
                      <div className="inline-field">
                        <input
                          placeholder="Department name"
                          value={departmentNameInput}
                          onChange={(event) => setDepartmentNameInput(event.target.value)}
                        />
                        <input
                          className="department-code-input"
                          maxLength={2}
                          placeholder="Prefix"
                          value={departmentCodeInput}
                          onChange={(event) => setDepartmentCodeInput(event.target.value.toUpperCase())}
                        />
                        <button type="button" className="primary-btn" onClick={handleAddOrUpdateDepartment}>
                          {departmentEditingName ? 'Update' : 'Add'}
                        </button>
                      </div>
                    </label>
                    {departmentError ? <p className="form-error">{departmentError}</p> : null}
                    <div>
                      <span className="field-title">Departments & Prefixes</span>
                      <div className="department-list">
                        {appSettings.departments.map((department) => (
                          <div key={department.name} className="department-row">
                            <span>{department.name}</span>
                            <span className="department-code">{department.code}</span>
                            <button
                              type="button"
                              className="mini-btn"
                              onClick={() => handleEditDepartment(department)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="mini-btn danger"
                              onClick={() => handleDeleteDepartment(department.name)}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                {settingsTab === 'employment' ? (
                  <>
                    <label>
                      <span>{employmentStageEditingValue ? 'Edit Employment Stage' : 'Add Employment Stage'}</span>
                      <div className="inline-field">
                        <input
                          placeholder="Employment stage"
                          value={employmentStageInput}
                          onChange={(event) => setEmploymentStageInput(event.target.value)}
                        />
                        <button type="button" className="primary-btn" onClick={handleAddOrUpdateEmploymentStage}>
                          {employmentStageEditingValue ? 'Update' : 'Add'}
                        </button>
                      </div>
                    </label>
                    {employmentStageError ? <p className="form-error">{employmentStageError}</p> : null}
                    <div>
                      <span className="field-title">Employment Stages</span>
                      <div className="department-list">
                        {appSettings.employmentStages.map((stage) => (
                          <div key={stage} className="employment-stage-row">
                            <span>{stage}</span>
                            <button
                              type="button"
                              className="mini-btn"
                              onClick={() => handleEditEmploymentStage(stage)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="mini-btn danger"
                              onClick={() => handleDeleteEmploymentStage(stage)}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                {settingsTab === 'id-card' ? (
                  <>
                    <label>
                      <span>ID Card Company Name</span>
                      <input
                        value={appSettings.idCardDesign.companyName}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyName: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Company Address</span>
                      <textarea
                        rows="3"
                        value={appSettings.idCardDesign.companyAddress}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyAddress: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Company Phone</span>
                      <input
                        value={appSettings.idCardDesign.companyPhone}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyPhone: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Company Email</span>
                      <input
                        type="email"
                        value={appSettings.idCardDesign.companyEmail}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyEmail: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Company Website</span>
                      <input
                        value={appSettings.idCardDesign.companyWebsite}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              companyWebsite: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>ID Card Logo</span>
                      <input type="file" accept="image/*" onChange={handleIdCardLogoUpload} />
                    </label>
                    {appSettings.idCardDesign.logoUrl ? (
                      <div className="id-logo-preview-wrap">
                        <img src={appSettings.idCardDesign.logoUrl} alt="Company logo" className="id-logo-preview" />
                        <button
                          type="button"
                          className="mini-btn danger"
                          onClick={() =>
                            setAppSettings((prev) => ({
                              ...prev,
                              idCardDesign: {
                                ...prev.idCardDesign,
                                logoUrl: '',
                              },
                            }))
                          }
                        >
                          Remove logo
                        </button>
                      </div>
                    ) : null}
                    <label>
                      <span>ID Card Primary Color</span>
                      <input
                        type="color"
                        value={appSettings.idCardDesign.primaryColor}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              primaryColor: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>ID Card Secondary Color</span>
                      <input
                        type="color"
                        value={appSettings.idCardDesign.secondaryColor}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              secondaryColor: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>ID Card Orientation</span>
                      <select
                        className="filter-select"
                        value={appSettings.idCardDesign.orientation}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              orientation: event.target.value === 'portrait' ? 'portrait' : 'landscape',
                            },
                          }))
                        }
                      >
                        <option value="landscape">Landscape</option>
                        <option value="portrait">Portrait</option>
                      </select>
                    </label>
                    <label>
                      <span>ID Card Border Radius ({appSettings.idCardDesign.borderRadius}px)</span>
                      <input
                        type="range"
                        min="0"
                        max="40"
                        value={appSettings.idCardDesign.borderRadius}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            idCardDesign: {
                              ...prev.idCardDesign,
                              borderRadius: Number(event.target.value),
                            },
                          }))
                        }
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </section>
          ) : isManualPage ? (
            <section className="panel table-panel">
              <div className="panel-title-row">
                <div>
                  <h2>Manual</h2>
                  <p>Detailed system usage guide for admin and mobile workflows.</p>
                </div>
              </div>
              <ManualPage />
            </section>
          ) : (
            <section className="panel table-panel">
              <div className="panel-title-row">
                <div>
                  <h2>{activeModuleConfig.title}</h2>
                  <p>
                    {showMainModuleTable
                      ? `${activeModuleConfig.entityLabel} registry and operations table • ${filteredRows.length} visible row(s)`
                      : `${activeModuleConfig.entityLabel} registry and operations table`}
                  </p>
                </div>
                {activeModuleId !== 'attendance-time' && activeModuleId !== 'user-management' ? (
                  <div className="panel-title-actions">
                    {moduleAdapter && moduleAdapter.active && typeof moduleAdapter.renderHeader === 'function' ? (
                      moduleAdapter.renderHeader({ startCreate })
                    ) : (
                      <button type="button" className="primary-btn" onClick={startCreate}>
                        + Add {activeModuleConfig.entityLabel}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              {activeModuleId === 'attendance-time' ? (
                <AttendanceTimePage
                  appSettings={appSettings}
                  attendanceViewTab={attendanceViewTab}
                  setAttendanceViewTab={setAttendanceViewTab}
                  attendanceSearchText={attendanceSearchText}
                  setAttendanceSearchText={setAttendanceSearchText}
                  attendanceSearchMatches={attendanceSearchMatches}
                  employeeBaseRows={employeeBaseRows}
                  attendanceClockDraft={attendanceClockDraft}
                  setAttendanceClockDraft={setAttendanceClockDraft}
                  selectedAttendanceEmployee={selectedAttendanceEmployee}
                  handleClockIn={handleClockIn}
                  handleClockOut={handleClockOut}
                  attendanceTodayRows={attendanceTodayRows}
                  attendanceLateCount={attendanceLateCount}
                  downloadCsv={downloadCsv}
                  downloadPdf={downloadPdf}
                  todayIsoDate={todayIsoDate}
                  getTodayIsoDate={getTodayIsoDate}
                  attendanceAuditDate={attendanceAuditDate}
                  setAttendanceAuditDate={setAttendanceAuditDate}
                  attendanceAuditFilter={attendanceAuditFilter}
                  setAttendanceAuditFilter={setAttendanceAuditFilter}
                  attendanceAuditSearchText={attendanceAuditSearchText}
                  setAttendanceAuditSearchText={setAttendanceAuditSearchText}
                  attendanceComplianceFilteredRows={attendanceComplianceFilteredRows}
                  setAttendanceDetailModal={setAttendanceDetailModal}
                  selectedComplianceKey={selectedComplianceKey}
                  setSelectedComplianceKey={setSelectedComplianceKey}
                  attendancePenaltyStatusFilter={attendancePenaltyStatusFilter}
                  setAttendancePenaltyStatusFilter={setAttendancePenaltyStatusFilter}
                  attendancePenaltyFilteredRows={attendancePenaltyFilteredRows}
                  selectedPenaltyKey={selectedPenaltyKey}
                  setSelectedPenaltyKey={setSelectedPenaltyKey}
                  selectedPenaltyRow={selectedPenaltyRow}
                  penaltyActionDraft={penaltyActionDraft}
                  setPenaltyActionDraft={setPenaltyActionDraft}
                  handlePenaltyActionSave={handlePenaltyActionSave}
                  toNumberValue={toNumberValue}
                  attendancePerformancePeriod={attendancePerformancePeriod}
                  setAttendancePerformancePeriod={setAttendancePerformancePeriod}
                  attendancePerformanceStartDate={attendancePerformanceStartDate}
                  setAttendancePerformanceStartDate={setAttendancePerformanceStartDate}
                  attendancePerformanceEndDate={attendancePerformanceEndDate}
                  setAttendancePerformanceEndDate={setAttendancePerformanceEndDate}
                  attendancePerformanceRankMetric={attendancePerformanceRankMetric}
                  setAttendancePerformanceRankMetric={setAttendancePerformanceRankMetric}
                  attendancePerformanceDepartmentFilter={attendancePerformanceDepartmentFilter}
                  setAttendancePerformanceDepartmentFilter={setAttendancePerformanceDepartmentFilter}
                  attendancePerformanceDepartmentOptions={attendancePerformanceDepartmentOptions}
                  attendancePerformanceSearchText={attendancePerformanceSearchText}
                  setAttendancePerformanceSearchText={setAttendancePerformanceSearchText}
                  attendancePerformanceRange={attendancePerformanceRange}
                  attendancePerformanceRows={attendancePerformanceRows}
                  selectedPerformanceEmployeeId={selectedPerformanceEmployeeId}
                  setSelectedPerformanceEmployeeId={setSelectedPerformanceEmployeeId}
                  getCurrentClockValue={getCurrentClockValue}
                  currentUser={currentUser}
                  handleAssignEmployeeShift={handleAssignEmployeeShift}
                />
              ) : null}
              {activeModuleId === 'monitoring-tracking' ? <AdminTrackingPage /> : null}
              {activeModuleId === 'user-management' ? <UserManagementPage authToken={authToken} currentUser={currentUser} /> : null}
              {activeModuleId === 'tenant-management' ? <TenantManagementPage authToken={authToken} /> : null}
              {activeModuleId === 'leave-management' ? (
                <LeaveManagementPage
                  appSettings={appSettings}
                  selectedRowId={selectedRowId}
                  leaveDepartmentFilter={leaveDepartmentFilter}
                  setLeaveDepartmentFilter={setLeaveDepartmentFilter}
                  leaveDepartmentOptions={leaveDepartmentOptions}
                  leaveStatusFilter={leaveStatusFilter}
                  setLeaveStatusFilter={setLeaveStatusFilter}
                  leaveStatusOptions={leaveStatusOptions}
                  leaveSortBy={leaveSortBy}
                  setLeaveSortBy={setLeaveSortBy}
                  leaveSearchText={leaveSearchText}
                  setLeaveSearchText={setLeaveSearchText}
                  leaveRequestFilteredRows={leaveRequestFilteredRows}
                  getLeaveViewStatus={getLeaveViewStatus}
                  leaveActionMessage={leaveActionMessage}
                  leaveViewTab={leaveViewTab}
                  leaveRequestPageTab={leaveRequestPageTab}
                  setLeaveRequestPageTab={setLeaveRequestPageTab}
                  openDetails={openDetails}
                  getApprovalBadgeClass={getApprovalBadgeClass}
                  leaveBalanceFilteredRows={leaveBalanceFilteredRows}
                  leaveApprovalDrafts={leaveApprovalDrafts}
                  setLeaveApprovalDrafts={setLeaveApprovalDrafts}
                />
              ) : null}
              {activeModuleId === 'loan-records' ? (
                <LoanManagementPage
                  appSettings={appSettings}
                  currentUser={currentUser}
                  startCreate={startCreate}
                  selectedRowId={selectedRowId}
                  loanSearchText={loanSearchText}
                  setLoanSearchText={setLoanSearchText}
                  loanStatusFilter={loanStatusFilter}
                  setLoanStatusFilter={setLoanStatusFilter}
                  loanStatusOptions={loanStatusOptions}
                  loanRequestFilteredRows={loanRequestFilteredRows}
                  getLoanViewStatus={getLoanViewStatus}
                  loanActionMessage={loanActionMessage}
                  loanViewTab={loanViewTab}
                  openDetails={openDetails}
                  getApprovalBadgeClass={getApprovalBadgeClass}
                />
              ) : null}
              {activeModuleId === 'fingerprint' ? (
                <FingerprintPage
                  fingerprintConnectionState={fingerprintConnectionState}
                  fingerprintDraft={fingerprintDraft}
                  setFingerprintDraft={setFingerprintDraft}
                  employeeBaseRows={employeeBaseRows}
                  handleEnrollFingerprint={handleEnrollFingerprint}
                  handleQueueFingerprintSync={handleQueueFingerprintSync}
                  fingerprintRows={fingerprintRows}
                  appSettings={appSettings}
                  selectedFingerprintEmployee={selectedFingerprintEmployee}
                />
              ) : null}

              {showMainModuleTable ? (
                <div className="toolbar">
                <input
                  className="search-input"
                  placeholder="Search records..."
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                />
                <select
                  className="filter-select"
                  value={filterValue}
                  onChange={(event) => setFilterValue(event.target.value)}
                >
                  {filterOptions.map((option) => (
                    <option key={option} value={option}>
                      {activeModuleConfig.filterLabel}: {option}
                    </option>
                  ))}
                </select>
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={statusFilterValue}
                    onChange={(event) => setStatusFilterValue(event.target.value)}
                  >
                    {employeeStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        Status: {option}
                      </option>
                    ))}
                  </select>
                ) : null}
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={employmentStageFilterValue}
                    onChange={(event) => setEmploymentStageFilterValue(event.target.value)}
                  >
                    {employeeStageOptions.map((option) => (
                      <option key={option} value={option}>
                        Employment Stage: {option}
                      </option>
                    ))}
                  </select>
                ) : null}
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={expiryFilterValue}
                    onChange={(event) => setExpiryFilterValue(event.target.value)}
                  >
                    <option value="All">Expiry: All</option>
                    <option value="within30">Expiry: 0-30 days</option>
                    <option value="after30">Expiry: Above 30 days</option>
                    <option value="expired">Expiry: Already expired</option>
                    <option value="no-end-date">Expiry: No end date</option>
                  </select>
                ) : null}
                {isEmployeeModule ? (
                  <select
                    className="filter-select"
                    value={sortByValue}
                    onChange={(event) => setSortByValue(event.target.value)}
                  >
                    <option value="default">Sort: Default</option>
                    <option value="expiry-priority">Sort: Expiry priority</option>
                    <option value="closest-expiry">Sort: Closest expiry date</option>
                  </select>
                ) : null}
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => {
                    setSearchText('');
                    setFilterValue('All');
                    setStatusFilterValue('All');
                    setEmploymentStageFilterValue('All');
                    setExpiryFilterValue('All');
                    setSortByValue('default');
                  }}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() =>
                    downloadCsv(
                      `${activeModuleId}-${getTodayIsoDate()}.csv`,
                      tableColumns.map((column) => ({ key: column.key, label: column.label })),
                      filteredRows
                    )
                  }
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() =>
                    downloadPdf(
                      `${activeModuleConfig.title} - ${getTodayIsoDate()}`,
                      tableColumns.map((column) => ({ key: column.key, label: column.label })),
                      filteredRows
                    )
                  }
                >
                  Export PDF
                </button>
                </div>
              ) : null}

              {showMainModuleTable ? (
                <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {tableColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length > 0 ? (
                      filteredRows.map((row) => (
                        <tr
                          key={row.id}
                          className={selectedRowId === row.id ? 'selected-row' : ''}
                          onClick={() => openDetails(row.id)}
                        >
                          {tableColumns.map((column) => (
                            <td key={column.key}>
                              {column.key === 'contractAlert' ? (
                                <span className={`contract-alert ${getContractCountdown(row.contractEndDate)?.type || ''}`}>
                                  {getContractCountdown(row.contractEndDate)?.shortLabel || '—'}
                                </span>
                              ) : (
                                row[column.key]
                              )}
                            </td>
                          ))}
                          <td>
                            <div className="row-actions">
                              {activeModuleId === 'attendance-time' ? (
                                <button
                                  type="button"
                                  className="mini-btn"
                                  onClick={async (event) => {
                                    event.stopPropagation();
                                    await handleClockOut({
                                      employeeId: row.employeeId,
                                      date: row.date,
                                    });
                                  }}
                                  disabled={
                                    String(row.date || '') !== getTodayIsoDate() ||
                                    normalizeAttendanceClockings(row).reduce(
                                      (acc, clocking) =>
                                        clocking.mode === 'clock-in' ? acc + 1 : Math.max(0, acc - 1),
                                      0
                                    ) <= 0
                                  }
                                >
                                  Clock Out
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="mini-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openDetails(row.id);
                                }}
                              >
                                View
                              </button>
                              <button
                                type="button"
                                className="mini-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startEdit(row);
                                }}
                                disabled={activeModuleId === 'attendance-time'}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="mini-btn danger"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDelete(row);
                                }}
                                disabled={activeModuleId === 'attendance-time'}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={tableColumns.length + 1}>
                          <p className="empty-state">No matching records found.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                </div>
              ) : null}
            </section>
          )}
        </main>
      </div>
      {!isSettingsPage && isInstallHelpOpen ? (
        <div className="modal-backdrop" onClick={() => setIsInstallHelpOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>Install PTHR</h3>
              <button type="button" className="neutral-btn" onClick={() => setIsInstallHelpOpen(false)}>
                Close
              </button>
            </div>
            <div className="attendance-ops-form">
              <p>Use these steps when your browser does not show the install prompt automatically.</p>
              <ol style={{ margin: 0, paddingLeft: 18, color: '#334155' }}>
                {installHelpSteps.map((step) => (
                  <li key={step} style={{ marginBottom: 8 }}>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : null}
      <SubscriptionExtendModal
        open={subscriptionExtendModal.open}
        tenantId={subscriptionExtendModal.tenantId}
        initialTenant={subscriptionExtendModal.tenant}
        onClose={closeSubscriptionExtendModal}
        onSubscriptionUpdated={handleSubscriptionUpdated}
      />
      {!isSettingsPage && isModalOpen ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {isFormModal
                  ? editRowId === 'new'
                    ? `Add ${activeModuleConfig.entityLabel}`
                    : `Edit ${activeModuleConfig.entityLabel}`
                  : `${activeModuleConfig.entityLabel} Details`}
              </h3>
              <button type="button" className="neutral-btn" onClick={closeModal}>
                Close
              </button>
            </div>
            {isFormModal ? (
              activeModuleId === 'leave-management' ? (
                <div className="form-grid">
                  <label>
                    <span>Employee Search *</span>
                    <input
                      value={formValues.leaveEmployeeSearch || ''}
                      placeholder="Search by name or ID"
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          leaveEmployeeSearch: event.target.value,
                          employeeId: '',
                          employee: '',
                          department: '',
                        }))
                      }
                    />
                  </label>
                  {selectedLeaveFormBalance && currentUser && currentUser.role === 'employee' ? (
                    <>
                      <label>
                        <span>Department</span>
                        <input value={selectedLeaveFormBalance.department} readOnly />
                      </label>
                      <label>
                        <span>Opening Leave Days</span>
                        <input value={selectedLeaveFormBalance.openingBalance.toFixed(1)} readOnly />
                      </label>
                      <label>
                        <span>Approved Days</span>
                        <input value={selectedLeaveFormBalance.approvedDays.toFixed(1)} readOnly />
                      </label>
                      <label>
                        <span>Pending Days</span>
                        <input value={selectedLeaveFormBalance.pendingDays.toFixed(1)} readOnly />
                      </label>
                      <label>
                        <span>Remaining Leave Days</span>
                        <input value={selectedLeaveFormBalance.availableBalance.toFixed(1)} readOnly />
                      </label>
                    </>
                  ) : null}
                  {leaveFormEmployeeMatches.length > 0 ? (
                    <div className="row-actions">
                      {leaveFormEmployeeMatches.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          className="mini-btn"
                          onClick={() =>
                            setFormValues((prev) => ({
                              ...prev,
                              leaveEmployeeSearch: `${employee.fullName} (${employee.id})`,
                              employee: employee.fullName,
                              employeeId: employee.id,
                              department: employee.department || 'Unassigned',
                            }))
                          }
                        >
                          {employee.fullName} ({employee.id})
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label>
                    <span>Leave Type *</span>
                    <select
                      className="filter-select"
                      value={formValues.type || 'Annual'}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          type: event.target.value,
                        }))
                      }
                    >
                      {['Annual', 'Sick', 'Maternity', 'Paternity', 'Emergency', 'Unpaid'].map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Start Date *</span>
                    <input
                      type="date"
                      value={formValues.startDate || ''}
                      min={todayIsoDate}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          startDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>End Date *</span>
                    <input
                      type="date"
                      value={formValues.endDate || ''}
                      min={formValues.startDate || todayIsoDate}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          endDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>Days Requested</span>
                    <input value={leaveFormAutoDaysRequested > 0 ? String(leaveFormAutoDaysRequested) : ''} readOnly />
                  </label>
                  <label>
                    <span>Remaining Balance</span>
                    <input
                      value={
                        selectedLeaveFormBalance ? `${selectedLeaveFormBalance.availableBalance.toFixed(1)} day(s)` : ''
                      }
                      readOnly
                    />
                  </label>
                  <label>
                    <span>Reason *</span>
                    <textarea
                      className="form-textarea"
                      value={formValues.reason || ''}
                      onChange={(event) =>
                        setFormValues((prev) => ({
                          ...prev,
                          reason: event.target.value,
                        }))
                      }
                    />
                  </label>
                  {formError ? <p className="form-error">{formError}</p> : null}
                  <div className="form-actions">
                    <button type="button" className="primary-btn" onClick={handleSave} disabled={recordSaving}>
                      {recordSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" className="neutral-btn" onClick={closeModal}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {moduleAdapter && moduleAdapter.active && typeof moduleAdapter.renderFormBody === 'function' ? (
                    moduleAdapter.renderFormBody({ renderFormFieldControl })
                  ) : isEmployeeModule ? (
                    <div className="form-section-grid">
                      {employeeFormSections
                        .map((section) => ({
                          id: section.id,
                          title: section.title,
                          fields: section.fields
                            .map((key) => employeeFormFieldMap[key])
                            .filter(Boolean),
                        }))
                        .filter((section) => section.fields.length > 0)
                        .map((section) => (
                          <div key={section.id} className="form-section">
                            <p className="form-section-title">{section.title}</p>
                            <div className="form-grid">
                              {section.fields.map((field) => renderFormFieldControl(field))}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <>
                      {activeModuleId === 'loan-records' ? (
                        <LoanRecordsPage
                          formValues={formValues}
                          setFormValues={setFormValues}
                          visibleFormFields={visibleFormFields}
                          loanInstallmentPreview={loanInstallmentPreview}
                          renderFormFieldControl={renderFormFieldControl}
                          loanFormEmployeeMatches={loanFormEmployeeMatches}
                          selectedLoanFormEmployee={selectedLoanFormEmployee}
                        />
                      ) : (
                        <div className="form-section-grid">
                          {(genericFormSections.length > 0
                            ? genericFormSections
                            : [
                                {
                                  id: 'generic-details',
                                  title: activeModuleConfig
                                    ? `${activeModuleConfig.entityLabel} Details`
                                    : 'Details',
                                  fields: visibleFormFields.map((field) => field.key),
                                },
                              ]
                          )
                            .map((section) => ({
                              id: section.id,
                              title: section.title,
                              fields: section.fields
                                .map((key) => visibleFormFields.find((field) => field.key === key))
                                .filter(Boolean),
                            }))
                            .filter((section) => section.fields.length > 0)
                            .map((section) => (
                              <div key={section.id} className="form-section">
                                <p className="form-section-title">{section.title}</p>
                                <div className="form-grid">
                                  {section.fields.map((field) => renderFormFieldControl(field))}
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                  {formError ? <p className="form-error">{formError}</p> : null}
                  <div className="form-actions">
                    <button type="button" className="primary-btn" onClick={handleSave} disabled={recordSaving}>
                      {recordSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" className="neutral-btn" onClick={closeModal}>
                      Cancel
                    </button>
                  </div>
                </>
              )
            ) : (
              <div className="details-card">
                {modalRow ? (
                  <>
                    <div className="details-hero">
                      <div>
                        <p className="details-kicker">{activeModuleConfig.entityLabel} Profile</p>
                        <h4>{modalRow.fullName || modalRow.name || modalRow.id}</h4>
                        <p className="details-subtitle">
                          {modalRow.department || 'Department'} • {modalRow.position || 'Role not set'}
                        </p>
                      </div>
                      <div className="details-badges">
                        {modalRow.status ? <span className="status-badge">{modalRow.status}</span> : null}
                        {modalRow.employmentState ? (
                          <span className="status-badge secondary">{modalRow.employmentState}</span>
                        ) : null}
                        {modalContractCountdown ? (
                          <span className={`status-badge contract ${modalContractCountdown.type}`}>
                            {modalContractCountdown.detailLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {activeModuleId === 'employee-management' ? (
                      <div className="details-media-grid">
                        {employeeImageFields.map((key) => {
                          const imageFiles = Array.isArray(modalRow[`${key}Files`]) ? modalRow[`${key}Files`] : [];
                          const imageFile = imageFiles.find((file) => file.isImage);
                          const imageSource = imageFile?.url || modalRow[`${key}Preview`] || '';
                          return (
                            <div className="media-card" key={key}>
                              <span className="media-label">
                                {activeModuleConfig.formFields.find((field) => field.key === key)?.label || key}
                              </span>
                              {imageSource ? (
                                <img src={imageSource} alt={key} className="media-image" />
                              ) : (
                                <strong>{modalRow[key] || 'No file uploaded'}</strong>
                              )}
                              {imageFile?.url ? (
                                <div className="media-actions">
                                  <a href={imageFile.url} target="_blank" rel="noreferrer">
                                    Preview
                                  </a>
                                  <a href={imageFile.url} download={imageFile.name}>
                                    Download
                                  </a>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {moduleAdapter && moduleAdapter.active && typeof moduleAdapter.renderDetailsExtras === 'function'
                      ? moduleAdapter.renderDetailsExtras({ modalRow })
                      : null}
                    {activeModuleId === 'leave-management' ? (
                      <LeaveApprovalPanel
                        selectedLeaveDetailRow={selectedLeaveDetailRow}
                        leaveViewTab={leaveViewTab}
                        leaveApprovalDrafts={leaveApprovalDrafts}
                        setLeaveApprovalDrafts={setLeaveApprovalDrafts}
                        leaveApprovalSavingId={leaveApprovalSavingId}
                        appSettings={appSettings}
                        getApprovalBadgeClass={getApprovalBadgeClass}
                        handleDepartmentLeaveDecision={handleDepartmentLeaveDecision}
                        handleHrLeaveDecision={handleHrLeaveDecision}
                        handleManagerLeaveDecision={handleManagerLeaveDecision}
                      />
                    ) : null}
                    {activeModuleId === 'loan-records' ? (
                      <LoanApprovalPanel
                        selectedLoanDetailRow={selectedLoanDetailRow}
                        loanViewTab={loanViewTab}
                        loanApprovalDrafts={loanApprovalDrafts}
                        setLoanApprovalDrafts={setLoanApprovalDrafts}
                        loanApprovalSavingId={loanApprovalSavingId}
                        appSettings={appSettings}
                        getApprovalBadgeClass={getApprovalBadgeClass}
                        handleDepartmentLoanDecision={handleDepartmentLoanDecision}
                        handleHrLoanDecision={handleHrLoanDecision}
                        handleManagerLoanDecision={handleManagerLoanDecision}
                      />
                    ) : null}

                    <div className="details-grid-table">
                      <div className="detail-cell">
                        <span>{activeModuleConfig.entityLabel} ID</span>
                        <strong>{modalRow.id}</strong>
                      </div>
                      {isEmployeeModule
                        ? employeeFormSections
                            .map((section) => ({
                              id: section.id,
                              title: section.title,
                              fields: section.fields
                                .map((key) => employeeFormFieldMap[key])
                                .filter(Boolean),
                            }))
                            .filter((section) => section.fields.length > 0)
                            .map((section) => (
                              <Fragment key={section.id}>
                                <div className="detail-section-header">
                                  <span>{section.title}</span>
                                </div>
                                {section.fields.map((field) => renderDetailFieldCell(field))}
                              </Fragment>
                            ))
                        : activeModuleConfig.formFields
                            .filter((field) => !employeeImageFields.includes(field.key))
                            .map((field) => renderDetailFieldCell(field))}
                    </div>
                    {activeModuleId === 'employee-management' ? (
                      <div className="employee-ops-card">
                        <div className="employee-ops-header">
                          <h5>Employee Records</h5>
                          <span>
                            {employeeDetailRecordTab === 'loan'
                              ? `${employeeLoanRecords.length} loans`
                              : `${employeeLeaveRequests.length} records`}
                          </span>
                        </div>
                        <div className="employee-record-tabs">
                          <button
                            type="button"
                            className={`employee-record-tab ${employeeDetailRecordTab === 'loan' ? 'active' : ''}`}
                            onClick={() => setEmployeeDetailRecordTab('loan')}
                          >
                            Loan Records
                          </button>
                          <button
                            type="button"
                            className={`employee-record-tab ${employeeDetailRecordTab === 'leave' ? 'active' : ''}`}
                            onClick={() => setEmployeeDetailRecordTab('leave')}
                          >
                            Leave Records
                          </button>
                        </div>
                        {employeeDetailRecordTab === 'loan' ? (
                          <div className="employee-ops-list">
                            {employeeLoanRecords.length > 0 ? (
                              employeeLoanRecords.map((loanRow) => (
                                <div className="employee-ops-row" key={loanRow.id}>
                                  <div>
                                    <p>{loanRow.type || 'Loan Record'}</p>
                                    <span>
                                      {loanRow.issuedOn || '—'} • {loanRow.amount || '—'}
                                    </span>
                                  </div>
                                  <div className="employee-ops-actions">
                                    <strong>{loanRow.status || 'Active'}</strong>
                                    <span>{loanRow.balance ? `Balance: ${loanRow.balance}` : 'Balance: —'}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="employee-ops-empty">No loan record exists for this employee yet.</p>
                            )}
                          </div>
                        ) : (
                          <div className="employee-ops-list">
                            {employeeLeaveRequests.length > 0 ? (
                              employeeLeaveRequests.map((leaveRow) => (
                                <div className="employee-ops-row" key={leaveRow.id}>
                                  <div>
                                    <p>{leaveRow.type || 'Leave Record'}</p>
                                    <span>
                                      {leaveRow.startDate || '—'} → {leaveRow.endDate || '—'}
                                    </span>
                                  </div>
                                  <div className="employee-ops-actions">
                                    <strong>{leaveRow.status || 'Pending'}</strong>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="employee-ops-empty">No leave record exists for this employee yet.</p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}
                    {activeModuleId === 'employee-management' ? (
                      <div className={`id-preview-grid ${appSettings.idCardDesign.orientation}`}>
                        <div
                          className={`id-preview-card ${appSettings.idCardDesign.orientation}`}
                          style={{
                            '--id-radius': `${appSettings.idCardDesign.borderRadius}px`,
                            '--id-primary': appSettings.idCardDesign.primaryColor,
                            '--id-secondary': appSettings.idCardDesign.secondaryColor,
                          }}
                        >
                          <div className="id-preview-head">
                            <div className="id-preview-head-text">
                              <strong className="id-preview-title">EMPLOYEE ID CARD</strong>
                              <span>{appSettings.idCardDesign.companyName || appSettings.appName || 'PTHR'}</span>
                            </div>
                            {appSettings.idCardDesign.logoUrl ? (
                              <img src={appSettings.idCardDesign.logoUrl} alt="logo" className="id-preview-logo" />
                            ) : null}
                          </div>
                          <div className="id-preview-subhead">{modalRow.department || 'Department'}</div>
                          <div className={`id-preview-body ${appSettings.idCardDesign.orientation}`}>
                            <div className="id-preview-photo">
                              {modalPassportPhotoUrl ? (
                                <img src={modalPassportPhotoUrl} alt="passport" className="id-preview-photo-img" />
                              ) : (
                                <span>PHOTO</span>
                              )}
                            </div>
                            <div className="id-preview-info">
                              <p>
                                <span>Name</span>
                                <strong>{modalRow.fullName || '—'}</strong>
                              </p>
                              <p>
                                <span>Position</span>
                                <strong>{modalRow.position || '—'}</strong>
                              </p>
                              <p>
                                <span>Employee Number</span>
                                <strong>{modalRow.id || '—'}</strong>
                              </p>
                              <p>
                                <span>Date of Expiry</span>
                                <strong>{formatCardDate(modalRow.contractEndDate)}</strong>
                              </p>
                            </div>
                          </div>
                          <div className="id-preview-footer">
                            {modalBarcodeDataUrl ? (
                              <img src={modalBarcodeDataUrl} alt="Employee barcode" className="id-preview-barcode-img" />
                            ) : (
                              <div className="id-preview-barcode" />
                            )}
                          </div>
                        </div>
                        <div
                          className={`id-preview-card ${appSettings.idCardDesign.orientation}`}
                          style={{
                            '--id-radius': `${appSettings.idCardDesign.borderRadius}px`,
                            '--id-primary': appSettings.idCardDesign.primaryColor,
                            '--id-secondary': appSettings.idCardDesign.secondaryColor,
                          }}
                        >
                          <div className="id-preview-head">
                            <div className="id-preview-head-text">
                              <strong className="id-preview-title">OFFICIAL BACK</strong>
                              <span>{appSettings.idCardDesign.companyName || appSettings.appName || 'PTHR'}</span>
                            </div>
                            {appSettings.idCardDesign.logoUrl ? (
                              <img src={appSettings.idCardDesign.logoUrl} alt="logo" className="id-preview-logo" />
                            ) : null}
                          </div>
                          <div className={`id-preview-back-body ${appSettings.idCardDesign.orientation}`}>
                            <p>
                              <span>ID</span>
                              <strong>{modalRow.id || '—'}</strong>
                            </p>
                            <p>
                              <span>Name</span>
                              <strong>{modalRow.fullName || '—'}</strong>
                            </p>
                            <p>
                              <span>Department</span>
                              <strong>{modalRow.department || '—'}</strong>
                            </p>
                            <p>
                              <span>Emergency Contact</span>
                              <strong>
                                {modalRow.emergencyContact1Name || 'N/A'} • {modalRow.emergencyContact1Phone || 'N/A'}
                              </strong>
                            </p>
                            <p>
                              <span>Expiry</span>
                              <strong>{formatCardDate(modalRow.contractEndDate)}</strong>
                            </p>
                            {appSettings.idCardDesign.logoUrl ? (
                              <div className="id-preview-back-logo-wrap">
                                <img src={appSettings.idCardDesign.logoUrl} alt="logo" className="id-preview-back-logo" />
                              </div>
                            ) : null}
                            <div className="id-preview-back-footer">
                              <div className="id-preview-qr" />
                              <div className="id-preview-signatures">
                                <span>Employee Signature</span>
                                <span>HR Manager</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="form-actions">
                      <button type="button" className="primary-btn" onClick={() => startEdit(modalRow)}>
                        Edit
                      </button>
                      {activeModuleId === 'employee-management' ? (
                        <>
                          <button
                            type="button"
                            className="neutral-btn id-download-btn"
                            onClick={() => handleDownloadEmployeeId(modalRow, 'front')}
                          >
                            Download Front ID
                          </button>
                          <button
                            type="button"
                            className="neutral-btn id-download-btn"
                            onClick={() => handleDownloadEmployeeId(modalRow, 'back')}
                          >
                            Download Back ID
                          </button>
                          <button
                            type="button"
                            className="neutral-btn id-download-btn"
                            onClick={() => handleDownloadBothEmployeeIdSides(modalRow)}
                          >
                            Download Both Sides
                          </button>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="empty-state">No row selected yet. Pick any row from the table.</p>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {!isSettingsPage && attendanceDetailModal.type ? (
        <div className="modal-backdrop" onClick={() => setAttendanceDetailModal({ type: '', key: '' })}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {attendanceDetailModal.type === 'performance'
                  ? 'Performance Detail'
                  : attendanceDetailModal.type === 'compliance'
                    ? 'Daily Compliance Detail'
                    : 'Penalty Clearance Detail'}
              </h3>
              <button
                type="button"
                className="neutral-btn"
                onClick={() => setAttendanceDetailModal({ type: '', key: '' })}
              >
                Close
              </button>
            </div>
            {attendanceDetailModal.type === 'compliance' ? (
              selectedComplianceRow ? (
                <div className="attendance-audit-wrap">
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Employee ID</th>
                          <th>Date</th>
                          <th>Check In</th>
                          <th>Check Out</th>
                          <th>Status</th>
                          <th>Late Min</th>
                          <th>Deduction</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{selectedComplianceRow.employee}</td>
                          <td>{selectedComplianceRow.employeeId}</td>
                          <td>{selectedComplianceRow.date}</td>
                          <td>{selectedComplianceRow.checkIn || '—'}</td>
                          <td>{selectedComplianceRow.checkOut || '—'}</td>
                          <td>{selectedComplianceRow.dailyStatus}</td>
                          <td>{selectedComplianceAttendanceRow?.lateMinutes || '0'}</td>
                          <td>{selectedComplianceAttendanceRow?.deductionAmount || '0.00'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Mode</th>
                          <th>Time</th>
                          <th>Photo</th>
                          <th>Latitude</th>
                          <th>Longitude</th>
                          <th>Accuracy</th>
                          <th>Source</th>
                          <th>Map</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedComplianceClockings.length > 0 ? (
                          selectedComplianceClockings.map((clocking, index) => (
                            <tr key={`${selectedComplianceRow.employeeId}-${selectedComplianceRow.date}-${clocking.id || index}`}>
                              <td>{index + 1}</td>
                              <td>{clocking.mode === 'clock-in' ? 'Clock In' : 'Clock Out'}</td>
                              <td>{clocking.time || '—'}</td>
                              <td>
                                {clocking.photoDataUrl ? (
                                  <button
                                    type="button"
                                    className="neutral-btn"
                                    style={{ padding: 0, border: 'none', background: 'transparent' }}
                                    onClick={() =>
                                      {
                                        setAttendancePhotoPreview({
                                          open: true,
                                          src: clocking.photoDataUrl,
                                          title: `${selectedComplianceRow.employee} (${selectedComplianceRow.employeeId}) • ${
                                            clocking.mode === 'clock-in' ? 'Clock In' : 'Clock Out'
                                          } ${clocking.time || ''}`,
                                        });
                                        setAttendancePhotoPreviewZoom(1);
                                      }
                                    }
                                  >
                                    <img
                                      src={clocking.photoDataUrl}
                                      alt={`${clocking.mode === 'clock-in' ? 'Clock-in' : 'Clock-out'} capture ${clocking.time || ''}`}
                                      style={{
                                        width: 56,
                                        height: 56,
                                        objectFit: 'cover',
                                        borderRadius: 10,
                                        border: '1px solid rgba(15, 23, 42, 0.12)',
                                      }}
                                    />
                                  </button>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td>{typeof clocking.lat === 'number' ? clocking.lat.toFixed(6) : '—'}</td>
                              <td>{typeof clocking.lng === 'number' ? clocking.lng.toFixed(6) : '—'}</td>
                              <td>{typeof clocking.accuracy === 'number' ? `${Math.round(clocking.accuracy)} m` : '—'}</td>
                              <td>{clocking.source || 'System'}</td>
                              <td>
                                {typeof clocking.lat === 'number' && typeof clocking.lng === 'number' ? (
                                  <a href={`https://www.google.com/maps?q=${clocking.lat},${clocking.lng}`} target="_blank" rel="noreferrer">
                                    Open
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={9}>No clocking events for this day.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {selectedComplianceClockings.some((clocking) => clocking.photoDataUrl) ? (
                    <div className="employee-ops-card">
                      <div className="employee-ops-header">
                        <h5>Captured Clock Photos</h5>
                        <span>
                          {selectedComplianceClockings.filter((clocking) => clocking.photoDataUrl).length} photo(s)
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: 12,
                        }}
                      >
                        {selectedComplianceClockings
                          .filter((clocking) => clocking.photoDataUrl)
                          .map((clocking, index) => (
                            <button
                              type="button"
                              key={`${clocking.id || clocking.time || index}-photo`}
                              onClick={() =>
                                {
                                  setAttendancePhotoPreview({
                                    open: true,
                                    src: clocking.photoDataUrl,
                                    title: `${selectedComplianceRow.employee} (${selectedComplianceRow.employeeId}) • ${
                                      clocking.mode === 'clock-in' ? 'Clock In' : 'Clock Out'
                                    } ${clocking.time || ''}`,
                                  });
                                  setAttendancePhotoPreviewZoom(1);
                                }
                              }
                              style={{
                                display: 'block',
                                borderRadius: 14,
                                overflow: 'hidden',
                                background: '#f8fafc',
                                border: '1px solid rgba(15, 23, 42, 0.08)',
                                color: 'inherit',
                                textAlign: 'left',
                                padding: 0,
                                cursor: 'pointer',
                              }}
                            >
                              <img
                                src={clocking.photoDataUrl}
                                alt={`${clocking.mode === 'clock-in' ? 'Clock-in' : 'Clock-out'} proof ${clocking.time || ''}`}
                                style={{
                                  width: '100%',
                                  height: 180,
                                  objectFit: 'cover',
                                  display: 'block',
                                }}
                              />
                              <div style={{ padding: 10 }}>
                                <strong>{clocking.mode === 'clock-in' ? 'Clock In' : 'Clock Out'}</strong>
                                <div>{clocking.time || '—'}</div>
                                <div style={{ color: '#64748b', fontSize: 12 }}>
                                  Click to preview
                                </div>
                              </div>
                            </button>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Session #</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Duration</th>
                          <th>Start Point</th>
                          <th>End Point</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedComplianceClockingSessions.length > 0 ? (
                          selectedComplianceClockingSessions.map((session, index) => (
                            <tr key={session.id}>
                              <td>{index + 1}</td>
                              <td>{session.startTime || '—'}</td>
                              <td>{session.endTime || '—'}</td>
                              <td>{session.duration}</td>
                              <td>
                                {typeof session.startLat === 'number' && typeof session.startLng === 'number' ? (
                                  <a
                                    href={`https://www.google.com/maps?q=${session.startLat},${session.startLng}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open Start
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td>
                                {typeof session.endLat === 'number' && typeof session.endLng === 'number' ? (
                                  <a href={`https://www.google.com/maps?q=${session.endLat},${session.endLng}`} target="_blank" rel="noreferrer">
                                    Open End
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6}>No complete IN/OUT session pairs for this day.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="employee-ops-card" style={{ minHeight: 260 }}>
                    <div className="employee-ops-header">
                      <h5>Clocking Location Trail</h5>
                      <div className="employee-ops-actions" style={{ gap: 8 }}>
                        <span>
                          {selectedComplianceClockingMapNodes.length > 0
                            ? `${selectedComplianceClockingMapNodes.length} point(s) • ${Math.min(
                                complianceReplayIndex + 1,
                                selectedComplianceClockingMapNodes.length
                              )}/${selectedComplianceClockingMapNodes.length}`
                            : 'No GPS points'}
                        </span>
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() => {
                            setComplianceReplayIndex(0);
                            setComplianceReplayActive(true);
                          }}
                          disabled={selectedComplianceClockingMapNodes.length === 0}
                        >
                          Replay
                        </button>
                        <select
                          className="filter-select"
                          value={String(complianceReplaySpeed)}
                          onChange={(event) => setComplianceReplaySpeed(Number(event.target.value) || 1)}
                          style={{ minWidth: 84 }}
                        >
                          <option value="0.5">0.5x</option>
                          <option value="1">1x</option>
                          <option value="2">2x</option>
                        </select>
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() => setComplianceReplayActive((prev) => !prev)}
                          disabled={selectedComplianceClockingMapNodes.length === 0}
                        >
                          {complianceReplayActive ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() => {
                            setComplianceReplayActive(false);
                            setComplianceReplayIndex(0);
                          }}
                          disabled={selectedComplianceClockingMapNodes.length === 0}
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() => setComplianceShowPointLabels((prev) => !prev)}
                          disabled={selectedComplianceClockingMapNodes.length === 0}
                        >
                          {complianceShowPointLabels ? 'Hide Labels' : 'Show Labels'}
                        </button>
                      </div>
                    </div>
                    <div
                      style={{
                        position: 'relative',
                        height: 240,
                        borderRadius: 10,
                        overflow: 'hidden',
                        border: '1px solid #d9e6fb',
                        background: '#ecf2ff',
                      }}
                    >
                      {selectedComplianceClockingMapNodes.length > 0 ? (
                        <div
                          ref={complianceTrailMapElementRef}
                          style={{
                            width: '100%',
                            height: '100%',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#607098',
                            fontSize: 13,
                          }}
                        >
                          No location trail captured for this day.
                        </div>
                      )}
                    </div>
                    {selectedComplianceClockingMapNodes.length > 0 ? (
                      <div style={{ marginTop: 12 }}>
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0, selectedComplianceClockingMapNodes.length - 1)}
                          value={Math.min(complianceReplayIndex, Math.max(0, selectedComplianceClockingMapNodes.length - 1))}
                          onChange={(event) => {
                            const nextIndex = Number(event.target.value) || 0;
                            setComplianceReplayActive(false);
                            setComplianceReplayIndex(Math.max(0, Math.min(nextIndex, selectedComplianceClockingMapNodes.length - 1)));
                          }}
                          style={{ width: '100%' }}
                        />
                        <div
                          style={{
                            marginTop: 6,
                            display: 'flex',
                            justifyContent: 'space-between',
                            color: '#607098',
                            fontSize: 12,
                          }}
                        >
                          <span>Start</span>
                          <span>
                            Step {Math.min(complianceReplayIndex + 1, selectedComplianceClockingMapNodes.length)} of{' '}
                            {selectedComplianceClockingMapNodes.length}
                          </span>
                          <span>End</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Penalty Type</th>
                          <th>Penalty Label</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedComplianceRow.penalties.length > 0 ? (
                          selectedComplianceRow.penalties.map((penalty) => (
                            <tr key={`${selectedComplianceRow.employeeId}-${selectedComplianceRow.date}-${penalty.type}`}>
                              <td>{penalty.type}</td>
                              <td>{penalty.label}</td>
                              <td>{penalty.amount.toFixed(2)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3}>No penalties on this day.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="empty-state">No compliance detail selected.</p>
              )
            ) : null}
            {attendanceDetailModal.type === 'penalties' ? (
              selectedPenaltyRow ? (
                <div className="attendance-audit-wrap">
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Employee ID</th>
                          <th>Date</th>
                          <th>Penalty</th>
                          <th>Base</th>
                          <th>Cleared</th>
                          <th>Outstanding</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{selectedPenaltyRow.employee}</td>
                          <td>{selectedPenaltyRow.employeeId}</td>
                          <td>{selectedPenaltyRow.date}</td>
                          <td>{selectedPenaltyRow.penaltyLabel}</td>
                          <td>{selectedPenaltyRow.baseAmount.toFixed(2)}</td>
                          <td>{selectedPenaltyRow.clearedAmount.toFixed(2)}</td>
                          <td>{selectedPenaltyRow.outstandingAmount.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Acted On</th>
                          <th>Actor</th>
                          <th>Mode</th>
                          <th>Cleared Amount</th>
                          <th>Remark</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPenaltyRow.adjustments.length > 0 ? (
                          selectedPenaltyRow.adjustments.map((adjustment) => (
                            <tr key={adjustment.id}>
                              <td>{adjustment.actedOn}</td>
                              <td>{adjustment.actorUsername}</td>
                              <td>{adjustment.clearanceMode}</td>
                              <td>{toNumberValue(adjustment.clearedAmount).toFixed(2)}</td>
                              <td>{adjustment.remark || '—'}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5}>No clearance actions yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="empty-state">No penalty detail selected.</p>
              )
            ) : null}
            {attendanceDetailModal.type === 'performance' ? (
              selectedPerformanceRow ? (
                <div className="attendance-audit-wrap">
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Employee ID</th>
                          <th>Period</th>
                          <th>Expected Days</th>
                          <th>On Time Days</th>
                          <th>Absent Days</th>
                          <th>Leave Apps</th>
                          <th>Perfect</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{selectedPerformanceRow.employee}</td>
                          <td>{selectedPerformanceRow.employeeId}</td>
                          <td>
                            {selectedPerformanceRow.periodStart} to {selectedPerformanceRow.periodEnd}
                          </td>
                          <td>{selectedPerformanceRow.expectedWorkDays}</td>
                          <td>{selectedPerformanceRow.onTimeCompleteDays}</td>
                          <td>{selectedPerformanceRow.absentDays}</td>
                          <td>{selectedPerformanceRow.leaveApplications}</td>
                          <td>{selectedPerformanceRow.perfectAttendance ? 'Yes' : 'No'}</td>
                          <td>{selectedPerformanceRow.attendanceScore.toFixed(1)}%</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Shift</th>
                          <th>Clock In</th>
                          <th>Clock Out</th>
                          <th>Late Min</th>
                          <th>Deduction</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPerformanceAttendanceRows.length > 0 ? (
                          selectedPerformanceAttendanceRows.map((attendanceRow) => (
                            <tr key={`${attendanceRow.employeeId}-${attendanceRow.date}`}>
                              <td>{attendanceRow.date}</td>
                              <td>{attendanceRow.shift || '—'}</td>
                              <td>{attendanceRow.checkIn || '—'}</td>
                              <td>{attendanceRow.checkOut || '—'}</td>
                              <td>{attendanceRow.lateMinutes || '0'}</td>
                              <td>{attendanceRow.deductionAmount || '0.00'}</td>
                              <td>{attendanceRow.status || 'Incomplete'}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={7}>No attendance entries in selected period.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="empty-state">No performance detail selected.</p>
              )
            ) : null}
          </div>
        </div>
      ) : null}
      {attendancePhotoPreview.open && attendancePhotoPreview.src ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setAttendancePhotoPreview({ open: false, src: '', title: '' });
            setAttendancePhotoPreviewZoom(1);
          }}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 'min(96vw, 1280px)', width: 'min(96vw, 1280px)' }}
          >
            <div className="modal-header">
              <h3>{attendancePhotoPreview.title || 'Clock Photo'}</h3>
              <div className="employee-ops-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => setAttendancePhotoPreviewZoom((prev) => Math.max(0.5, Number((prev - 0.25).toFixed(2))))}
                >
                  Zoom Out
                </button>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => setAttendancePhotoPreviewZoom((prev) => Math.min(3, Number((prev + 0.25).toFixed(2))))}
                >
                  Zoom In
                </button>
                <button type="button" className="neutral-btn" onClick={() => setAttendancePhotoPreviewZoom(1)}>
                  Reset
                </button>
                <button type="button" className="neutral-btn" onClick={downloadAttendancePreviewPhoto}>
                  Download
                </button>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => {
                    setAttendancePhotoPreview({ open: false, src: '', title: '' });
                    setAttendancePhotoPreviewZoom(1);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div
              className="attendance-ops-form"
              style={{
                overflow: 'auto',
                maxHeight: '82vh',
                background: '#020617',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <div
                style={{
                  width: `${Math.max(100, Math.round(attendancePhotoPreviewZoom * 100))}%`,
                  minWidth: '420px',
                  margin: '0 auto',
                }}
              >
                <img
                  src={attendancePhotoPreview.src}
                  alt={attendancePhotoPreview.title || 'Clock photo'}
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    borderRadius: 16,
                    background: '#0f172a',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {toasts.length > 0 ? (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-item ${toast.type}`}>
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default App;
