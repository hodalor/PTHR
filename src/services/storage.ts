import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthSession, TrackingRuntimeConfig } from '../types/app';

export const AUTH_SESSION_KEY = 'pthr_mobile_auth_session';
export const API_BASE_URL_KEY = 'pthr_mobile_api_base_url';
export const TRACKING_RUNTIME_KEY = 'pthr_mobile_tracking_runtime';

export const loadAuthSession = async () => {
  const raw = await AsyncStorage.getItem(AUTH_SESSION_KEY);
  return raw ? (JSON.parse(raw) as AuthSession) : null;
};

export const saveAuthSession = async (session: AuthSession) => {
  await AsyncStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
};

export const clearAuthSession = async () => {
  await AsyncStorage.removeItem(AUTH_SESSION_KEY);
};

export const clearApiBaseUrl = async () => {
  await AsyncStorage.removeItem(API_BASE_URL_KEY);
};

export const loadApiBaseUrl = async () => AsyncStorage.getItem(API_BASE_URL_KEY);

export const saveApiBaseUrl = async (apiBaseUrl: string) => {
  await AsyncStorage.setItem(API_BASE_URL_KEY, apiBaseUrl.trim());
};

export const saveTrackingRuntime = async (config: TrackingRuntimeConfig) => {
  const current = await loadTrackingRuntime();
  await AsyncStorage.setItem(TRACKING_RUNTIME_KEY, JSON.stringify({ ...(current || {}), ...config }));
};

export const loadTrackingRuntime = async () => {
  const raw = await AsyncStorage.getItem(TRACKING_RUNTIME_KEY);
  return raw ? (JSON.parse(raw) as TrackingRuntimeConfig) : null;
};
