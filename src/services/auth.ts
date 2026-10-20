import { apiRequest } from './http';
import { AuthSession, AuthUser } from '../types/app';

type LoginResponse = {
  token: string;
  user: AuthUser;
};

type PasswordResetRequestResponse = {
  ok: boolean;
  resetToken?: string;
  expiresInSeconds?: number;
  channelsSent?: string[];
  maskedEmail?: string;
  maskedPhone?: string;
  providers?: string[];
  message?: string;
};

type PasswordResetVerifyResponse = {
  ok: boolean;
  resetToken?: string;
  verified?: boolean;
  message?: string;
};

type PasswordResetConfirmResponse = {
  ok: boolean;
  message?: string;
};

export const loginWithCredentials = async (apiBaseUrl: string, tenantId: string, username: string, password: string) => {
  const response = await apiRequest<LoginResponse>(apiBaseUrl, '/api/auth/login', {
    method: 'POST',
    body: { tenantId, username, password },
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

export const logoutSession = async (apiBaseUrl: string, token: string) => {
  await apiRequest<{ ok: boolean }>(apiBaseUrl, '/api/auth/logout', {
    method: 'POST',
    token,
  });
};

export const requestPasswordReset = async (
  apiBaseUrl: string,
  input: { tenantId: string; username: string; channels?: string[] }
) => {
  return apiRequest<PasswordResetRequestResponse>(apiBaseUrl, '/api/auth/password-reset/request', {
    method: 'POST',
    body: {
      tenantId: input.tenantId,
      username: input.username,
      channels: input.channels,
    },
  });
};

export const verifyPasswordResetOtp = async (
  apiBaseUrl: string,
  input: { tenantId: string; resetToken: string; otp: string }
) => {
  return apiRequest<PasswordResetVerifyResponse>(apiBaseUrl, '/api/auth/password-reset/verify', {
    method: 'POST',
    body: {
      tenantId: input.tenantId,
      resetToken: input.resetToken,
      otp: input.otp,
    },
  });
};

export const confirmPasswordReset = async (
  apiBaseUrl: string,
  input: { tenantId: string; resetToken: string; otp: string; newPassword: string }
) => {
  return apiRequest<PasswordResetConfirmResponse>(apiBaseUrl, '/api/auth/password-reset/confirm', {
    method: 'POST',
    body: {
      tenantId: input.tenantId,
      resetToken: input.resetToken,
      otp: input.otp,
      newPassword: input.newPassword,
    },
  });
};
