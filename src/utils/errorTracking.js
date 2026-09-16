import { logger } from './logger';

const normalizeErrorPayload = (error, context = {}) => ({
  name: error?.name || 'Error',
  message: error?.message || 'Unknown error',
  stack: error?.stack || '',
  ...context,
});

export const captureException = (error, context = {}) => {
  logger.error('Captured application exception', normalizeErrorPayload(error, context));
};

export const captureMessage = (message, context = {}) => {
  logger.warn(message, context);
};
