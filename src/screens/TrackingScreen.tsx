import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTrackingController } from '../hooks/useTrackingController';
import { StatCard } from '../components/StatCard';
import { colors } from '../theme';
import {
  fetchEmployeeDashboardSummary,
  fetchEmployeeProfile,
  fetchEmployeeAttendanceRows,
  fetchEmployeeLeaveRows,
  fetchEmployeeLoanRows,
  fetchMobileSettings,
  getAvailableEmployeeModules,
  saveAttendanceClock,
  submitLeaveRequest,
  submitLoanRequest,
} from '../services/mobileModules';
import { AttendanceRecord, EmployeeDashboardSummary, EmployeeProfile, LeaveRecord, LoanRecord, MobileSettings } from '../types/app';

const formatCoordinate = (value: number | undefined) => (typeof value === 'number' ? value.toFixed(6) : '—');
const formatMoney = (value: number | undefined, currency = 'USD') =>
  `${currency ? `${currency} ` : ''}${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const moduleLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  'attendance-time': 'Attendance',
  'loan-records': 'Loans',
  'leave-management': 'Leaves',
  'monitoring-tracking': 'Tracking',
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const initialLoanForm = {
  type: 'Salary Advance',
  amount: '',
  interestPercent: '',
  tenorMonths: '1',
};
const initialLeaveForm = {
  type: 'Annual',
  startDate: todayIso(),
  endDate: todayIso(),
  reason: '',
};
const formatApprovalTrail = (row: { departmentApproval?: string; hrApproval?: string; managerApproval?: string }) =>
  `Dept ${row.departmentApproval || 'Pending'} • HR ${row.hrApproval || 'Pending'} • Mgr ${row.managerApproval || 'Pending'}`;

export const TrackingScreen = () => {
  const { apiBaseUrl, logout, session } = useAuth();
  const tracking = useTrackingController(apiBaseUrl, session);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSettings, setMobileSettings] = useState<MobileSettings | null>(null);
  const [employeeProfile, setEmployeeProfile] = useState<EmployeeProfile | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRecord[]>([]);
  const [loanRows, setLoanRows] = useState<LoanRecord[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRecord[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<EmployeeDashboardSummary | null>(null);
  const [selectedModule, setSelectedModule] = useState('dashboard');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [clockLoadingMode, setClockLoadingMode] = useState<'clock-in' | 'clock-out' | ''>('');
  const [clockMessage, setClockMessage] = useState('');
  const [loanForm, setLoanForm] = useState(initialLoanForm);
  const [leaveForm, setLeaveForm] = useState(initialLeaveForm);
  const [loanSubmitting, setLoanSubmitting] = useState(false);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [loanMessage, setLoanMessage] = useState('');
  const [leaveMessage, setLeaveMessage] = useState('');
  const [trackingRefreshLoading, setTrackingRefreshLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);

  const showMobileToast = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    if (!message) {
      return;
    }
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeoutId = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    if (tracking.error) {
      showMobileToast(tracking.error, 'error');
    }
  }, [showMobileToast, tracking.error]);

  const refreshDashboard = useCallback(async () => {
    if (!session) {
      return;
    }
    setDashboardLoading(true);
    setDashboardError('');
    try {
      const settings = await fetchMobileSettings(apiBaseUrl, session);
      setMobileSettings(settings);
      const [profileResult, attendanceResult, loanResult, leaveResult, summaryResult] = await Promise.allSettled([
        fetchEmployeeProfile(apiBaseUrl, session),
        fetchEmployeeAttendanceRows(apiBaseUrl, session),
        fetchEmployeeLoanRows(apiBaseUrl, session),
        fetchEmployeeLeaveRows(apiBaseUrl, session),
        fetchEmployeeDashboardSummary(apiBaseUrl, session),
      ]);
      setEmployeeProfile(profileResult.status === 'fulfilled' ? profileResult.value : null);
      setAttendanceRows(attendanceResult.status === 'fulfilled' ? attendanceResult.value : []);
      setLoanRows(loanResult.status === 'fulfilled' ? loanResult.value : []);
      setLeaveRows(leaveResult.status === 'fulfilled' ? leaveResult.value : []);
      setDashboardSummary(summaryResult.status === 'fulfilled' ? summaryResult.value : null);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Unable to load employee modules');
    } finally {
      setDashboardLoading(false);
    }
  }, [apiBaseUrl, session]);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  const availableModules = useMemo(() => {
    if (!session || !mobileSettings) {
      return [];
    }
    return getAvailableEmployeeModules(session, mobileSettings);
  }, [mobileSettings, session]);

  useEffect(() => {
    if (availableModules.length === 0) {
      return;
    }
    const preferredModule = availableModules.includes('dashboard')
      ? 'dashboard'
      : availableModules.includes('monitoring-tracking')
        ? 'monitoring-tracking'
        : availableModules.includes('attendance-time')
          ? 'attendance-time'
          : availableModules[0];
    if (!availableModules.includes(selectedModule)) {
      setSelectedModule(preferredModule);
    }
  }, [availableModules, selectedModule]);

  const currencyCode = '';

  const renderDashboardModule = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Personal summary</Text>
        <Text style={styles.detailText}>
          Track your deductions, take-home pay, attendance, loans, and leave before month end.
        </Text>
        <View style={styles.buttonRow}>
          <Pressable style={[styles.smallButton, styles.ghostButton]} onPress={refreshDashboard} disabled={dashboardLoading}>
            <Text style={styles.ghostButtonText}>{dashboardLoading ? 'Refreshing...' : 'Refresh Summary'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatCard
          label="Take Home"
          value={formatMoney(dashboardSummary?.compensation?.takeHomePay, currencyCode)}
          tone="success"
          helper={
            <Text style={styles.cardHelperText}>
              {dashboardSummary?.compensation?.payrollPeriod || 'Current estimate'}
            </Text>
          }
        />
        <StatCard
          label="Total Deductions"
          value={formatMoney(dashboardSummary?.compensation?.totalDeductions, currencyCode)}
          tone="warning"
          helper={<Text style={styles.cardHelperText}>Today {formatMoney(dashboardSummary?.attendance?.deductionAmount, currencyCode)}</Text>}
        />
      </View>

      <View style={styles.statsRow}>
        <StatCard
          label="Month Deductions"
          value={formatMoney(dashboardSummary?.monthToDate?.deductionAmount, currencyCode)}
          tone="danger"
        />
        <StatCard
          label="Today Status"
          value={dashboardSummary?.attendance?.status || todayAttendance?.status || 'No Record'}
          tone={String(dashboardSummary?.attendance?.status || '').toLowerCase() === 'late' ? 'warning' : 'default'}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pay breakdown</Text>
        <View style={styles.summaryList}>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Gross pay</Text>
            <Text style={styles.summaryValue}>{formatMoney(dashboardSummary?.compensation?.grossPay, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Total deductions</Text>
            <Text style={styles.summaryValue}>{formatMoney(dashboardSummary?.compensation?.totalDeductions, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Take-home pay</Text>
            <Text style={styles.summaryValue}>{formatMoney(dashboardSummary?.compensation?.takeHomePay, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Today deduction</Text>
            <Text style={styles.summaryValue}>{formatMoney(dashboardSummary?.attendance?.deductionAmount, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Month deduction</Text>
            <Text style={styles.summaryValue}>{formatMoney(dashboardSummary?.monthToDate?.deductionAmount, currencyCode)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Attendance, loans, and leave</Text>
        <View style={styles.summaryList}>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Late minutes today</Text>
            <Text style={styles.summaryValue}>{String(dashboardSummary?.attendance?.lateMinutes || 0)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Late minutes this month</Text>
            <Text style={styles.summaryValue}>{String(dashboardSummary?.monthToDate?.lateMinutes || 0)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Active loans</Text>
            <Text style={styles.summaryValue}>{String(dashboardSummary?.loans?.activeCount || 0)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Outstanding loans</Text>
            <Text style={styles.summaryValue}>{formatMoney(dashboardSummary?.loans?.outstandingAmount, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Pending leaves</Text>
            <Text style={styles.summaryValue}>{String(dashboardSummary?.leaves?.pendingCount || 0)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Approved leaves</Text>
            <Text style={styles.summaryValue}>{String(dashboardSummary?.leaves?.approvedCount || 0)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Leave balance</Text>
            <Text style={styles.summaryValue}>{String(dashboardSummary?.employee?.leaveBalanceDays || 0)} day(s)</Text>
          </View>
        </View>
      </View>
    </>
  );

  const trackingTone =
    tracking.latestStatus === 'INSIDE'
      ? 'success'
      : tracking.latestStatus === 'OUTSIDE'
        ? 'warning'
        : tracking.latestStatus === 'OFFLINE'
          ? 'danger'
          : 'default';

  const todayAttendance = useMemo(
    () => attendanceRows.find((row) => String(row.date || '') === todayIso()) || null,
    [attendanceRows]
  );

  const handleClockAction = async (mode: 'clock-in' | 'clock-out') => {
    if (!session || !mobileSettings) {
      return;
    }
    setClockLoadingMode(mode);
    setClockMessage('');
    setDashboardError('');
    try {
      const savedRow = await saveAttendanceClock({
        apiBaseUrl,
        session,
        settings: mobileSettings,
        trackingSettings: tracking.settings,
        rows: attendanceRows,
        mode,
      });
      setAttendanceRows((prev) => {
        const existingIndex = prev.findIndex((row) => String(row.id || '') === String(savedRow.id || ''));
        if (existingIndex >= 0) {
          const nextRows = [...prev];
          nextRows[existingIndex] = savedRow;
          return nextRows;
        }
        return [savedRow, ...prev];
      });
      setClockMessage(mode === 'clock-in' ? 'Clock-in captured with location.' : 'Clock-out captured with location.');
      showMobileToast(mode === 'clock-in' ? 'Thanks for clocking in.' : 'Clock-out captured successfully.', 'success');
      await tracking.refreshTrackingStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete attendance action';
      setDashboardError(message);
      showMobileToast(message, 'error');
    } finally {
      setClockLoadingMode('');
    }
  };

  const handleLoanSubmit = async () => {
    if (!session || !mobileSettings?.allowLoanRequest) {
      return;
    }
    setLoanSubmitting(true);
    setDashboardError('');
    setLoanMessage('');
    try {
      const saved = await submitLoanRequest(apiBaseUrl, session, employeeProfile, loanForm);
      setLoanRows((prev) => [saved, ...prev]);
      setLoanForm(initialLoanForm);
      setLoanMessage('Loan request submitted for approval.');
      showMobileToast('Loan applied successfully.', 'success');
      setSelectedModule('loan-records');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit loan request';
      setDashboardError(message);
      showMobileToast(message, 'error');
    } finally {
      setLoanSubmitting(false);
    }
  };

  const handleLeaveSubmit = async () => {
    if (!session || !mobileSettings?.allowLeaveRequest) {
      return;
    }
    setLeaveSubmitting(true);
    setDashboardError('');
    setLeaveMessage('');
    try {
      const saved = await submitLeaveRequest(apiBaseUrl, session, employeeProfile, leaveForm);
      setLeaveRows((prev) => [saved, ...prev]);
      setLeaveForm(initialLeaveForm);
      setLeaveMessage('Leave request submitted for approval.');
      showMobileToast('Leave request submitted successfully.', 'success');
      setSelectedModule('leave-management');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit leave request';
      setDashboardError(message);
      showMobileToast(message, 'error');
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const renderAttendanceModule = () => (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Attendance & time</Text>
      <Text style={styles.detailText}>
        Today: {todayAttendance?.status || 'No record yet'} • Check-in: {todayAttendance?.checkIn || '—'} • Check-out:{' '}
        {todayAttendance?.checkOut || '—'}
      </Text>
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.smallButton, !mobileSettings?.allowClockIn ? styles.disabledButton : null]}
          onPress={() => handleClockAction('clock-in')}
          disabled={clockLoadingMode !== '' || !mobileSettings?.allowClockIn}
        >
          <Text style={styles.buttonText}>{clockLoadingMode === 'clock-in' ? 'Clocking...' : 'Clock In'}</Text>
        </Pressable>
        <Pressable
          style={[styles.smallButton, styles.secondaryButton, !mobileSettings?.allowClockOut ? styles.disabledButton : null]}
          onPress={() => handleClockAction('clock-out')}
          disabled={clockLoadingMode !== '' || !mobileSettings?.allowClockOut}
        >
          <Text style={styles.buttonText}>{clockLoadingMode === 'clock-out' ? 'Clocking...' : 'Clock Out'}</Text>
        </Pressable>
        <Pressable style={[styles.smallButton, styles.ghostButton]} onPress={refreshDashboard} disabled={dashboardLoading}>
          <Text style={styles.ghostButtonText}>Refresh</Text>
        </Pressable>
      </View>
      {clockMessage ? <Text style={styles.success}>{clockMessage}</Text> : null}
      <View style={styles.infoStrip}>
        <Text style={styles.infoStripText}>
          Clock source: GPS verified • Check-in location {todayAttendance?.checkInLat ? 'captured' : 'pending'}
        </Text>
      </View>
      <View style={styles.listWrap}>
        {attendanceRows.slice(0, 5).map((row) => (
          <View style={styles.listRow} key={row.id}>
            <View style={styles.listTextWrap}>
              <Text style={styles.listTitle}>{row.date}</Text>
              <Text style={styles.detailText}>
                {row.checkIn || '—'} → {row.checkOut || '—'} • {row.workedHours || 'Pending'}
              </Text>
              <Text style={styles.mutedTiny}>
                Clockings: {Array.isArray(row.clockings) ? row.clockings.length : 0}{' '}
                {Array.isArray(row.clockings) && row.clockings.length > 0
                  ? `• ${row.clockings
                      .slice(-4)
                      .map((clocking) => `${clocking.mode === 'clock-in' ? 'IN' : 'OUT'} ${clocking.time}`)
                      .join(' | ')}`
                  : ''}
              </Text>
              <Text style={styles.mutedTiny}>
                In GPS {formatCoordinate(row.checkInLat)} / {formatCoordinate(row.checkInLng)} • Out GPS {formatCoordinate(row.checkOutLat)} /{' '}
                {formatCoordinate(row.checkOutLng)}
              </Text>
            </View>
            <Text style={styles.listMeta}>{row.status || 'Pending'}</Text>
          </View>
        ))}
        {attendanceRows.length === 0 ? <Text style={styles.detailText}>No attendance records available.</Text> : null}
      </View>
    </View>
  );

  const renderLoanModule = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Request a loan</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Loan type</Text>
          <TextInput value={loanForm.type} onChangeText={(value) => setLoanForm((prev) => ({ ...prev, type: value }))} style={styles.input} />
        </View>
        <View style={styles.fieldRow}>
          <View style={styles.fieldGroupWide}>
            <Text style={styles.fieldLabel}>Amount</Text>
            <TextInput
              value={loanForm.amount}
              onChangeText={(value) => setLoanForm((prev) => ({ ...prev, amount: value }))}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroupWide}>
            <Text style={styles.fieldLabel}>Interest % / month</Text>
            <TextInput
              value={loanForm.interestPercent}
              onChangeText={(value) => setLoanForm((prev) => ({ ...prev, interestPercent: value }))}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Tenor months</Text>
          <TextInput
            value={loanForm.tenorMonths}
            onChangeText={(value) => setLoanForm((prev) => ({ ...prev, tenorMonths: value }))}
            keyboardType="number-pad"
            style={styles.input}
          />
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.smallButton, !mobileSettings?.allowLoanRequest ? styles.disabledButton : null]}
            onPress={handleLoanSubmit}
            disabled={loanSubmitting || !mobileSettings?.allowLoanRequest}
          >
            <Text style={styles.buttonText}>{loanSubmitting ? 'Submitting...' : 'Submit Loan Request'}</Text>
          </Pressable>
        </View>
        {loanMessage ? <Text style={styles.success}>{loanMessage}</Text> : null}
        {!mobileSettings?.allowLoanRequest ? <Text style={styles.detailText}>Loan requests are disabled by admin settings.</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Loan records</Text>
        <View style={styles.listWrap}>
          {loanRows.slice(0, 6).map((row) => (
            <View style={styles.listRow} key={row.id}>
              <View style={styles.listTextWrap}>
                <Text style={styles.listTitle}>{row.type || 'Loan Record'}</Text>
                <Text style={styles.detailText}>
                  Amount {row.amount || '—'} • Balance {row.balance || '—'} • Installment {row.monthlyInstallment || '—'}
                </Text>
                <Text style={styles.mutedTiny}>{formatApprovalTrail(row)}</Text>
              </View>
              <Text style={styles.listMeta}>{row.status || 'Active'}</Text>
            </View>
          ))}
          {loanRows.length === 0 ? <Text style={styles.detailText}>No loan records available.</Text> : null}
        </View>
      </View>
    </>
  );

  const renderLeaveModule = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Request leave</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Leave type</Text>
          <TextInput value={leaveForm.type} onChangeText={(value) => setLeaveForm((prev) => ({ ...prev, type: value }))} style={styles.input} />
        </View>
        <View style={styles.fieldRow}>
          <View style={styles.fieldGroupWide}>
            <Text style={styles.fieldLabel}>Start date</Text>
            <TextInput value={leaveForm.startDate} onChangeText={(value) => setLeaveForm((prev) => ({ ...prev, startDate: value }))} style={styles.input} />
          </View>
          <View style={styles.fieldGroupWide}>
            <Text style={styles.fieldLabel}>End date</Text>
            <TextInput value={leaveForm.endDate} onChangeText={(value) => setLeaveForm((prev) => ({ ...prev, endDate: value }))} style={styles.input} />
          </View>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Reason</Text>
          <TextInput
            value={leaveForm.reason}
            onChangeText={(value) => setLeaveForm((prev) => ({ ...prev, reason: value }))}
            multiline
            style={[styles.input, styles.textArea]}
          />
        </View>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.smallButton, !mobileSettings?.allowLeaveRequest ? styles.disabledButton : null]}
            onPress={handleLeaveSubmit}
            disabled={leaveSubmitting || !mobileSettings?.allowLeaveRequest}
          >
            <Text style={styles.buttonText}>{leaveSubmitting ? 'Submitting...' : 'Submit Leave Request'}</Text>
          </Pressable>
        </View>
        {leaveMessage ? <Text style={styles.success}>{leaveMessage}</Text> : null}
        {!mobileSettings?.allowLeaveRequest ? <Text style={styles.detailText}>Leave requests are disabled by admin settings.</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Leave records</Text>
        <View style={styles.listWrap}>
          {leaveRows.slice(0, 6).map((row) => (
            <View style={styles.listRow} key={row.id}>
              <View style={styles.listTextWrap}>
                <Text style={styles.listTitle}>{row.type || 'Leave Request'}</Text>
                <Text style={styles.detailText}>
                  {row.startDate || '—'} → {row.endDate || '—'} • {row.daysRequested || '—'} day(s)
                </Text>
                <Text style={styles.mutedTiny}>{formatApprovalTrail(row)}</Text>
              </View>
              <Text style={styles.listMeta}>{row.status || 'Pending'}</Text>
            </View>
          ))}
          {leaveRows.length === 0 ? <Text style={styles.detailText}>No leave records available.</Text> : null}
        </View>
      </View>
    </>
  );

  const renderTrackingModule = () => (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Tracking mission control</Text>
        <View style={styles.buttonRow}>
          <Pressable style={styles.smallButton} onPress={tracking.enableTracking} disabled={tracking.loading}>
            <Text style={styles.buttonText}>
              {tracking.loading && !tracking.enabled ? 'Starting...' : tracking.enabled ? 'Tracking Active' : 'Start Tracking'}
            </Text>
          </Pressable>
          <Pressable style={[styles.smallButton, styles.dangerButton]} onPress={tracking.disableTracking} disabled={tracking.loading}>
            <Text style={styles.buttonText}>{tracking.loading && tracking.enabled ? 'Stopping...' : 'Stop Tracking'}</Text>
          </Pressable>
          <Pressable style={[styles.smallButton, styles.secondaryButton]} onPress={() => tracking.sendCurrentLocation()} disabled={tracking.loading}>
            <Text style={styles.buttonText}>{tracking.loading ? 'Sending...' : 'Send Location'}</Text>
          </Pressable>
          <Pressable
            style={[styles.smallButton, styles.ghostButton]}
            onPress={async () => {
              setTrackingRefreshLoading(true);
              setDashboardError('');
              try {
                await Promise.all([
                  refreshDashboard(),
                  tracking.refreshSettings(),
                  tracking.refreshTrackingStatus(),
                ]);
                showMobileToast('Tracking panel refreshed.', 'info');
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Unable to refresh tracking state';
                setDashboardError(message);
                showMobileToast(message, 'error');
              } finally {
                setTrackingRefreshLoading(false);
              }
            }}
            disabled={dashboardLoading || trackingRefreshLoading}
          >
            <Text style={styles.ghostButtonText}>
              {dashboardLoading || trackingRefreshLoading ? 'Refreshing...' : 'Refresh Tracking'}
            </Text>
          </Pressable>
        </View>
        {tracking.error ? <Text style={styles.error}>{tracking.error}</Text> : null}
      </View>

      <View style={styles.statsRow}>
        <StatCard label="Tracking State" value={tracking.enabled ? 'ACTIVE' : 'STOPPED'} tone={tracking.enabled ? 'success' : 'danger'} />
        <StatCard label="Server Status" value={tracking.latestStatus || 'IDLE'} tone={trackingTone} />
      </View>

      <View style={styles.statsRow}>
        <StatCard
          label="Distance From Office"
          value={typeof tracking.distanceMeters === 'number' ? `${Math.round(tracking.distanceMeters)} m` : '—'}
        />
        <StatCard label="Last Sync" value={tracking.lastSentAt ? new Date(tracking.lastSentAt).toLocaleTimeString() : 'Not sent'} />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Latest coordinates</Text>
        <Text style={styles.detailText}>Latitude: {formatCoordinate(tracking.latestCoordinates?.latitude)}</Text>
        <Text style={styles.detailText}>Longitude: {formatCoordinate(tracking.latestCoordinates?.longitude)}</Text>
        <Text style={styles.detailText}>
          Accuracy: {typeof tracking.latestCoordinates?.accuracy === 'number' ? `${Math.round(tracking.latestCoordinates.accuracy)} m` : '—'}
        </Text>
        <Text style={styles.detailText}>
          Trust: {tracking.latestCoordinates?.mocked ? 'Mocked/Fake (blocked)' : 'Real device GPS'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Location tools</Text>
        <Text style={styles.detailText}>
          The mobile tracking screen now uses the safer device maps handoff so it does not crash when opening Tracking.
        </Text>
        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.smallButton, !tracking.latestCoordinates ? styles.disabledButton : null]}
            disabled={!tracking.latestCoordinates}
            onPress={async () => {
              if (!tracking.latestCoordinates) {
                return;
              }
              const { latitude, longitude } = tracking.latestCoordinates;
              const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
              await Linking.openURL(url);
            }}
          >
            <Text style={styles.buttonText}>Open Current Map</Text>
          </Pressable>
          <Pressable
            style={[
              styles.smallButton,
              styles.secondaryButton,
              typeof tracking.settings?.officeLat !== 'number' || typeof tracking.settings?.officeLng !== 'number'
                ? styles.disabledButton
                : null,
            ]}
            disabled={typeof tracking.settings?.officeLat !== 'number' || typeof tracking.settings?.officeLng !== 'number'}
            onPress={async () => {
              if (typeof tracking.settings?.officeLat !== 'number' || typeof tracking.settings?.officeLng !== 'number') {
                return;
              }
              const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${tracking.settings.officeLat},${tracking.settings.officeLng}`
              )}`;
              await Linking.openURL(url);
            }}
          >
            <Text style={styles.buttonText}>Open Office Map</Text>
          </Pressable>
        </View>
        <View style={styles.infoStrip}>
          <Text style={styles.infoStripText}>
            Current GPS {formatCoordinate(tracking.latestCoordinates?.latitude)} / {formatCoordinate(tracking.latestCoordinates?.longitude)}
          </Text>
        </View>
      </View>
    </>
  );

  return (
    <View style={styles.container}>
      {toast ? (
        <View
          style={[
            styles.toastWrap,
            toast.tone === 'success' ? styles.toastSuccess : toast.tone === 'error' ? styles.toastError : styles.toastInfo,
          ]}
        >
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={dashboardLoading} onRefresh={refreshDashboard} tintColor={colors.text} />}
      >
        <View style={styles.hero}>
        <View style={styles.heroTextWrap}>
          <Text style={styles.eyebrow}>Employee Mobile</Text>
          <Text style={styles.title}>{session?.user.fullName}</Text>
          <Text style={styles.subtitle}>{session?.user.employeeId} • {employeeProfile?.department || session?.user.role}</Text>
        </View>
        <Pressable style={[styles.menuButton, menuOpen ? styles.menuButtonActive : null]} onPress={() => setMenuOpen((prev) => !prev)}>
          <Text style={styles.menuButtonText}>☰</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={styles.drawer}>
          <Text style={styles.sectionTitle}>Mobile menu</Text>
          <View style={styles.drawerActions}>
            {availableModules.map((moduleId) => (
              <Pressable
                key={moduleId}
                style={[styles.drawerItem, selectedModule === moduleId ? styles.drawerItemActive : null]}
                onPress={() => {
                  setSelectedModule(moduleId);
                  setMenuOpen(false);
                }}
              >
                <Text style={[styles.drawerItemTitle, selectedModule === moduleId ? styles.drawerItemTitleActive : null]}>
                  {moduleLabels[moduleId] || moduleId}
                </Text>
              </Pressable>
            ))}
            <Pressable style={[styles.smallButton, styles.ghostButton]} onPress={logout}>
              <Text style={styles.ghostButtonText}>Logout</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.statsRow}>
        <StatCard label="Today Status" value={todayAttendance?.status || 'PENDING'} tone={todayAttendance?.checkOut ? 'success' : tracking.enabled ? 'success' : 'warning'} />
        <StatCard
          label="Today Deduction"
          value={formatMoney(dashboardSummary?.attendance?.deductionAmount, currencyCode)}
          tone="warning"
        />
      </View>

      <View style={styles.statsRow}>
        <StatCard
          label="Month Take Home"
          value={formatMoney(dashboardSummary?.compensation?.takeHomePay, currencyCode)}
          tone="success"
        />
        <StatCard label="Tracking" value={tracking.enabled ? 'ARMED' : 'OFF'} tone={tracking.enabled ? 'success' : 'danger'} />
      </View>

      <View style={styles.moduleTabs}>
        {availableModules.map((moduleId) => (
          <Pressable
            key={moduleId}
            style={[styles.moduleTab, selectedModule === moduleId ? styles.moduleTabActive : null]}
            onPress={() => setSelectedModule(moduleId)}
          >
            <Text style={[styles.moduleTabText, selectedModule === moduleId ? styles.moduleTabTextActive : null]}>
              {moduleLabels[moduleId] || moduleId}
            </Text>
          </Pressable>
        ))}
      </View>

      {dashboardError ? <Text style={styles.error}>{dashboardError}</Text> : null}
      {selectedModule === 'dashboard' ? renderDashboardModule() : null}
      {selectedModule === 'attendance-time' ? renderAttendanceModule() : null}
      {selectedModule === 'loan-records' ? renderLoanModule() : null}
      {selectedModule === 'leave-management' ? renderLeaveModule() : null}
      {selectedModule === 'monitoring-tracking' ? renderTrackingModule() : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  hero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  heroTextWrap: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  drawer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  drawerActions: {
    gap: 10,
  },
  drawerItem: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  drawerItemActive: {
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  drawerItemTitle: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 15,
  },
  drawerItemTitleActive: {
    color: colors.primary,
  },
  moduleTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  moduleTab: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  moduleTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  moduleTabText: {
    color: colors.textMuted,
    fontWeight: '700',
  },
  moduleTabTextActive: {
    color: colors.text,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldGroupWide: {
    flex: 1,
    gap: 6,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  smallButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuButton: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  menuButtonText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.primaryMuted,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  ghostButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: {
    color: colors.text,
    fontWeight: '700',
  },
  ghostButtonText: {
    color: colors.text,
    fontWeight: '700',
  },
  detailText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  cardHelperText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  mutedTiny: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  infoStrip: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoStripText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  listWrap: {
    gap: 10,
  },
  summaryList: {
    gap: 10,
  },
  summaryRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  summaryValue: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
  },
  listRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  listTextWrap: {
    flex: 1,
    gap: 4,
  },
  listTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  listMeta: {
    color: colors.primary,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.45,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  success: {
    color: colors.success,
    fontWeight: '600',
  },
  toastWrap: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 20,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  toastText: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
  },
  toastSuccess: {
    backgroundColor: '#174f32',
    borderColor: '#1f8f55',
  },
  toastError: {
    backgroundColor: '#5a1820',
    borderColor: '#b33b45',
  },
  toastInfo: {
    backgroundColor: '#14355e',
    borderColor: colors.primary,
  },
  mapView: {
    width: '100%',
    height: 220,
    borderRadius: 12,
  },
});
