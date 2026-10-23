import {
  enhancePayrollRows,
  getAttendanceDayRuleKey,
  normalizeShiftDayRules,
} from './enhancePayrollRows';

const toMinutesFromClock = (value) => {
  const normalized = String(value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(normalized)) {
    return null;
  }
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours * 60 + minutes;
};

const getMinutesBetweenClocks = (start, end) => {
  const startMinutes = toMinutesFromClock(start);
  const endMinutes = toMinutesFromClock(end);
  if (startMinutes === null || endMinutes === null) {
    return 0;
  }
  return Math.max(0, endMinutes - startMinutes);
};

const buildSharedArgs = (overrides = {}) => ({
  baseRows: [
    {
      employeeId: 'EMP-001',
      employee: 'Amina Yusuf',
      basicPay: '3000',
      workingDays: '30',
    },
  ],
  moduleRowsState: {
    'employee-management': [
      {
        id: 'EMP-001',
        employeeId: 'HR00000001',
        fullName: 'Amina Yusuf',
        assignedShift: 'Main Shift',
        department: 'Operations',
        status: 'Active',
        employmentState: 'Confirmed',
        basicPay: '3000',
        workingDays: '30',
      },
    ],
    'attendance-time': [],
    'leave-management': [],
    'attendance-penalty-adjustments': [],
    'loan-records': [],
  },
  appSettings: {
    payrollWorkingDays: 30,
    attendanceReportTime: '08:00',
    attendanceShiftEnd: '17:00',
    attendanceCalculationMode: 'fixed',
    attendanceFixedDeductionPerMinute: 2,
    attendanceFixedScope: 'all',
    attendanceNoClockInPenaltyPercent: 25,
    attendanceNoClockOutPenaltyPercent: 10,
    attendanceAbsentPenaltyPercent: 100,
    attendanceHolidayDates: ['2026-12-25'],
    shifts: [
      {
        name: 'Main Shift',
        reportTime: '08:00',
        shiftEnd: '17:00',
        graceInMinutes: 15,
        graceOutMinutes: 10,
        dayRules: {
          saturday: {
            enabled: true,
            reportTime: '09:00',
            shiftEnd: '13:00',
            graceInMinutes: 15,
            graceOutMinutes: 5,
          },
          holiday: {
            enabled: true,
            reportTime: '10:00',
            shiftEnd: '14:00',
            graceInMinutes: 0,
            graceOutMinutes: 0,
          },
        },
      },
    ],
  },
  getTodayIsoDate: () => '2026-09-15',
  getCurrentClockValue: () => '18:00',
  toMinutesFromClock,
  getMinutesBetweenClocks,
  isLoanCountableRecord: () => true,
  ...overrides,
});

describe('enhancePayrollRows attendance helpers', () => {
  test('normalizes weekday and weekend rules for multiple shift schedules', () => {
    const dayRules = normalizeShiftDayRules(
      {
        saturday: {
          enabled: true,
          reportTime: '09:00',
          shiftEnd: '13:00',
          graceInMinutes: 15,
        },
      },
      {
        reportTime: '08:00',
        shiftEnd: '17:00',
        graceInMinutes: 10,
      }
    );

    expect(dayRules.monday.enabled).toBe(true);
    expect(dayRules.monday.reportTime).toBe('08:00');
    expect(dayRules.saturday.enabled).toBe(true);
    expect(dayRules.saturday.reportTime).toBe('09:00');
    expect(dayRules.sunday.enabled).toBe(false);
  });

  test('resolves weekday, weekend, holiday, and invalid dates', () => {
    expect(getAttendanceDayRuleKey('2026-09-15')).toBe('tuesday');
    expect(getAttendanceDayRuleKey('2026-09-13')).toBe('sunday');
    expect(getAttendanceDayRuleKey('2026-12-25', ['2026-12-25'])).toBe('holiday');
    expect(getAttendanceDayRuleKey('')).toBe('monday');
  });
});

describe('enhancePayrollRows attendance penalties', () => {
  test('applies no-clock-in penalty when clock-in is missing after deadline', () => {
    const results = enhancePayrollRows(
      buildSharedArgs({
        moduleRowsState: {
          ...buildSharedArgs().moduleRowsState,
          'attendance-time': [
            {
              id: 'ATT-001',
              employeeId: 'EMP-001',
              employee: 'Amina Yusuf',
              date: '2026-09-14',
              shift: 'Main Shift',
              checkOut: '17:05',
            },
          ],
        },
      })
    );

    expect(results[0].noClockInPenalty).toBe('25.00');
    expect(results[0].noClockOutPenalty).toBe('0.00');
    expect(results[0].absentPenalty).toBe('0.00');
  });

  test('applies no-clock-out penalty when clock-out is missing after deadline', () => {
    const results = enhancePayrollRows(
      buildSharedArgs({
        moduleRowsState: {
          ...buildSharedArgs().moduleRowsState,
          'attendance-time': [
            {
              id: 'ATT-002',
              employeeId: 'EMP-001',
              employee: 'Amina Yusuf',
              date: '2026-09-14',
              shift: 'Main Shift',
              checkIn: '08:05',
            },
          ],
        },
      })
    );

    expect(results[0].noClockInPenalty).toBe('0.00');
    expect(results[0].noClockOutPenalty).toBe('10.00');
    expect(results[0].absentPenalty).toBe('0.00');
  });

  test('uses the configured Saturday rule when computing late deductions', () => {
    const results = enhancePayrollRows(
      buildSharedArgs({
        moduleRowsState: {
          ...buildSharedArgs().moduleRowsState,
          'attendance-time': [
            {
              id: 'ATT-003',
              employeeId: 'EMP-001',
              employee: 'Amina Yusuf',
              date: '2026-09-12',
              shift: 'Main Shift',
              checkIn: '09:20',
              checkOut: '13:15',
            },
          ],
        },
      })
    );

    expect(results[0].lateDeduction).toBe('10.00');
    expect(results[0].totalAttendancePenalty).toBe('10.00');
  });

  test('falls back safely when shift rule configuration is missing', () => {
    const results = enhancePayrollRows(
      buildSharedArgs({
        appSettings: {
          ...buildSharedArgs().appSettings,
          shifts: [
            {
              name: 'Main Shift',
              reportTime: '08:00',
              shiftEnd: '17:00',
              dayRules: null,
            },
          ],
        },
        moduleRowsState: {
          ...buildSharedArgs().moduleRowsState,
          'attendance-time': [
            {
              id: 'ATT-004',
              employeeId: 'EMP-001',
              employee: 'Amina Yusuf',
              date: '2026-09-15',
              shift: 'Main Shift',
              lateMinutes: 5,
              checkIn: '08:20',
              checkOut: '17:00',
            },
          ],
        },
      })
    );

    expect(results[0].lateDeduction).toBe('10.00');
    expect(results[0].noClockInPenalty).toBe('0.00');
    expect(results[0].noClockOutPenalty).toBe('0.00');
  });

  test('keeps saved payroll deduction snapshot instead of overwriting from live attendance', () => {
    const results = enhancePayrollRows(
      buildSharedArgs({
        baseRows: [
          {
            employeeId: 'EMP-001',
            employee: 'Amina Yusuf',
            basicPay: '3000',
            workingDays: '30',
            napsaDeduction: '150.00',
            nhimaDeduction: '30.00',
            taxDeduction: '0.00',
            otherDeduction: '20.00',
            lateDeduction: '10.00',
            noClockInPenalty: '0.00',
            noClockOutPenalty: '0.00',
            absentPenalty: '0.00',
            totalDeductions: '210.00',
            totalEarnings: '3000.00',
          },
        ],
        moduleRowsState: {
          ...buildSharedArgs().moduleRowsState,
          'attendance-time': [],
        },
      })
    );

    expect(results[0].lateDeduction).toBe('10.00');
    expect(results[0].napsaDeduction).toBe('150.00');
    expect(results[0].nhimaDeduction).toBe('30.00');
    expect(results[0].otherDeduction).toBe('20.00');
    expect(results[0].totalAttendancePenalty).toBe('10.00');
    expect(results[0].totalDeductions).toBe('210.00');
    expect(results[0].netPayable).toBe('2790.00');
  });
});
