const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEYS = ['password', 'token', 'secret', 'authorization', 'privatekey', 'private_key'];

const resolveThreshold = () => {
  if (process.env.NODE_ENV === 'production') {
    return LOG_LEVELS.warn;
  }
  return LOG_LEVELS.debug;
};

const sanitizeValue = (value) => {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
    const normalizedKey = String(key || '').toLowerCase();
    accumulator[key] = SENSITIVE_KEYS.some((sensitiveKey) => normalizedKey.includes(sensitiveKey))
      ? '[REDACTED]'
      : sanitizeValue(entryValue);
    return accumulator;
  }, {});
};

const writeLog = (level, message, context) => {
  if (LOG_LEVELS[level] < resolveThreshold()) {
    return;
  }

  const payload = sanitizeValue(context);
  const consoleMethod = console[level] || console.log;
  if (payload && Object.keys(payload).length > 0) {
    consoleMethod(`[${level}] ${message}`, payload);
    return;
  }
  consoleMethod(`[${level}] ${message}`);
};

export const logger = {
  debug: (message, context = {}) => writeLog('debug', message, context),
  info: (message, context = {}) => writeLog('info', message, context),
  warn: (message, context = {}) => writeLog('warn', message, context),
  error: (message, context = {}) => writeLog('error', message, context),
};
