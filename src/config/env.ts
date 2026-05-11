import { Platform } from 'react-native';

const hostedApiBaseUrl = 'https://pthr.onrender.com';

const isLocalDevHost = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    normalized.includes('localhost') ||
    normalized.includes('127.0.0.1') ||
    normalized.includes('10.0.2.2') ||
    normalized.includes('192.168.')
  );
};

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || '';

export const defaultApiBaseUrl =
  !__DEV__ && (!configuredApiBaseUrl || isLocalDevHost(configuredApiBaseUrl))
    ? hostedApiBaseUrl
    : configuredApiBaseUrl || hostedApiBaseUrl;

export const normalizeApiBaseUrl = (value: string) => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
};

export const resolveApiBaseUrl = (value: string) => {
  const normalized = normalizeApiBaseUrl(value);
  if (!normalized) {
    return '';
  }

  try {
    const url = new URL(normalized);
    const hostname = String(url.hostname || '').trim().toLowerCase();
    if (Platform.OS === 'android' && (hostname === 'localhost' || hostname === '127.0.0.1')) {
      url.hostname = '10.0.2.2';
      return url.toString().replace(/\/$/, '');
    }
    return normalized;
  } catch (error) {
    return normalized;
  }
};

export const buildApiUrl = (baseUrl: string, path: string) => {
  const normalizedBaseUrl = resolveApiBaseUrl(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
};
