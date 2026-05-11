const express = require('express');

const router = express.Router();

const defaultSettings = {
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
  locationOffAlertEnabled: true,
};

const tenantRuntimeStore = new Map();
const TRACKING_STATE_COLLECTION = 'trackingEmployeeState';
const TRACKING_MOVEMENT_COLLECTION = 'trackingMovementLogs';
const TRACKING_ALERTS_COLLECTION = 'trackingWhatsappAlerts';
const TRACKING_EVENTS_COLLECTION = 'trackingRiskEvents';

function normalizeTrackingSettings(settings) {
  return {
    ...defaultSettings,
    ...(settings || {}),
    officeLat: settings?.officeLat === null || settings?.officeLat === undefined ? null : toNumber(settings.officeLat),
    officeLng: settings?.officeLng === null || settings?.officeLng === undefined ? null : toNumber(settings.officeLng),
    geofenceRadiusMeters: toNumber(settings?.geofenceRadiusMeters) || defaultSettings.geofenceRadiusMeters,
    offlineMinutesThreshold: toNumber(settings?.offlineMinutesThreshold) || defaultSettings.offlineMinutesThreshold,
    geofenceEnabled: settings?.geofenceEnabled === undefined ? defaultSettings.geofenceEnabled : Boolean(settings.geofenceEnabled),
    wifiValidationEnabled:
      settings?.wifiValidationEnabled === undefined ? defaultSettings.wifiValidationEnabled : Boolean(settings.wifiValidationEnabled),
    activityMonitoringEnabled:
      settings?.activityMonitoringEnabled === undefined
        ? defaultSettings.activityMonitoringEnabled
        : Boolean(settings.activityMonitoringEnabled),
    randomSelfieEnabled:
      settings?.randomSelfieEnabled === undefined ? defaultSettings.randomSelfieEnabled : Boolean(settings.randomSelfieEnabled),
    antiGpsSpoofingEnabled:
      settings?.antiGpsSpoofingEnabled === undefined
        ? defaultSettings.antiGpsSpoofingEnabled
        : Boolean(settings.antiGpsSpoofingEnabled),
    whatsappAlertsEnabled:
      settings?.whatsappAlertsEnabled === undefined
        ? defaultSettings.whatsappAlertsEnabled
        : Boolean(settings.whatsappAlertsEnabled),
    locationOffAlertEnabled:
      settings?.locationOffAlertEnabled === undefined
        ? defaultSettings.locationOffAlertEnabled
        : Boolean(settings.locationOffAlertEnabled),
    officeWifiSsids: Array.isArray(settings?.officeWifiSsids) ? settings.officeWifiSsids : defaultSettings.officeWifiSsids,
    officeWifiBssids: Array.isArray(settings?.officeWifiBssids) ? settings.officeWifiBssids : defaultSettings.officeWifiBssids,
    officeIpRanges: Array.isArray(settings?.officeIpRanges) ? settings.officeIpRanges : defaultSettings.officeIpRanges,
  };
}

function getTenantRuntime(tenantIdRaw) {
  const tenantId = String(tenantIdRaw || 'master').trim().toLowerCase() || 'master';
  if (!tenantRuntimeStore.has(tenantId)) {
    tenantRuntimeStore.set(tenantId, {
      employeeState: new Map(),
      movementLogs: [],
      whatsappAlerts: [],
      riskEvents: [],
    });
  }
  return tenantRuntimeStore.get(tenantId);
}

async function persistEmployeeState(db, record) {
  if (!db || !record?.employeeId) {
    return;
  }
  const timestamp = String(record.lastSeen || new Date().toISOString());
  await db.collection(TRACKING_STATE_COLLECTION).updateOne(
    { _id: String(record.employeeId) },
    {
      $set: {
        ...record,
        employeeId: String(record.employeeId),
        updatedAt: timestamp,
      },
      $setOnInsert: {
        createdAt: timestamp,
      },
    },
    { upsert: true }
  );
}

async function persistMovementLog(db, entry) {
  if (!db || !entry?.employeeId) {
    return;
  }
  await db.collection(TRACKING_MOVEMENT_COLLECTION).insertOne({
    ...entry,
    employeeId: String(entry.employeeId),
  });
}

async function persistWhatsappAlert(db, alert) {
  if (!db || !alert?.id) {
    return;
  }
  await db.collection(TRACKING_ALERTS_COLLECTION).updateOne(
    { _id: String(alert.id) },
    {
      $set: {
        ...alert,
        id: String(alert.id),
      },
      $setOnInsert: {
        createdAt: String(alert.createdAt || new Date().toISOString()),
      },
    },
    { upsert: true }
  );
}

async function persistRiskEvent(db, event) {
  if (!db || !event?.id) {
    return;
  }
  await db.collection(TRACKING_EVENTS_COLLECTION).updateOne(
    { _id: String(event.id) },
    {
      $set: {
        ...event,
        id: String(event.id),
      },
      $setOnInsert: {
        createdAt: String(event.createdAt || new Date().toISOString()),
      },
    },
    { upsert: true }
  );
}

async function loadPersistedEmployeeState(db) {
  if (!db) {
    return [];
  }
  return db
    .collection(TRACKING_STATE_COLLECTION)
    .find({})
    .toArray()
    .catch(() => []);
}

async function loadPersistedMovement(db, employeeId, limit) {
  if (!db) {
    return [];
  }
  const rows = await db
    .collection(TRACKING_MOVEMENT_COLLECTION)
    .find({ employeeId: String(employeeId || '') })
    .sort({ recordedAt: -1, createdAt: -1, _id: -1 })
    .limit(Math.max(limit * 10, 500))
    .toArray()
    .catch(() => []);
  return rows.reverse();
}

async function loadPersistedAlerts(db, limit) {
  if (!db) {
    return [];
  }
  const rows = await db
    .collection(TRACKING_ALERTS_COLLECTION)
    .find({})
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .toArray()
    .catch(() => []);
  return rows.reverse();
}

async function loadPersistedRiskEvents(db, { limit, employeeId, riskType }) {
  if (!db) {
    return [];
  }
  const filter = employeeId ? { employeeId: String(employeeId) } : {};
  const rows = await db
    .collection(TRACKING_EVENTS_COLLECTION)
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(Math.max(limit * 3, limit))
    .toArray()
    .catch(() => []);
  return rows
    .filter((event) => !riskType || String(event.riskType || '').toLowerCase() === riskType)
    .slice(0, limit)
    .reverse();
}

function mergeEmployeeStateRecords(runtime, persistedRows) {
  const merged = new Map();
  persistedRows.forEach((row) => {
    if (row?.employeeId) {
      merged.set(String(row.employeeId), row);
    }
  });
  runtime.employeeState.forEach((row, employeeId) => {
    const key = String(employeeId || row?.employeeId || '');
    if (!key) {
      return;
    }
    const existing = merged.get(key);
    const existingSeen = new Date(existing?.lastSeen || 0).getTime();
    const nextSeen = new Date(row?.lastSeen || 0).getTime();
    if (!existing || nextSeen >= existingSeen) {
      merged.set(key, row);
    }
  });
  return Array.from(merged.values());
}

async function loadTrackingSettings(db) {
  const settingsDoc = await db.collection('appSettings').findOne({ _id: 'tracking-rules' });
  return normalizeTrackingSettings(settingsDoc?.value);
}

async function saveTrackingSettings(db, value) {
  const normalized = normalizeTrackingSettings(value);
  await db.collection('appSettings').updateOne(
    { _id: 'tracking-rules' },
    {
      $set: {
        value: normalized,
        updatedAt: new Date().toISOString(),
      },
      $setOnInsert: {
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );
  return normalized;
}

function toNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const r = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function classifyStatus(record, settings, now) {
  if (!record || !record.lastSeen) {
    return 'OFFLINE';
  }
  const lastSeenTime = new Date(record.lastSeen).getTime();
  const deltaMs = now.getTime() - lastSeenTime;
  const offlineMs = (settings.offlineMinutesThreshold || 15) * 60 * 1000;
  if (deltaMs > offlineMs) {
    return 'OFFLINE';
  }
  if (record.locationDisabled) {
    return 'LOCATION_OFF';
  }
  if (settings.geofenceEnabled && record.insideGeofence === false) {
    return 'OUTSIDE';
  }
  return 'INSIDE';
}

async function recordWhatsappAlert(runtime, db, record, reason) {
  const alert = {
    id: `${record.employeeId}-${Date.now()}`,
    employeeId: record.employeeId,
    fullName: record.fullName,
    status: record.status,
    reason,
    createdAt: new Date().toISOString(),
  };
  runtime.whatsappAlerts.push(alert);
  await persistWhatsappAlert(db, alert);
}

async function recordRiskEvent(runtime, db, { employeeId, fullName, riskType, severity = 'high', details = '', status = '' }) {
  const event = {
    id: `${employeeId || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    employeeId: employeeId || null,
    fullName: fullName || employeeId || 'Unknown',
    riskType: String(riskType || '').trim() || 'unknown',
    severity: String(severity || 'high'),
    status: String(status || ''),
    details: String(details || ''),
    createdAt: new Date().toISOString(),
  };
  runtime.riskEvents.push(event);
  if (runtime.riskEvents.length > 5000) {
    runtime.riskEvents.splice(0, runtime.riskEvents.length - 5000);
  }
  await persistRiskEvent(db, event);
}

function validateWifi(settings, wifiSsid) {
  if (!settings.wifiValidationEnabled) {
    return true;
  }
  if (!settings.officeWifiSsids || settings.officeWifiSsids.length === 0) {
    return true;
  }
  const ssid = String(wifiSsid || '').toLowerCase();
  if (!ssid) {
    return false;
  }
  return settings.officeWifiSsids.some((allowed) => String(allowed || '').toLowerCase() === ssid);
}

function ipv4ToInt(ipAddress) {
  const parts = String(ipAddress || '')
    .trim()
    .split('.')
    .map((value) => Number(value));
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

function isIpInCidr(ipAddress, cidr) {
  const [rangeIp, prefixRaw] = String(cidr || '').split('/');
  const ipNum = ipv4ToInt(ipAddress);
  const rangeNum = ipv4ToInt(rangeIp);
  if (ipNum === null || rangeNum === null) {
    return false;
  }
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function validateOfficeIp(settings, ipAddress) {
  if (!Array.isArray(settings.officeIpRanges) || settings.officeIpRanges.length === 0) {
    return true;
  }
  if (!ipAddress) {
    return false;
  }
  return settings.officeIpRanges.some((cidr) => isIpInCidr(ipAddress, cidr));
}

function extractIsoDate(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

function buildCoordinateFallbackLabel(lat, lng) {
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
  return 'Location unavailable';
}

async function fetchReverseGeocodeDisplayName(lat, lng) {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return '';
  }
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}`,
      {
        headers: {
          'User-Agent': 'PTHR/1.0 support@pthr.app',
          Accept: 'application/json',
          'Accept-Language': 'en',
        },
      }
    );
    if (!response.ok) {
      return '';
    }
    const data = await response.json();
    return String(data?.display_name || '').trim();
  } catch (error) {
    return '';
  }
}

router.post('/location', async (req, res) => {
  const tenantId = req.tenantId || 'master';
  const runtime = getTenantRuntime(tenantId);
  const trackingSettings = await loadTrackingSettings(req.db);
  const now = new Date();
  const {
    employeeId,
    fullName,
    lat,
    lng,
    locationLabel,
    locationAddress,
    wifiSsid,
    wifiBssid,
    ipAddress,
    accuracy,
    isMockLocation,
    locationDisabled,
    activity,
  } = req.body || {};

  if (!employeeId) {
    return res.status(400).json({ ok: false, error: 'employeeId is required' });
  }

  const latNum = toNumber(lat);
  const lngNum = toNumber(lng);
  const resolvedLocationAddress =
    String(locationAddress || '').trim() || (await fetchReverseGeocodeDisplayName(latNum, lngNum)) || buildCoordinateFallbackLabel(latNum, lngNum);

  let distanceMeters = null;
  let insideGeofence = null;

  if (
    trackingSettings.officeLat !== null &&
    trackingSettings.officeLng !== null &&
    latNum !== null &&
    lngNum !== null
  ) {
    distanceMeters = haversineDistanceMeters(
      trackingSettings.officeLat,
      trackingSettings.officeLng,
      latNum,
      lngNum
    );
    insideGeofence = distanceMeters <= (trackingSettings.geofenceRadiusMeters || 100);
  }

  const wifiValid = validateWifi(trackingSettings, wifiSsid);
  const ipValid = validateOfficeIp(trackingSettings, ipAddress);
  const accuracyNum = toNumber(accuracy);
  const gpsSpoofSuspected = Boolean(isMockLocation) || (accuracyNum !== null && accuracyNum > 80);
  const locationDisabledFlag = Boolean(locationDisabled);
  const networkRisk = (!wifiValid && trackingSettings.wifiValidationEnabled) || !ipValid;

  if (trackingSettings.antiGpsSpoofingEnabled && Boolean(isMockLocation)) {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || employeeId,
      riskType: 'gps-spoofing',
      severity: 'high',
      details: 'Location update rejected because mock location is enabled on device.',
      status: 'REJECTED',
    });
    return res.status(403).json({ ok: false, error: 'Mock location detected. Disable fake GPS and retry.' });
  }

  const lastSeen = now.toISOString();

  const previousRecord = runtime.employeeState.get(employeeId) || null;
  const previousStatus = previousRecord ? classifyStatus(previousRecord, trackingSettings, now) : null;

  const record = {
    employeeId,
    fullName: fullName || employeeId,
    lat: latNum,
    lng: lngNum,
    locationLabel: locationLabel || null,
    locationAddress: locationAddress || null,
    locationAddress: resolvedLocationAddress || null,
    wifiSsid: wifiSsid || null,
    wifiBssid: wifiBssid || null,
    ipAddress: ipAddress || null,
    accuracy: accuracyNum,
    distanceMeters,
    insideGeofence,
    wifiValid,
    gpsSpoofSuspected,
    ipValid,
    networkRisk,
    locationDisabled: locationDisabledFlag,
    lastSeen,
    lastActivity: activity || null,
  };

  const status = classifyStatus(record, trackingSettings, now);
  record.status = status;

  if (trackingSettings.whatsappAlertsEnabled) {
    if (status === 'OUTSIDE' && previousStatus !== 'OUTSIDE') {
      await recordWhatsappAlert(runtime, req.db, record, 'outside-premises');
    }
    if (status === 'OFFLINE' && previousStatus !== 'OFFLINE') {
      await recordWhatsappAlert(runtime, req.db, record, 'offline-threshold');
    }
    if (status === 'LOCATION_OFF' && previousStatus !== 'LOCATION_OFF' && trackingSettings.locationOffAlertEnabled) {
      await recordWhatsappAlert(runtime, req.db, record, 'location-disabled');
    }
    if (record.networkRisk && !previousRecord?.networkRisk) {
      await recordWhatsappAlert(runtime, req.db, record, 'network-risk');
    }
  }

  if (status === 'OUTSIDE' && previousStatus !== 'OUTSIDE') {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || employeeId,
      riskType: 'outside-premises',
      severity: 'high',
      details: `Employee moved outside geofence (${Math.round(distanceMeters || 0)}m from office).`,
      status,
    });
  }
  if (status === 'OFFLINE' && previousStatus !== 'OFFLINE') {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || employeeId,
      riskType: 'offline-threshold',
      severity: 'medium',
      details: 'No location updates within offline threshold.',
      status,
    });
  }
  if (status === 'LOCATION_OFF' && previousStatus !== 'LOCATION_OFF') {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || employeeId,
      riskType: 'location-disabled',
      severity: 'high',
      details: 'Employee device reported location services disabled.',
      status,
    });
  }
  if (gpsSpoofSuspected && !previousRecord?.gpsSpoofSuspected) {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || employeeId,
      riskType: 'gps-spoof-suspected',
      severity: 'high',
      details: 'Mock location flag or abnormal GPS accuracy detected.',
      status,
    });
  }
  if (!wifiValid && previousRecord?.wifiValid !== false) {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || employeeId,
      riskType: 'wifi-mismatch',
      severity: 'medium',
      details: `Current WiFi "${wifiSsid || 'unknown'}" is not in allowed office SSIDs.`,
      status,
    });
  }
  if (networkRisk && !previousRecord?.networkRisk) {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || employeeId,
      riskType: 'network-risk',
      severity: 'high',
      details: `IP ${ipAddress || 'unknown'} is outside office ranges or trusted network policy.`,
      status,
    });
  }

  runtime.employeeState.set(employeeId, record);
  await persistEmployeeState(req.db, record);

  const movementEntry = {
    id: `${employeeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    employeeId,
    lat: latNum,
    lng: lngNum,
    timestamp: lastSeen,
    recordedAt: lastSeen,
    createdAt: lastSeen,
    distanceMeters,
    status,
    locationLabel: locationLabel || null,
    locationAddress: resolvedLocationAddress || null,
    wifiSsid: wifiSsid || null,
    ipAddress: ipAddress || null,
    networkRisk,
    locationDisabled: locationDisabledFlag,
  };
  runtime.movementLogs.push(movementEntry);
  await persistMovementLog(req.db, movementEntry);
  if (runtime.movementLogs.length > 5000) {
    runtime.movementLogs.splice(0, runtime.movementLogs.length - 5000);
  }

  return res.json({ ok: true, status, distanceMeters });
});

router.post('/location-status', async (req, res) => {
  const tenantId = req.tenantId || 'master';
  const runtime = getTenantRuntime(tenantId);
  const trackingSettings = await loadTrackingSettings(req.db);
  const now = new Date();
  const { employeeId, fullName, locationDisabled, reason, activity } = req.body || {};
  if (!employeeId) {
    return res.status(400).json({ ok: false, error: 'employeeId is required' });
  }
  const previousRecord = runtime.employeeState.get(employeeId) || {};
  const nextRecord = {
    ...previousRecord,
    employeeId,
    fullName: fullName || previousRecord.fullName || employeeId,
    locationDisabled: Boolean(locationDisabled),
    locationIssueReason: String(reason || ''),
    lastSeen: now.toISOString(),
    lastActivity: activity || previousRecord.lastActivity || null,
  };
  const previousStatus = previousRecord ? classifyStatus(previousRecord, trackingSettings, now) : null;
  const status = classifyStatus(nextRecord, trackingSettings, now);
  nextRecord.status = status;
  if (
    trackingSettings.whatsappAlertsEnabled &&
    trackingSettings.locationOffAlertEnabled &&
    status === 'LOCATION_OFF' &&
    previousStatus !== 'LOCATION_OFF'
  ) {
    await recordWhatsappAlert(runtime, req.db, nextRecord, 'location-disabled');
  }
  if (status === 'LOCATION_OFF' && previousStatus !== 'LOCATION_OFF') {
    await recordRiskEvent(runtime, req.db, {
      employeeId,
      fullName: fullName || previousRecord.fullName || employeeId,
      riskType: 'location-disabled',
      severity: 'high',
      details: String(reason || 'Device location permission/state disabled'),
      status,
    });
  }
  runtime.employeeState.set(employeeId, nextRecord);
  await persistEmployeeState(req.db, nextRecord);
  return res.json({ ok: true, status });
});

router.get('/employees', async (req, res) => {
  const tenantId = req.tenantId || 'master';
  const runtime = getTenantRuntime(tenantId);
  const trackingSettings = await loadTrackingSettings(req.db);
  const now = new Date();
  const persistedRows = await loadPersistedEmployeeState(req.db);
  const employeeRecords = mergeEmployeeStateRecords(runtime, persistedRows);
  const employeeProfileRows = await req.db
    .collection('employees')
    .find({}, { projection: { id: 1, employeeId: 1, gender: 1, sex: 1 } })
    .toArray()
    .catch(() => []);
  const employeeGenderMap = new Map();
  employeeProfileRows.forEach((row) => {
    const genderValue = String(row?.gender || row?.sex || '').trim();
    if (!genderValue) {
      return;
    }
    if (row?.id) {
      employeeGenderMap.set(String(row.id), genderValue);
    }
    if (row?.employeeId) {
      employeeGenderMap.set(String(row.employeeId), genderValue);
    }
  });
  const employees = employeeRecords.map((record) => {
    const status = classifyStatus(record, trackingSettings, now);
    const outsidePremises = status === 'OUTSIDE';
    const offline = status === 'OFFLINE';
    return {
      employeeId: record.employeeId,
      fullName: record.fullName,
      gender: employeeGenderMap.get(String(record.employeeId || '')) || '',
      lat: record.lat,
      lng: record.lng,
      locationLabel: record.locationLabel || null,
      locationAddress: record.locationAddress || null,
      wifiSsid: record.wifiSsid,
      wifiBssid: record.wifiBssid,
      ipAddress: record.ipAddress,
      distanceMeters: record.distanceMeters,
      lastSeen: record.lastSeen,
      status,
      outsidePremises,
      offline,
      wifiValid: record.wifiValid,
      ipValid: record.ipValid,
      networkRisk: record.networkRisk,
      gpsSpoofSuspected: record.gpsSpoofSuspected,
      locationDisabled: record.locationDisabled,
    };
  });

  res.json({ employees });
});

router.get('/movement/:employeeId', async (req, res) => {
  const tenantId = req.tenantId || 'master';
  const runtime = getTenantRuntime(tenantId);
  const { employeeId } = req.params;
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 120));
  const requestedDateRaw = String(req.query.date || new Date().toISOString().slice(0, 10)).trim();
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDateRaw)
    ? requestedDateRaw
    : new Date().toISOString().slice(0, 10);
  const persistedMovement = (await loadPersistedMovement(req.db, employeeId, limit))
    .filter((row) => extractIsoDate(row.recordedAt || row.createdAt || row.lastSeen) === requestedDate)
    .slice(-limit);
  const movement =
    persistedMovement.length > 0
      ? persistedMovement
      : runtime.movementLogs
          .filter(
            (row) =>
              String(row.employeeId || '') === String(employeeId || '') &&
              extractIsoDate(row.recordedAt || row.createdAt || row.lastSeen || row.timestamp) === requestedDate
          )
          .slice(-limit);
  res.json({ movement });
});

router.get('/events', async (req, res) => {
  const tenantId = req.tenantId || 'master';
  const runtime = getTenantRuntime(tenantId);
  const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 200));
  const employeeId = String(req.query.employeeId || '').trim();
  const riskType = String(req.query.riskType || '').trim().toLowerCase();
  const persistedRows = await loadPersistedRiskEvents(req.db, { limit, employeeId, riskType });
  const rows =
    persistedRows.length > 0
      ? persistedRows
      : runtime.riskEvents
          .filter((event) => {
            const matchEmployee = !employeeId || String(event.employeeId || '') === employeeId;
            const matchType = !riskType || String(event.riskType || '').toLowerCase() === riskType;
            return matchEmployee && matchType;
          })
          .slice(-limit);
  res.json({ events: rows });
});

router.get('/reverse-geocode', async (req, res) => {
  const lat = toNumber(req.query.lat);
  const lng = toNumber(req.query.lng);
  if (lat === null || lng === null) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  try {
    const displayName = (await fetchReverseGeocodeDisplayName(lat, lng)) || buildCoordinateFallbackLabel(lat, lng);
    return res.json({
      displayName,
      address: {},
    });
  } catch (error) {
    return res.json({ displayName: buildCoordinateFallbackLabel(lat, lng), address: {} });
  }
});

router.get('/settings', async (req, res) => {
  const settings = await loadTrackingSettings(req.db);
  res.json(settings);
});

router.post('/settings', async (req, res) => {
  const trackingSettings = await loadTrackingSettings(req.db);
  const payload = req.body || {};
  const nextSettings = {
    ...trackingSettings,
    officeLat:
      payload.officeLat === null || payload.officeLat === undefined ? trackingSettings.officeLat : toNumber(payload.officeLat),
    officeLng:
      payload.officeLng === null || payload.officeLng === undefined ? trackingSettings.officeLng : toNumber(payload.officeLng),
    geofenceRadiusMeters:
      payload.geofenceRadiusMeters === null || payload.geofenceRadiusMeters === undefined
        ? trackingSettings.geofenceRadiusMeters
        : toNumber(payload.geofenceRadiusMeters) || trackingSettings.geofenceRadiusMeters,
    geofenceEnabled:
      payload.geofenceEnabled === undefined ? trackingSettings.geofenceEnabled : Boolean(payload.geofenceEnabled),
    wifiValidationEnabled:
      payload.wifiValidationEnabled === undefined
        ? trackingSettings.wifiValidationEnabled
        : Boolean(payload.wifiValidationEnabled),
    activityMonitoringEnabled:
      payload.activityMonitoringEnabled === undefined
        ? trackingSettings.activityMonitoringEnabled
        : Boolean(payload.activityMonitoringEnabled),
    randomSelfieEnabled:
      payload.randomSelfieEnabled === undefined
        ? trackingSettings.randomSelfieEnabled
        : Boolean(payload.randomSelfieEnabled),
    antiGpsSpoofingEnabled:
      payload.antiGpsSpoofingEnabled === undefined
        ? trackingSettings.antiGpsSpoofingEnabled
        : Boolean(payload.antiGpsSpoofingEnabled),
    whatsappAlertsEnabled:
      payload.whatsappAlertsEnabled === undefined
        ? trackingSettings.whatsappAlertsEnabled
        : Boolean(payload.whatsappAlertsEnabled),
    officeWifiSsids: Array.isArray(payload.officeWifiSsids)
      ? payload.officeWifiSsids
      : trackingSettings.officeWifiSsids,
    officeWifiBssids: Array.isArray(payload.officeWifiBssids)
      ? payload.officeWifiBssids
      : trackingSettings.officeWifiBssids,
    officeIpRanges: Array.isArray(payload.officeIpRanges)
      ? payload.officeIpRanges
      : trackingSettings.officeIpRanges,
    offlineMinutesThreshold:
      payload.offlineMinutesThreshold === null || payload.offlineMinutesThreshold === undefined
        ? trackingSettings.offlineMinutesThreshold
        : toNumber(payload.offlineMinutesThreshold) || trackingSettings.offlineMinutesThreshold,
    locationOffAlertEnabled:
      payload.locationOffAlertEnabled === undefined
        ? trackingSettings.locationOffAlertEnabled
        : Boolean(payload.locationOffAlertEnabled),
  };

  const savedSettings = await saveTrackingSettings(req.db, nextSettings);
  res.json({ ok: true, settings: savedSettings });
});

router.post('/selfie', (req, res) => {
  const { employeeId, selfieUrl, takenAt } = req.body || {};
  if (!employeeId || !selfieUrl) {
    return res.status(400).json({ ok: false, error: 'employeeId and selfieUrl are required' });
  }
  return res.json({ ok: true });
});

router.post('/alerts/whatsapp', (req, res) => {
  const tenantId = req.tenantId || 'master';
  const runtime = getTenantRuntime(tenantId);
  const { employeeId, phoneNumber, message, reason } = req.body || {};
  if (!phoneNumber || !message) {
    return res.status(400).json({ ok: false, error: 'phoneNumber and message are required' });
  }
  const alert = {
    id: `${employeeId || 'manual'}-${Date.now()}`,
    employeeId: employeeId || null,
    phoneNumber,
    message,
    reason: reason || 'manual',
    createdAt: new Date().toISOString(),
  };
  runtime.whatsappAlerts.push(alert);
  return res.json({ ok: true });
});

router.get('/alerts/whatsapp', async (req, res) => {
  const tenantId = req.tenantId || 'master';
  const runtime = getTenantRuntime(tenantId);
  const persistedAlerts = await loadPersistedAlerts(req.db, 500);
  res.json({ alerts: persistedAlerts.length > 0 ? persistedAlerts : runtime.whatsappAlerts });
});

module.exports = router;
