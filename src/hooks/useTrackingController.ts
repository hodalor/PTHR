import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthSession, TrackingSettings } from '../types/app';
import {
  captureCurrentLocation,
  fetchTrackingSettings,
  isBackgroundTrackingActive,
  persistTrackingRuntime,
  requestTrackingPermissions,
  startBackgroundTracking,
  stopBackgroundTracking,
  transmitLocation,
} from '../services/tracking';

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
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to initialize tracking',
        }));
      }
    };

    boot();
  }, [apiBaseUrl, refreshSettings, refreshTrackingStatus, session]);

  const sendCurrentLocation = useCallback(async () => {
    if (!session) {
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
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
        loading: false,
        latestStatus: response.status || 'SENT',
        distanceMeters: typeof response.distanceMeters === 'number' ? response.distanceMeters : null,
        lastSentAt: new Date().toISOString(),
        latestCoordinates: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
        },
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to send location',
      }));
    }
  }, [apiBaseUrl, session]);

  const enableTracking = useCallback(async () => {
    if (!session) {
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      await requestTrackingPermissions();
      await startBackgroundTracking({ apiBaseUrl, session });
      await sendCurrentLocation();
      setState((prev) => ({
        ...prev,
        loading: false,
        enabled: true,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to start tracking',
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
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to stop tracking',
      }));
    }
  }, []);

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

