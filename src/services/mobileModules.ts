import { apiRequest } from './http';
import { AttendanceRecord, AuthSession, EmployeeProfile, LeaveRecord, LoanRecord, MobileSettings, TrackingSettings } from '../types/app';
import { captureCurrentLocation, requestForegroundLocationPermission, transmitLocation } from './tracking';

const defaultEmployeeModules = ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking'];

const defaultMobileSettings: MobileSettings = {
  enabledModules: defaultEmployeeModules,
  allowClockIn: true,
  allowClockOut: true,
  requireLocationOnClock: true,
  autoSendLocationOnClock: true,
  allowLoanView: true,
  allowLoanRequest: true,
  allowLeaveView: true,
  allowLeaveRequest: true,
  allowTrackingView: true,
};

const nowDate = () => new Date().toISOString().slice(0, 10);

const nowClock = () => {
  const current = new Date();
  return `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`;
};

const getMinutesFromClock = (value?: string) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(':').map((part) => Number(part));
  return hours * 60 + minutes;
};

const formatWorkedHours = (start?: string, end?: string) => {
  const startMinutes = getMinutesFromClock(start);
  const endMinutes = getMinutesFromClock(end);
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return '';
  }
  const totalMinutes = endMinutes - startMinutes;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const nowDateTime = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

const createRecordId = (prefix: string) => `${prefix}-${Date.now().toString().slice(-7)}`;

const toNumberValue = (value: string | number | undefined) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const getInclusiveDays = (startDate?: string, endDate?: string) => {
  if (!startDate || !endDate) {
    return 0;
  }
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diff = end.getTime() - start.getTime();
  if (Number.isNaN(diff)) {
    return 0;
  }
  return Math.floor(diff / 86400000) + 1;
};

const calculateDistanceMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const earthRadius = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const filterRowsForEmployee = <T extends { employeeId?: string; employee?: string }>(rows: T[], session: AuthSession) => {
  const employeeId = String(session.user.employeeId || '').trim();
  const fullName = String(session.user.fullName || '').trim();
  return rows.filter((row) => {
    const rowEmployeeId = String(row.employeeId || '').trim();
    const rowEmployeeName = String(row.employee || '').trim();
    return (employeeId && rowEmployeeId === employeeId) || (fullName && rowEmployeeName === fullName);
  });
};

export const fetchMobileSettings = async (apiBaseUrl: string) => {
  const response = await apiRequest<Partial<MobileSettings>>(apiBaseUrl, '/api/mobile/settings');
  return {
    ...defaultMobileSettings,
    ...(response || {}),
    enabledModules: Array.isArray(response?.enabledModules)
      ? response.enabledModules.map((value) => String(value || '').trim()).filter(Boolean)
      : defaultMobileSettings.enabledModules,
  };
};

export const fetchEmployeeProfile = async (apiBaseUrl: string, session: AuthSession) => {
  const response = await apiRequest<{ records?: EmployeeProfile[] }>(apiBaseUrl, '/api/modules/employee-management');
  const rows = Array.isArray(response.records) ? response.records : [];
  const employeeId = String(session.user.employeeId || '').trim();
  const fullName = String(session.user.fullName || '').trim();
  return (
    rows.find((row) => String(row.employeeId || row.id || '').trim() === employeeId) ||
    rows.find((row) => String(row.fullName || '').trim() === fullName) ||
    null
  );
};

export const getAvailableEmployeeModules = (session: AuthSession, settings: MobileSettings) => {
  const allowedModules =
    Array.isArray(session.user.allowedModules) && session.user.allowedModules.length > 0
      ? session.user.allowedModules
      : session.user.role === 'employee'
        ? defaultEmployeeModules
        : [];

  return allowedModules.filter((moduleId) => {
    if (!settings.enabledModules.includes(moduleId)) {
      return false;
    }
    if (moduleId === 'loan-records') {
      return settings.allowLoanView;
    }
    if (moduleId === 'leave-management') {
      return settings.allowLeaveView;
    }
    if (moduleId === 'monitoring-tracking') {
      return settings.allowTrackingView;
    }
    return true;
  });
};

export const fetchEmployeeAttendanceRows = async (apiBaseUrl: string, session: AuthSession) => {
  const response = await apiRequest<{ records?: AttendanceRecord[] }>(apiBaseUrl, '/api/modules/attendance-time');
  const rows = Array.isArray(response.records) ? response.records : [];
  return filterRowsForEmployee(rows, session).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
};

export const fetchEmployeeLoanRows = async (apiBaseUrl: string, session: AuthSession) => {
  const response = await apiRequest<{ records?: LoanRecord[] }>(apiBaseUrl, '/api/modules/loan-records');
  const rows = Array.isArray(response.records) ? response.records : [];
  return filterRowsForEmployee(rows, session).sort((a, b) => String(b.issuedOn || '').localeCompare(String(a.issuedOn || '')));
};

export const fetchEmployeeLeaveRows = async (apiBaseUrl: string, session: AuthSession) => {
  const response = await apiRequest<{ records?: LeaveRecord[] }>(apiBaseUrl, '/api/modules/leave-management');
  const rows = Array.isArray(response.records) ? response.records : [];
  return filterRowsForEmployee(rows, session).sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
};

type LoanRequestInput = {
  type: string;
  amount: string;
  interestPercent: string;
  tenorMonths: string;
};

type LeaveRequestInput = {
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
};

export const submitLoanRequest = async (
  apiBaseUrl: string,
  session: AuthSession,
  employeeProfile: EmployeeProfile | null,
  values: LoanRequestInput
) => {
  const principal = toNumberValue(values.amount);
  const interestPercent = toNumberValue(values.interestPercent);
  const tenorMonths = Math.max(1, toNumberValue(values.tenorMonths) || 1);
  if (!values.type.trim()) {
    throw new Error('Loan type is required');
  }
  if (principal <= 0) {
    throw new Error('Loan amount must be greater than zero');
  }

  const totalRepay = principal + principal * (interestPercent / 100) * tenorMonths;
  const monthlyInstallment = totalRepay / tenorMonths;

  const payload: LoanRecord & {
    interestPercent: string;
    tenorMonths: string;
    monthlyInstallment: string;
    overduePenaltyPercentPerDay: string;
    departmentApproval: string;
    hrApproval: string;
    managerApproval: string;
  } = {
    id: createRecordId('LON'),
    employee: session.user.fullName,
    employeeId: session.user.employeeId,
    department: employeeProfile?.department || 'Unassigned',
    type: values.type.trim(),
    amount: principal.toFixed(2),
    interestPercent: interestPercent ? interestPercent.toFixed(2) : '',
    tenorMonths: String(tenorMonths),
    monthlyInstallment: monthlyInstallment.toFixed(2),
    issuedOn: nowDate(),
    balance: principal.toFixed(2),
    overduePenaltyPercentPerDay: '0',
    departmentApproval: 'Pending',
    hrApproval: 'Pending',
    managerApproval: 'Pending',
    status: 'Pending Department',
  };

  const response = await apiRequest<{ record?: LoanRecord }>(apiBaseUrl, '/api/modules/loan-records', {
    method: 'POST',
    body: payload,
  });

  return (response.record || payload) as LoanRecord;
};

export const submitLeaveRequest = async (
  apiBaseUrl: string,
  session: AuthSession,
  employeeProfile: EmployeeProfile | null,
  values: LeaveRequestInput
) => {
  const reason = String(values.reason || '').trim();
  const daysRequested = getInclusiveDays(values.startDate, values.endDate);
  if (!String(values.type || '').trim()) {
    throw new Error('Leave type is required');
  }
  if (!reason) {
    throw new Error('Reason is required');
  }
  if (!values.startDate || !values.endDate || daysRequested <= 0) {
    throw new Error('Choose a valid leave start and end date');
  }
  if (values.startDate < nowDate()) {
    throw new Error('Past dates are not allowed for leave requests');
  }

  const payload: LeaveRecord & {
    requestedOn: string;
    departmentApproval: string;
    hrApproval: string;
    managerApproval: string;
  } = {
    id: createRecordId('LEV'),
    employee: session.user.fullName,
    employeeId: session.user.employeeId,
    department: employeeProfile?.department || 'Unassigned',
    type: values.type.trim(),
    startDate: values.startDate,
    endDate: values.endDate,
    daysRequested,
    reason,
    requestedOn: nowDateTime(),
    departmentApproval: 'Pending',
    hrApproval: 'Pending',
    managerApproval: 'Pending',
    status: 'Pending Department',
  };

  const response = await apiRequest<{ record?: LeaveRecord }>(apiBaseUrl, '/api/modules/leave-management', {
    method: 'POST',
    body: payload,
  });

  return (response.record || payload) as LeaveRecord;
};

type AttendanceMutationInput = {
  apiBaseUrl: string;
  session: AuthSession;
  settings: MobileSettings;
  trackingSettings: TrackingSettings | null;
  rows: AttendanceRecord[];
  mode: 'clock-in' | 'clock-out';
};

export const saveAttendanceClock = async ({ apiBaseUrl, session, settings, trackingSettings, rows, mode }: AttendanceMutationInput) => {
  await requestForegroundLocationPermission();

  let position = null;
  try {
    position = await captureCurrentLocation();
  } catch (error) {
    if (settings.requireLocationOnClock) {
      throw new Error('Location is required before clocking can continue');
    }
  }

  if (position?.mocked && trackingSettings?.antiGpsSpoofingEnabled) {
    throw new Error('Mock location detected. Attendance action has been blocked.');
  }

  if (
    position?.coords &&
    trackingSettings?.geofenceEnabled &&
    typeof trackingSettings.officeLat === 'number' &&
    typeof trackingSettings.officeLng === 'number'
  ) {
    const distanceFromOffice = calculateDistanceMeters(
      trackingSettings.officeLat,
      trackingSettings.officeLng,
      position.coords.latitude,
      position.coords.longitude
    );
    if (distanceFromOffice > Number(trackingSettings.geofenceRadiusMeters || 0)) {
      throw new Error(`You are outside the office geofence by ${Math.round(distanceFromOffice)} meters`);
    }
  }

  const today = nowDate();
  const clockValue = nowClock();
  const existingRow =
    rows.find((row) => String(row.date || '') === today && String(row.employeeId || '') === String(session.user.employeeId || '')) ||
    null;

  if (mode === 'clock-out' && !existingRow?.checkIn) {
    throw new Error('No clock-in record found for today');
  }

  const baseRecord: AttendanceRecord = existingRow || {
    id: `ATT-${Date.now()}`,
    employee: session.user.fullName,
    employeeId: session.user.employeeId,
    date: today,
    shift: 'Morning',
    source: 'Mobile App',
    status: 'On Time',
  };

  const payload: AttendanceRecord =
    mode === 'clock-in'
      ? {
          ...baseRecord,
          checkIn: clockValue,
          source: 'Mobile App',
          status: baseRecord.status || 'On Time',
          checkInLat: position?.coords.latitude,
          checkInLng: position?.coords.longitude,
          checkInAccuracy: position?.coords.accuracy ?? null,
        }
      : {
          ...baseRecord,
          checkOut: clockValue,
          workedHours: formatWorkedHours(baseRecord.checkIn, clockValue),
          checkOutLat: position?.coords.latitude,
          checkOutLng: position?.coords.longitude,
          checkOutAccuracy: position?.coords.accuracy ?? null,
        };

  const endpoint = existingRow
    ? `/api/modules/attendance-time/${encodeURIComponent(payload.id)}`
    : '/api/modules/attendance-time';
  const method = existingRow ? 'PUT' : 'POST';

  await apiRequest(apiBaseUrl, endpoint, {
    method,
    body: payload,
  });

  if (position?.coords && settings.autoSendLocationOnClock) {
    await transmitLocation({
      apiBaseUrl,
      session,
      location: position.coords,
      mocked: position.mocked,
      activity: mode,
    });
  }

  return payload;
};
