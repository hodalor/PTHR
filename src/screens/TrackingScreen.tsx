import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import {
  AttendanceRecord,
  DeductionItem,
  EmployeeDashboardSummary,
  EmployeeProfile,
  LeaveRecord,
  LoanRecord,
  MobileSettings,
} from '../types/app';

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
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const currentMonthValue = () => todayIso().slice(0, 7);
const monthEndIso = (monthValue: string) => {
  const match = String(monthValue || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return todayIso();
  }
  const lastDay = new Date(Number(match[1]), Number(match[2]), 0).getDate();
  return `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
};
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
const toMoneyNumber = (value: string | number | undefined) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};
const buildRecentMonthOptions = (count = 12) => {
  const options: string[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let index = 0; index < count; index += 1) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    options.push(`${year}-${month}`);
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return options;
};
const countInclusiveMonths = (fromMonth: string, toMonth: string) => {
  const fromMatch = String(fromMonth || '').match(/^(\d{4})-(\d{2})$/);
  const toMatch = String(toMonth || '').match(/^(\d{4})-(\d{2})$/);
  if (!fromMatch || !toMatch) {
    return 1;
  }
  const fromIndex = Number(fromMatch[1]) * 12 + Number(fromMatch[2]);
  const toIndex = Number(toMatch[1]) * 12 + Number(toMatch[2]);
  return Math.max(1, toIndex - fromIndex + 1);
};
const formatMonthLabel = (monthValue: string) => {
  const match = String(monthValue || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return monthValue;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleString(undefined, { month: 'short', year: 'numeric' });
};
const getOpenClockInCount = (row?: AttendanceRecord | null) => {
  if (!row) {
    return 0;
  }
  if (Array.isArray(row.clockings) && row.clockings.length > 0) {
    return row.clockings.reduce((openCount, clocking) => {
      if (clocking?.mode === 'clock-in') {
        return openCount + 1;
      }
      if (clocking?.mode === 'clock-out') {
        return Math.max(0, openCount - 1);
      }
      return openCount;
    }, 0);
  }
  return row.checkIn && !row.checkOut ? 1 : 0;
};
const buildDeductionItemsForMonths = (rows: AttendanceRecord[], fromMonth: string, toMonth: string): DeductionItem[] => {
  const start = String(fromMonth || '').slice(0, 7);
  const end = String(toMonth || '').slice(0, 7);
  return rows
    .filter((row) => {
      const month = String(row.date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return false;
      }
      if (start && month < start) {
        return false;
      }
      if (end && month > end) {
        return false;
      }
      return toMoneyNumber(row.deductionAmount) > 0 || toMoneyNumber(row.lateMinutes) > 0;
    })
    .map((row) => {
      const amount = toMoneyNumber(row.deductionAmount);
      const lateMinutes = toMoneyNumber(row.lateMinutes);
      const checkInTime = String(row.checkIn || '').trim();
      const clockInTime =
        checkInTime ||
        String(row.clockings?.find((clocking) => clocking.mode === 'clock-in')?.time || '').trim() ||
        '—';
      return {
        id: String(row.id || `${row.date}-${clockInTime}`),
        type: 'lateness',
        label: lateMinutes > 0 || amount > 0 ? 'Lateness' : String(row.status || 'Deduction'),
        date: String(row.date || ''),
        time: clockInTime,
        lateMinutes,
        amount,
      };
    })
    .filter((item) => item.amount > 0)
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
};
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
  const [selectedMonthFrom, setSelectedMonthFrom] = useState(currentMonthValue());
  const [selectedMonthTo, setSelectedMonthTo] = useState(currentMonthValue());
  const [selectedDateFrom, setSelectedDateFrom] = useState(`${currentMonthValue()}-01`);
  const [selectedDateTo, setSelectedDateTo] = useState(todayIso());
  const [deductionModalVisible, setDeductionModalVisible] = useState(false);
  const monthOptions = useMemo(() => buildRecentMonthOptions(12), []);

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
      const dateFrom = isIsoDate(selectedDateFrom) ? selectedDateFrom : `${selectedMonthFrom}-01`;
      const dateTo = isIsoDate(selectedDateTo) ? selectedDateTo : todayIso();
      const [profileResult, attendanceResult, loanResult, leaveResult, summaryResult] = await Promise.allSettled([
        fetchEmployeeProfile(apiBaseUrl, session),
        fetchEmployeeAttendanceRows(apiBaseUrl, session),
        fetchEmployeeLoanRows(apiBaseUrl, session),
        fetchEmployeeLeaveRows(apiBaseUrl, session),
        fetchEmployeeDashboardSummary(apiBaseUrl, session, {
          date: dateTo,
          dateFrom,
          dateTo,
          monthFrom: dateFrom.slice(0, 7),
          monthTo: dateTo.slice(0, 7),
        }),
      ]);
      setEmployeeProfile(profileResult.status === 'fulfilled' ? profileResult.value : null);
      setAttendanceRows(attendanceResult.status === 'fulfilled' ? attendanceResult.value : []);
      setLoanRows(loanResult.status === 'fulfilled' ? loanResult.value : []);
      setLeaveRows(leaveResult.status === 'fulfilled' ? leaveResult.value : []);
      setDashboardSummary(summaryResult.status === 'fulfilled' ? summaryResult.value : null);
      if (summaryResult.status === 'rejected') {
        const message =
          summaryResult.reason instanceof Error ? summaryResult.reason.message : 'Unable to load dashboard summary';
        setDashboardError(message);
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Unable to load employee modules');
    } finally {
      setDashboardLoading(false);
    }
  }, [apiBaseUrl, selectedDateFrom, selectedDateTo, selectedMonthFrom, session]);

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

  const todayAttendance = useMemo(
    () => attendanceRows.find((row) => String(row.date || '') === todayIso()) || null,
    [attendanceRows]
  );

  const employeeSummary =
    dashboardSummary?.view === 'admin' && dashboardSummary.selectedEmployee
      ? dashboardSummary.selectedEmployee
      : dashboardSummary;

  const monthlySalary = useMemo(() => {
    const fromApi = toMoneyNumber(employeeSummary?.compensation?.grossPay);
    if (fromApi > 0) {
      return fromApi;
    }
    return (
      toMoneyNumber(employeeProfile?.basicPay) +
      toMoneyNumber(employeeProfile?.monthlyBonuses) +
      toMoneyNumber(employeeProfile?.transportAllowance) +
      toMoneyNumber(employeeProfile?.housingAllowance) +
      toMoneyNumber(employeeProfile?.foodAllowance)
    );
  }, [employeeProfile, employeeSummary?.compensation?.grossPay]);

  const rangeDateFrom = isIsoDate(selectedDateFrom) ? selectedDateFrom : `${selectedMonthFrom}-01`;
  const rangeDateTo = isIsoDate(selectedDateTo) ? selectedDateTo : todayIso();
  const normalizedMonthFrom =
    rangeDateFrom.slice(0, 7) <= rangeDateTo.slice(0, 7) ? rangeDateFrom.slice(0, 7) : rangeDateTo.slice(0, 7);
  const normalizedMonthTo =
    rangeDateFrom.slice(0, 7) <= rangeDateTo.slice(0, 7) ? rangeDateTo.slice(0, 7) : rangeDateFrom.slice(0, 7);
  const selectedMonthCount = countInclusiveMonths(normalizedMonthFrom, normalizedMonthTo);

  const localDeductionItems = useMemo(
    () =>
      buildDeductionItemsForMonths(attendanceRows, normalizedMonthFrom, normalizedMonthTo).filter((item) => {
        if (rangeDateFrom && item.date < rangeDateFrom) {
          return false;
        }
        if (rangeDateTo && item.date > rangeDateTo) {
          return false;
        }
        return true;
      }),
    [attendanceRows, normalizedMonthFrom, normalizedMonthTo, rangeDateFrom, rangeDateTo]
  );

  const apiPeriod = employeeSummary?.periodSummary;
  const hasApiPeriod = Boolean(apiPeriod);
  const periodDeductionItems =
    Array.isArray(apiPeriod?.deductionItems) && apiPeriod.deductionItems.length > 0
      ? apiPeriod.deductionItems
      : localDeductionItems;
  const periodDeductionAmount = hasApiPeriod
    ? toMoneyNumber(apiPeriod?.amountDeducted)
    : periodDeductionItems.reduce((total, item) => total + item.amount, 0);
  const periodTotalSalary =
    toMoneyNumber(apiPeriod?.totalSalary) > 0
      ? toMoneyNumber(apiPeriod?.totalSalary)
      : monthlySalary * selectedMonthCount;
  const periodRemainingBalance = Math.max(0, periodTotalSalary - periodDeductionAmount);

  const applyMonthFrom = (monthValue: string) => {
    setSelectedMonthFrom(monthValue);
    setSelectedDateFrom(`${monthValue}-01`);
  };
  const applyMonthTo = (monthValue: string) => {
    setSelectedMonthTo(monthValue);
    setSelectedDateTo(monthEndIso(monthValue));
  };

  const renderMonthChip = (monthValue: string, selectedValue: string, onSelect: (value: string) => void) => (
    <Pressable
      key={`${selectedValue}-${monthValue}`}
      style={[styles.monthChip, selectedValue === monthValue ? styles.monthChipActive : null]}
      onPress={() => onSelect(monthValue)}
    >
      <Text style={[styles.monthChipText, selectedValue === monthValue ? styles.monthChipTextActive : null]}>
        {formatMonthLabel(monthValue)}
      </Text>
    </Pressable>
  );

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

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Salary period</Text>
        <Text style={styles.detailText}>
          Choose the date range used for total salary, deductions, and remaining balance. Summary cards load from the same dashboard API as the web app.
        </Text>
        <View style={styles.fieldRow}>
          <View style={styles.fieldGroupWide}>
            <Text style={styles.fieldLabel}>From date</Text>
            <TextInput
              value={selectedDateFrom}
              onChangeText={setSelectedDateFrom}
              onEndEditing={() => {
                if (isIsoDate(selectedDateFrom)) {
                  setSelectedMonthFrom(selectedDateFrom.slice(0, 7));
                }
              }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <View style={styles.fieldGroupWide}>
            <Text style={styles.fieldLabel}>To date</Text>
            <TextInput
              value={selectedDateTo}
              onChangeText={setSelectedDateTo}
              onEndEditing={() => {
                if (isIsoDate(selectedDateTo)) {
                  setSelectedMonthTo(selectedDateTo.slice(0, 7));
                }
              }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
        </View>
        <Text style={styles.fieldLabel}>From month</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthChipRow}>
          {monthOptions.map((monthValue) => renderMonthChip(monthValue, selectedMonthFrom, applyMonthFrom))}
        </ScrollView>
        <Text style={styles.fieldLabel}>To month</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthChipRow}>
          {monthOptions.map((monthValue) => renderMonthChip(monthValue, selectedMonthTo, applyMonthTo))}
        </ScrollView>
        <Text style={styles.cardHelperText}>
          {rangeDateFrom} → {rangeDateTo}
          {` • ${formatMonthLabel(normalizedMonthFrom)}`}
          {normalizedMonthFrom === normalizedMonthTo ? '' : ` to ${formatMonthLabel(normalizedMonthTo)}`}
          {` • ${selectedMonthCount} month(s)`}
        </Text>
      </View>

      <View style={styles.statsRow}>
        <StatCard
          label="Total Salary"
          value={formatMoney(periodTotalSalary, currencyCode)}
          tone="default"
          helper={<Text style={styles.cardHelperText}>{formatMoney(monthlySalary, currencyCode)} / month</Text>}
        />
        <StatCard
          label="Total Deduction"
          value={formatMoney(periodDeductionAmount, currencyCode)}
          tone="danger"
          helper={<Text style={styles.cardHelperText}>{periodDeductionItems.length} item(s)</Text>}
          onPress={() => setDeductionModalVisible(true)}
        />
        <StatCard
          label="Take Home"
          value={formatMoney(periodRemainingBalance, currencyCode)}
          tone="success"
          helper={<Text style={styles.cardHelperText}>Remaining after selected deductions</Text>}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pay breakdown</Text>
        <View style={styles.summaryList}>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Gross pay (monthly)</Text>
            <Text style={styles.summaryValue}>{formatMoney(monthlySalary, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Selected-period deductions</Text>
            <Text style={styles.summaryValue}>{formatMoney(periodDeductionAmount, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Remaining balance</Text>
            <Text style={styles.summaryValue}>{formatMoney(periodRemainingBalance, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Today deduction</Text>
            <Text style={styles.summaryValue}>{formatMoney(dashboardSummary?.attendance?.deductionAmount, currencyCode)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.detailText}>Month-to-date deduction</Text>
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

  const allowMultipleClockings = Boolean(tracking.settings?.randomSelfieEnabled);
  const openClockInCount = getOpenClockInCount(todayAttendance);
  const canClockIn = Boolean(mobileSettings?.allowClockIn) && (allowMultipleClockings || openClockInCount <= 0);
  const canClockOut = Boolean(mobileSettings?.allowClockOut) && openClockInCount > 0;

  const handleClockAction = async (mode: 'clock-in' | 'clock-out') => {
    if (!session || !mobileSettings) {
      return;
    }
    if (mode === 'clock-in' && !canClockIn) {
      showMobileToast('Clock-in is already active. Clock out first.', 'info');
      return;
    }
    if (mode === 'clock-out' && !canClockOut) {
      showMobileToast('Clock in first before clocking out.', 'info');
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
      if (mode === 'clock-in') {
        await tracking.enableTracking();
      } else {
        await tracking.disableTracking();
      }
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
          style={[styles.smallButton, !canClockIn ? styles.disabledButton : null]}
          onPress={() => handleClockAction('clock-in')}
          disabled={clockLoadingMode !== '' || !canClockIn}
        >
          <Text style={styles.buttonText}>{clockLoadingMode === 'clock-in' ? 'Clocking...' : 'Clock In'}</Text>
        </Pressable>
        <Pressable
          style={[styles.smallButton, styles.secondaryButton, !canClockOut ? styles.disabledButton : null]}
          onPress={() => handleClockAction('clock-out')}
          disabled={clockLoadingMode !== '' || !canClockOut}
        >
          <Text style={styles.buttonText}>{clockLoadingMode === 'clock-out' ? 'Clocking...' : 'Clock Out'}</Text>
        </Pressable>
        <Pressable style={[styles.smallButton, styles.ghostButton]} onPress={refreshDashboard} disabled={dashboardLoading}>
          <Text style={styles.ghostButtonText}>Refresh</Text>
        </Pressable>
      </View>
      <Text style={styles.detailText}>
        {allowMultipleClockings
          ? 'Multiple clock-ins are enabled for random selfie verification.'
          : 'Single session: clock in to start work and tracking, then clock out to stop both.'}
      </Text>
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
          <Pressable
            style={[styles.smallButton, tracking.enabled ? styles.disabledButton : null]}
            onPress={tracking.enableTracking}
            disabled={tracking.loading || tracking.enabled}
          >
            <Text style={styles.buttonText}>
              {tracking.loading && !tracking.enabled ? 'Starting...' : tracking.enabled ? 'Tracking Active' : 'Start Tracking'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.smallButton, styles.dangerButton, !tracking.enabled ? styles.disabledButton : null]}
            onPress={tracking.disableTracking}
            disabled={tracking.loading || !tracking.enabled}
          >
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
        <StatCard
          label="Total Salary"
          value={formatMoney(periodTotalSalary, currencyCode)}
          helper={<Text style={styles.cardHelperText}>{formatMoney(monthlySalary, currencyCode)} / month</Text>}
        />
        <StatCard
          label="Total Deduction"
          value={formatMoney(periodDeductionAmount, currencyCode)}
          tone="danger"
          helper={<Text style={styles.cardHelperText}>{periodDeductionItems.length} item(s)</Text>}
          onPress={() => setDeductionModalVisible(true)}
        />
      </View>

      <View style={styles.statsRow}>
        <StatCard
          label="Take Home"
          value={formatMoney(periodRemainingBalance, currencyCode)}
          tone="success"
          helper={<Text style={styles.cardHelperText}>Remaining after selected deductions</Text>}
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

      <Modal
        visible={deductionModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setDeductionModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.heroTextWrap}>
                <Text style={styles.sectionTitle}>Deduction details</Text>
                <Text style={styles.detailText}>
                  {formatMonthLabel(normalizedMonthFrom)}
                  {normalizedMonthFrom === normalizedMonthTo ? '' : ` → ${formatMonthLabel(normalizedMonthTo)}`}
                  {` • ${formatMoney(periodDeductionAmount, currencyCode)}`}
                </Text>
              </View>
              <Pressable style={[styles.smallButton, styles.ghostButton]} onPress={() => setDeductionModalVisible(false)}>
                <Text style={styles.ghostButtonText}>Close</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalList}>
              {periodDeductionItems.length === 0 ? (
                <Text style={styles.detailText}>No lateness or attendance deductions in the selected months.</Text>
              ) : (
                periodDeductionItems.map((item) => (
                  <View key={item.id} style={styles.listRow}>
                    <View style={styles.listTextWrap}>
                      <Text style={styles.listTitle}>{item.label}</Text>
                      <Text style={styles.detailText}>
                        {item.date} at {item.time}
                      </Text>
                      <Text style={styles.mutedTiny}>{item.lateMinutes} minute(s) late</Text>
                    </View>
                    <Text style={styles.listMeta}>{formatMoney(item.amount, currencyCode)}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  monthChipRow: {
    gap: 8,
    paddingVertical: 4,
  },
  monthChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  monthChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  monthChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  monthChipTextActive: {
    color: colors.text,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.72)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '78%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalList: {
    gap: 10,
    paddingBottom: 24,
  },
});
