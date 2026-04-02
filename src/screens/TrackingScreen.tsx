import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTrackingController } from '../hooks/useTrackingController';
import { StatCard } from '../components/StatCard';
import { colors } from '../theme';
import {
  fetchEmployeeAttendanceRows,
  fetchEmployeeLeaveRows,
  fetchEmployeeLoanRows,
  fetchMobileSettings,
  getAvailableEmployeeModules,
  saveAttendanceClock,
} from '../services/mobileModules';
import { AttendanceRecord, LeaveRecord, LoanRecord, MobileSettings } from '../types/app';

const formatCoordinate = (value: number | undefined) => (typeof value === 'number' ? value.toFixed(6) : '—');
const moduleLabels: Record<string, string> = {
  'attendance-time': 'Attendance',
  'loan-records': 'Loans',
  'leave-management': 'Leaves',
  'monitoring-tracking': 'Tracking',
};
const todayIso = () => new Date().toISOString().slice(0, 10);

export const TrackingScreen = () => {
  const { apiBaseUrl, logout, session } = useAuth();
  const tracking = useTrackingController(apiBaseUrl, session);
  const [mobileSettings, setMobileSettings] = useState<MobileSettings | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRecord[]>([]);
  const [loanRows, setLoanRows] = useState<LoanRecord[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRecord[]>([]);
  const [selectedModule, setSelectedModule] = useState('attendance-time');
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [clockLoadingMode, setClockLoadingMode] = useState<'clock-in' | 'clock-out' | ''>('');
  const [clockMessage, setClockMessage] = useState('');

  const refreshDashboard = useCallback(async () => {
    if (!session) {
      return;
    }
    setDashboardLoading(true);
    setDashboardError('');
    try {
      const settings = await fetchMobileSettings(apiBaseUrl);
      const [nextAttendanceRows, nextLoanRows, nextLeaveRows] = await Promise.all([
        fetchEmployeeAttendanceRows(apiBaseUrl, session),
        fetchEmployeeLoanRows(apiBaseUrl, session),
        fetchEmployeeLeaveRows(apiBaseUrl, session),
      ]);
      setMobileSettings(settings);
      setAttendanceRows(nextAttendanceRows);
      setLoanRows(nextLoanRows);
      setLeaveRows(nextLeaveRows);
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
    if (!availableModules.includes(selectedModule)) {
      setSelectedModule(availableModules[0]);
    }
  }, [availableModules, selectedModule]);

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
      await tracking.refreshTrackingStatus();
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Unable to complete attendance action');
    } finally {
      setClockLoadingMode('');
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
      <View style={styles.listWrap}>
        {attendanceRows.slice(0, 5).map((row) => (
          <View style={styles.listRow} key={row.id}>
            <View style={styles.listTextWrap}>
              <Text style={styles.listTitle}>{row.date}</Text>
              <Text style={styles.detailText}>
                {row.checkIn || '—'} → {row.checkOut || '—'} • {row.workedHours || 'Pending'}
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
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Loan records</Text>
      <View style={styles.listWrap}>
        {loanRows.slice(0, 6).map((row) => (
          <View style={styles.listRow} key={row.id}>
            <View style={styles.listTextWrap}>
              <Text style={styles.listTitle}>{row.type || 'Loan Record'}</Text>
              <Text style={styles.detailText}>
                {row.amount || '—'} • Balance: {row.balance || '—'}
              </Text>
            </View>
            <Text style={styles.listMeta}>{row.status || 'Active'}</Text>
          </View>
        ))}
        {loanRows.length === 0 ? <Text style={styles.detailText}>No loan records available.</Text> : null}
      </View>
    </View>
  );

  const renderLeaveModule = () => (
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
            </View>
            <Text style={styles.listMeta}>{row.status || 'Pending'}</Text>
          </View>
        ))}
        {leaveRows.length === 0 ? <Text style={styles.detailText}>No leave records available.</Text> : null}
      </View>
    </View>
  );

  const renderTrackingModule = () => (
    <>
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
        <Text style={styles.sectionTitle}>Live tracking</Text>
        <View style={styles.buttonRow}>
          <Pressable style={styles.smallButton} onPress={tracking.sendCurrentLocation} disabled={tracking.loading}>
            <Text style={styles.buttonText}>Send Now</Text>
          </Pressable>
          <Pressable style={[styles.smallButton, styles.secondaryButton]} onPress={tracking.enableTracking} disabled={tracking.loading}>
            <Text style={styles.buttonText}>Start Tracking</Text>
          </Pressable>
          <Pressable style={[styles.smallButton, styles.dangerButton]} onPress={tracking.disableTracking} disabled={tracking.loading}>
            <Text style={styles.buttonText}>Stop Tracking</Text>
          </Pressable>
        </View>
        {tracking.error ? <Text style={styles.error}>{tracking.error}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Tracking policy</Text>
        <Text style={styles.detailText}>
          Geofence: {tracking.settings?.geofenceEnabled ? 'Enabled' : 'Disabled'} • Radius:{' '}
          {tracking.settings?.geofenceRadiusMeters ?? '—'} m
        </Text>
        <Text style={styles.detailText}>
          Office GPS: {formatCoordinate(tracking.settings?.officeLat ?? undefined)}, {formatCoordinate(tracking.settings?.officeLng ?? undefined)}
        </Text>
        <Text style={styles.detailText}>
          Offline threshold: {tracking.settings?.offlineMinutesThreshold ?? '—'} minute(s)
        </Text>
      </View>
    </>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={dashboardLoading} onRefresh={refreshDashboard} tintColor={colors.text} />}
    >
      <View style={styles.hero}>
        <View style={styles.heroTextWrap}>
          <Text style={styles.eyebrow}>Employee Mobile</Text>
          <Text style={styles.title}>{session?.user.fullName}</Text>
          <Text style={styles.subtitle}>
            {session?.user.employeeId} • {session?.user.role}
          </Text>
        </View>
        <Pressable style={[styles.smallButton, styles.ghostButton]} onPress={logout}>
          <Text style={styles.ghostButtonText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Mobile access</Text>
        <Text style={styles.detailText}>{apiBaseUrl}</Text>
        <Text style={styles.detailText}>Modules available: {availableModules.map((item) => moduleLabels[item] || item).join(', ') || '—'}</Text>
      </View>

      <View style={styles.statsRow}>
        <StatCard label="Today Status" value={todayAttendance?.status || 'PENDING'} tone={todayAttendance?.checkOut ? 'success' : 'warning'} />
        <StatCard label="Loans" value={String(loanRows.length)} />
      </View>

      <View style={styles.statsRow}>
        <StatCard label="Leaves" value={String(leaveRows.length)} />
        <StatCard label="Available Modules" value={String(availableModules.length)} />
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
      {selectedModule === 'attendance-time' ? renderAttendanceModule() : null}
      {selectedModule === 'loan-records' ? renderLoanModule() : null}
      {selectedModule === 'leave-management' ? renderLeaveModule() : null}
      {selectedModule === 'monitoring-tracking' ? renderTrackingModule() : null}
    </ScrollView>
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
    alignItems: 'flex-start',
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
  smallButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  listWrap: {
    gap: 10,
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
});
