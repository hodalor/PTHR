const LOCAL_API_BASE_URL = 'http://localhost:8000';
const REMOTE_API_BASE_URL = 'https://pthr.onrender.com';

const resolveDefaultApiBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const hostname = String(window.location?.hostname || '').trim().toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return LOCAL_API_BASE_URL;
    }
  }
  return REMOTE_API_BASE_URL;
};

const DEFAULT_API_BASE_URL = resolveDefaultApiBaseUrl();

export const API_BASE_URL = String(process.env.REACT_APP_API_BASE_URL || DEFAULT_API_BASE_URL)
  .trim()
  .replace(/\/+$/, '');

export const toApiUrl = (url) => String(url || '').replace(/^http:\/\/localhost:8000/i, API_BASE_URL);

export const buildApiUrl = (path) => {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${API_BASE_URL}${normalizedPath}`;
};
