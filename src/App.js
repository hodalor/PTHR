import { Fragment, useCallback, useMemo, useState } from 'react';
import './App.css';
import { moduleUiData, sidebarSections } from './config/moduleUiData';

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

const shouldDisplayField = (field, currentValues) => {
  if (!field.showWhen) {
    return true;
  }
  return String(currentValues[field.showWhen.field] || '') === String(field.showWhen.value);
};

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

const toNumberValue = (value) => {
  const sanitized = String(value || '').replace(/[^0-9.-]/g, '');
  const numeric = Number(sanitized);
  return Number.isFinite(numeric) ? numeric : 0;
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

const defaultEmployeeLoanRows = [
  {
    id: 'LON-100',
    employee: 'Amina Yusuf',
    type: 'Salary Advance',
    amount: 'GHS 2,500',
    issuedOn: '2026-01-18',
    balance: 'GHS 1,200',
    status: 'Active',
  },
  {
    id: 'LON-101',
    employee: 'Liam Osei',
    type: 'Medical Loan',
    amount: 'GHS 4,000',
    issuedOn: '2025-12-05',
    balance: 'GHS 600',
    status: 'Active',
  },
  {
    id: 'LON-102',
    employee: 'Fatima Bello',
    type: 'Emergency Loan',
    amount: 'NGN 850,000',
    issuedOn: '2025-09-12',
    balance: 'NGN 0',
    status: 'Closed',
  },
];

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

function App() {
  const firstModuleId = sidebarSections[0].items[0].id;
  const [activeModuleId, setActiveModuleId] = useState(firstModuleId);
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
  const [leaveViewTab, setLeaveViewTab] = useState('requests');
  const [leaveRequestPageTab, setLeaveRequestPageTab] = useState('requests');
  const [leaveMenuExpanded, setLeaveMenuExpanded] = useState(false);
  const [leaveSearchText, setLeaveSearchText] = useState('');
  const [leaveDepartmentFilter, setLeaveDepartmentFilter] = useState('All');
  const [leaveStatusFilter, setLeaveStatusFilter] = useState('All');
  const [leaveSortBy, setLeaveSortBy] = useState('date-desc');
  const [leaveActionMessage, setLeaveActionMessage] = useState('');
  const [leaveApprovalDrafts, setLeaveApprovalDrafts] = useState({});
  const [toasts, setToasts] = useState([]);
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
    payrollWorkingDays: 26,
    attendanceCalculationMode: 'auto',
    attendanceFixedDeductionPerMinute: 0.128,
    attendanceFixedScope: 'all',
    attendanceFixedDepartment: '',
    attendanceFixedEmployeeId: '',
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
  });
  const [moduleRowsState, setModuleRowsState] = useState(() => {
    const initialRows = Object.fromEntries(Object.entries(moduleUiData).map(([moduleId, value]) => [moduleId, value.rows]));
    if (!initialRows['loan-records']) {
      initialRows['loan-records'] = defaultEmployeeLoanRows;
    }
    if (!initialRows['attendance-penalty-adjustments']) {
      initialRows['attendance-penalty-adjustments'] = [];
    }
    return initialRows;
  });

  const isSettingsPage = activeModuleId === 'settings';
  const activeModuleConfig = isSettingsPage ? null : moduleUiData[activeModuleId];
  const rows = useMemo(() => {
    if (!activeModuleConfig) {
      return [];
    }
    const baseRows = moduleRowsState[activeModuleId] || [];
    if (activeModuleId !== 'payroll-management') {
      return baseRows;
    }
    const employeeRows = moduleRowsState['employee-management'] || [];
    const attendanceTimeRows = moduleRowsState['attendance-time'] || [];
    const leaveRows = moduleRowsState['leave-management'] || [];
    const penaltyAdjustmentRows = moduleRowsState['attendance-penalty-adjustments'] || [];
    const lateMinutesByEmployee = attendanceTimeRows.reduce((acc, attendanceRow) => {
      const employeeId = String(attendanceRow.employeeId || '').trim();
      const employeeName = String(attendanceRow.employee || '').trim();
      if (!employeeId && !employeeName) {
        return acc;
      }
      const minutes = Math.max(0, Number(attendanceRow.lateMinutes) || 0);
      const matchedEmployee =
        employeeRows.find((employeeRow) => String(employeeRow.id || '').trim() === employeeId) ||
        employeeRows.find((employeeRow) => String(employeeRow.fullName || '').trim() === employeeName);
      const key = String(matchedEmployee?.id || employeeId || employeeName);
      acc[key] = (acc[key] || 0) + minutes;
      return acc;
    }, {});
    const nowDate = getTodayIsoDate();
    const nowMinutes = toMinutesFromClock(getCurrentClockValue()) || 0;
    const shiftEndMinutes = toMinutesFromClock(appSettings.attendanceShiftEnd) ?? 0;
    const noClockInPenaltyByEmployee = {};
    const noClockOutPenaltyByEmployee = {};
    const absentPenaltyByEmployee = {};
    attendanceTimeRows.forEach((attendanceRow) => {
      const employeeId = String(attendanceRow.employeeId || '').trim();
      const employeeName = String(attendanceRow.employee || '').trim();
      const matchedEmployee =
        employeeRows.find((employeeRow) => String(employeeRow.id || '').trim() === employeeId) ||
        employeeRows.find((employeeRow) => String(employeeRow.fullName || '').trim() === employeeName);
      const key = String(matchedEmployee?.id || employeeId || employeeName);
      if (!key) {
        return;
      }
      const currentDate = String(attendanceRow.date || '');
      const isPastDate = currentDate < nowDate;
      const isNoonReached = isPastDate || (currentDate === nowDate && nowMinutes >= 12 * 60);
      const isClockOutDeadlineReached = isPastDate;
      const leaveMatch = leaveRows.find((leaveRow) => {
        const leaveEmployeeId = String(leaveRow.employeeId || '').trim();
        const leaveEmployeeName = String(leaveRow.employee || '').trim();
        const leaveStatus = String(leaveRow.status || '').toLowerCase();
        const sameEmployee = leaveEmployeeId === key || leaveEmployeeName === String(matchedEmployee?.fullName || '');
        return (
          sameEmployee &&
          (leaveStatus === 'approved' || leaveStatus === 'active') &&
          String(leaveRow.startDate || '') <= currentDate &&
          String(leaveRow.endDate || '') >= currentDate
        );
      });
      const employeeStatus = String(matchedEmployee?.status || '').toLowerCase();
      const employeeStage = String(matchedEmployee?.employmentState || '').toLowerCase();
      const isOffDuty = employeeStatus !== 'active' || employeeStage === 'terminated' || employeeStage === 'suspended';
      const isExempt = isOffDuty || Boolean(leaveMatch);
      if (isExempt) {
        return;
      }
      const checkInMinutes = toMinutesFromClock(attendanceRow.checkIn);
      const rawCheckOut = String(attendanceRow.checkOut || '');
      const hasClockOut =
        rawCheckOut !== '00:00' &&
        rawCheckOut !== '24:00' &&
        toMinutesFromClock(attendanceRow.checkOut) !== null &&
        toMinutesFromClock(attendanceRow.checkOut) > (checkInMinutes ?? 0);
      const missingClockIn = checkInMinutes === null && isNoonReached;
      const missingClockOut = !hasClockOut && isClockOutDeadlineReached;
      const missingCount = Number(missingClockIn) + Number(missingClockOut);
      const payrollForEmployee =
        baseRows.find((payrollRow) => String(payrollRow.employeeId || '').trim() === key) ||
        baseRows.find((payrollRow) => String(payrollRow.employee || '').trim() === String(matchedEmployee?.fullName || ''));
      const basicPay = toNumberValue(payrollForEmployee?.basicPay);
      const workingDays = Math.max(1, Number(payrollForEmployee?.workingDays || appSettings.payrollWorkingDays) || 1);
      const dailyWage = basicPay > 0 ? basicPay / workingDays : 0;
      if (missingCount >= 2) {
        absentPenaltyByEmployee[key] = (absentPenaltyByEmployee[key] || 0) + dailyWage;
      } else if (missingClockIn) {
        noClockInPenaltyByEmployee[key] = (noClockInPenaltyByEmployee[key] || 0) + dailyWage / 2;
      } else if (missingClockOut) {
        noClockOutPenaltyByEmployee[key] = (noClockOutPenaltyByEmployee[key] || 0) + dailyWage / 2;
      }
      if (checkInMinutes !== null && hasClockOut && shiftEndMinutes > 0) {
        const checkOutMinutes = toMinutesFromClock(attendanceRow.checkOut) || 0;
        if (checkOutMinutes < shiftEndMinutes) {
          noClockOutPenaltyByEmployee[key] = noClockOutPenaltyByEmployee[key] || 0;
        }
      }
    });
    const clearedByPenaltyAndEmployee = penaltyAdjustmentRows.reduce((acc, row) => {
      const key = `${String(row.employeeId || '').trim()}|${String(row.penaltyType || '').trim()}`;
      acc[key] = (acc[key] || 0) + toNumberValue(row.clearedAmount);
      return acc;
    }, {});
    const scheduledMinutes = Math.max(1, getMinutesBetweenClocks(appSettings.attendanceReportTime, appSettings.attendanceShiftEnd));
    return baseRows.map((payrollRow) => {
      const payrollEmployeeId = String(payrollRow.employeeId || '').trim();
      const payrollEmployeeName = String(payrollRow.employee || '').trim();
      const matchedEmployee =
        employeeRows.find((employeeRow) => String(employeeRow.id || '').trim() === payrollEmployeeId) ||
        employeeRows.find((employeeRow) => String(employeeRow.fullName || '').trim() === payrollEmployeeName);
      const key = String(matchedEmployee?.id || payrollEmployeeId || payrollEmployeeName);
      const lateMinutes = lateMinutesByEmployee[key] || 0;
      const basicPay = toNumberValue(payrollRow.basicPay);
      const workingDays = Math.max(1, Number(payrollRow.workingDays || appSettings.payrollWorkingDays) || 1);
      const autoMinuteRate = basicPay > 0 ? basicPay / workingDays / scheduledMinutes : 0;
      const fixedMinuteRate = Math.max(0, Number(appSettings.attendanceFixedDeductionPerMinute) || 0);
      const fixedScope = String(appSettings.attendanceFixedScope || 'all');
      const fixedApplies =
        fixedScope === 'all' ||
        (fixedScope === 'department' &&
          String(matchedEmployee?.department || '') === String(appSettings.attendanceFixedDepartment || '')) ||
        (fixedScope === 'individual' &&
          String(matchedEmployee?.id || payrollEmployeeId || '') === String(appSettings.attendanceFixedEmployeeId || ''));
      const minuteRate = appSettings.attendanceCalculationMode === 'fixed' && fixedApplies ? fixedMinuteRate : autoMinuteRate;
      const lateDeduction = lateMinutes * minuteRate;
      const noClockInPenalty = noClockInPenaltyByEmployee[key] || 0;
      const noClockOutPenalty = noClockOutPenaltyByEmployee[key] || 0;
      const absentPenalty = absentPenaltyByEmployee[key] || 0;
      const lateClearance = clearedByPenaltyAndEmployee[`${key}|lateness`] || 0;
      const noClockInClearance = clearedByPenaltyAndEmployee[`${key}|no-clock-in`] || 0;
      const noClockOutClearance = clearedByPenaltyAndEmployee[`${key}|no-clock-out`] || 0;
      const absentClearance = clearedByPenaltyAndEmployee[`${key}|absent`] || 0;
      const netLateDeduction = Math.max(0, lateDeduction - lateClearance);
      const netNoClockInPenalty = Math.max(0, noClockInPenalty - noClockInClearance);
      const netNoClockOutPenalty = Math.max(0, noClockOutPenalty - noClockOutClearance);
      const netAbsentPenalty = Math.max(0, absentPenalty - absentClearance);
      const totalAttendancePenalty = netLateDeduction + netNoClockInPenalty + netNoClockOutPenalty + netAbsentPenalty;
      return {
        ...payrollRow,
        lateMinutes: String(lateMinutes),
        deductionRatePerMinute: minuteRate.toFixed(3),
        lateDeduction: netLateDeduction.toFixed(2),
        noClockInPenalty: netNoClockInPenalty.toFixed(2),
        noClockOutPenalty: netNoClockOutPenalty.toFixed(2),
        absentPenalty: netAbsentPenalty.toFixed(2),
        totalAttendancePenalty: totalAttendancePenalty.toFixed(2),
        payableAfterLate: Math.max(0, basicPay - totalAttendancePenalty).toFixed(2),
      };
    });
  }, [activeModuleConfig, activeModuleId, appSettings, moduleRowsState]);
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
    if (activeModuleId !== 'employee-management') {
      return activeModuleConfig.columns;
    }
    if (activeModuleConfig.columns.some((column) => column.key === 'contractAlert')) {
      return activeModuleConfig.columns;
    }
    return [
      ...activeModuleConfig.columns,
      { key: 'contractAlert', label: 'Contract Alert' },
    ];
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

  const totalModules = useMemo(
    () => sidebarSections.reduce((acc, section) => acc + section.items.length, 0),
    []
  );
  const totalRows = useMemo(
    () => Object.values(moduleRowsState).reduce((acc, records) => acc + records.length, 0),
    [moduleRowsState]
  );
  const activeStatusCount = useMemo(
    () =>
      Object.values(moduleRowsState)
        .flat()
        .filter((row) => String(row.status || '').toLowerCase() === 'active').length,
    [moduleRowsState]
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
  const isPayrollModule = activeModuleId === 'payroll-management';
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
                'accessAccount',
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
                'referee2',
              ],
            },
            {
              id: 'employment-docs',
              title: 'Employment & Documents',
              fields: [
                'department',
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
  const payrollDetailSections = useMemo(
    () =>
      isPayrollModule
        ? [
            {
              id: 'employee-period',
              title: 'Employee & Period',
              fields: ['month', 'employee', 'employeeId', 'status'],
            },
            {
              id: 'statutory',
              title: 'Statutory IDs',
              fields: ['taxId', 'pensionId', 'nhimaNumber'],
            },
            {
              id: 'wallet-bank',
              title: 'Wallet & Bank',
              fields: [
                'accessAccount',
                'mobileMoneyNumber',
                'mobileMoneyNetwork',
                'bankName',
                'bankAccountName',
                'bankAccountNumber',
              ],
            },
            {
              id: 'pay-allowances',
              title: 'Pay & Allowances',
              fields: [
                'basicPay',
                'monthlyBonuses',
                'transportAllowance',
                'housingAllowance',
                'foodAllowance',
                'grossPay',
                'workingDays',
              ],
            },
            {
              id: 'deductions-penalties',
              title: 'Deductions & Penalties',
              fields: [
                'napsaDeduction',
                'nhimaDeduction',
                'taxDeduction',
                'otherDeduction',
                'totalAttendancePenalty',
                'lateMinutes',
                'deductionRatePerMinute',
                'lateDeduction',
                'noClockInPenalty',
                'noClockOutPenalty',
                'absentPenalty',
                'totalDeductions',
              ],
            },
            {
              id: 'summary',
              title: 'Summary',
              fields: ['netPayable'],
            },
          ]
        : [],
    [isPayrollModule]
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
  const payrollFormFieldMap = useMemo(() => {
    if (!isPayrollModule || !activeModuleConfig) {
      return {};
    }
    const map = {};
    activeModuleConfig.formFields.forEach((field) => {
      map[field.key] = field;
    });
    return map;
  }, [activeModuleConfig, isPayrollModule]);
  const genericFormSections = useMemo(() => {
    if (isEmployeeModule || isPayrollModule || !activeModuleConfig) {
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
  }, [activeModuleConfig, isEmployeeModule, isPayrollModule, visibleFormFields]);
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
  const loanRows = useMemo(() => moduleRowsState['loan-records'] || [], [moduleRowsState]);
  const employeeLoanRecords = useMemo(() => {
    if (!isEmployeeModule || !modalRow) {
      return [];
    }
    return loanRows
      .filter((loanRow) => String(loanRow.employee) === String(modalRow.fullName))
      .sort((a, b) => new Date(b.issuedOn || '1900-01-01').getTime() - new Date(a.issuedOn || '1900-01-01').getTime());
  }, [isEmployeeModule, loanRows, modalRow]);
  const employeeBaseRows = useMemo(() => moduleRowsState['employee-management'] || [], [moduleRowsState]);
  const payrollFormEmployeeMatches = useMemo(() => {
    const query = String(formValues.payrollEmployeeSearch || '').trim().toLowerCase();
    if (!query) {
      return [];
    }
    return employeeBaseRows
      .filter((employee) => {
        const employeeId = String(employee.id || '').toLowerCase();
        const employeeName = String(employee.fullName || '').toLowerCase();
        return employeeId.includes(query) || employeeName.includes(query);
      })
      .slice(0, 6);
  }, [employeeBaseRows, formValues.payrollEmployeeSearch]);
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
  const leaveBalanceRows = useMemo(
    () =>
      employeeBaseRows.map((employee) => {
        const payrollRows = moduleRowsState['payroll-management'] || [];
        const payrollProfile =
          payrollRows.find((row) => String(row.employeeId || '') === String(employee.id || '')) ||
          payrollRows.find((row) => String(row.employee || '') === String(employee.fullName || ''));
        const approvedDays = leaveRequestRows
          .filter(
            (row) =>
              String(row.employeeId || '') === String(employee.id || '') &&
              String(row.departmentApproval || '') === 'Approved' &&
              String(row.managerApproval || '') === 'Approved' &&
              String(row.hrApproval || '') === 'Approved'
          )
          .reduce((total, row) => total + row.daysRequested, 0);
        const pendingDays = leaveRequestRows
          .filter(
            (row) =>
              String(row.employeeId || '') === String(employee.id || '') &&
              String(row.status || '').toLowerCase().includes('pending')
          )
          .reduce((total, row) => total + row.daysRequested, 0);
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
    const scopedRows = leaveRequestRows.filter((row) => {
      if (leaveViewTab === 'hr') {
        return String(row.departmentApproval || '') === 'Approved';
      }
      if (leaveViewTab === 'manager') {
        return String(row.departmentApproval || '') === 'Approved' && String(row.hrApproval || '') === 'Approved';
      }
      return true;
    });
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
  }, [getLeaveViewStatus, leaveDepartmentFilter, leaveRequestRows, leaveSearchText, leaveSortBy, leaveStatusFilter, leaveViewTab]);
  const leaveBalanceFilteredRows = useMemo(() => {
    const query = leaveSearchText.trim().toLowerCase();
    const filteredRows = leaveBalanceRows.filter((row) => {
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
  }, [leaveBalanceRows, leaveDepartmentFilter, leaveSearchText, leaveSortBy]);
  const leaveFormEmployeeMatches = useMemo(() => {
    const query = String(formValues.leaveEmployeeSearch || '').trim().toLowerCase();
    if (!query) {
      return [];
    }
    return employeeBaseRows
      .filter((employee) => {
        const employeeId = String(employee.id || '').toLowerCase();
        const employeeName = String(employee.fullName || '').toLowerCase();
        return employeeId.includes(query) || employeeName.includes(query);
      })
      .slice(0, 6);
  }, [employeeBaseRows, formValues.leaveEmployeeSearch]);
  const selectedLeaveFormEmployee = useMemo(
    () =>
      employeeBaseRows.find((employee) => String(employee.id || '') === String(formValues.employeeId || '')) ||
      employeeBaseRows.find((employee) => String(employee.fullName || '') === String(formValues.employee || '')) ||
      null,
    [employeeBaseRows, formValues.employee, formValues.employeeId]
  );
  const selectedLeaveFormBalance = useMemo(
    () => leaveBalanceRows.find((row) => String(row.employeeId || '') === String(selectedLeaveFormEmployee?.id || '')) || null,
    [leaveBalanceRows, selectedLeaveFormEmployee]
  );
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
          <strong>{field.key === 'password' ? '••••••••' : modalRow[field.key] || '—'}</strong>
        )}
      </div>
    );
  };
  const renderFormFieldControl = (field) => {
    if (!field) {
      return null;
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
            value={formValues[field.key] || ''}
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
            value={formValues[field.key] || ''}
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
              onChange={(event) => {
                const selectedFiles = Array.from(event.target.files || []);
                const selectedFilesMeta = selectedFiles.map((file) => ({
                  name: file.name,
                  url: URL.createObjectURL(file),
                  isImage: file.type.startsWith('image/'),
                  note: '',
                }));
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
        ) : (
          <input
            type={field.type || 'text'}
            value={formValues[field.key] || ''}
            onChange={(event) =>
              setFormValues((prev) => ({
                ...prev,
                [field.key]: event.target.value,
              }))
            }
          />
        )}
      </label>
    );
  };
  const attendanceTodayRows = useMemo(
    () =>
      attendanceRows
        .filter((row) => String(row.date || '') === todayIsoDate)
        .sort((a, b) => toMinutesFromClock(b.checkIn) - toMinutesFromClock(a.checkIn)),
    [attendanceRows, todayIsoDate]
  );
  const attendanceLateCount = useMemo(
    () => attendanceTodayRows.filter((row) => String(row.status || '').toLowerCase() === 'late').length,
    [attendanceTodayRows]
  );
  const selectedAttendanceEmployee = useMemo(
    () => employeeBaseRows.find((employee) => employee.id === attendanceClockDraft.employeeId) || null,
    [attendanceClockDraft.employeeId, employeeBaseRows]
  );
  const attendanceSearchMatches = useMemo(() => {
    const query = attendanceSearchText.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return employeeBaseRows
      .filter((employee) => {
        const employeeId = String(employee.id || '').toLowerCase();
        const employeeName = String(employee.fullName || '').toLowerCase();
        return employeeId.includes(query) || employeeName.includes(query);
      })
      .slice(0, 6);
  }, [attendanceSearchText, employeeBaseRows]);
  const selectedFingerprintEmployee = useMemo(
    () => employeeBaseRows.find((employee) => employee.id === fingerprintDraft.employeeId) || null,
    [employeeBaseRows, fingerprintDraft.employeeId]
  );
  const payrollRows = useMemo(() => moduleRowsState['payroll-management'] || [], [moduleRowsState]);
  const penaltyAdjustmentRows = useMemo(() => moduleRowsState['attendance-penalty-adjustments'] || [], [moduleRowsState]);
  const attendanceComplianceRows = useMemo(() => {
    const targetDate = attendanceAuditDate || todayIsoDate;
    const nowMinutes = toMinutesFromClock(getCurrentClockValue()) || 0;
    const isPastDate = targetDate < todayIsoDate;
    const isNoonReached = isPastDate || (targetDate === todayIsoDate && nowMinutes >= 12 * 60);
    const isClockOutDeadlineReached = isPastDate;
    const lateAfterMinutes = toMinutesFromClock(appSettings.attendanceLateAfter) ?? 0;
    const shiftEndMinutes = toMinutesFromClock(appSettings.attendanceShiftEnd) ?? 0;
    return employeeBaseRows.map((employee) => {
      const attendanceRow = attendanceRows.find(
        (row) => String(row.employeeId || '') === String(employee.id || '') && String(row.date || '') === String(targetDate)
      );
      const payrollProfile =
        payrollRows.find((row) => String(row.employeeId || '') === String(employee.id || '')) ||
        payrollRows.find((row) => String(row.employee || '') === String(employee.fullName || ''));
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
      const checkInMinutes = toMinutesFromClock(attendanceRow?.checkIn);
      const rawCheckOut = String(attendanceRow?.checkOut || '');
      const hasMidnightCheckout = rawCheckOut === '00:00' || rawCheckOut === '24:00';
      const checkOutMinutes = hasMidnightCheckout ? null : toMinutesFromClock(rawCheckOut);
      const hasClockIn = checkInMinutes !== null;
      const hasClockOut = checkOutMinutes !== null && checkOutMinutes > (checkInMinutes ?? 0);
      const isLate = hasClockIn && checkInMinutes > lateAfterMinutes;
      const leftEarly = hasClockOut && shiftEndMinutes > 0 && checkOutMinutes < shiftEndMinutes;
      const lateDeduction = toNumberValue(attendanceRow?.deductionAmount);
      const countMissingClockIn = !isExempt && !hasClockIn && isNoonReached;
      const countMissingClockOut = !isExempt && !hasClockOut && isClockOutDeadlineReached;
      const missingCount = Number(countMissingClockIn) + Number(countMissingClockOut);
      const noClockInPenalty = missingCount === 1 && countMissingClockIn ? dailyWage / 2 : 0;
      const noClockOutPenalty = missingCount === 1 && countMissingClockOut ? dailyWage / 2 : 0;
      const absentPenalty = missingCount >= 2 ? dailyWage : 0;
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
      } else if (noClockInPenalty > 0 || noClockOutPenalty > 0) {
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
        checkIn: attendanceRow?.checkIn || '',
        checkOut: attendanceRow?.checkOut || '',
        dailyWage,
        dailyStatus,
        isLate,
        leftEarly,
        penalties,
      };
    });
  }, [
    appSettings.attendanceLateAfter,
    appSettings.attendanceShiftEnd,
    attendanceAuditDate,
    attendanceRows,
    employeeBaseRows,
    leaveRows,
    payrollRows,
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
    const ledger = [];
    attendanceComplianceRows.forEach((row) => {
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
  }, [attendanceComplianceRows, penaltyAdjustmentRows]);
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
    const lateAfterMinutes = toMinutesFromClock(appSettings.attendanceLateAfter) ?? 0;
    const shiftEndMinutes = toMinutesFromClock(appSettings.attendanceShiftEnd) ?? 0;
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
    return employeeBaseRows
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
          const isNoonReached = isPastDate || (currentDate === todayIsoDate && nowMinutes >= 12 * 60);
          const isClockOutDeadlineReached = isPastDate;
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
            const checkInMinutes = toMinutesFromClock(attendanceRow?.checkIn);
            const checkOutRaw = String(attendanceRow?.checkOut || '');
            const checkOutMinutes = toMinutesFromClock(checkOutRaw);
            const hasClockIn = checkInMinutes !== null;
            const hasClockOut =
              checkOutRaw !== '00:00' &&
              checkOutRaw !== '24:00' &&
              checkOutMinutes !== null &&
              checkOutMinutes > (checkInMinutes ?? 0);
            const isLate = hasClockIn && checkInMinutes > lateAfterMinutes;
            const leftEarly = hasClockOut && shiftEndMinutes > 0 && checkOutMinutes < shiftEndMinutes;
            if (isLate) {
              lateDays += 1;
            }
            if (leftEarly) {
              leftEarlyDays += 1;
            }
            const missingClockIn = !hasClockIn && isNoonReached;
            const missingClockOut = !hasClockOut && isClockOutDeadlineReached;
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
    appSettings.attendanceLateAfter,
    appSettings.attendanceShiftEnd,
    attendancePerformanceRange,
    attendancePerformanceRankMetric,
    attendancePerformanceDepartmentFilter,
    attendancePerformanceSearchText,
    attendanceRows,
    employeeBaseRows,
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
    return (
      attendanceRows.find(
        (attendanceRow) =>
          String(attendanceRow.employeeId || '') === String(selectedComplianceRow.employeeId || '') &&
          String(attendanceRow.date || '') === String(selectedComplianceRow.date || '')
      ) || null
    );
  }, [attendanceRows, selectedComplianceRow]);
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
  const showMainModuleTable =
    (activeModuleId !== 'attendance-time' || attendanceViewTab === 'clock') && activeModuleId !== 'leave-management';
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
  };
  const leaveSubmenuItems = [
    { key: 'requests', label: 'Leave Requests' },
    { key: 'department', label: 'Department Approval' },
    { key: 'hr', label: 'HR Approval' },
    { key: 'manager', label: 'Manager Approval' },
  ];
  const showToast = (message, type = 'info') => {
    const toastId = `TST-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setToasts((prev) => [...prev, { id: toastId, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== toastId));
    }, 3200);
  };

  const handleModuleChange = (moduleId) => {
    setActiveModuleId(moduleId);
    setLeaveMenuExpanded(moduleId === 'leave-management');
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

  const handleClockIn = () => {
    if (!selectedAttendanceEmployee) {
      showToast('Select an employee before clock in.', 'error');
      return;
    }
    const checkInTime = getCurrentClockValue();
    const nowDate = getTodayIsoDate();
    const lateRuleMinutes = toMinutesFromClock(appSettings.attendanceLateAfter || appSettings.attendanceReportTime);
    const checkInMinutes = toMinutesFromClock(checkInTime);
    const lateMinutes =
      lateRuleMinutes === null || checkInMinutes === null ? 0 : Math.max(0, checkInMinutes - lateRuleMinutes);
    const status = lateMinutes > 0 ? 'Late' : 'On Time';
    const rowId = `ATT-${Date.now().toString().slice(-6)}`;
    const payrollRows = moduleRowsState['payroll-management'] || [];
    const payrollProfile =
      payrollRows.find((row) => String(row.employeeId || '') === String(selectedAttendanceEmployee.id)) ||
      payrollRows.find((row) => String(row.employee || '') === String(selectedAttendanceEmployee.fullName));
    const basicPay = toNumberValue(payrollProfile?.basicPay);
    const workingDays = Math.max(1, Number(payrollProfile?.workingDays || appSettings.payrollWorkingDays) || 1);
    const scheduledMinutes = Math.max(
      1,
      getMinutesBetweenClocks(appSettings.attendanceReportTime, appSettings.attendanceShiftEnd)
    );
    const autoMinuteRate = basicPay > 0 ? basicPay / workingDays / scheduledMinutes : 0;
    const fixedMinuteRate = Math.max(0, Number(appSettings.attendanceFixedDeductionPerMinute) || 0);
    const fixedScope = String(appSettings.attendanceFixedScope || 'all');
    const fixedApplies =
      fixedScope === 'all' ||
      (fixedScope === 'department' &&
        String(selectedAttendanceEmployee.department || '') === String(appSettings.attendanceFixedDepartment || '')) ||
      (fixedScope === 'individual' &&
        String(selectedAttendanceEmployee.id || '') === String(appSettings.attendanceFixedEmployeeId || ''));
    const deductionRatePerMinute =
      appSettings.attendanceCalculationMode === 'fixed' && fixedApplies ? fixedMinuteRate : autoMinuteRate;
    const deductionAmount = lateMinutes * deductionRatePerMinute;

    setModuleRowsState((prev) => {
      const currentRows = prev['attendance-time'] || [];
      const existingRowIndex = currentRows.findIndex(
        (row) => row.employeeId === selectedAttendanceEmployee.id && String(row.date || '') === nowDate
      );
      const newRow = {
        id: existingRowIndex >= 0 ? currentRows[existingRowIndex].id : rowId,
        employee: selectedAttendanceEmployee.fullName,
        employeeId: selectedAttendanceEmployee.id,
        date: nowDate,
        shift: attendanceClockDraft.shift || 'Morning',
        checkIn: checkInTime,
        checkOut: existingRowIndex >= 0 ? currentRows[existingRowIndex].checkOut || '' : '',
        workedHours: existingRowIndex >= 0 ? currentRows[existingRowIndex].workedHours || '' : '',
        lateMinutes: String(lateMinutes),
        deductionRatePerMinute: deductionRatePerMinute.toFixed(3),
        deductionAmount: deductionAmount.toFixed(2),
        source: appSettings.fingerprintIntegration.mode === 'live' ? 'Fingerprint Device' : 'Manual Clock',
        status,
      };
      if (existingRowIndex >= 0) {
        const updatedRows = [...currentRows];
        updatedRows[existingRowIndex] = { ...currentRows[existingRowIndex], ...newRow };
        return { ...prev, 'attendance-time': updatedRows };
      }
      return { ...prev, 'attendance-time': [newRow, ...currentRows] };
    });
    showToast(`Thank you ${selectedAttendanceEmployee.fullName}, clock in captured successfully.`, 'success');
  };

  const handleClockOut = () => {
    if (!selectedAttendanceEmployee) {
      showToast('Select an employee before clock out.', 'error');
      return;
    }
    const checkOutTime = getCurrentClockValue();
    const nowDate = getTodayIsoDate();
    const currentRows = moduleRowsState['attendance-time'] || [];
    const existingRow = currentRows.find(
      (row) => row.employee === selectedAttendanceEmployee.fullName && String(row.date || '') === nowDate
    );
    if (!existingRow) {
      showToast(`No clock-in record found for ${selectedAttendanceEmployee.fullName} today.`, 'error');
      return;
    }
    if (!existingRow.checkIn || getMinutesBetweenClocks(existingRow.checkIn, checkOutTime) <= 0) {
      showToast('Clock out time is invalid. Ensure check-in exists and time is after check-in.', 'error');
      return;
    }

    setModuleRowsState((prev) => {
      const stateRows = prev['attendance-time'] || [];
      const existingRowIndex = stateRows.findIndex(
        (row) => row.employee === selectedAttendanceEmployee.fullName && String(row.date || '') === nowDate
      );
      if (existingRowIndex < 0) {
        return prev;
      }
      const matchedRow = stateRows[existingRowIndex];
      if (!matchedRow.checkIn || getMinutesBetweenClocks(matchedRow.checkIn, checkOutTime) <= 0) {
        return prev;
      }
      const workedHours = formatWorkedDuration(matchedRow.checkIn, checkOutTime);
      const updatedRows = [...stateRows];
      updatedRows[existingRowIndex] = {
        ...matchedRow,
        checkOut: checkOutTime,
        workedHours,
      };
      return { ...prev, 'attendance-time': updatedRows };
    });
    showToast(`Thank you ${selectedAttendanceEmployee.fullName}, clock out captured successfully.`, 'success');
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
  const handleDepartmentLeaveDecision = (leaveId, decision) => {
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
    setModuleRowsState((prev) => ({
      ...prev,
      'leave-management': (prev['leave-management'] || []).map((row) => {
        if (String(row.id || '') !== String(leaveId || '')) {
          return row;
        }
        const currentApproval = row.departmentApproval || row.supervisorApproval || row.managerApproval || 'Pending';
        if (String(currentApproval) !== 'Pending') {
          return row;
        }
        return {
          ...row,
          departmentApproval: normalizedDecision,
          departmentApprover: input.actorName,
          departmentComment: input.comment,
          departmentApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
          hrApproval: normalizedDecision === 'Rejected' ? 'Rejected' : row.hrApproval || 'Pending',
          managerApproval: normalizedDecision === 'Rejected' ? 'Rejected' : row.managerApproval || 'Pending',
          status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Pending HR',
        };
      }),
    }));
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
  const handleHrLeaveDecision = (leaveId, decision) => {
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
    setModuleRowsState((prev) => ({
      ...prev,
      'leave-management': (prev['leave-management'] || []).map((row) => {
        if (String(row.id || '') !== String(leaveId || '')) {
          return row;
        }
        if (String(row.departmentApproval || '') !== 'Approved' || String(row.hrApproval || 'Pending') !== 'Pending') {
          return row;
        }
        return {
          ...row,
          hrApproval: normalizedDecision,
          hrApprover: input.actorName,
          hrComment: input.comment,
          hrApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
          managerApproval: normalizedDecision === 'Rejected' ? 'Rejected' : row.managerApproval || 'Pending',
          status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Pending Manager',
        };
      }),
    }));
    setLeaveApprovalDrafts((prev) => ({ ...prev, [leaveId]: { actorName: input.actorName, comment: '' } }));
    showToast(
      normalizedDecision === 'Rejected' ? `HR rejected leave request ${leaveId}.` : `HR approved leave request ${leaveId}.`,
      normalizedDecision === 'Rejected' ? 'error' : 'success'
    );
    setLeaveActionMessage(
      normalizedDecision === 'Rejected' ? 'HR rejected the leave request.' : 'HR approved. Request moved to branch manager.'
    );
  };
  const handleManagerLeaveDecision = (leaveId, decision) => {
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
    setModuleRowsState((prev) => ({
      ...prev,
      'leave-management': (prev['leave-management'] || []).map((row) => {
        if (String(row.id || '') !== String(leaveId || '')) {
          return row;
        }
        if (String(row.departmentApproval || '') !== 'Approved' || String(row.hrApproval || '') !== 'Approved') {
          return row;
        }
        if (String(row.managerApproval || 'Pending') !== 'Pending') {
          return row;
        }
        return {
          ...row,
          managerApproval: normalizedDecision,
          managerApprover: input.actorName,
          managerComment: input.comment,
          managerApprovedOn: `${getTodayIsoDate()} ${getCurrentClockValue()}`,
          status: normalizedDecision === 'Rejected' ? 'Rejected' : 'Approved',
        };
      }),
    }));
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
  };

  const startCreate = () => {
    setEditRowId('new');
    setFormValues(
      activeModuleId === 'leave-management'
        ? {
            leaveEmployeeSearch: '',
            employee: '',
            employeeId: '',
            department: '',
            type: 'Annual',
            startDate: getTodayIsoDate(),
            endDate: getTodayIsoDate(),
            reason: '',
          }
        : activeModuleId === 'payroll-management'
          ? {
              payrollEmployeeSearch: '',
              employee: '',
              employeeId: '',
              month: '',
            }
        : {}
    );
    setFormError('');
    setModalState({ mode: 'form', rowId: null });
  };

  const startEdit = (row) => {
    setEditRowId(row.id);
    setFormValues(
      activeModuleId === 'leave-management'
        ? { ...row, leaveEmployeeSearch: `${row.employee || ''} ${row.employeeId || ''}`.trim() }
        : activeModuleId === 'payroll-management'
          ? {
              ...row,
              payrollEmployeeSearch: `${row.employee || ''} ${row.employeeId || ''}`.trim(),
            }
        : { ...row }
    );
    setFormError('');
    setModalState({ mode: 'form', rowId: row.id });
  };

  const handleDelete = (rowId) => {
    setModuleRowsState((prev) => ({
      ...prev,
      [activeModuleId]: prev[activeModuleId].filter((row) => row.id !== rowId),
    }));
    if (selectedRowId === rowId) {
      setSelectedRowId(null);
    }
    if (editRowId === rowId || modalState.rowId === rowId) {
      closeModal();
    }
  };

  const handleSave = () => {
    if (!activeModuleConfig) {
      return;
    }
    const missingRequiredField = visibleFormFields.find(
      (field) => field.required && !String(formValues[field.key] || '').trim()
    );
    if (missingRequiredField) {
      setFormError(`${getFieldLabel(missingRequiredField)} is required.`);
      return;
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
    if (activeModuleId === 'payroll-management') {
      const basicPay = toNumberValue(formValues.basicPay);
      const monthlyBonuses = toNumberValue(formValues.monthlyBonuses);
      const transportAllowance = toNumberValue(formValues.transportAllowance);
      const housingAllowance = toNumberValue(formValues.housingAllowance);
      const foodAllowance = toNumberValue(formValues.foodAllowance);
      const grossPay = basicPay + monthlyBonuses + transportAllowance + housingAllowance + foodAllowance;
      const lateDeduction = toNumberValue(formValues.lateDeduction);
      const noClockInPenalty = toNumberValue(formValues.noClockInPenalty);
      const noClockOutPenalty = toNumberValue(formValues.noClockOutPenalty);
      const absentPenalty = toNumberValue(formValues.absentPenalty);
      const totalAttendancePenalty = lateDeduction + noClockInPenalty + noClockOutPenalty + absentPenalty;
      const napsaDeduction = toNumberValue(formValues.napsaDeduction);
      const nhimaDeduction = toNumberValue(formValues.nhimaDeduction);
      const taxDeduction = toNumberValue(formValues.taxDeduction);
      const otherDeduction = toNumberValue(formValues.otherDeduction);
      const totalDeductions =
        napsaDeduction + nhimaDeduction + taxDeduction + otherDeduction + totalAttendancePenalty;
      const netPayable = grossPay - totalDeductions;
      computedPayrollValues = {
        grossPay: grossPay ? grossPay.toFixed(2) : '',
        totalAttendancePenalty: totalAttendancePenalty ? totalAttendancePenalty.toFixed(2) : '',
        totalDeductions: totalDeductions ? totalDeductions.toFixed(2) : '',
        netPayable: netPayable ? netPayable.toFixed(2) : '',
      };
    }
    if (activeModuleId === 'leave-management') {
      if (!selectedLeaveFormEmployee) {
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
      setModuleRowsState((prev) => ({
        ...prev,
        'leave-management':
          editRowId === 'new'
            ? [requestPayload, ...(prev['leave-management'] || [])]
            : (prev['leave-management'] || []).map((row) => (row.id === editRowId ? requestPayload : row)),
      }));
      setLeaveActionMessage(
        editRowId === 'new'
          ? 'Leave request submitted to department approval.'
          : 'Leave request updated successfully.'
      );
      showToast(
        editRowId === 'new'
          ? `Leave request submitted for ${selectedLeaveFormEmployee.fullName}.`
          : 'Leave request updated successfully.',
        'success'
      );
      setSelectedRowId(rowId);
      closeModal();
      return;
    }

    const payload = activeModuleConfig.formFields.reduce(
      (acc, field) => ({
        ...acc,
        [field.key]:
          computedPayrollValues[field.key] !== undefined
            ? computedPayrollValues[field.key]
            : formValues[field.key] || '',
      }),
      {}
    );
    const employeeImagePreviewsPayload =
      activeModuleId === 'employee-management'
        ? employeeImageFields.reduce(
            (acc, key) => ({
              ...acc,
              [`${key}Preview`]: formValues[`${key}Preview`] || '',
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
                : [],
            }),
            {}
          )
        : {};
    const moduleIdPrefix = activeModuleId.slice(0, 3).toUpperCase();
    const fallbackId = `${moduleIdPrefix}-${Math.floor(Math.random() * 900 + 100)}`;
    let employeeGeneratedId = '';

    if (activeModuleId === 'employee-management' && editRowId === 'new') {
      const prefix = getDepartmentPrefix(payload.department, appSettings.departments);
      const currentEmployeeRows = moduleRowsState['employee-management'] || [];
      const highestSequenceForDepartment = currentEmployeeRows
        .filter((row) => row.department === payload.department)
        .reduce((acc, row) => {
        const match = String(row.id || '').match(/(\d{8})$/);
        if (!match) {
          return acc;
        }
        return Math.max(acc, Number(match[1]));
      }, 0);
      employeeGeneratedId = `${prefix}${String(highestSequenceForDepartment + 1).padStart(8, '0')}`;
    }

    const rowWithId = {
      ...payload,
      ...employeeImagePreviewsPayload,
      ...employeeFilesPayload,
      id:
        editRowId === 'new'
          ? activeModuleId === 'employee-management'
            ? employeeGeneratedId
            : formValues.id || fallbackId
          : formValues.id || editRowId,
    };

    setModuleRowsState((prev) => {
      if (editRowId === 'new') {
        return {
          ...prev,
          [activeModuleId]: [rowWithId, ...prev[activeModuleId]],
        };
      }
      return {
        ...prev,
        [activeModuleId]: prev[activeModuleId].map((row) => (row.id === editRowId ? rowWithId : row)),
      };
    });
    setSelectedRowId(rowWithId.id);
    closeModal();
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

  return (
    <div className="App">
      <aside className="sidebar-shell" style={sidebarStyle}>
        <div className="brand-block">
          <div className="brand-logo">{appInitial}</div>
          <div>
            <h1>{appSettings.appName || 'PTHR'}</h1>
            <p>HR Command Center</p>
          </div>
        </div>
        {sidebarSections.map((section) => (
          <div className="sidebar-section" key={section.title}>
            <h2>{section.title}</h2>
            <nav>
              {section.items.map((item) => {
                if (item.id === 'leave-management') {
                  return (
                    <div key={item.id} className="menu-group">
                      <button
                        type="button"
                        className={`menu-item ${activeModuleId === item.id ? 'active' : ''}`}
                        onClick={() => {
                          if (activeModuleId !== 'leave-management') {
                            handleModuleChange('leave-management');
                            setLeaveMenuExpanded(true);
                            return;
                          }
                          setLeaveMenuExpanded((prev) => !prev);
                        }}
                      >
                        <span>{item.label}</span>
                        <span className={`menu-arrow ${leaveMenuExpanded ? 'open' : ''}`}>▾</span>
                      </button>
                      {leaveMenuExpanded ? (
                        <div className="menu-subitems">
                          {leaveSubmenuItems.map((submenu) => (
                            <button
                              key={submenu.key}
                              type="button"
                              className={`menu-subitem ${
                                activeModuleId === 'leave-management' && leaveViewTab === submenu.key ? 'active' : ''
                              }`}
                              onClick={() => {
                                if (activeModuleId !== 'leave-management') {
                                  handleModuleChange('leave-management');
                                }
                                setLeaveMenuExpanded(true);
                                setLeaveViewTab(submenu.key);
                                if (submenu.key === 'requests') {
                                  setLeaveRequestPageTab('requests');
                                }
                              }}
                            >
                              {submenu.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`menu-item ${activeModuleId === item.id ? 'active' : ''}`}
                    onClick={() => handleModuleChange(item.id)}
                  >
                    <span>{item.label}</span>
                    {Array.isArray(item.children) && item.children.length > 0 ? <span className="menu-arrow">▾</span> : null}
                  </button>
                );
              })}
            </nav>
          </div>
        ))}
      </aside>

      <div className="app-shell">
        <header className="hero">
          <div>
            <h1>{appSettings.appName || 'PTHR'} HR Management Workspace</h1>
            <p>Complete UI implementation with CRUD actions, enterprise data tables, and smart filters.</p>
          </div>
          <div className="stats">
            <article className="stat-card">
              <span className="stat-value">{totalModules}</span>
              <span className="stat-label">Modules</span>
            </article>
            <article className="stat-card">
              <span className="stat-value">{totalRows}</span>
              <span className="stat-label">Data Rows</span>
            </article>
            <article className="stat-card">
              <span className="stat-value">{activeStatusCount}</span>
              <span className="stat-label">Active Records</span>
            </article>
          </div>
        </header>

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
                {settingsTab === 'general' ? (
                  <>
                    <label>
                      <span>Application Name</span>
                      <input
                        value={appSettings.appName}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            appName: event.target.value,
                          }))
                        }
                      />
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
                  </>
                ) : null}
                {settingsTab === 'attendance' ? (
                  <>
                    <label>
                      <span>Reporting Time</span>
                      <input
                        type="time"
                        value={appSettings.attendanceReportTime}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceReportTime: event.target.value || '08:00',
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Free Late Until</span>
                      <input
                        type="time"
                        value={appSettings.attendanceLateAfter}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceLateAfter: event.target.value || '08:15',
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Shift End Time</span>
                      <input
                        type="time"
                        value={appSettings.attendanceShiftEnd}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceShiftEnd: event.target.value || '17:00',
                          }))
                        }
                      />
                    </label>
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
                      <span>Deduction Mode</span>
                      <select
                        className="filter-select"
                        value={appSettings.attendanceCalculationMode}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceCalculationMode: event.target.value === 'fixed' ? 'fixed' : 'auto',
                          }))
                        }
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
                        disabled={appSettings.attendanceCalculationMode !== 'fixed'}
                        value={appSettings.attendanceFixedDeductionPerMinute}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceFixedDeductionPerMinute: Math.max(0, Number(event.target.value) || 0),
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Fixed Scope</span>
                      <select
                        className="filter-select"
                        disabled={appSettings.attendanceCalculationMode !== 'fixed'}
                        value={appSettings.attendanceFixedScope}
                        onChange={(event) =>
                          setAppSettings((prev) => ({
                            ...prev,
                            attendanceFixedScope: event.target.value,
                          }))
                        }
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
                          value={appSettings.attendanceFixedDepartment}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              attendanceFixedDepartment: event.target.value,
                            }))
                          }
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
                          value={appSettings.attendanceFixedEmployeeId}
                          onChange={(event) =>
                            setAppSettings((prev) => ({
                              ...prev,
                              attendanceFixedEmployeeId: event.target.value,
                            }))
                          }
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
          ) : (
            <section className="panel table-panel">
              <div className="panel-title-row">
                <div>
                  <h2>{activeModuleConfig.title}</h2>
                  <p>{activeModuleConfig.entityLabel} registry and operations table</p>
                </div>
                {activeModuleId !== 'attendance-time' ? (
                  <button type="button" className="primary-btn" onClick={startCreate}>
                    + Add {activeModuleConfig.entityLabel}
                  </button>
                ) : null}
              </div>
              {activeModuleId === 'attendance-time' ? (
                <div className="attendance-ops-card">
                  <div className="attendance-ops-head">
                    <h4>Attendance</h4>
                    <span>
                      Report {appSettings.attendanceReportTime} • Grace until {appSettings.attendanceLateAfter}
                    </span>
                  </div>
                  <div className="attendance-subtabs">
                    <button
                      type="button"
                      className={`settings-tab-btn ${attendanceViewTab === 'clock' ? 'active' : ''}`}
                      onClick={() => setAttendanceViewTab('clock')}
                    >
                      Clock
                    </button>
                    <button
                      type="button"
                      className={`settings-tab-btn ${attendanceViewTab === 'compliance' ? 'active' : ''}`}
                      onClick={() => setAttendanceViewTab('compliance')}
                    >
                      Daily Compliance
                    </button>
                    <button
                      type="button"
                      className={`settings-tab-btn ${attendanceViewTab === 'penalties' ? 'active' : ''}`}
                      onClick={() => setAttendanceViewTab('penalties')}
                    >
                      Penalty Clearance
                    </button>
                    <button
                      type="button"
                      className={`settings-tab-btn ${attendanceViewTab === 'performance' ? 'active' : ''}`}
                      onClick={() => setAttendanceViewTab('performance')}
                    >
                      Performance
                    </button>
                  </div>
                  {attendanceViewTab === 'clock' ? (
                    <>
                      <div className="attendance-ops-form">
                        <label>
                          <span>Search Employee (Name or ID)</span>
                          <input
                            placeholder="Type employee name or ID"
                            value={attendanceSearchText}
                            onChange={(event) => {
                              const query = event.target.value;
                              const normalizedQuery = query.trim().toLowerCase();
                              const matchedEmployee = normalizedQuery
                                ? employeeBaseRows.find((employee) => {
                                    const employeeId = String(employee.id || '').toLowerCase();
                                    const employeeName = String(employee.fullName || '').toLowerCase();
                                    return employeeId.includes(normalizedQuery) || employeeName.includes(normalizedQuery);
                                  }) || null
                                : null;
                              setAttendanceSearchText(query);
                              setAttendanceClockDraft((prev) => ({
                                ...prev,
                                employeeId: matchedEmployee?.id || '',
                              }));
                            }}
                          />
                          {attendanceSearchText.trim() ? (
                            <div className="attendance-search-dropdown">
                              {attendanceSearchMatches.length > 0 ? (
                                attendanceSearchMatches.map((employee) => (
                                  <button
                                    key={employee.id}
                                    type="button"
                                    className="attendance-search-item"
                                    onClick={() => {
                                      setAttendanceClockDraft((prev) => ({
                                        ...prev,
                                        employeeId: employee.id,
                                      }));
                                      setAttendanceSearchText('');
                                    }}
                                  >
                                    {employee.fullName} ({employee.id})
                                  </button>
                                ))
                              ) : (
                                <span className="attendance-search-empty">No matching employee</span>
                              )}
                            </div>
                          ) : null}
                          <span className="field-title">
                            {selectedAttendanceEmployee
                              ? `Selected: ${selectedAttendanceEmployee.fullName} (${selectedAttendanceEmployee.id})`
                              : 'No matching employee selected'}
                          </span>
                        </label>
                        <label>
                          <span>Shift</span>
                          <select
                            className="filter-select"
                            value={attendanceClockDraft.shift}
                            onChange={(event) =>
                              setAttendanceClockDraft((prev) => ({
                                ...prev,
                                shift: event.target.value,
                              }))
                            }
                          >
                            <option value="Morning">Morning</option>
                            <option value="Evening">Evening</option>
                            <option value="Night">Night</option>
                            <option value="Remote">Remote</option>
                          </select>
                        </label>
                        <label>
                          <span>Punch Time</span>
                          <input value={getCurrentClockValue()} readOnly />
                        </label>
                        <div className="attendance-ops-actions">
                          <button type="button" className="primary-btn" onClick={handleClockIn}>
                            Clock In
                          </button>
                          <button type="button" className="neutral-btn" onClick={handleClockOut}>
                            Clock Out
                          </button>
                        </div>
                      </div>
                      <div className="attendance-stats-grid">
                        <article className="attendance-stat">
                          <strong>{attendanceTodayRows.length}</strong>
                          <span>Today Logs</span>
                        </article>
                        <article className="attendance-stat">
                          <strong>{attendanceLateCount}</strong>
                          <span>Late Today</span>
                        </article>
                        <article className="attendance-stat">
                          <strong>{Math.max(0, attendanceTodayRows.length - attendanceLateCount)}</strong>
                          <span>On Time Today</span>
                        </article>
                        <article className="attendance-stat">
                          <strong>
                            {attendanceTodayRows
                              .reduce((total, row) => total + (Number(row.deductionAmount) || 0), 0)
                              .toFixed(2)}
                          </strong>
                          <span>Late Deduction Today</span>
                        </article>
                      </div>
                      <div className="attendance-export-actions">
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() =>
                            downloadCsv(
                              `attendance-clock-${todayIsoDate}.csv`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'date', label: 'Date' },
                                { key: 'shift', label: 'Shift' },
                                { key: 'checkIn', label: 'Check In' },
                                { key: 'checkOut', label: 'Check Out' },
                                { key: 'lateMinutes', label: 'Late Minutes' },
                                { key: 'deductionAmount', label: 'Deduction Amount' },
                                { key: 'status', label: 'Status' },
                              ],
                              attendanceTodayRows
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
                              `Attendance Clock - ${todayIsoDate}`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'date', label: 'Date' },
                                { key: 'shift', label: 'Shift' },
                                { key: 'checkIn', label: 'Check In' },
                                { key: 'checkOut', label: 'Check Out' },
                                { key: 'lateMinutes', label: 'Late Minutes' },
                                { key: 'deductionAmount', label: 'Deduction Amount' },
                                { key: 'status', label: 'Status' },
                              ],
                              attendanceTodayRows
                            )
                          }
                        >
                          Export PDF
                        </button>
                      </div>
                      <div className="attendance-log-list">
                        {attendanceTodayRows.length > 0 ? (
                          attendanceTodayRows.map((attendanceRow) => (
                            <div className="attendance-log-row" key={attendanceRow.id}>
                              <div>
                                <p>{attendanceRow.employee}</p>
                                <span>
                                  {attendanceRow.checkIn || '—'} → {attendanceRow.checkOut || '—'} •{' '}
                                  {attendanceRow.shift || 'Shift'}
                                </span>
                              </div>
                              <div className="attendance-log-badges">
                                <strong className={String(attendanceRow.status).toLowerCase() === 'late' ? 'danger-text' : ''}>
                                  {attendanceRow.status || 'Incomplete'}
                                </strong>
                                <span>{attendanceRow.lateMinutes || '0'} min late</span>
                                <span>Deduction: {attendanceRow.deductionAmount || '0.00'}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="employee-ops-empty">No attendance logged today.</p>
                        )}
                      </div>
                    </>
                  ) : null}
                  {attendanceViewTab === 'compliance' ? (
                    <div className="attendance-audit-wrap">
                      <div className="attendance-audit-filters">
                        <label>
                          <span>Date</span>
                          <input
                            type="date"
                            value={attendanceAuditDate}
                            onChange={(event) => setAttendanceAuditDate(event.target.value || getTodayIsoDate())}
                          />
                        </label>
                        <label>
                          <span>Status Filter</span>
                          <select
                            className="filter-select"
                            value={attendanceAuditFilter}
                            onChange={(event) => setAttendanceAuditFilter(event.target.value)}
                          >
                            {['All', 'On Time', 'Late', 'Clocked In Once', 'Absent', 'Left Early', 'On Leave', 'Off Duty'].map(
                              (option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              )
                            )}
                          </select>
                        </label>
                        <label>
                          <span>Search</span>
                          <input
                            placeholder="Name, ID, or department"
                            value={attendanceAuditSearchText}
                            onChange={(event) => setAttendanceAuditSearchText(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="attendance-export-actions">
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() =>
                            downloadCsv(
                              `attendance-compliance-${attendanceAuditDate}.csv`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'department', label: 'Department' },
                                { key: 'date', label: 'Date' },
                                { key: 'checkIn', label: 'Check In' },
                                { key: 'checkOut', label: 'Check Out' },
                                { key: 'dailyStatus', label: 'Status' },
                                { key: 'penaltyTotal', label: 'Penalty' },
                              ],
                              attendanceComplianceFilteredRows.map((row) => ({
                                ...row,
                                penaltyTotal:
                                  row.penalties.length > 0
                                    ? row.penalties.map((penalty) => penalty.amount.toFixed(2)).join(' + ')
                                    : '0.00',
                              }))
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
                              `Attendance Compliance - ${attendanceAuditDate}`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'department', label: 'Department' },
                                { key: 'date', label: 'Date' },
                                { key: 'checkIn', label: 'Check In' },
                                { key: 'checkOut', label: 'Check Out' },
                                { key: 'dailyStatus', label: 'Status' },
                                { key: 'penaltyTotal', label: 'Penalty' },
                              ],
                              attendanceComplianceFilteredRows.map((row) => ({
                                ...row,
                                penaltyTotal:
                                  row.penalties.length > 0
                                    ? row.penalties.map((penalty) => penalty.amount.toFixed(2)).join(' + ')
                                    : '0.00',
                              }))
                            )
                          }
                        >
                          Export PDF
                        </button>
                      </div>
                      <div className="attendance-log-list">
                        {attendanceComplianceFilteredRows.length > 0 ? (
                          attendanceComplianceFilteredRows.map((row) => {
                            const key = `${row.employeeId}-${row.date}`;
                            const totalPenalty = row.penalties.reduce((total, penalty) => total + penalty.amount, 0);
                            return (
                              <button
                                key={key}
                                type="button"
                                className={`attendance-log-row action-row ${selectedComplianceKey === key ? 'selected-row' : ''}`}
                                onClick={() => {
                                  setSelectedComplianceKey(key);
                                  setAttendanceDetailModal({ type: 'compliance', key });
                                }}
                              >
                                <div>
                                  <p>
                                    {row.employee} ({row.employeeId})
                                  </p>
                                  <span>
                                    {row.department} • {row.date} • {row.checkIn || '—'} → {row.checkOut || '—'}
                                  </span>
                                </div>
                                <div className="attendance-log-badges">
                                  <strong>{row.dailyStatus}</strong>
                                  <span>Penalty: {totalPenalty.toFixed(2)}</span>
                                </div>
                              </button>
                            );
                          })
                        ) : (
                          <p className="employee-ops-empty">No compliance records for the selected filters.</p>
                        )}
                      </div>
                    </div>
                  ) : null}
                  {attendanceViewTab === 'penalties' ? (
                    <div className="attendance-audit-wrap">
                      <div className="attendance-audit-filters">
                        <label>
                          <span>Date</span>
                          <input
                            type="date"
                            value={attendanceAuditDate}
                            onChange={(event) => setAttendanceAuditDate(event.target.value || getTodayIsoDate())}
                          />
                        </label>
                        <label>
                          <span>Penalty Status</span>
                          <select
                            className="filter-select"
                            value={attendancePenaltyStatusFilter}
                            onChange={(event) => setAttendancePenaltyStatusFilter(event.target.value)}
                          >
                            <option value="Outstanding">Outstanding</option>
                            <option value="Cleared">Cleared</option>
                            <option value="All">All</option>
                          </select>
                        </label>
                        <label>
                          <span>Search</span>
                          <input
                            placeholder="Name, ID, or department"
                            value={attendanceAuditSearchText}
                            onChange={(event) => setAttendanceAuditSearchText(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="attendance-export-actions">
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() =>
                            downloadCsv(
                              `attendance-penalties-${attendanceAuditDate}.csv`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'penaltyLabel', label: 'Penalty' },
                                { key: 'baseAmount', label: 'Base' },
                                { key: 'clearedAmount', label: 'Cleared' },
                                { key: 'outstandingAmount', label: 'Outstanding' },
                              ],
                              attendancePenaltyFilteredRows.map((row) => ({
                                ...row,
                                baseAmount: row.baseAmount.toFixed(2),
                                clearedAmount: row.clearedAmount.toFixed(2),
                                outstandingAmount: row.outstandingAmount.toFixed(2),
                              }))
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
                              `Attendance Penalties - ${attendanceAuditDate}`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'penaltyLabel', label: 'Penalty' },
                                { key: 'baseAmount', label: 'Base' },
                                { key: 'clearedAmount', label: 'Cleared' },
                                { key: 'outstandingAmount', label: 'Outstanding' },
                              ],
                              attendancePenaltyFilteredRows.map((row) => ({
                                ...row,
                                baseAmount: row.baseAmount.toFixed(2),
                                clearedAmount: row.clearedAmount.toFixed(2),
                                outstandingAmount: row.outstandingAmount.toFixed(2),
                              }))
                            )
                          }
                        >
                          Export PDF
                        </button>
                      </div>
                      <div className="attendance-log-list">
                        {attendancePenaltyFilteredRows.length > 0 ? (
                          attendancePenaltyFilteredRows.map((row) => (
                            <button
                              key={row.key}
                              type="button"
                              className={`attendance-log-row action-row ${selectedPenaltyKey === row.key ? 'selected-row' : ''}`}
                              onClick={() => {
                                setSelectedPenaltyKey(row.key);
                                setAttendanceDetailModal({ type: 'penalties', key: row.key });
                              }}
                            >
                              <div>
                                <p>
                                  {row.employee} ({row.employeeId})
                                </p>
                                <span>{row.penaltyLabel}</span>
                              </div>
                              <div className="attendance-log-badges">
                                <span>Base: {row.baseAmount.toFixed(2)}</span>
                                <span>Cleared: {row.clearedAmount.toFixed(2)}</span>
                                <strong>Outstanding: {row.outstandingAmount.toFixed(2)}</strong>
                              </div>
                            </button>
                          ))
                        ) : (
                          <p className="employee-ops-empty">No penalty rows for the selected filters.</p>
                        )}
                      </div>
                      {selectedPenaltyRow ? (
                        <div className="penalty-action-card">
                          <strong>
                            {selectedPenaltyRow.employee} • {selectedPenaltyRow.penaltyLabel}
                          </strong>
                          <span>Outstanding: {selectedPenaltyRow.outstandingAmount.toFixed(2)}</span>
                          <div className="attendance-audit-filters">
                            <label>
                              <span>Clearance Mode</span>
                              <select
                                className="filter-select"
                                value={penaltyActionDraft.mode}
                                onChange={(event) =>
                                  setPenaltyActionDraft((prev) => ({
                                    ...prev,
                                    mode: event.target.value === 'full' ? 'full' : 'partial',
                                  }))
                                }
                              >
                                <option value="partial">Partial</option>
                                <option value="full">Full</option>
                              </select>
                            </label>
                            <label>
                              <span>Clearance Amount</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                disabled={penaltyActionDraft.mode === 'full'}
                                value={penaltyActionDraft.amount}
                                onChange={(event) =>
                                  setPenaltyActionDraft((prev) => ({
                                    ...prev,
                                    amount: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label>
                              <span>Remark</span>
                              <input
                                placeholder="Reason for clearance"
                                value={penaltyActionDraft.remark}
                                onChange={(event) =>
                                  setPenaltyActionDraft((prev) => ({
                                    ...prev,
                                    remark: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          </div>
                          <button type="button" className="primary-btn" onClick={handlePenaltyActionSave}>
                            Save Clearance Action
                          </button>
                          <div className="attendance-log-list">
                            {selectedPenaltyRow.adjustments.length > 0 ? (
                              selectedPenaltyRow.adjustments.map((row) => (
                                <div key={row.id} className="attendance-log-row">
                                  <div>
                                    <p>{row.clearanceMode === 'full' ? 'Full Clearance' : 'Partial Clearance'}</p>
                                    <span>
                                      By {row.actorUsername} • {row.actedOn}
                                    </span>
                                  </div>
                                  <div className="attendance-log-badges">
                                    <strong>{toNumberValue(row.clearedAmount).toFixed(2)}</strong>
                                    <span>{row.remark}</span>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="employee-ops-empty">No clearance actions yet.</p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {attendanceViewTab === 'performance' ? (
                    <div className="attendance-audit-wrap">
                      <div className="attendance-audit-filters">
                        <label>
                          <span>Period</span>
                          <select
                            className="filter-select"
                            value={attendancePerformancePeriod}
                            onChange={(event) => setAttendancePerformancePeriod(event.target.value)}
                          >
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="yearly">Yearly</option>
                            <option value="custom">Custom Range</option>
                          </select>
                        </label>
                        {attendancePerformancePeriod === 'custom' ? (
                          <>
                            <label>
                              <span>Start Date</span>
                              <input
                                type="date"
                                value={attendancePerformanceStartDate}
                                onChange={(event) => setAttendancePerformanceStartDate(event.target.value)}
                              />
                            </label>
                            <label>
                              <span>End Date</span>
                              <input
                                type="date"
                                value={attendancePerformanceEndDate}
                                onChange={(event) => setAttendancePerformanceEndDate(event.target.value)}
                              />
                            </label>
                          </>
                        ) : null}
                        <label>
                          <span>Ranking Filter</span>
                          <select
                            className="filter-select"
                            value={attendancePerformanceRankMetric}
                            onChange={(event) => setAttendancePerformanceRankMetric(event.target.value)}
                          >
                            <option value="perfect-attendance">Perfect Attendance Rank</option>
                            <option value="least-leave-applications">Least Leave Applications</option>
                            <option value="most-leave-applications">Most Leave Applications</option>
                            <option value="least-absent">Least Absent</option>
                            <option value="most-absent">Most Absent</option>
                            <option value="least-late">Least Late</option>
                            <option value="most-late">Most Late</option>
                          </select>
                        </label>
                        <label>
                          <span>Department</span>
                          <select
                            className="filter-select"
                            value={attendancePerformanceDepartmentFilter}
                            onChange={(event) => setAttendancePerformanceDepartmentFilter(event.target.value)}
                          >
                            {attendancePerformanceDepartmentOptions.map((departmentOption) => (
                              <option key={departmentOption} value={departmentOption}>
                                {departmentOption}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Search</span>
                          <input
                            placeholder="Name, ID, or department"
                            value={attendancePerformanceSearchText}
                            onChange={(event) => setAttendancePerformanceSearchText(event.target.value)}
                          />
                        </label>
                      </div>
                      <div className="attendance-stats-grid">
                        <article className="attendance-stat">
                          <strong>{attendancePerformanceRange.startDate}</strong>
                          <span>Period Start</span>
                        </article>
                        <article className="attendance-stat">
                          <strong>{attendancePerformanceRange.endDate}</strong>
                          <span>Period End</span>
                        </article>
                        <article className="attendance-stat">
                          <strong>{attendancePerformanceRows.filter((row) => row.perfectAttendance).length}</strong>
                          <span>Perfect Attendance</span>
                        </article>
                        <article className="attendance-stat">
                          <strong>{attendancePerformanceRows.length}</strong>
                          <span>Employees Ranked</span>
                        </article>
                      </div>
                      <div className="attendance-export-actions">
                        <button
                          type="button"
                          className="neutral-btn"
                          onClick={() =>
                            downloadCsv(
                              `attendance-performance-${attendancePerformanceRange.startDate}-${attendancePerformanceRange.endDate}.csv`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'department', label: 'Department' },
                                { key: 'expectedWorkDays', label: 'Expected Days' },
                                { key: 'onTimeCompleteDays', label: 'On Time Days' },
                                { key: 'lateDays', label: 'Late Days' },
                                { key: 'absentDays', label: 'Absent Days' },
                                { key: 'leaveApplications', label: 'Leave Applications' },
                                { key: 'leaveDays', label: 'Leave Days' },
                                { key: 'attendanceScore', label: 'Score (%)' },
                                { key: 'perfectAttendance', label: 'Perfect Attendance' },
                              ],
                              attendancePerformanceRows.map((row) => ({
                                ...row,
                                attendanceScore: row.attendanceScore.toFixed(2),
                                perfectAttendance: row.perfectAttendance ? 'Yes' : 'No',
                              }))
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
                              `Attendance Performance ${attendancePerformanceRange.startDate} to ${attendancePerformanceRange.endDate}`,
                              [
                                { key: 'employee', label: 'Employee' },
                                { key: 'employeeId', label: 'Employee ID' },
                                { key: 'department', label: 'Department' },
                                { key: 'expectedWorkDays', label: 'Expected Days' },
                                { key: 'onTimeCompleteDays', label: 'On Time Days' },
                                { key: 'lateDays', label: 'Late Days' },
                                { key: 'absentDays', label: 'Absent Days' },
                                { key: 'leaveApplications', label: 'Leave Applications' },
                                { key: 'leaveDays', label: 'Leave Days' },
                                { key: 'attendanceScore', label: 'Score (%)' },
                                { key: 'perfectAttendance', label: 'Perfect Attendance' },
                              ],
                              attendancePerformanceRows.map((row) => ({
                                ...row,
                                attendanceScore: row.attendanceScore.toFixed(2),
                                perfectAttendance: row.perfectAttendance ? 'Yes' : 'No',
                              }))
                            )
                          }
                        >
                          Export PDF
                        </button>
                      </div>
                      <div className="attendance-audit-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Rank</th>
                              <th>Employee</th>
                              <th>Department</th>
                              <th>On Time</th>
                              <th>Absent</th>
                              <th>Late</th>
                              <th>Leave Apps</th>
                              <th>Perfect</th>
                              <th>Score</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attendancePerformanceRows.length > 0 ? (
                              attendancePerformanceRows.map((row, index) => (
                                <tr
                                  key={row.employeeId}
                                  className={selectedPerformanceEmployeeId === row.employeeId ? 'selected-row' : ''}
                                  onClick={() => {
                                    setSelectedPerformanceEmployeeId(row.employeeId);
                                    setAttendanceDetailModal({ type: 'performance', key: row.employeeId });
                                  }}
                                >
                                  <td>{index + 1}</td>
                                  <td>
                                    {row.employee} ({row.employeeId})
                                  </td>
                                  <td>{row.department}</td>
                                  <td>
                                    {row.onTimeCompleteDays}/{row.expectedWorkDays}
                                  </td>
                                  <td>{row.absentDays}</td>
                                  <td>{row.lateDays}</td>
                                  <td>{row.leaveApplications}</td>
                                  <td>{row.perfectAttendance ? 'Yes' : 'No'}</td>
                                  <td>{row.attendanceScore.toFixed(1)}%</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={9}>No performance records for the selected filters.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {activeModuleId === 'leave-management' ? (
                <div className="attendance-ops-card">
                  <div className="attendance-ops-head">
                    <h4>Leave System</h4>
                    <span>Request list • Department approval • HR approval • Manager approval</span>
                  </div>
                  <div className="attendance-audit-filters">
                    <label>
                      <span>Department</span>
                      <select
                        className="filter-select"
                        value={leaveDepartmentFilter}
                        onChange={(event) => setLeaveDepartmentFilter(event.target.value)}
                      >
                        {leaveDepartmentOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Status</span>
                      <select
                        className="filter-select"
                        value={leaveStatusFilter}
                        onChange={(event) => setLeaveStatusFilter(event.target.value)}
                      >
                        {leaveStatusOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Sort</span>
                      <select className="filter-select" value={leaveSortBy} onChange={(event) => setLeaveSortBy(event.target.value)}>
                        <option value="date-desc">Date (Newest)</option>
                        <option value="date-asc">Date (Oldest)</option>
                        <option value="employee-asc">Employee (A-Z)</option>
                        <option value="employee-desc">Employee (Z-A)</option>
                        <option value="days-desc">Days (High-Low)</option>
                        <option value="days-asc">Days (Low-High)</option>
                      </select>
                    </label>
                    <label>
                      <span>Search</span>
                      <input
                        placeholder="Name, ID, type, department"
                        value={leaveSearchText}
                        onChange={(event) => setLeaveSearchText(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="attendance-stats-grid">
                    <article className="attendance-stat">
                      <strong>{leaveRequestFilteredRows.length}</strong>
                      <span>Total Requests</span>
                    </article>
                    <article className="attendance-stat">
                      <strong>
                        {leaveRequestFilteredRows.filter((row) =>
                          String(getLeaveViewStatus(row)).toLowerCase().includes('pending')
                        ).length}
                      </strong>
                      <span>Pending Requests</span>
                    </article>
                    <article className="attendance-stat">
                      <strong>{leaveRequestFilteredRows.filter((row) => String(getLeaveViewStatus(row)) === 'Approved').length}</strong>
                      <span>Approved Requests</span>
                    </article>
                    <article className="attendance-stat">
                      <strong>{leaveRequestFilteredRows.filter((row) => String(getLeaveViewStatus(row)) === 'Rejected').length}</strong>
                      <span>Rejected Requests</span>
                    </article>
                  </div>
                  {leaveActionMessage ? <p className="field-title">{leaveActionMessage}</p> : null}
                  {leaveViewTab === 'requests' ? (
                    <div className="settings-tab-strip leave-request-page-tabs">
                      <button
                        type="button"
                        className={`settings-tab-btn ${leaveRequestPageTab === 'requests' ? 'active' : ''}`}
                        onClick={() => setLeaveRequestPageTab('requests')}
                      >
                        Request List
                      </button>
                      <button
                        type="button"
                        className={`settings-tab-btn ${leaveRequestPageTab === 'balances' ? 'active' : ''}`}
                        onClick={() => setLeaveRequestPageTab('balances')}
                      >
                        Leave Balance
                      </button>
                    </div>
                  ) : null}
                  <div className="attendance-audit-wrap">
                    {leaveViewTab !== 'requests' || leaveRequestPageTab === 'requests' ? (
                      <div className="attendance-audit-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Request</th>
                              <th>Employee</th>
                              <th>Dates</th>
                              <th>Days</th>
                              <th>Type</th>
                              <th>Department</th>
                              <th>HR</th>
                              <th>Manager</th>
                              <th>Approval Trail</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaveRequestFilteredRows.length > 0 ? (
                              leaveRequestFilteredRows.map((row) => {
                                return (
                                  <tr
                                    key={row.id}
                                    className={selectedRowId === row.id ? 'selected-row' : ''}
                                    onClick={() => openDetails(row.id)}
                                  >
                                    <td>{row.id}</td>
                                    <td>
                                      {row.employee} ({row.employeeId})
                                    </td>
                                    <td>
                                      {row.startDate} → {row.endDate}
                                    </td>
                                    <td>{row.daysRequested}</td>
                                    <td>{row.type}</td>
                                    <td>
                                      <span className={`approval-stage-badge ${getApprovalBadgeClass(row.departmentApproval)}`}>
                                        {row.departmentApproval}
                                      </span>
                                    </td>
                                    <td>
                                      <span className={`approval-stage-badge ${getApprovalBadgeClass(row.hrApproval)}`}>
                                        {row.hrApproval}
                                      </span>
                                    </td>
                                    <td>
                                      <span className={`approval-stage-badge ${getApprovalBadgeClass(row.managerApproval)}`}>
                                        {row.managerApproval}
                                      </span>
                                    </td>
                                    <td>
                                      {[
                                        row.departmentApprover
                                          ? `Department: ${row.departmentApprover} (${row.departmentComment || 'No comment'})`
                                          : '',
                                        row.hrApprover ? `HR: ${row.hrApprover} (${row.hrComment || 'No comment'})` : '',
                                        row.managerApprover
                                          ? `Manager: ${row.managerApprover} (${row.managerComment || 'No comment'})`
                                          : '',
                                      ]
                                        .filter(Boolean)
                                        .join(' | ') || 'No approvals yet'}
                                    </td>
                                    <td>
                                      <span className={`approval-stage-badge ${getApprovalBadgeClass(getLeaveViewStatus(row))}`}>
                                        {getLeaveViewStatus(row)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={10}>No leave requests for the selected filters.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {leaveViewTab === 'requests' && leaveRequestPageTab === 'balances' ? (
                      <div className="attendance-audit-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Employee</th>
                              <th>Department</th>
                              <th>Contract End</th>
                              <th>Opening Balance</th>
                              <th>Approved Days</th>
                              <th>Pending Days</th>
                              <th>Available Balance</th>
                              <th>Daily Basic Pay</th>
                              <th>Unused Leave Days</th>
                              <th>Leave Payout</th>
                              <th>Payout Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaveBalanceFilteredRows.length > 0 ? (
                              leaveBalanceFilteredRows.map((row) => (
                                <tr key={row.employeeId}>
                                  <td>
                                    {row.employee} ({row.employeeId})
                                  </td>
                                  <td>{row.department}</td>
                                  <td>{row.contractEndDate}</td>
                                  <td>{row.openingBalance.toFixed(1)}</td>
                                  <td>{row.approvedDays.toFixed(1)}</td>
                                  <td>{row.pendingDays.toFixed(1)}</td>
                                  <td>{row.availableBalance.toFixed(1)}</td>
                                  <td>
                                    {appSettings.defaultCurrency} {row.dailyBasicPay.toFixed(2)}
                                  </td>
                                  <td>{row.unusedLeaveDays.toFixed(1)}</td>
                                  <td>
                                    {appSettings.defaultCurrency} {row.leavePayoutAmount.toFixed(2)}
                                  </td>
                                  <td>{row.payoutStatus}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={11}>No leave balance rows for the selected filters.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {activeModuleId === 'fingerprint' ? (
                <div className="fingerprint-ops-card">
                  <div className="attendance-ops-head">
                    <h4>Fingerprint Enrollment Console</h4>
                    <span>{fingerprintConnectionState}</span>
                  </div>
                  <div className="attendance-ops-form">
                    <label>
                      <span>Employee</span>
                      <select
                        className="filter-select"
                        value={fingerprintDraft.employeeId}
                        onChange={(event) =>
                          setFingerprintDraft((prev) => ({
                            ...prev,
                            employeeId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select employee</option>
                        {employeeBaseRows.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.fullName} ({employee.id})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Device User ID</span>
                      <input
                        placeholder="e.g. BIO-3042"
                        value={fingerprintDraft.deviceUserId}
                        onChange={(event) =>
                          setFingerprintDraft((prev) => ({
                            ...prev,
                            deviceUserId: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="attendance-ops-actions">
                      <button type="button" className="primary-btn" onClick={handleEnrollFingerprint}>
                        Enroll Employee
                      </button>
                      <button type="button" className="neutral-btn" onClick={handleQueueFingerprintSync}>
                        Queue Device Sync
                      </button>
                    </div>
                  </div>
                  <div className="fingerprint-meta-grid">
                    <article className="attendance-stat">
                      <strong>{fingerprintRows.length}</strong>
                      <span>Total Enrolled</span>
                    </article>
                    <article className="attendance-stat">
                      <strong>{appSettings.fingerprintIntegration.mode}</strong>
                      <span>Integration Mode</span>
                    </article>
                    <article className="attendance-stat">
                      <strong>{appSettings.fingerprintIntegration.apiVersion}</strong>
                      <span>API Version</span>
                    </article>
                  </div>
                  <p className="fingerprint-hint">
                    Current endpoint: {appSettings.fingerprintIntegration.gatewayUrl || 'Not set'} • Heartbeat every{' '}
                    {appSettings.fingerprintIntegration.heartbeatSeconds}s
                    {selectedFingerprintEmployee ? ` • Employee: ${selectedFingerprintEmployee.fullName}` : ''}
                  </p>
                </div>
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
                                  handleDelete(row.id);
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
                    <button type="button" className="primary-btn" onClick={handleSave}>
                      Save
                    </button>
                    <button type="button" className="neutral-btn" onClick={closeModal}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {activeModuleId === 'payroll-management' ? (
                    <>
                      <div className="form-grid">
                        <label>
                          <span>Employee Search *</span>
                          <input
                            value={formValues.payrollEmployeeSearch || ''}
                            placeholder="Search by name or ID"
                            onChange={(event) =>
                              setFormValues((prev) => ({
                                ...prev,
                                payrollEmployeeSearch: event.target.value,
                              }))
                            }
                          />
                        </label>
                        {payrollFormEmployeeMatches.length > 0 ? (
                          <div className="row-actions">
                            {payrollFormEmployeeMatches.map((employee) => (
                              <button
                                key={employee.id}
                                type="button"
                                className="mini-btn"
                                onClick={() =>
                                  setFormValues((prev) => ({
                                    ...prev,
                                    payrollEmployeeSearch: `${employee.fullName} (${employee.id})`,
                                    employee: employee.fullName,
                                    employeeId: employee.id,
                                    taxId: employee.taxId || '',
                                    pensionId: employee.pensionId || '',
                                    nhimaNumber: employee.nhimaNumber || '',
                                    accessAccount: employee.accessAccount || '',
                                    mobileMoneyNumber: employee.mobileMoneyNumber || '',
                                    mobileMoneyNetwork: employee.mobileMoneyNetwork || '',
                                    bankName: employee.bankName || '',
                                    bankAccountName: employee.bankAccountName || '',
                                    bankAccountNumber: employee.bankAccountNumber || '',
                                    basicPay: employee.basicPay || '',
                                    monthlyBonuses: employee.monthlyBonuses || '',
                                    transportAllowance: employee.transportAllowance || '',
                                    housingAllowance: employee.housingAllowance || '',
                                    foodAllowance: employee.foodAllowance || '',
                                  }))
                                }
                              >
                                {employee.fullName} ({employee.id})
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    <div className="form-section-grid">
                      {payrollDetailSections
                        .map((section) => ({
                          id: section.id,
                          title: section.title,
                          fields: section.fields
                            .map((key) => payrollFormFieldMap[key])
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
                  </>
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
                  {formError ? <p className="form-error">{formError}</p> : null}
                  <div className="form-actions">
                    <button type="button" className="primary-btn" onClick={handleSave}>
                      Save
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
                    {activeModuleId === 'leave-management' && selectedLeaveDetailRow ? (
                      <div className="penalty-action-card">
                        <strong>Leave Approval Details</strong>
                        <span>
                          {selectedLeaveDetailRow.startDate} → {selectedLeaveDetailRow.endDate} •{' '}
                          {selectedLeaveDetailRow.daysRequested} day(s) • {selectedLeaveDetailRow.type}
                        </span>
                        <span>{selectedLeaveDetailRow.reason || 'No reason provided.'}</span>
                        <div className="details-badges">
                          <span
                            className={`approval-stage-badge ${getApprovalBadgeClass(
                              selectedLeaveDetailRow.departmentApproval
                            )}`}
                          >
                            Department: {selectedLeaveDetailRow.departmentApproval}
                          </span>
                          <span className={`approval-stage-badge ${getApprovalBadgeClass(selectedLeaveDetailRow.hrApproval)}`}>
                            HR: {selectedLeaveDetailRow.hrApproval}
                          </span>
                          <span
                            className={`approval-stage-badge ${getApprovalBadgeClass(selectedLeaveDetailRow.managerApproval)}`}
                          >
                            Manager: {selectedLeaveDetailRow.managerApproval}
                          </span>
                        </div>
                        <div className="details-grid-table">
                          <div className="detail-cell">
                            <span>Department Actor</span>
                            <strong>{selectedLeaveDetailRow.departmentApprover || '—'}</strong>
                          </div>
                          <div className="detail-cell">
                            <span>Department Comment</span>
                            <strong>{selectedLeaveDetailRow.departmentComment || '—'}</strong>
                          </div>
                          <div className="detail-cell">
                            <span>HR Actor</span>
                            <strong>{selectedLeaveDetailRow.hrApprover || '—'}</strong>
                          </div>
                          <div className="detail-cell">
                            <span>HR Comment</span>
                            <strong>{selectedLeaveDetailRow.hrComment || '—'}</strong>
                          </div>
                          <div className="detail-cell">
                            <span>Manager Actor</span>
                            <strong>{selectedLeaveDetailRow.managerApprover || '—'}</strong>
                          </div>
                          <div className="detail-cell">
                            <span>Manager Comment</span>
                            <strong>{selectedLeaveDetailRow.managerComment || '—'}</strong>
                          </div>
                        </div>
                        {leaveViewTab !== 'requests' ? (
                          <div className="attendance-ops-form">
                            <label>
                              <span>Actor</span>
                              <input
                                value={
                                  (leaveApprovalDrafts[selectedLeaveDetailRow.id] || {}).actorName ||
                                  appSettings.penaltyActorUsername ||
                                  ''
                                }
                                onChange={(event) =>
                                  setLeaveApprovalDrafts((prev) => ({
                                    ...prev,
                                    [selectedLeaveDetailRow.id]: {
                                      ...(prev[selectedLeaveDetailRow.id] || {}),
                                      actorName: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </label>
                            <label>
                              <span>Comment</span>
                              <input
                                value={(leaveApprovalDrafts[selectedLeaveDetailRow.id] || {}).comment || ''}
                                onChange={(event) =>
                                  setLeaveApprovalDrafts((prev) => ({
                                    ...prev,
                                    [selectedLeaveDetailRow.id]: {
                                      ...(prev[selectedLeaveDetailRow.id] || {}),
                                      comment: event.target.value,
                                    },
                                  }))
                                }
                              />
                            </label>
                            <div className="row-actions">
                              {leaveViewTab === 'department' ? (
                                <>
                                  <button
                                    type="button"
                                    className="mini-btn"
                                    disabled={String(selectedLeaveDetailRow.departmentApproval || '') !== 'Pending'}
                                    onClick={() => handleDepartmentLeaveDecision(selectedLeaveDetailRow.id, 'Approved')}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="mini-btn danger"
                                    disabled={String(selectedLeaveDetailRow.departmentApproval || '') !== 'Pending'}
                                    onClick={() => handleDepartmentLeaveDecision(selectedLeaveDetailRow.id, 'Rejected')}
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}
                              {leaveViewTab === 'hr' ? (
                                <>
                                  <button
                                    type="button"
                                    className="mini-btn"
                                    disabled={
                                      String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                                      String(selectedLeaveDetailRow.hrApproval || '') !== 'Pending'
                                    }
                                    onClick={() => handleHrLeaveDecision(selectedLeaveDetailRow.id, 'Approved')}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="mini-btn danger"
                                    disabled={
                                      String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                                      String(selectedLeaveDetailRow.hrApproval || '') !== 'Pending'
                                    }
                                    onClick={() => handleHrLeaveDecision(selectedLeaveDetailRow.id, 'Rejected')}
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}
                              {leaveViewTab === 'manager' ? (
                                <>
                                  <button
                                    type="button"
                                    className="mini-btn"
                                    disabled={
                                      String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                                      String(selectedLeaveDetailRow.hrApproval || '') !== 'Approved' ||
                                      String(selectedLeaveDetailRow.managerApproval || '') !== 'Pending'
                                    }
                                    onClick={() => handleManagerLeaveDecision(selectedLeaveDetailRow.id, 'Approved')}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="mini-btn danger"
                                    disabled={
                                      String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                                      String(selectedLeaveDetailRow.hrApproval || '') !== 'Approved' ||
                                      String(selectedLeaveDetailRow.managerApproval || '') !== 'Pending'
                                    }
                                    onClick={() => handleManagerLeaveDecision(selectedLeaveDetailRow.id, 'Rejected')}
                                  >
                                    Reject
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
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
                        : isPayrollModule
                          ? payrollDetailSections
                              .map((section) => ({
                                id: section.id,
                                title: section.title,
                                fields: section.fields
                                  .map((key) => payrollFormFieldMap[key])
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
