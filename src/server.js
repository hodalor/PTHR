const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');
const https = require('https');
const {
  normalizeTenantId,
  resolvePackageModules,
  resolveTenantGrantedModules,
  resolveTenantEffectiveLimits,
} = require('./tenancy');

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: '12mb' }));

const trackingRoutes = require('./routes/tracking');
const mobileRoutes = require('./routes/mobile');
const { router: authRoutes, ensureSuperAdmin } = require('./routes/auth');

const PORT = process.env.PORT || 8000;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_MASTER_DB_NAME = process.env.MONGO_DB_NAME || 'hr-master';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const defaultEmployeeModules = ['attendance-time', 'loan-records', 'leave-management', 'monitoring-tracking', 'manual'];

const moduleCollections = {
  'employee-management': 'employees',
  'attendance-time': 'attendanceTime',
  'loan-records': 'loanRecords',
  fingerprint: 'fingerprintRecords',
  'leave-management': 'leaveRequests',
  'payroll-management': 'payrollRecords',
  'documents-records': 'documentRecords',
  'reports-analytics': 'reportRecords',
  'auth-roles': 'authRoleRecords',
  recruitment: 'recruitmentRecords',
  performance: 'performanceRecords',
  training: 'trainingRecords',
};

const defaultAttendanceSettings = {
  attendanceLateAfter: '08:15',
  attendanceReportTime: '08:00',
  attendanceShiftEnd: '17:00',
  requireWebClockInPhoto: false,
  payrollWorkingDays: 26,
  attendanceCalculationMode: 'auto',
  attendanceFixedDeductionPerMinute: 0.128,
  attendanceFixedScope: 'all',
  attendanceFixedDepartment: '',
  attendanceFixedEmployeeId: '',
  shifts: [
    {
      id: 'SHIFT-MORNING',
      name: 'Morning',
      reportTime: '08:00',
      shiftEnd: '17:00',
      graceInMinutes: 15,
      graceOutMinutes: 0,
      overtimeEnabled: false,
      overtimeStartAfterMinutes: 0,
      overtimePayPerMinute: 0,
    },
  ],
};

function normalizeAttendanceSettings(payload) {
  const source = payload || {};
  const shifts = Array.isArray(source.shifts)
    ? source.shifts
        .map((shift, index) => ({
          id: String(shift?.id || `SHIFT-${index + 1}`),
          name: String(shift?.name || '').trim(),
          reportTime: String(shift?.reportTime || '').trim(),
          shiftEnd: String(shift?.shiftEnd || '').trim(),
          graceInMinutes: Math.max(0, Number(shift?.graceInMinutes) || 0),
          graceOutMinutes: Math.max(0, Number(shift?.graceOutMinutes) || 0),
          overtimeEnabled: Boolean(shift?.overtimeEnabled),
          overtimeStartAfterMinutes: Math.max(0, Number(shift?.overtimeStartAfterMinutes) || 0),
          overtimePayPerMinute: Math.max(0, Number(shift?.overtimePayPerMinute) || 0),
        }))
        .filter(
          (shift) =>
            shift.name &&
            /^\d{2}:\d{2}$/.test(shift.reportTime) &&
            /^\d{2}:\d{2}$/.test(shift.shiftEnd)
        )
    : [];
  return {
    attendanceLateAfter: String(source.attendanceLateAfter || defaultAttendanceSettings.attendanceLateAfter),
    attendanceReportTime: String(source.attendanceReportTime || defaultAttendanceSettings.attendanceReportTime),
    attendanceShiftEnd: String(source.attendanceShiftEnd || defaultAttendanceSettings.attendanceShiftEnd),
    requireWebClockInPhoto:
      source.requireWebClockInPhoto === undefined
        ? defaultAttendanceSettings.requireWebClockInPhoto
        : Boolean(source.requireWebClockInPhoto),
    payrollWorkingDays: Math.max(1, Number(source.payrollWorkingDays) || defaultAttendanceSettings.payrollWorkingDays),
    attendanceCalculationMode: source.attendanceCalculationMode === 'fixed' ? 'fixed' : 'auto',
    attendanceFixedDeductionPerMinute: Math.max(
      0,
      Number(source.attendanceFixedDeductionPerMinute) || defaultAttendanceSettings.attendanceFixedDeductionPerMinute
    ),
    attendanceFixedScope: ['all', 'department', 'individual'].includes(String(source.attendanceFixedScope || ''))
      ? String(source.attendanceFixedScope)
      : defaultAttendanceSettings.attendanceFixedScope,
    attendanceFixedDepartment: String(source.attendanceFixedDepartment || ''),
    attendanceFixedEmployeeId: String(source.attendanceFixedEmployeeId || ''),
    shifts: shifts.length > 0 ? shifts : defaultAttendanceSettings.shifts,
  };
}

function toMinutesFromClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatWorkedDuration(checkIn, checkOut) {
  const start = toMinutesFromClock(checkIn);
  const end = toMinutesFromClock(checkOut);
  if (start === null || end === null || end <= start) {
    return '';
  }
  const diff = end - start;
  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  return `${hours}h ${minutes}m`;
}

function escapeSvgAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function splitStampLines(value, maxLineLength = 34) {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, 3);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function firstNonEmpty(values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function compactUnique(values) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function normalizeCountryCode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return normalized.length === 2 ? normalized : '';
}

function toFlagEmoji(countryCode) {
  const normalizedCode = normalizeCountryCode(countryCode).toUpperCase();
  if (!normalizedCode) {
    return '';
  }
  return normalizedCode
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function fetchJsonWithRelaxedTls(url, headers) {
  return new Promise((resolve) => {
    const request = https.get(
      url,
      {
        headers,
        rejectUnauthorized: false,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            resolve(null);
          }
        });
      }
    );
    request.setTimeout(12000, () => {
      request.destroy();
      resolve(null);
    });
    request.on('error', () => resolve(null));
  });
}

function formatPhotoStampTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

const PHOTO_STAMP_VERSION = 1;
const reverseGeocodeCache = new Map();

function formatCoordinateLabel(lat, lng) {
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
    return `Lat ${lat.toFixed(6)}  Long ${lng.toFixed(6)}`;
  }
  return 'Coordinates unavailable';
}

function buildCoordinateFallbackLabel(lat, lng) {
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
  return 'Location unavailable';
}

function buildLocationStampParts(locationDetails, lat, lng) {
  const details = locationDetails || {};
  const address = details.address || {};
  const country = firstNonEmpty([address.country]);
  const region = firstNonEmpty([address.state, address.region, address.province]);
  const countryCode = normalizeCountryCode(address.country_code);
  const city = firstNonEmpty([address.city, address.town, address.village, address.municipality, address.county]);
  const suburb = firstNonEmpty([
    address.suburb,
    address.neighbourhood,
    address.city_district,
    address.quarter,
    address.residential,
    address.hamlet,
  ]);
  const district = firstNonEmpty([address.city_district, address.state_district, address.county]);
  const street = firstNonEmpty([address.road, address.street, address.pedestrian, address.footway, address.path]);
  const block = firstNonEmpty([address.house_number, address.block, address.building, address.house_name, address.amenity]);
  const locality = firstNonEmpty([suburb, city]);
  const preferredTitle = compactUnique([locality, locality === city ? '' : city, region]).join(', ');
  const fallbackDisplay = String(details.displayName || '').trim();
  const detailPrimary = compactUnique([street, block]).join(', ');
  const detailSecondary = compactUnique([district, country]).join(', ');
  const title = preferredTitle || fallbackDisplay || buildCoordinateFallbackLabel(lat, lng);
  const detailLines = compactUnique([detailPrimary, detailSecondary]).filter((line) => line && line !== title);
  return {
    title,
    detailLines,
    displayLabel: compactUnique([title, ...detailLines]).join(' • ') || buildCoordinateFallbackLabel(lat, lng),
    country,
    countryCode,
  };
}

async function fetchReverseGeocodeDetails(lat, lng) {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return { displayName: '', address: {} };
  }
  const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (reverseGeocodeCache.has(cacheKey)) {
    return reverseGeocodeCache.get(cacheKey);
  }
  const requestUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${encodeURIComponent(
    lat
  )}&lon=${encodeURIComponent(lng)}`;
  const requestHeaders = {
    'User-Agent': 'PTHR/1.0 support@pthr.app',
    Accept: 'application/json',
    'Accept-Language': 'en',
  };
  try {
    const response = await fetch(requestUrl, { headers: requestHeaders });
    if (!response.ok) {
      const relaxedData = await fetchJsonWithRelaxedTls(requestUrl, requestHeaders);
      const fallbackResult = {
        displayName: String(relaxedData?.display_name || '').trim(),
        address: relaxedData?.address || {},
      };
      reverseGeocodeCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }
    const data = await response.json();
    const result = {
      displayName: String(data?.display_name || '').trim(),
      address: data?.address || {},
    };
    reverseGeocodeCache.set(cacheKey, result);
    return result;
  } catch (error) {
    const relaxedData = await fetchJsonWithRelaxedTls(requestUrl, requestHeaders);
    const fallbackResult = {
      displayName: String(relaxedData?.display_name || '').trim(),
      address: relaxedData?.address || {},
    };
    reverseGeocodeCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }
}

async function buildStampedPhotoDataUrl({ photoDataUrl, locationAddress, locationDetails, lat, lng, capturedAt }) {
  const rawValue = String(photoDataUrl || '').trim();
  const match = rawValue.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return rawValue;
  }
  try {
    const inputBuffer = Buffer.from(match[2], 'base64');
    const sourceImage = sharp(inputBuffer, { failOnError: false }).rotate();
    const metadata = await sourceImage.metadata();
    const targetWidth =
      typeof metadata.width === 'number' && metadata.width > 0 ? Math.min(metadata.width, 1080) : 720;
    const targetHeight =
      typeof metadata.width === 'number' &&
      metadata.width > 0 &&
      typeof metadata.height === 'number' &&
      metadata.height > 0
        ? Math.max(480, Math.round((metadata.height / metadata.width) * targetWidth))
        : 960;
    const isLandscape = targetWidth >= targetHeight;
    const shortestEdge = Math.min(targetWidth, targetHeight);
    const resolvedLocationDetails =
      locationDetails ||
      (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)
        ? await fetchReverseGeocodeDetails(lat, lng)
        : String(locationAddress || '').trim()
          ? { displayName: String(locationAddress || '').trim(), address: {} }
          : { displayName: '', address: {} });
    const stampParts = buildLocationStampParts(resolvedLocationDetails, lat, lng);
    const flagEmoji = toFlagEmoji(stampParts.countryCode);
    const titleLines = splitStampLines(stampParts.title, isLandscape ? 30 : 22).slice(0, 2);
    const detailLines = stampParts.detailLines
      .flatMap((line) => splitStampLines(line, isLandscape ? 40 : 28))
      .slice(0, isLandscape ? 2 : 3);
    const margin = Math.round(shortestEdge * 0.04);
    const panelWidth = Math.round(targetWidth * (isLandscape ? 0.56 : 0.86));
    const padX = Math.round(shortestEdge * (isLandscape ? 0.035 : 0.045));
    const padY = Math.round(shortestEdge * (isLandscape ? 0.03 : 0.038));
    const headerFont = clamp(Math.round(shortestEdge * 0.026), 14, 24);
    const titleFont = clamp(Math.round(shortestEdge * (isLandscape ? 0.042 : 0.05)), 22, 40);
    const detailFont = clamp(Math.round(shortestEdge * 0.027), 15, 23);
    const metaFont = clamp(Math.round(shortestEdge * 0.024), 13, 20);
    const iconRadius = clamp(Math.round(shortestEdge * 0.017), 12, 20);
    const flagFont = clamp(Math.round(shortestEdge * 0.045), 20, 30);
    const flagWidth = flagEmoji ? Math.round(flagFont * 1.7) : 0;
    const headerLineHeight = Math.round(headerFont * 1.25);
    const titleLineHeight = Math.round(titleFont * 1.08);
    const detailLineHeight = Math.round(detailFont * 1.18);
    const metaLineHeight = Math.round(metaFont * 1.2);
    const lineGap = clamp(Math.round(shortestEdge * 0.008), 4, 10);
    const sectionGap = clamp(Math.round(shortestEdge * 0.014), 8, 16);
    const panelHeight =
      padY * 2 +
      Math.max(iconRadius * 2, headerLineHeight) +
      sectionGap +
      titleLines.length * titleLineHeight +
      Math.max(0, titleLines.length - 1) * lineGap +
      (detailLines.length > 0 ? sectionGap + detailLines.length * detailLineHeight + Math.max(0, detailLines.length - 1) * lineGap : 0) +
      sectionGap +
      metaLineHeight * 2 +
      lineGap;
    const panelX = Math.max(margin, targetWidth - panelWidth - margin);
    const panelY = Math.max(margin, targetHeight - panelHeight - margin);
    const headerTextX = panelX + padX + iconRadius * 2 + 16;
    const coordinateText = formatCoordinateLabel(lat, lng);
    const timeText = formatPhotoStampTime(capturedAt) || 'Time unavailable';
    const flagX = panelX + panelWidth - padX - flagWidth;
    const flagY = panelY + padY + Math.max(iconRadius * 2, headerLineHeight) * 0.78;
    let textCursorY = panelY + padY;
    const headerBaselineY = textCursorY + Math.max(iconRadius * 2, headerLineHeight) * 0.72;
    textCursorY += Math.max(iconRadius * 2, headerLineHeight) + sectionGap;
    const titleSvg = titleLines
      .map((line) => {
        const y = textCursorY + titleLineHeight * 0.84;
        textCursorY += titleLineHeight + lineGap;
        return `<text x="${panelX + padX}" y="${Math.round(y)}" fill="#ffffff" font-size="${titleFont}" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(
          line
        )}</text>`;
      })
      .join('');
    if (titleLines.length > 0) {
      textCursorY += sectionGap - lineGap;
    }
    const detailSvg = detailLines
      .map((line) => {
        const y = textCursorY + detailLineHeight * 0.82;
        textCursorY += detailLineHeight + lineGap;
        return `<text x="${panelX + padX}" y="${Math.round(y)}" fill="#d7e3ff" font-size="${detailFont}" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(
          line
        )}</text>`;
      })
      .join('');
    if (detailLines.length > 0) {
      textCursorY += sectionGap - lineGap;
    }
    const overlaySvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}">
        <defs>
          <linearGradient id="stampGlow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="rgba(11,18,32,0.96)" />
            <stop offset="100%" stop-color="rgba(15,23,42,0.88)" />
          </linearGradient>
        </defs>
        <g>
          <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="${Math.round(
      shortestEdge * 0.03
    )}" fill="url(#stampGlow)" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
          <circle cx="${panelX + padX + iconRadius}" cy="${panelY + padY + iconRadius}" r="${iconRadius}" fill="#ef4444" />
          <path d="M${panelX + padX + iconRadius} ${panelY + padY + Math.round(iconRadius * 0.22)} C${panelX + padX + Math.round(
      iconRadius * 1.55
    )} ${panelY + padY + Math.round(iconRadius * 0.22)} ${panelX + padX + Math.round(iconRadius * 1.95)} ${
      panelY + padY + Math.round(iconRadius * 0.62)
    } ${panelX + padX + Math.round(iconRadius * 1.95)} ${panelY + padY + Math.round(iconRadius * 1.08)} C${
      panelX + padX + Math.round(iconRadius * 1.95)
    } ${panelY + padY + Math.round(iconRadius * 1.72)} ${panelX + padX + iconRadius} ${
      panelY + padY + Math.round(iconRadius * 2.45)
    } ${panelX + padX + iconRadius} ${panelY + padY + Math.round(iconRadius * 2.45)} C${panelX + padX + iconRadius} ${
      panelY + padY + Math.round(iconRadius * 2.45)
    } ${panelX + padX + Math.round(iconRadius * 0.05)} ${panelY + padY + Math.round(iconRadius * 1.72)} ${
      panelX + padX + Math.round(iconRadius * 0.05)
    } ${panelY + padY + Math.round(iconRadius * 1.08)} C${panelX + padX + Math.round(iconRadius * 0.05)} ${
      panelY + padY + Math.round(iconRadius * 0.62)
    } ${panelX + padX + Math.round(iconRadius * 0.45)} ${panelY + padY + Math.round(iconRadius * 0.22)} ${
      panelX + padX + iconRadius
    } ${panelY + padY + Math.round(iconRadius * 0.22)} Z" fill="#ef4444" />
          <circle cx="${panelX + padX + iconRadius}" cy="${panelY + padY + Math.round(iconRadius * 0.95)}" r="${Math.max(
      5,
      Math.round(iconRadius * 0.42)
    )}" fill="#ffffff" />
          ${
            flagEmoji
              ? `<text x="${flagX}" y="${Math.round(flagY)}" font-size="${flagFont}" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${escapeSvgAttribute(
                  flagEmoji
                )}</text>`
              : ''
          }
          <text x="${headerTextX}" y="${Math.round(
      headerBaselineY
    )}" fill="#ffffff" font-size="${headerFont}" font-weight="700" font-family="Segoe UI, Arial, sans-serif">GPS Verified Clocking</text>
          ${titleSvg}
          ${detailSvg}
          <text x="${panelX + padX}" y="${Math.round(
      textCursorY + metaLineHeight * 0.82
    )}" fill="#d7e3ff" font-size="${metaFont}" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(coordinateText)}</text>
          <text x="${panelX + padX}" y="${Math.round(
      textCursorY + metaLineHeight + lineGap + metaLineHeight * 0.82
    )}" fill="#d7e3ff" font-size="${metaFont}" font-family="Segoe UI, Arial, sans-serif">${escapeSvgAttribute(timeText)}</text>
        </g>
      </svg>
    `;
    const stampedBuffer = await sourceImage
      .resize({ width: targetWidth, withoutEnlargement: true })
      .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
      .jpeg({ quality: 74, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${stampedBuffer.toString('base64')}`;
  } catch (error) {
    return rawValue;
  }
}

async function processAttendanceClockings(clockings) {
  const normalizedClockings = Array.isArray(clockings) ? clockings : [];
  return Promise.all(
    normalizedClockings.map(async (clocking) => {
      const lat = typeof clocking?.photoLat === 'number' ? clocking.photoLat : clocking?.lat;
      const lng = typeof clocking?.photoLng === 'number' ? clocking.photoLng : clocking?.lng;
      const photoDataUrl = String(clocking?.photoDataUrl || '').trim();
      const photoCapturedAt = String(clocking?.photoCapturedAt || clocking?.createdAt || new Date().toISOString());
      const hasCoordinates = typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng);
      const hasPhoto = Boolean(photoDataUrl);
      const existingLocationAddress = String(clocking?.photoLocationAddress || '').trim();
      const isAlreadyStamped =
        hasPhoto &&
        Number(clocking?.photoStampVersion || 0) >= PHOTO_STAMP_VERSION &&
        !/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(existingLocationAddress);

      if (isAlreadyStamped) {
        return {
          ...clocking,
          photoLat: hasCoordinates ? lat : undefined,
          photoLng: hasCoordinates ? lng : undefined,
          photoCapturedAt,
          photoStampVersion: PHOTO_STAMP_VERSION,
        };
      }

      const locationDetails =
        hasCoordinates
          ? await fetchReverseGeocodeDetails(lat, lng)
          : existingLocationAddress
            ? { displayName: existingLocationAddress, address: {} }
            : { displayName: '', address: {} };
      const stampParts = buildLocationStampParts(locationDetails, lat, lng);
      return {
        ...clocking,
        photoLocationAddress: stampParts.displayLabel || buildCoordinateFallbackLabel(lat, lng),
        photoLat: hasCoordinates ? lat : undefined,
        photoLng: hasCoordinates ? lng : undefined,
        photoCapturedAt,
        photoStampVersion: hasPhoto ? PHOTO_STAMP_VERSION : undefined,
        photoDataUrl: hasPhoto
          ? await buildStampedPhotoDataUrl({
              photoDataUrl,
              locationAddress: stampParts.displayLabel,
              locationDetails,
              lat,
              lng,
              capturedAt: photoCapturedAt,
            })
          : photoDataUrl,
      };
    })
  );
}

function normalizeAttendanceClockings(row) {
  const fromClockings = Array.isArray(row?.clockings)
    ? row.clockings
        .map((clocking) => ({
          id: String(clocking?.id || ''),
          mode: clocking?.mode === 'clock-out' ? 'clock-out' : 'clock-in',
          time: String(clocking?.time || '').trim(),
          lat: typeof clocking?.lat === 'number' ? clocking.lat : undefined,
          lng: typeof clocking?.lng === 'number' ? clocking.lng : undefined,
          accuracy: typeof clocking?.accuracy === 'number' ? clocking.accuracy : null,
          photoDataUrl: String(clocking?.photoDataUrl || '').trim(),
          photoLocationAddress: String(clocking?.photoLocationAddress || '').trim(),
          photoLat: typeof clocking?.photoLat === 'number' ? clocking.photoLat : undefined,
          photoLng: typeof clocking?.photoLng === 'number' ? clocking.photoLng : undefined,
          photoCapturedAt: String(clocking?.photoCapturedAt || clocking?.createdAt || ''),
          photoStampVersion: Number(clocking?.photoStampVersion || 0) || undefined,
          source: String(clocking?.source || row?.source || 'System'),
          createdAt: String(clocking?.createdAt || ''),
        }))
        .filter((clocking) => /^\d{1,2}:\d{2}$/.test(clocking.time))
    : [];
  if (fromClockings.length > 0) {
    return fromClockings.sort((left, right) => left.time.localeCompare(right.time));
  }
  const fallback = [];
  if (/^\d{1,2}:\d{2}$/.test(String(row?.checkIn || ''))) {
    fallback.push({
      id: `CLK-IN-${Date.now()}`,
      mode: 'clock-in',
      time: String(row.checkIn).trim(),
      lat: typeof row?.checkInLat === 'number' ? row.checkInLat : undefined,
      lng: typeof row?.checkInLng === 'number' ? row.checkInLng : undefined,
      accuracy: typeof row?.checkInAccuracy === 'number' ? row.checkInAccuracy : null,
      source: String(row?.source || 'System'),
      createdAt: String(row?.date || ''),
    });
  }
  if (/^\d{1,2}:\d{2}$/.test(String(row?.checkOut || ''))) {
    fallback.push({
      id: `CLK-OUT-${Date.now()}`,
      mode: 'clock-out',
      time: String(row.checkOut).trim(),
      lat: typeof row?.checkOutLat === 'number' ? row.checkOutLat : undefined,
      lng: typeof row?.checkOutLng === 'number' ? row.checkOutLng : undefined,
      accuracy: typeof row?.checkOutAccuracy === 'number' ? row.checkOutAccuracy : null,
      source: String(row?.source || 'System'),
      createdAt: String(row?.date || ''),
    });
  }
  return fallback.sort((left, right) => left.time.localeCompare(right.time));
}

function enrichAttendanceRecordWithContext(payload, context) {
  const source = payload || {};
  const employeeId = String(source.employeeId || '').trim();
  const employeeName = String(source.employee || '').trim();
  const settings = context?.settings || defaultAttendanceSettings;
  const employee =
    context?.employeeById?.get(employeeId) ||
    context?.employeeByEmployeeId?.get(employeeId) ||
    context?.employeeByName?.get(employeeName) ||
    null;
  if (!employeeId && !employeeName && !employee) {
    return source;
  }
  const shiftName = String(source.shift || employee?.assignedShift || settings.shifts?.[0]?.name || 'Default').trim();
  const shiftConfig =
    settings.shifts.find(
      (shift) => String(shift?.name || '').trim().toLowerCase() === shiftName.toLowerCase()
    ) || settings.shifts[0];
  const clockings = normalizeAttendanceClockings(source);
  const firstClockIn = clockings.find((clocking) => clocking.mode === 'clock-in') || null;
  const lastClockOut = [...clockings].reverse().find((clocking) => clocking.mode === 'clock-out') || null;
  const checkIn = firstClockIn?.time || String(source.checkIn || '').trim();
  const checkOut = lastClockOut?.time || String(source.checkOut || '').trim();
  const reportMinutes = toMinutesFromClock(shiftConfig?.reportTime || settings.attendanceReportTime);
  const lateAfterMinutes =
    reportMinutes === null ? null : reportMinutes + Math.max(0, Number(shiftConfig?.graceInMinutes) || 0);
  const checkInMinutes = toMinutesFromClock(checkIn);
  const lateMinutes =
    lateAfterMinutes === null || checkInMinutes === null ? 0 : Math.max(0, checkInMinutes - lateAfterMinutes);
  const existingStatus = String(source.status || '').trim();
  const status =
    checkInMinutes === null
      ? existingStatus || 'Absent'
      : lateMinutes > 0
        ? 'Late'
        : existingStatus === 'On Leave'
          ? 'On Leave'
          : 'On Time';
  return {
    ...source,
    shift: shiftConfig?.name || shiftName,
    checkIn,
    checkOut,
    workedHours: checkIn && checkOut ? formatWorkedDuration(checkIn, checkOut) : String(source.workedHours || ''),
    lateMinutes: String(lateMinutes),
    status,
    clockings,
  };
}

async function enrichAttendanceRecord(db, payload) {
  const payloadSource = payload || {};
  const processedClockings = await processAttendanceClockings(payloadSource.clockings);
  const source =
    Array.isArray(payloadSource.clockings) && payloadSource.clockings.length > 0
      ? { ...payloadSource, clockings: processedClockings }
      : payloadSource;
  const employeeId = String(source.employeeId || '').trim();
  const employeeName = String(source.employee || '').trim();
  const [settingsRecord, employee] = await Promise.all([
    db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
    db.collection('employees').findOne({
      $or: [{ id: employeeId }, { employeeId }, { fullName: employeeName }],
    }),
  ]);
  return enrichAttendanceRecordWithContext(source, {
    settings: normalizeAttendanceSettings(settingsRecord?.value),
    employeeById: new Map(employee?.id ? [[String(employee.id), employee]] : []),
    employeeByEmployeeId: new Map(employee?.employeeId ? [[String(employee.employeeId), employee]] : []),
    employeeByName: new Map(employee?.fullName ? [[String(employee.fullName), employee]] : []),
  });
}

let mongoClient;
const tenantDbCache = new Map();

async function connectToMongo() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }
  if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
    return mongoClient.db(MONGO_MASTER_DB_NAME);
  }
  mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  return mongoClient.db(MONGO_MASTER_DB_NAME);
}

async function getTenantDatabase(masterDb, tenantIdRaw) {
  const normalizedTenantId = normalizeTenantId(tenantIdRaw);
  if (!normalizedTenantId) {
    throw new Error('tenantId is required');
  }
  if (normalizedTenantId === 'master') {
    return { tenantId: 'master', dbName: MONGO_MASTER_DB_NAME, db: masterDb };
  }
  if (tenantDbCache.has(normalizedTenantId)) {
    return tenantDbCache.get(normalizedTenantId);
  }
  const tenant = await masterDb.collection('tenants').findOne({ tenantId: normalizedTenantId, status: 'active' });
  if (!tenant) {
    throw new Error('Unknown or inactive tenant');
  }
  const tenantContext = {
    tenantId: normalizedTenantId,
    dbName: String(tenant.dbName || ''),
    tenant,
    db: mongoClient.db(String(tenant.dbName || '')),
  };
  tenantDbCache.set(normalizedTenantId, tenantContext);
  return tenantContext;
}

function resolveTenantIdFromRequest(req) {
  const fromHeader = req.headers['x-tenant-id'];
  if (fromHeader) {
    return normalizeTenantId(fromHeader);
  }
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return normalizeTenantId(payload.tenantId) || 'master';
    } catch (error) {
    }
  }
  if (req.body && req.body.tenantId) {
    return normalizeTenantId(req.body.tenantId);
  }
  if (req.query && req.query.tenantId) {
    return normalizeTenantId(req.query.tenantId);
  }
  return 'master';
}

const EMPLOYEE_PHONE_FIELDS = [
  'phonePrimary',
  'phoneSecondary',
  'phone',
  'contactNumber',
  'mobileNumber',
  'personalPhone',
  'emergencyContact1Phone',
  'emergencyContact2Phone',
  'referee1Phone',
  'referee2Phone',
];

function keepDigitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalizeEmployeePhoneFields(record) {
  const source = record || {};
  return EMPLOYEE_PHONE_FIELDS.reduce(
    (acc, field) => ({
      ...acc,
      [field]: field in source ? keepDigitsOnly(source[field]) : source[field],
    }),
    { ...source }
  );
}

async function syncEmployeeUser(db, employee) {
  try {
    const employeeId = String(employee.id || '').trim();
    const portalPassword = String(employee.password || '').trim();
    if (!employeeId || !portalPassword) {
      return;
    }
    const users = db.collection('users');
    const username = employeeId;
    const existing = await users.findOne({
      $or: [{ username }, { employeeId }],
    });
    const passwordHash = await bcrypt.hash(portalPassword, 10);
    const now = new Date().toISOString();
    if (existing) {
      await users.updateOne(
        { _id: existing._id },
        {
          $set: {
            username,
            fullName: employee.fullName || username,
            employeeId,
            passwordHash,
            role: existing.role || 'employee',
            isActive: existing.isActive !== false,
            updatedAt: now,
          },
        }
      );
    } else {
      await users.insertOne({
        username,
        fullName: employee.fullName || username,
        employeeId,
        passwordHash,
        role: 'employee',
        allowedModules: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    console.error('Failed to sync employee user', error);
  }
}

async function persistModuleRecord(db, moduleId, record) {
  if (!record || !record.id) {
    return;
  }
  const collectionName = moduleCollections[moduleId];
  if (!collectionName) {
    return;
  }
  const collection = db.collection(collectionName);
  const { id, _id, ...rest } = record;
  const update = {
    ...rest,
    id,
    updatedAt: new Date().toISOString(),
  };
  await collection.updateOne({ id }, { $set: update }, { upsert: false });
}

function getModuleCollection(db, moduleId) {
  const collectionName = moduleCollections[moduleId];
  if (!collectionName) {
    return null;
  }
  return db.collection(collectionName);
}

async function loadAuthUserFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  if (!token) {
    return null;
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
  const users = req.db.collection('users');
  const user = await users.findOne({ _id: new ObjectId(payload.sub), isActive: true });
  if (!user) {
    return null;
  }
  if (payload.jti) {
    const activeSession = await req.db.collection('authSessions').findOne({
      tokenId: payload.jti,
      revokedAt: null,
      expiresAt: { $gt: new Date().toISOString() },
    });
    if (!activeSession) {
      return null;
    }
  }
  return { ...user, tokenPayload: payload };
}

function resolveUserAllowedModulesForTenant(user, tenant, tenantId) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'superadmin' && tenantId === 'master') {
    return ['*'];
  }
  const packageModules = tenant ? resolvePackageModules(tenant.packageType) : [];
  const tenantGrants = tenant
    ? resolveTenantGrantedModules(tenant.packageType, tenant.grantedModules)
    : packageModules;
  const requestedModules = Array.isArray(user.allowedModules)
    ? user.allowedModules.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const baseline =
    role === 'employee' && requestedModules.length === 0
      ? defaultEmployeeModules
      : requestedModules.length > 0
        ? requestedModules
        : tenantGrants;
  const tenantSet = new Set(tenantGrants);
  if (tenantSet.size === 0) {
    return baseline;
  }
  return baseline.filter((moduleId) => tenantSet.has(moduleId));
}

app.get('/health', async (req, res) => {
  try {
    const masterDb = await connectToMongo();
    await masterDb.command({ ping: 1 });
    res.json({ status: 'ok', service: 'hr-backend', mongo: 'connected', mode: 'multitenant' });
  } catch (error) {
    res.status(500).json({ status: 'error', service: 'hr-backend', mongo: 'unavailable' });
  }
});

app.use(async (req, res, next) => {
  try {
    const masterDb = await connectToMongo();
    const requestedTenantId = resolveTenantIdFromRequest(req);
    const tenantContext = await getTenantDatabase(masterDb, requestedTenantId || 'master');
    req.masterDb = masterDb;
    req.tenantId = tenantContext.tenantId;
    req.tenant = tenantContext.tenant || null;
    req.getTenantDb = async (tenantId) => {
      const resolved = await getTenantDatabase(masterDb, tenantId);
      return resolved.db;
    };
    req.getDbByName = (dbName) => mongoClient.db(String(dbName || '').trim());
    req.db = tenantContext.db;
    req.db.bson = { ObjectId };
    next();
  } catch (error) {
    res.status(500).json({ error: error.message || 'Database connection failed' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/mobile', mobileRoutes);

app.get('/api/settings/attendance', async (req, res) => {
  try {
    const record = await req.db.collection('appSettings').findOne({ _id: 'attendance-rules' });
    const settings = normalizeAttendanceSettings(record?.value);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load attendance settings' });
  }
});

app.post('/api/settings/attendance', async (req, res) => {
  try {
    const settings = normalizeAttendanceSettings(req.body);
    await req.db.collection('appSettings').updateOne(
      { _id: 'attendance-rules' },
      {
        $set: {
          value: settings,
          updatedAt: new Date().toISOString(),
        },
        $setOnInsert: {
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save attendance settings' });
  }
});

app.use('/api/modules/:moduleId', async (req, res, next) => {
  try {
    const user = await loadAuthUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const moduleId = req.params.moduleId;
    if (String(user.role || '').toLowerCase() === 'superadmin' && req.tenantId === 'master') {
      req.authUser = user;
      next();
      return;
    }
    const allowedModules = resolveUserAllowedModulesForTenant(user, req.tenant, req.tenantId);
    if (!allowedModules.includes(moduleId)) {
      res.status(403).json({ error: 'Forbidden: module not enabled for this tenant/user' });
      return;
    }
    req.authUser = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Authorization check failed' });
  }
});

app.get('/api/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const records = await collection.find({}).sort({ _id: -1 }).limit(500).toArray();
    if (moduleId !== 'attendance-time') {
      res.json({ records });
      return;
    }
    const [settingsRecord, employees] = await Promise.all([
      req.db.collection('appSettings').findOne({ _id: 'attendance-rules' }),
      req.db.collection('employees').find({}).toArray(),
    ]);
    const employeeById = new Map();
    const employeeByEmployeeId = new Map();
    const employeeByName = new Map();
    for (const employee of employees) {
      if (employee?.id) {
        employeeById.set(String(employee.id), employee);
      }
      if (employee?.employeeId) {
        employeeByEmployeeId.set(String(employee.employeeId), employee);
      }
      if (employee?.fullName) {
        employeeByName.set(String(employee.fullName), employee);
      }
    }
    const settings = normalizeAttendanceSettings(settingsRecord?.value);
    const normalizedRecords = records.map((row) =>
      enrichAttendanceRecordWithContext(row, {
        settings,
        employeeById,
        employeeByEmployeeId,
        employeeByName,
      })
    );
    res.json({ records: normalizedRecords });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load records' });
  }
});

app.post('/api/modules/:moduleId', async (req, res) => {
  try {
    const { moduleId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    if (moduleId === 'employee-management' && req.tenantId !== 'master') {
      const limits = resolveTenantEffectiveLimits(req.tenant || {});
      const employeeLimit = Number(limits.employeeLimit) || 0;
      if (employeeLimit > 0) {
        const currentCount = await req.db.collection('employees').countDocuments({});
        if (currentCount >= employeeLimit) {
          res.status(403).json({ error: `Employee limit reached (${employeeLimit}) for this tenant plan.` });
          return;
        }
      }
    }
    if (moduleId === 'employee-management') {
      const incomingId = String(req.body?.id || '').trim();
      if (!incomingId) {
        res.status(400).json({ error: 'Employee ID is required.' });
        return;
      }
      const existingEmployee = await req.db.collection('employees').findOne({ id: incomingId });
      if (existingEmployee) {
        res.status(409).json({ error: `Employee ID ${incomingId} already exists.` });
        return;
      }
    }
    const incoming =
      moduleId === 'attendance-time'
        ? await enrichAttendanceRecord(req.db, req.body)
        : moduleId === 'employee-management'
          ? normalizeEmployeePhoneFields(req.body)
          : req.body;
    const payload = {
      ...incoming,
      moduleId,
      createdAt: incoming.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await collection.insertOne(payload);
    const inserted = await collection.findOne({ _id: result.insertedId });
    if (moduleId === 'employee-management' && inserted) {
      await syncEmployeeUser(req.db, inserted);
    }
    res.status(201).json({ record: inserted });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create record' });
  }
});

app.put('/api/modules/:moduleId/:recordId', async (req, res) => {
  try {
    const { moduleId, recordId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const existingRecord = await collection.findOne({ id: recordId });
    if (!existingRecord) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    const { _id, ...requestBody } = req.body || {};
    const mergedRequest = { ...existingRecord, ...requestBody };
    const normalized =
      moduleId === 'attendance-time'
        ? await enrichAttendanceRecord(req.db, mergedRequest)
        : moduleId === 'employee-management'
          ? normalizeEmployeePhoneFields(mergedRequest)
          : mergedRequest;
    const normalizedWithoutId = { ...(normalized || {}) };
    delete normalizedWithoutId._id;
    const update = {
      ...normalizedWithoutId,
      moduleId,
      updatedAt: new Date().toISOString(),
    };
    const result = await collection.updateOne({ id: recordId }, { $set: update });
    const updated = await collection.findOne({ id: recordId });
    if (moduleId === 'employee-management') {
      await syncEmployeeUser(req.db, updated);
    }
    res.json({ record: updated });
  } catch (error) {
    console.error('Failed to update record', error);
    res.status(500).json({ error: 'Failed to update record' });
  }
});

app.delete('/api/modules/:moduleId/:recordId', async (req, res) => {
  try {
    const { moduleId, recordId } = req.params;
    const collection = getModuleCollection(req.db, moduleId);
    if (!collection) {
      res.status(404).json({ error: 'Unknown module' });
      return;
    }
    const result = await collection.deleteOne({ id: recordId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

app.use('/api/tracking', trackingRoutes);

async function start() {
  try {
    const masterDb = await connectToMongo();
    app.locals.masterDb = masterDb;
    await masterDb.collection('tenants').updateOne(
      { tenantId: 'master' },
      {
        $set: {
          name: 'Master Tenant',
          packageType: 'enterprise',
          dbName: MONGO_MASTER_DB_NAME,
          grantedModules: [],
          status: 'active',
          updatedAt: new Date().toISOString(),
        },
        $setOnInsert: {
          tenantId: 'master',
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
    await ensureSuperAdmin(masterDb);
    app.listen(PORT, () => {
      console.log(`Connected to MongoDB Atlas database "${MONGO_MASTER_DB_NAME}"`);
      console.log(`HR backend listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start backend', error);
    process.exit(1);
  }
}

start();
