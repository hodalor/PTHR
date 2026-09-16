export const ATTENDANCE_DAY_RULE_META = [
  { key: 'monday', label: 'Mon', defaultEnabled: true },
  { key: 'tuesday', label: 'Tue', defaultEnabled: true },
  { key: 'wednesday', label: 'Wed', defaultEnabled: true },
  { key: 'thursday', label: 'Thu', defaultEnabled: true },
  { key: 'friday', label: 'Fri', defaultEnabled: true },
  { key: 'saturday', label: 'Sat', defaultEnabled: false },
  { key: 'sunday', label: 'Sun', defaultEnabled: false },
  { key: 'holiday', label: 'Holiday', defaultEnabled: false },
];

const ATTENDANCE_WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const normalizeTimeValue = (value, fallback) => String(value || fallback).trim();

const normalizeMinutesValue = (value, fallback = 0) =>
  value === undefined ? Math.max(0, Number(fallback) || 0) : Math.max(0, Number(value) || 0);

export const parseHolidayDateList = (value) => {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  return items
    .map((item) => String(item || '').trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
};

export const buildDefaultShiftDayRules = (base = {}) =>
  ATTENDANCE_DAY_RULE_META.reduce((accumulator, meta) => {
    accumulator[meta.key] = {
      enabled: meta.defaultEnabled,
      reportTime: normalizeTimeValue(base.reportTime, '08:00'),
      shiftEnd: normalizeTimeValue(base.shiftEnd, '17:00'),
      graceInMinutes: normalizeMinutesValue(base.graceInMinutes),
      graceOutMinutes: normalizeMinutesValue(base.graceOutMinutes),
      overtimeEnabled: Boolean(base.overtimeEnabled),
      overtimeStartAfterMinutes: normalizeMinutesValue(base.overtimeStartAfterMinutes),
      overtimePayPerMinute: normalizeMinutesValue(base.overtimePayPerMinute),
    };
    return accumulator;
  }, {});

export const normalizeShiftDayRules = (dayRules, base = {}) =>
  ATTENDANCE_DAY_RULE_META.reduce((accumulator, meta) => {
    const source = dayRules?.[meta.key] || {};
    accumulator[meta.key] = {
      enabled: source.enabled === undefined ? meta.defaultEnabled : Boolean(source.enabled),
      reportTime: normalizeTimeValue(source.reportTime, base.reportTime || '08:00'),
      shiftEnd: normalizeTimeValue(source.shiftEnd, base.shiftEnd || '17:00'),
      graceInMinutes: normalizeMinutesValue(source.graceInMinutes, base.graceInMinutes),
      graceOutMinutes: normalizeMinutesValue(source.graceOutMinutes, base.graceOutMinutes),
      overtimeEnabled: source.overtimeEnabled === undefined ? Boolean(base.overtimeEnabled) : Boolean(source.overtimeEnabled),
      overtimeStartAfterMinutes: normalizeMinutesValue(
        source.overtimeStartAfterMinutes,
        base.overtimeStartAfterMinutes
      ),
      overtimePayPerMinute: normalizeMinutesValue(source.overtimePayPerMinute, base.overtimePayPerMinute),
    };
    return accumulator;
  }, {});

export const getAttendanceDayRuleKey = (dateValue, holidayDates = []) => {
  const normalizedDate = String(dateValue || '').trim();
  if (normalizedDate && holidayDates.includes(normalizedDate)) {
    return 'holiday';
  }

  const parsed = new Date(`${normalizedDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return 'monday';
  }

  return ATTENDANCE_WEEKDAY_KEYS[parsed.getDay()] || 'monday';
};
