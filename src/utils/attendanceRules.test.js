import {
  ATTENDANCE_DAY_RULE_META,
  getAttendanceDayRuleKey,
  normalizeShiftDayRules,
  parseHolidayDateList,
} from './attendanceRules';

describe('attendanceRules', () => {
  test('defines every attendance rule with labels and defaults', () => {
    expect(ATTENDANCE_DAY_RULE_META.map((item) => item.key)).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'holiday',
    ]);
    expect(ATTENDANCE_DAY_RULE_META.find((item) => item.key === 'holiday')).toEqual({
      key: 'holiday',
      label: 'Holiday',
      defaultEnabled: false,
    });
  });

  test('normalizes missing configuration with base defaults', () => {
    const rules = normalizeShiftDayRules(undefined, {
      reportTime: '08:30',
      shiftEnd: '17:30',
      graceInMinutes: 10,
      overtimeEnabled: true,
      overtimeStartAfterMinutes: 20,
      overtimePayPerMinute: 3,
    });

    expect(rules.monday).toEqual({
      enabled: true,
      reportTime: '08:30',
      shiftEnd: '17:30',
      graceInMinutes: 10,
      graceOutMinutes: 0,
      overtimeEnabled: true,
      overtimeStartAfterMinutes: 20,
      overtimePayPerMinute: 3,
    });
    expect(rules.sunday.enabled).toBe(false);
    expect(rules.holiday.enabled).toBe(false);
  });

  test('keeps explicit overrides and clamps invalid numeric values', () => {
    const rules = normalizeShiftDayRules(
      {
        saturday: {
          enabled: true,
          reportTime: '09:00',
          shiftEnd: '13:00',
          graceInMinutes: -5,
          graceOutMinutes: '7',
          overtimeEnabled: true,
          overtimeStartAfterMinutes: '-10',
          overtimePayPerMinute: 4,
        },
      },
      {
        reportTime: '08:00',
        shiftEnd: '17:00',
        graceInMinutes: 15,
      }
    );

    expect(rules.saturday).toEqual({
      enabled: true,
      reportTime: '09:00',
      shiftEnd: '13:00',
      graceInMinutes: 0,
      graceOutMinutes: 7,
      overtimeEnabled: true,
      overtimeStartAfterMinutes: 0,
      overtimePayPerMinute: 4,
    });
  });

  test('maps weekday, weekend, holiday, and unknown dates to the right rule key', () => {
    expect(getAttendanceDayRuleKey('2026-09-09')).toBe('wednesday');
    expect(getAttendanceDayRuleKey('2026-09-12')).toBe('saturday');
    expect(getAttendanceDayRuleKey('2026-12-25', ['2026-12-25'])).toBe('holiday');
    expect(getAttendanceDayRuleKey('not-a-date')).toBe('monday');
  });

  test('parses holiday dates from arrays and comma-separated strings', () => {
    expect(parseHolidayDateList(['2026-01-01', 'bad-value', '2026-12-25'])).toEqual([
      '2026-01-01',
      '2026-12-25',
    ]);
    expect(parseHolidayDateList('2026-04-04, 2026-05-01 invalid')).toEqual([
      '2026-04-04',
      '2026-05-01',
    ]);
  });
});
