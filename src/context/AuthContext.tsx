import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { defaultApiBaseUrl, resolveApiBaseUrl } from '../config/env';
import { fetchCurrentUser, loginWithCredentials, logoutSession } from '../services/auth';
import {
  clearAuthSession,
  loadApiBaseUrl,
  loadAuthSession,
  saveApiBaseUrl,
  saveAuthSession,
} from '../services/storage';
import { AuthSession } from '../types/app';

type AuthContextValue = {
  apiBaseUrl: string;
  authReady: boolean;
  isAuthenticating: boolean;
  session: AuthSession | null;
  setApiBaseUrl: (value: string) => Promise<void>;
  login: (tenantId: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [apiBaseUrl, updateApiBaseUrl] = useState(defaultApiBaseUrl);

  useEffect(() => {
    const restore = async () => {
      try {
        const storedSession = await loadAuthSession();
        const storedApiBaseUrl = await loadApiBaseUrl();
        const nextApiBaseUrl = resolveApiBaseUrl(storedApiBaseUrl || defaultApiBaseUrl);
        updateApiBaseUrl(nextApiBaseUrl);
        if (!storedSession) {
          return;
        }
        const user = await fetchCurrentUser(nextApiBaseUrl, storedSession.token);
        setSession({
          token: storedSession.token,
          user,
        });
      } catch (error) {
        await clearAuthSession();
        setSession(null);
      } finally {
        setAuthReady(true);
      }
    };

    restore();
  }, []);

  const setApiBaseUrl = async (value: string) => {
    const nextApiBaseUrl = resolveApiBaseUrl(value || defaultApiBaseUrl);
    updateApiBaseUrl(nextApiBaseUrl);
    await saveApiBaseUrl(nextApiBaseUrl);
  };

  const login = async (tenantId: string, username: string, password: string) => {
    const normalizedApiBaseUrl = resolveApiBaseUrl(apiBaseUrl || defaultApiBaseUrl);
    updateApiBaseUrl(normalizedApiBaseUrl);
    await saveApiBaseUrl(normalizedApiBaseUrl);
    setIsAuthenticating(true);
    try {
      const nextSession = await loginWithCredentials(normalizedApiBaseUrl, tenantId, username, password);
      setSession(nextSession);
      await saveAuthSession(nextSession);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const logout = async () => {
    if (session?.token) {
      try {
        await logoutSession(apiBaseUrl, session.token);
      } catch (error) {
      }
    }
    setSession(null);
    await clearAuthSession();
  };

  const value = useMemo(
    () => ({
      apiBaseUrl,
      authReady,
      isAuthenticating,
      session,
      setApiBaseUrl,
      login,
      logout,
    }),
    [apiBaseUrl, authReady, isAuthenticating, login, logout, session, setApiBaseUrl]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
};
