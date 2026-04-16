import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { defaultApiBaseUrl, resolveApiBaseUrl } from '../config/env';
import { fetchCurrentUser, loginWithCredentials, logoutSession } from '../services/auth';
import {
  clearApiBaseUrl,
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from '../services/storage';
import { AuthSession } from '../types/app';

type AuthContextValue = {
  apiBaseUrl: string;
  authReady: boolean;
  isAuthenticating: boolean;
  session: AuthSession | null;
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
        const nextApiBaseUrl = resolveApiBaseUrl(defaultApiBaseUrl);
        updateApiBaseUrl(nextApiBaseUrl);
        await clearApiBaseUrl();
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

  const login = async (tenantId: string, username: string, password: string) => {
    const normalizedApiBaseUrl = resolveApiBaseUrl(defaultApiBaseUrl);
    updateApiBaseUrl(normalizedApiBaseUrl);
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
      login,
      logout,
    }),
    [apiBaseUrl, authReady, isAuthenticating, session]
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
