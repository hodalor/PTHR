const DEFAULT_API_BASE_URL = 'http://localhost:8000';

export const API_BASE_URL = String(process.env.REACT_APP_API_BASE_URL || DEFAULT_API_BASE_URL)
  .trim()
  .replace(/\/+$/, '');

export const toApiUrl = (url) => String(url || '').replace(/^http:\/\/localhost:8000/i, API_BASE_URL);

export const buildApiUrl = (path) => {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${API_BASE_URL}${normalizedPath}`;
};
