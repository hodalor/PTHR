export type AuthUser = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  employeeId: string;
  allowedModules: string[];
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type TrackingSettings = {
  officeLat: number | null;
  officeLng: number | null;
  geofenceRadiusMeters: number;
  geofenceEnabled: boolean;
  wifiValidationEnabled: boolean;
  activityMonitoringEnabled: boolean;
  randomSelfieEnabled: boolean;
  antiGpsSpoofingEnabled: boolean;
  whatsappAlertsEnabled: boolean;
  officeWifiSsids: string[];
  officeWifiBssids: string[];
  officeIpRanges: string[];
  offlineMinutesThreshold: number;
};

export type TrackingTransmissionResult = {
  ok: boolean;
  status?: string;
  distanceMeters?: number | null;
  error?: string;
};

export type TrackingRuntimeConfig = {
  apiBaseUrl: string;
  session: AuthSession | null;
};

export type MobileSettings = {
  enabledModules: string[];
  allowClockIn: boolean;
  allowClockOut: boolean;
  requireLocationOnClock: boolean;
  autoSendLocationOnClock: boolean;
  allowLoanView: boolean;
  allowLoanRequest: boolean;
  allowLeaveView: boolean;
  allowLeaveRequest: boolean;
  allowTrackingView: boolean;
};

export type EmployeeProfile = {
  id: string;
  fullName: string;
  department?: string;
  employeeId?: string;
  basicPay?: string;
  monthlyBonuses?: string;
  transportAllowance?: string;
  housingAllowance?: string;
  foodAllowance?: string;
};

export type AttendanceRecord = {
  id: string;
  employee: string;
  employeeId: string;
  date: string;
  shift?: string;
  checkIn?: string;
  checkOut?: string;
  workedHours?: string;
  lateMinutes?: string;
  deductionAmount?: string;
  source?: string;
  status?: string;
  checkInLat?: number;
  checkInLng?: number;
  checkInAccuracy?: number | null;
  checkOutLat?: number;
  checkOutLng?: number;
  checkOutAccuracy?: number | null;
};

export type LoanRecord = {
  id: string;
  employee: string;
  employeeId: string;
  type?: string;
  amount?: string;
  interestPercent?: string;
  tenorMonths?: string;
  monthlyInstallment?: string;
  issuedOn?: string;
  balance?: string;
  status?: string;
  department?: string;
  departmentApproval?: string;
  hrApproval?: string;
  managerApproval?: string;
};

export type LeaveRecord = {
  id: string;
  employee: string;
  employeeId: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  daysRequested?: string | number;
  reason?: string;
  status?: string;
  department?: string;
  departmentApproval?: string;
  hrApproval?: string;
  managerApproval?: string;
};
