import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { apiRequest } from './http';
import { loadTrackingRuntime, saveTrackingRuntime } from './storage';
import { AuthSession, TrackingRuntimeConfig, TrackingSettings, TrackingTransmissionResult } from '../types/app';

export const LOCATION_TASK_NAME = 'pthr-background-location-task';

const defaultTrackingSettings: TrackingSettings = {
  officeLat: null,
  officeLng: null,
  geofenceRadiusMeters: 100,
  geofenceEnabled: true,
  wifiValidationEnabled: false,
  activityMonitoringEnabled: false,
  randomSelfieEnabled: false,
  antiGpsSpoofingEnabled: false,
  whatsappAlertsEnabled: false,
  officeWifiSsids: [],
  officeWifiBssids: [],
  officeIpRanges: [],
  offlineMinutesThreshold: 15,
};

const normalizeTrackingSettings = (settings: Partial<TrackingSettings> | null | undefined): TrackingSettings => ({
  ...defaultTrackingSettings,
  ...(settings || {}),
});

export const fetchTrackingSettings = async (apiBaseUrl: string) => {
  const response = await apiRequest<Partial<TrackingSettings>>(apiBaseUrl, '/api/tracking/settings');
  return normalizeTrackingSettings(response);
};

type TrackingPayload = {
  apiBaseUrl: string;
  session: AuthSession | null;
  location: Location.LocationObjectCoords;
  mocked?: boolean;
  activity?: string;
};

export const transmitLocation = async ({
  apiBaseUrl,
  session,
  location,
  mocked,
  activity,
}: TrackingPayload): Promise<TrackingTransmissionResult> => {
  if (!session?.user?.employeeId) {
    throw new Error('No employee session available');
  }

  const response = await apiRequest<{ ok: boolean; status?: string; distanceMeters?: number | null }>(
    apiBaseUrl,
    '/api/tracking/location',
    {
      method: 'POST',
      token: session.token,
      body: {
        employeeId: session.user.employeeId,
        fullName: session.user.fullName,
        lat: location.latitude,
        lng: location.longitude,
        accuracy: location.accuracy,
        isMockLocation: mocked,
        activity: activity || AppState.currentState,
        devicePlatform: Platform.OS,
      },
    }
  );

  return {
    ok: response.ok,
    status: response.status,
    distanceMeters: response.distanceMeters ?? null,
  };
};

export const persistTrackingRuntime = async (config: TrackingRuntimeConfig) => {
  await saveTrackingRuntime(config);
};

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      return;
    }

    const runtime = await loadTrackingRuntime();
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations || [];
    const latestLocation = locations[locations.length - 1];

    if (!runtime?.apiBaseUrl || !runtime.session || !latestLocation?.coords) {
      return;
    }

    try {
      await transmitLocation({
        apiBaseUrl: runtime.apiBaseUrl,
        session: runtime.session,
        location: latestLocation.coords,
        mocked: latestLocation.mocked,
        activity: 'background',
      });
    } catch (taskError) {
      return;
    }
  });
}

export const requestTrackingPermissions = async () => {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    throw new Error('Foreground location permission is required');
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    throw new Error('Background location permission is required');
  }
};

export const requestForegroundLocationPermission = async () => {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    throw new Error('Foreground location permission is required');
  }
};

export const startBackgroundTracking = async (runtime: TrackingRuntimeConfig) => {
  await persistTrackingRuntime(runtime);
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (alreadyRunning) {
    return;
  }

  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 60000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'PTHR live tracking',
      notificationBody: 'Location updates are active for attendance monitoring.',
    },
  });
};

export const stopBackgroundTracking = async () => {
  const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (!alreadyRunning) {
    return;
  }
  await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
};

export const isBackgroundTrackingActive = async () => Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);

export const captureCurrentLocation = async () => {
  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return location;
};
