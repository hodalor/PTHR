import { apiRequest } from './http';
import { AuthSession, AuthUser } from '../types/app';

type LoginResponse = {
  token: string;
  user: AuthUser;
};

export const loginWithCredentials = async (apiBaseUrl: string, username: string, password: string) => {
  const response = await apiRequest<LoginResponse>(apiBaseUrl, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });

  const session: AuthSession = {
    token: response.token,
    user: response.user,
  };

  return session;
};

export const fetchCurrentUser = async (apiBaseUrl: string, token: string) => {
  const response = await apiRequest<{ user: AuthUser }>(apiBaseUrl, '/api/auth/me', {
    token,
  });

  return response.user;
};

