import { buildApiUrl } from '../config/env';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
};

export const apiRequest = async <T>(apiBaseUrl: string, path: string, options: RequestOptions = {}) => {
  const requestUrl = buildApiUrl(apiBaseUrl, path);
  let response: Response;

  try {
    response = await fetch(requestUrl, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    throw new Error(`Unable to reach backend at ${requestUrl}`);
  }

  const data = (await response.json().catch(() => null)) as T | { error?: string } | null;

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && 'error' in data && data.error) || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return data as T;
};
