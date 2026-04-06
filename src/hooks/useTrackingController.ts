import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthSession, TrackingSettings } from '../types/app';
import {
  captureCurrentLocation,
  fetchTrackingSettings,
  isBackgroundTrackingActive,
  persistTrackingRuntime,
  requestForegroundLocationPermission,
  requestTrackingPermissions,
  reportLocationStatus,
  startBackgroundTracking,
  stopBackgroundTracking,
  transmitLocation,
} from '../services/tracking';

const runWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

type TrackingState = {
  latestStatus: string;
  distanceMeters: number | null;
  lastSentAt: string;
  latestCoordinates: { latitude: number; longitude: number; accuracy: number | null } | null;
  error: string;
  loading: boolean;
  enabled: boolean;
  settings: TrackingSettings | null;
};

const initialState: TrackingState = {
  latestStatus: 'IDLE',
  distanceMeters: null,
  lastSentAt: '',
  latestCoordinates: null,
  error: '',
  loading: false,
  enabled: false,
  settings: null,
};

export const useTrackingController = (apiBaseUrl: string, session: AuthSession | null) => {
  const [state, setState] = useState<TrackingState>(initialState);

  const refreshSettings = useCallback(async () => {
    if (!apiBaseUrl) {
      return;
    }
    const settings = await fetchTrackingSettings(apiBaseUrl);
    setState((prev) => ({ ...prev, settings }));
  }, [apiBaseUrl]);

  const refreshTrackingStatus = useCallback(async () => {
    const enabled = await isBackgroundTrackingActive();
    setState((prev) => ({ ...prev, enabled }));
  }, []);

  useEffect(() => {
    refreshTrackingStatus();
  }, [refreshTrackingStatus]);

  useEffect(() => {
    if (!session || !apiBaseUrl) {
      setState(initialState);
      return;
    }

    const boot = async () => {
      try {
        await persistTrackingRuntime({ apiBaseUrl, session });
        await Promise.all([refreshSettings(), refreshTrackingStatus()]);
        await requestForegroundLocationPermission();
        const position = await captureCurrentLocation();
        const response = await transmitLocation({
          apiBaseUrl,
          session,
          location: position.coords,
          mocked: position.mocked,
          activity: 'boot',
        });
        setState((prev) => ({
          ...prev,
          latestStatus: response.status || prev.latestStatus,
          distanceMeters: typeof response.distanceMeters === 'number' ? response.distanceMeters : prev.distanceMeters,
          lastSentAt: new Date().toISOString(),
          latestCoordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null,
          },
        }));
      } catch (caughtError) {
        const errorMessage =
          caughtError instanceof Error ? caughtError.message : 'Failed to initialize tracking';
        try {
          await reportLocationStatus({
            apiBaseUrl,
            session,
            locationDisabled: true,
            reason: errorMessage,
            activity: 'boot',
          });
        } catch (reportError) {
        }
        setState((prev) => ({
          ...prev,
          error: errorMessage,
        }));
      }
    };

    boot();
  }, [apiBaseUrl, refreshSettings, refreshTrackingStatus, session]);

  const sendCurrentLocation = useCallback(async (options?: { silent?: boolean }) => {
    if (!session || !apiBaseUrl) {
      return;
    }
    const isSilent = Boolean(options?.silent);
    if (!isSilent) {
      setState((prev) => ({ ...prev, loading: true, error: '' }));
    }
    try {
      await requestForegroundLocationPermission();
      await persistTrackingRuntime({ apiBaseUrl, session });
      const position = await captureCurrentLocation();
      const response = await transmitLocation({
        apiBaseUrl,
        session,
        location: position.coords,
        mocked: position.mocked,
        activity: 'foreground',
      });
      setState((prev) => ({
        ...prev,
        loading: isSilent ? prev.loading : false,
        latestStatus: response.status || 'SENT',
        distanceMeters: typeof response.distanceMeters === 'number' ? response.distanceMeters : null,
        lastSentAt: new Date().toISOString(),
        latestCoordinates: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
        },
      }));
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : 'Failed to send location';
      try {
        await reportLocationStatus({
          apiBaseUrl,
          session,
          locationDisabled: true,
          reason: errorMessage,
          activity: 'foreground',
        });
      } catch (reportError) {
      }
      setState((prev) => ({
        ...prev,
        loading: isSilent ? prev.loading : false,
        error: isSilent ? prev.error : errorMessage,
      }));
    }
  }, [apiBaseUrl, session]);

  const enableTracking = useCallback(async () => {
    if (!session || !apiBaseUrl) {
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      await runWithTimeout(
        requestForegroundLocationPermission(),
        8000,
        'Location permission request timed out. Please try again.'
      );
      let backgroundEnabled = false;
      try {
        await runWithTimeout(
          requestTrackingPermissions(),
          8000,
          'Background permission request timed out. Using foreground tracking.'
        );
        await runWithTimeout(
          startBackgroundTracking({ apiBaseUrl, session }),
          8000,
          'Background tracking start timed out. Using foreground tracking.'
        );
        backgroundEnabled = true;
      } catch (backgroundError) {
        backgroundEnabled = false;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        enabled: true,
        latestStatus: backgroundEnabled ? prev.latestStatus : 'FOREGROUND_ONLY',
        error: '',
      }));
      await sendCurrentLocation({ silent: true });
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : 'Unable to start tracking';
      setState((prev) => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));
    }
  }, [apiBaseUrl, sendCurrentLocation, session]);

  const disableTracking = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      await stopBackgroundTracking();
      setState((prev) => ({
        ...prev,
        loading: false,
        enabled: false,
      }));
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : 'Unable to stop tracking';
      setState((prev) => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));
    }
  }, []);

  useEffect(() => {
    if (!session || !state.enabled) {
      return;
    }
    const intervalId = setInterval(() => {
      sendCurrentLocation({ silent: true });
    }, 12000);
    return () => clearInterval(intervalId);
  }, [sendCurrentLocation, session, state.enabled]);

  return useMemo(
    () => ({
      ...state,
      refreshSettings,
      refreshTrackingStatus,
      sendCurrentLocation,
      enableTracking,
      disableTracking,
    }),
    [disableTracking, enableTracking, refreshSettings, refreshTrackingStatus, sendCurrentLocation, state]
  );
};
