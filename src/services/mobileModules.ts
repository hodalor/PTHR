import { apiRequest } from './http';
import * as ImagePicker from 'expo-image-picker';
import {
  AttendanceClocking,
  AttendanceRecord,
  AuthSession,
  EmployeeProfile,
  LeaveRecord,
  LoanRecord,
  MobileSettings,
  TrackingSettings,
} from '../types/app';
import {
  captureCurrentLocation,
  requestForegroundLocationPermission,
  requestTrackingPermissions,
  startBackgroundTracking,
  transmitLocation,
} from './tracking';

const defaultEmployeeModules = ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking'];

const defaultMobileSettings: MobileSettings = {
  enabledModules: defaultEmployeeModules,
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
};

const nowDate = () => new Date().toISOString().slice(0, 10);
const runWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

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

const captureClockInPhoto = async () => {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera permission is required before mobile clock-in can continue');
  }

  const captureResult = await ImagePicker.launchCameraAsync({
    allowsEditing: false,
    base64: true,
    cameraType: ImagePicker.CameraType.front,
    mediaTypes: ['images'],
    quality: 0.35,
  });

  if (captureResult.canceled) {
    throw new Error('Clock-in photo capture was canceled');
  }

  const asset = captureResult.assets?.[0];
  if (!asset?.base64) {
    throw new Error('Unable to read the captured clock-in photo');
  }

  return `data:image/jpeg;base64,${asset.base64}`;
};

const normalizeClockings = (row?: AttendanceRecord | null): AttendanceClocking[] => {
  if (Array.isArray(row?.clockings) && row.clockings.length > 0) {
    return row.clockings
      .map((clocking) => {
        const mode: AttendanceClocking['mode'] = clocking?.mode === 'clock-out' ? 'clock-out' : 'clock-in';
        return {
          id: String(clocking?.id || createRecordId('CLK')),
          mode,
          time: String(clocking?.time || '').trim(),
          lat: typeof clocking?.lat === 'number' ? clocking.lat : undefined,
          lng: typeof clocking?.lng === 'number' ? clocking.lng : undefined,
          accuracy: typeof clocking?.accuracy === 'number' ? clocking.accuracy : null,
          photoDataUrl: String(clocking?.photoDataUrl || '').trim(),
          source: String(clocking?.source || 'Mobile App'),
          createdAt: String(clocking?.createdAt || ''),
        };
      })
      .filter((clocking) => /^\d{2}:\d{2}$/.test(clocking.time));
  }
  const fallbackClockings: AttendanceClocking[] = [];
  if (row?.checkIn) {
    fallbackClockings.push({
      id: createRecordId('CLK'),
      mode: 'clock-in',
      time: row.checkIn,
      lat: row.checkInLat,
      lng: row.checkInLng,
      accuracy: row.checkInAccuracy ?? null,
      source: row.source || 'Mobile App',
      createdAt: row.date ? `${row.date}T${row.checkIn}:00` : new Date().toISOString(),
    });
  }
  if (row?.checkOut) {
    fallbackClockings.push({
      id: createRecordId('CLK'),
      mode: 'clock-out',
      time: row.checkOut,
      lat: row.checkOutLat,
      lng: row.checkOutLng,
      accuracy: row.checkOutAccuracy ?? null,
      source: row.source || 'Mobile App',
      createdAt: row.date ? `${row.date}T${row.checkOut}:00` : new Date().toISOString(),
    });
  }
  return fallbackClockings;
};

const buildClockingDerivedFields = (clockings: AttendanceClocking[]) => {
  const ordered = [...clockings].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  const firstClockIn = ordered.find((clocking) => clocking.mode === 'clock-in') || null;
  const lastClockOut = [...ordered].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
  const openClockInCount = ordered.reduce(
    (acc, clocking) => (clocking.mode === 'clock-in' ? acc + 1 : Math.max(0, acc - 1)),
    0
  );
  return {
    checkIn: firstClockIn?.time || '',
    checkOut: lastClockOut?.time || '',
    workedHours: firstClockIn?.time && lastClockOut?.time ? formatWorkedHours(firstClockIn.time, lastClockOut.time) : '',
    checkInLat: firstClockIn?.lat,
    checkInLng: firstClockIn?.lng,
    checkInAccuracy: firstClockIn?.accuracy ?? null,
    checkOutLat: lastClockOut?.lat,
    checkOutLng: lastClockOut?.lng,
    checkOutAccuracy: lastClockOut?.accuracy ?? null,
    openClockInCount,
  };
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

export const fetchMobileSettings = async (apiBaseUrl: string, session: AuthSession) => {
  try {
    const response = await apiRequest<Partial<MobileSettings>>(apiBaseUrl, '/api/mobile/settings', {
      token: session.token,
    });
    return {
      ...defaultMobileSettings,
      ...(response || {}),
      enabledModules: Array.isArray(response?.enabledModules)
        ? response.enabledModules.map((value) => String(value || '').trim()).filter(Boolean)
        : defaultMobileSettings.enabledModules,
    };
  } catch (error) {
    return { ...defaultMobileSettings };
  }
};

export const fetchEmployeeProfile = async (apiBaseUrl: string, session: AuthSession) => {
  const response = await apiRequest<{ records?: EmployeeProfile[] }>(apiBaseUrl, '/api/modules/employee-management', {
    token: session.token,
  });
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
  const normalizedRole = String(session.user.role || '').toLowerCase();
  const allowedModules =
    Array.isArray(session.user.allowedModules) && session.user.allowedModules.length > 0
      ? session.user.allowedModules
      : normalizedRole === 'employee'
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
  const response = await apiRequest<{ records?: AttendanceRecord[] }>(apiBaseUrl, '/api/modules/attendance-time', {
    token: session.token,
  });
  const rows = Array.isArray(response.records) ? response.records : [];
  return filterRowsForEmployee(rows, session).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
};

export const fetchEmployeeLoanRows = async (apiBaseUrl: string, session: AuthSession) => {
  const response = await apiRequest<{ records?: LoanRecord[] }>(apiBaseUrl, '/api/modules/loan-records', {
    token: session.token,
  });
  const rows = Array.isArray(response.records) ? response.records : [];
  return filterRowsForEmployee(rows, session).sort((a, b) => String(b.issuedOn || '').localeCompare(String(a.issuedOn || '')));
};

export const fetchEmployeeLeaveRows = async (apiBaseUrl: string, session: AuthSession) => {
  const response = await apiRequest<{ records?: LeaveRecord[] }>(apiBaseUrl, '/api/modules/leave-management', {
    token: session.token,
  });
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
    token: session.token,
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
    token: session.token,
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
  const photoDataUrl =
    mode === 'clock-in' && settings.requireClockInPhoto ? await captureClockInPhoto() : '';

  await runWithTimeout(
    requestForegroundLocationPermission(),
    8000,
    'Location permission request timed out. Please try again.'
  );

  let position = null;
  try {
    position = await runWithTimeout(
      captureCurrentLocation(),
      10000,
      'Unable to get GPS fix in time. Please retry clocking.'
    );
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

  const existingClockings = normalizeClockings(existingRow);
  const existingDerived = buildClockingDerivedFields(existingClockings);

  if (mode === 'clock-out' && existingDerived.openClockInCount <= 0) {
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
    clockings: [],
  };

  const nextClocking: AttendanceClocking = {
    id: createRecordId('CLK'),
    mode,
    time: clockValue,
    lat: position?.coords.latitude,
    lng: position?.coords.longitude,
    accuracy: position?.coords.accuracy ?? null,
    photoDataUrl,
    source: 'Mobile App',
    createdAt: new Date().toISOString(),
  };

  const mergedClockings = [...existingClockings, nextClocking];
  const derivedFields = buildClockingDerivedFields(mergedClockings);

  const payload: AttendanceRecord = {
    ...baseRecord,
    source: 'Mobile App',
    status: baseRecord.status || 'On Time',
    clockings: mergedClockings,
    checkIn: derivedFields.checkIn,
    checkOut: derivedFields.checkOut,
    workedHours: derivedFields.workedHours,
    checkInLat: derivedFields.checkInLat,
    checkInLng: derivedFields.checkInLng,
    checkInAccuracy: derivedFields.checkInAccuracy,
    checkOutLat: derivedFields.checkOutLat,
    checkOutLng: derivedFields.checkOutLng,
    checkOutAccuracy: derivedFields.checkOutAccuracy,
  };

  const endpoint = existingRow
    ? `/api/modules/attendance-time/${encodeURIComponent(payload.id)}`
    : '/api/modules/attendance-time';
  const method = existingRow ? 'PUT' : 'POST';

  const persisted = await apiRequest<{ record?: AttendanceRecord }>(apiBaseUrl, endpoint, {
    method,
    token: session.token,
    body: payload,
  });
  const persistedRecord = persisted?.record || payload;

  if (mode === 'clock-in' && settings.autoStartTrackingOnClockIn) {
    void (async () => {
      try {
        await runWithTimeout(
          requestTrackingPermissions(),
          8000,
          'Tracking permission request timed out.'
        );
        await runWithTimeout(
          startBackgroundTracking({ apiBaseUrl, session }),
          8000,
          'Background tracking startup timed out.'
        );
      } catch (error) {
      }
    })();
  }

  if (position?.coords && settings.autoSendLocationOnClock) {
    void (async () => {
      try {
        await runWithTimeout(
          transmitLocation({
            apiBaseUrl,
            session,
            location: position.coords,
            mocked: position.mocked,
            activity: mode,
          }),
          6000,
          'Location sync timed out.'
        );
      } catch (error) {
      }
    })();
  }

  return persistedRecord;
};
