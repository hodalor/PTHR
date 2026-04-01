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
};

let trackingSettings = { ...defaultSettings };

const employeeState = new Map();
const movementLogs = [];
const whatsappAlerts = [];

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
  if (settings.geofenceEnabled && record.insideGeofence === false) {
    return 'OUTSIDE';
  }
  return 'INSIDE';
}

function recordWhatsappAlert(record, reason) {
  const alert = {
    id: `${record.employeeId}-${Date.now()}`,
    employeeId: record.employeeId,
    fullName: record.fullName,
    status: record.status,
    reason,
    createdAt: new Date().toISOString(),
  };
  whatsappAlerts.push(alert);
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

router.post('/location', (req, res) => {
  const now = new Date();
  const {
    employeeId,
    fullName,
    lat,
    lng,
    wifiSsid,
    wifiBssid,
    ipAddress,
    accuracy,
    isMockLocation,
    activity,
  } = req.body || {};

  if (!employeeId) {
    return res.status(400).json({ ok: false, error: 'employeeId is required' });
  }

  const latNum = toNumber(lat);
  const lngNum = toNumber(lng);

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
  const accuracyNum = toNumber(accuracy);
  const gpsSpoofSuspected = Boolean(isMockLocation) || (accuracyNum !== null && accuracyNum > 80);

  const lastSeen = now.toISOString();

  const previousRecord = employeeState.get(employeeId) || null;
  const previousStatus = previousRecord ? classifyStatus(previousRecord, trackingSettings, now) : null;

  const record = {
    employeeId,
    fullName: fullName || employeeId,
    lat: latNum,
    lng: lngNum,
    wifiSsid: wifiSsid || null,
    wifiBssid: wifiBssid || null,
    ipAddress: ipAddress || null,
    accuracy: accuracyNum,
    distanceMeters,
    insideGeofence,
    wifiValid,
    gpsSpoofSuspected,
    lastSeen,
    lastActivity: activity || null,
  };

  const status = classifyStatus(record, trackingSettings, now);
  record.status = status;

  if (trackingSettings.whatsappAlertsEnabled) {
    if (status === 'OUTSIDE' && previousStatus !== 'OUTSIDE') {
      recordWhatsappAlert(record, 'outside-premises');
    }
    if (status === 'OFFLINE' && previousStatus !== 'OFFLINE') {
      recordWhatsappAlert(record, 'offline-threshold');
    }
  }

  employeeState.set(employeeId, record);

  movementLogs.push({
    employeeId,
    lat: latNum,
    lng: lngNum,
    timestamp: lastSeen,
    distanceMeters,
    status,
    wifiSsid: wifiSsid || null,
    ipAddress: ipAddress || null,
  });

  return res.json({ ok: true, status, distanceMeters });
});

router.get('/employees', (req, res) => {
  const now = new Date();
  const employees = Array.from(employeeState.values()).map((record) => {
    const status = classifyStatus(record, trackingSettings, now);
    const outsidePremises = status === 'OUTSIDE';
    const offline = status === 'OFFLINE';
    return {
      employeeId: record.employeeId,
      fullName: record.fullName,
      lat: record.lat,
      lng: record.lng,
      wifiSsid: record.wifiSsid,
      wifiBssid: record.wifiBssid,
      ipAddress: record.ipAddress,
      distanceMeters: record.distanceMeters,
      lastSeen: record.lastSeen,
      status,
      outsidePremises,
      offline,
      wifiValid: record.wifiValid,
      gpsSpoofSuspected: record.gpsSpoofSuspected,
    };
  });

  res.json({ employees });
});

router.get('/settings', (req, res) => {
  res.json(trackingSettings);
});

router.post('/settings', (req, res) => {
  const payload = req.body || {};

  trackingSettings = {
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
  };

  res.json({ ok: true, settings: trackingSettings });
});

router.post('/selfie', (req, res) => {
  const { employeeId, selfieUrl, takenAt } = req.body || {};
  if (!employeeId || !selfieUrl) {
    return res.status(400).json({ ok: false, error: 'employeeId and selfieUrl are required' });
  }
  return res.json({ ok: true });
});

router.post('/alerts/whatsapp', (req, res) => {
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
  whatsappAlerts.push(alert);
  return res.json({ ok: true });
});

router.get('/alerts/whatsapp', (req, res) => {
  res.json({ alerts: whatsappAlerts });
});

module.exports = router;
