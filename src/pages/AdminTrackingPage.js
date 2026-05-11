import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toApiUrl } from '../config/api';

const googleMapsTileKey = (process.env.REACT_APP_GOOGLE_MAPS_TILE_KEY || '').trim();
const googleTileBaseUrl = googleMapsTileKey
  ? `https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${encodeURIComponent(googleMapsTileKey)}`
  : 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';

const resolveMarkerColor = (status) => {
  if (status === 'INSIDE') {
    return '#0f9d58';
  }
  if (status === 'OUTSIDE') {
    return '#db4437';
  }
  if (status === 'OFFLINE') {
    return '#f4b400';
  }
  if (status === 'LOCATION_OFF') {
    return '#7e57c2';
  }
  return '#8b97c4';
};

const getIsoDateString = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().slice(0, 10);
};

const createViewState = () => ({
  hasAutoCentered: false,
  lastFocusEmployeeId: '',
  lastMarkerCount: 0,
});

export default function AdminTrackingPage() {
  const todayTrackingDate = getIsoDateString();
  const [trackingTab, setTrackingTab] = useState('overview');
  const [trackingEmployees, setTrackingEmployees] = useState([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [alertsError, setAlertsError] = useState('');
  const [riskEvents, setRiskEvents] = useState([]);
  const [riskEventsError, setRiskEventsError] = useState('');
  const [riskTypeFilter, setRiskTypeFilter] = useState('All');
  const [riskSearchText, setRiskSearchText] = useState('');
  const [riskFromDate, setRiskFromDate] = useState('');
  const [riskToDate, setRiskToDate] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedTrackingDate, setSelectedTrackingDate] = useState(todayTrackingDate);
  const [movementTrail, setMovementTrail] = useState([]);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState('');
  const [resolvedAddress, setResolvedAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);
  const [isEmployeeDetailModalOpen, setIsEmployeeDetailModalOpen] = useState(false);
  const [isFullMapModalOpen, setIsFullMapModalOpen] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackRunning, setPlaybackRunning] = useState(true);
  const overviewMapElementRef = useRef(null);
  const overviewMapRef = useRef(null);
  const overviewLayerRef = useRef(null);
  const fullMapElementRef = useRef(null);
  const fullMapRef = useRef(null);
  const fullLayerRef = useRef(null);
  const detailMapElementRef = useRef(null);
  const detailMapRef = useRef(null);
  const detailLayerRef = useRef(null);
  const overviewViewStateRef = useRef(createViewState());
  const fullViewStateRef = useRef(createViewState());
  const detailViewStateRef = useRef(createViewState());

  const employeesWithCoordinates = useMemo(
    () =>
      trackingEmployees.filter(
        (employee) =>
          typeof employee.lat === 'number' &&
          !Number.isNaN(employee.lat) &&
          typeof employee.lng === 'number' &&
          !Number.isNaN(employee.lng)
      ),
    [trackingEmployees]
  );

  const selectedEmployee = useMemo(
    () => trackingEmployees.find((employee) => employee.employeeId === selectedEmployeeId) || null,
    [selectedEmployeeId, trackingEmployees]
  );
  const isViewingToday = selectedTrackingDate === todayTrackingDate;

  useEffect(() => {
    if (!selectedEmployeeId && trackingEmployees.length > 0) {
      setSelectedEmployeeId(trackingEmployees[0].employeeId);
    }
  }, [selectedEmployeeId, trackingEmployees]);

  useEffect(() => {
    let cancelled = false;
    let intervalId;
    const fetchTracking = async () => {
      try {
        if (cancelled) {
          return;
        }
        setTrackingLoading(true);
        const [trackingResponse, alertsResponse, riskEventsResponse] = await Promise.all([
          fetch(toApiUrl('http://localhost:8000/api/tracking/employees')),
          fetch(toApiUrl('http://localhost:8000/api/tracking/alerts/whatsapp')),
          fetch(toApiUrl('http://localhost:8000/api/tracking/events?limit=300')),
        ]);
        if (!trackingResponse.ok) {
          throw new Error('Failed to load tracking data');
        }
        const trackingData = await trackingResponse.json();
        let alertsData = null;
        let eventsData = null;
        if (alertsResponse.ok) {
          alertsData = await alertsResponse.json();
        }
        if (riskEventsResponse.ok) {
          eventsData = await riskEventsResponse.json();
        }
        if (!cancelled) {
          const employees = Array.isArray(trackingData.employees) ? trackingData.employees : [];
          setTrackingEmployees(employees);
          if (alertsData && Array.isArray(alertsData.alerts)) {
            setAlerts(alertsData.alerts);
            setAlertsError('');
          }
          if (eventsData && Array.isArray(eventsData.events)) {
            setRiskEvents(eventsData.events);
            setRiskEventsError('');
          }
          setTrackingError('');
        }
      } catch (error) {
        if (!cancelled) {
          setTrackingError('Unable to load tracking data');
          setRiskEventsError('Unable to load risk events');
        }
      } finally {
        if (!cancelled) {
          setTrackingLoading(false);
        }
      }
    };
    fetchTracking();
    intervalId = setInterval(fetchTracking, 1500);
    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedEmployeeId) {
      return;
    }
    let cancelled = false;
    const fetchTrail = async () => {
      try {
        setTrailLoading(true);
        setTrailError('');
        const response = await fetch(
          toApiUrl(
            `http://localhost:8000/api/tracking/movement/${encodeURIComponent(selectedEmployeeId)}?limit=200&date=${encodeURIComponent(
              selectedTrackingDate
            )}`
          )
        );
        if (!response.ok) {
          throw new Error('Failed to load movement trail');
        }
        const data = await response.json();
        if (!cancelled) {
          setMovementTrail(Array.isArray(data.movement) ? data.movement : []);
        }
      } catch (error) {
        if (!cancelled) {
          setTrailError('Unable to load movement trail');
          setMovementTrail([]);
        }
      } finally {
        if (!cancelled) {
          setTrailLoading(false);
        }
      }
    };
    fetchTrail();
    if (!isViewingToday) {
      return () => {
        cancelled = true;
      };
    }
    const intervalId = setInterval(fetchTrail, 1500);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isViewingToday, selectedEmployeeId, selectedTrackingDate]);

  useEffect(() => {
    if (!selectedEmployee || typeof selectedEmployee.lat !== 'number' || typeof selectedEmployee.lng !== 'number') {
      setResolvedAddress('');
      return;
    }
    let cancelled = false;
    const fetchAddress = async () => {
      try {
        setAddressLoading(true);
        const response = await fetch(
          toApiUrl(`http://localhost:8000/api/tracking/reverse-geocode?lat=${encodeURIComponent(selectedEmployee.lat)}&lng=${encodeURIComponent(
            selectedEmployee.lng
          )}`)
        );
        if (!response.ok) {
          throw new Error('Reverse geocode failed');
        }
        const data = await response.json();
        if (!cancelled) {
          setResolvedAddress(data.displayName || '');
        }
      } catch (error) {
        if (!cancelled) {
          setResolvedAddress('');
        }
      } finally {
        if (!cancelled) {
          setAddressLoading(false);
        }
      }
    };
    fetchAddress();
    return () => {
      cancelled = true;
    };
  }, [selectedEmployee]);

  const trailCoordinates = useMemo(() => {
    return movementTrail
      .filter(
        (row) => typeof row.lat === 'number' && !Number.isNaN(row.lat) && typeof row.lng === 'number' && !Number.isNaN(row.lng)
      )
      .map((row, index) => ({
        lat: row.lat,
        lng: row.lng,
        orderTs: new Date(row.recordedAt || row.createdAt || row.lastSeen || '').getTime() || index,
      }))
      .sort((left, right) => left.orderTs - right.orderTs)
      .map((row) => [row.lat, row.lng]);
  }, [movementTrail]);

  const playbackPath = useMemo(() => {
    if (!isFullMapModalOpen || trailCoordinates.length === 0) {
      return trailCoordinates;
    }
    return trailCoordinates.slice(0, Math.max(1, playbackIndex + 1));
  }, [isFullMapModalOpen, playbackIndex, trailCoordinates]);

  useEffect(() => {
    if (!isFullMapModalOpen) {
      return;
    }
    setPlaybackIndex(0);
    setPlaybackRunning(true);
  }, [isFullMapModalOpen, selectedEmployeeId]);

  useEffect(() => {
    if (!isFullMapModalOpen || !playbackRunning || trailCoordinates.length <= 1) {
      return;
    }
    const intervalId = setInterval(() => {
      setPlaybackIndex((prev) => (prev + 1 >= trailCoordinates.length ? prev : prev + 1));
    }, 650);
    return () => clearInterval(intervalId);
  }, [isFullMapModalOpen, playbackRunning, trailCoordinates.length]);

  const riskTypeOptions = useMemo(() => {
    const values = new Set(
      riskEvents
        .map((event) => String(event.riskType || '').trim())
        .filter(Boolean)
    );
    return ['All', ...Array.from(values)];
  }, [riskEvents]);

  const filteredRiskEvents = useMemo(() => {
    const query = riskSearchText.trim().toLowerCase();
    const fromTime = riskFromDate ? new Date(`${riskFromDate}T00:00:00`).getTime() : null;
    const toTime = riskToDate ? new Date(`${riskToDate}T23:59:59`).getTime() : null;
    return [...riskEvents]
      .filter((event) => {
        const matchesType = riskTypeFilter === 'All' || String(event.riskType || '') === String(riskTypeFilter);
        const eventTime = new Date(event.createdAt || '').getTime();
        const matchesFrom = fromTime === null || (Number.isFinite(eventTime) && eventTime >= fromTime);
        const matchesTo = toTime === null || (Number.isFinite(eventTime) && eventTime <= toTime);
        const matchesQuery =
          !query ||
          String(event.fullName || '').toLowerCase().includes(query) ||
          String(event.employeeId || '').toLowerCase().includes(query) ||
          String(event.riskType || '').toLowerCase().includes(query) ||
          String(event.details || '').toLowerCase().includes(query);
        return matchesType && matchesFrom && matchesTo && matchesQuery;
      })
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  }, [riskEvents, riskTypeFilter, riskSearchText, riskFromDate, riskToDate]);

  const getSeverityStyle = (severityValue) => {
    const normalized = String(severityValue || '').toLowerCase();
    if (normalized === 'high') {
      return { backgroundColor: '#ffe7ec', color: '#9a1f33', border: '1px solid #ffc0cb' };
    }
    if (normalized === 'medium') {
      return { backgroundColor: '#fff2df', color: '#8a4c0f', border: '1px solid #ffd39c' };
    }
    return { backgroundColor: '#eaf2ff', color: '#27467f', border: '1px solid #c9dbff' };
  };

  const downloadRiskEventsCsv = () => {
    if (filteredRiskEvents.length === 0) {
      return;
    }
    const headers = ['Event ID', 'Time', 'Employee ID', 'Employee', 'Risk Type', 'Severity', 'Status', 'Details'];
    const toCell = (value) => {
      const text = String(value ?? '');
      if (/[",\n]/.test(text)) {
        return `"${text.replaceAll('"', '""')}"`;
      }
      return text;
    };
    const lines = [
      headers.join(','),
      ...filteredRiskEvents.map((event) =>
        [
          event.id,
          event.createdAt,
          event.employeeId,
          event.fullName,
          event.riskType,
          event.severity,
          event.status,
          event.details,
        ]
          .map(toCell)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tracking-risk-events-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    return () => {
      if (overviewMapRef.current) {
        overviewMapRef.current.remove();
        overviewMapRef.current = null;
      }
      if (fullMapRef.current) {
        fullMapRef.current.remove();
        fullMapRef.current = null;
      }
      if (detailMapRef.current) {
        detailMapRef.current.remove();
        detailMapRef.current = null;
      }
    };
  }, []);

  const paintMap = useCallback(({
    mapRef,
    mapElementRef,
    layerRef,
    viewStateRef,
    height = 400,
    focusEmployeeId = '',
    showAllEmployees = true,
    pathCoordinates = [],
    enableFitBounds = true,
  }) => {
    const element = mapElementRef.current;
    if (!element) {
      return;
    }
    const fallbackCenter = [37.421998, -122.084];
    const focusedEmployee =
      employeesWithCoordinates.find((item) => item.employeeId === focusEmployeeId) || selectedEmployee || employeesWithCoordinates[0];
    const center =
      focusedEmployee && typeof focusedEmployee.lat === 'number' && typeof focusedEmployee.lng === 'number'
        ? [focusedEmployee.lat, focusedEmployee.lng]
        : fallbackCenter;
    if (!mapRef.current) {
      mapRef.current = L.map(element, {
        zoomControl: true,
        attributionControl: true,
      }).setView(center, 15);
      L.tileLayer(googleTileBaseUrl, {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        attribution: '&copy; Google Maps',
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;
    const viewState = viewStateRef.current;
    map.invalidateSize();
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    const layerGroup = L.layerGroup();
    const markerSource = showAllEmployees
      ? employeesWithCoordinates
      : employeesWithCoordinates.filter((employee) => employee.employeeId === focusEmployeeId);
    markerSource.forEach((employee) => {
      const isSelected = employee.employeeId === focusEmployeeId;
      L.circleMarker([employee.lat, employee.lng], {
        radius: isSelected ? 9 : 7,
        weight: isSelected ? 3 : 2,
        color: '#ffffff',
        fillColor: resolveMarkerColor(employee.status),
        fillOpacity: 0.95,
      })
        .bindTooltip(`${employee.fullName} (${employee.employeeId})`, {
          direction: 'top',
          offset: [0, -8],
          opacity: 0.95,
        })
        .on('mouseover', function handleMouseOver() {
          this.openTooltip();
        })
        .on('mouseout', function handleMouseOut() {
          this.closeTooltip();
        })
        .on('click', () => setSelectedEmployeeId(employee.employeeId))
        .addTo(layerGroup);
    });
    if (pathCoordinates.length > 1) {
      L.polyline(pathCoordinates, {
        color: '#0a73d9',
        weight: 4,
        opacity: 0.92,
      }).addTo(layerGroup);
      const previousPoint = pathCoordinates[pathCoordinates.length - 2];
      const lastPoint = pathCoordinates[pathCoordinates.length - 1];
      const deltaLat = lastPoint[0] - previousPoint[0];
      const deltaLng = lastPoint[1] - previousPoint[1];
      const headingDeg = (Math.atan2(deltaLng, deltaLat) * 180) / Math.PI;
      L.marker(lastPoint, {
        icon: L.divIcon({
          className: 'tracking-heading-icon',
          html: `<div style="transform: rotate(${headingDeg}deg); color:#0a73d9; font-size:18px; font-weight:700; line-height:1;">▲</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).addTo(layerGroup);
      L.circleMarker(lastPoint, {
        radius: 8,
        weight: 3,
        color: '#0a73d9',
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).addTo(layerGroup);
    }
    layerGroup.addTo(map);
    layerRef.current = layerGroup;
    const shouldReframeView =
      !viewState.hasAutoCentered ||
      viewState.lastFocusEmployeeId !== focusEmployeeId ||
      (viewState.lastMarkerCount === 0 && markerSource.length > 0);
    if (enableFitBounds && shouldReframeView) {
      const boundsCoordinates = [
        ...markerSource.map((employee) => [employee.lat, employee.lng]),
        ...pathCoordinates,
      ];
      if (boundsCoordinates.length > 0) {
        map.fitBounds(boundsCoordinates, { padding: [40, 40], maxZoom: 17 });
      } else {
        map.setView(center, 14);
      }
    } else if (!enableFitBounds && shouldReframeView) {
      map.setView(center, map.getZoom() || 15);
    }
    viewState.hasAutoCentered = true;
    viewState.lastFocusEmployeeId = focusEmployeeId;
    viewState.lastMarkerCount = markerSource.length;
    element.style.height = `${height}px`;
  }, [employeesWithCoordinates, selectedEmployee]);

  useEffect(() => {
    paintMap({
      mapRef: overviewMapRef,
      mapElementRef: overviewMapElementRef,
      layerRef: overviewLayerRef,
      viewStateRef: overviewViewStateRef,
      height: 400,
      focusEmployeeId: selectedEmployeeId,
      showAllEmployees: true,
      pathCoordinates: trailCoordinates,
      enableFitBounds: true,
    });
  }, [employeesWithCoordinates, paintMap, selectedEmployeeId, trailCoordinates]);

  useEffect(() => {
    if (!isFullMapModalOpen) {
      return;
    }
    paintMap({
      mapRef: fullMapRef,
      mapElementRef: fullMapElementRef,
      layerRef: fullLayerRef,
      viewStateRef: fullViewStateRef,
      height: 620,
      focusEmployeeId: selectedEmployeeId,
      showAllEmployees: true,
      pathCoordinates: playbackPath,
      enableFitBounds: false,
    });
  }, [employeesWithCoordinates, isFullMapModalOpen, paintMap, playbackPath, selectedEmployeeId]);

  useEffect(() => {
    if (!isEmployeeDetailModalOpen || !selectedEmployee) {
      return;
    }
    paintMap({
      mapRef: detailMapRef,
      mapElementRef: detailMapElementRef,
      layerRef: detailLayerRef,
      viewStateRef: detailViewStateRef,
      height: 280,
      focusEmployeeId: selectedEmployee.employeeId,
      showAllEmployees: false,
      pathCoordinates: trailCoordinates,
      enableFitBounds: true,
    });
  }, [isEmployeeDetailModalOpen, paintMap, selectedEmployee, trailCoordinates]);

  return (
    <section className="panel">
      <header className="panel-title-row">
        <div>
          <h2>Monitoring & Tracking</h2>
          <p>Real-time employee movement monitor with clickable details</p>
        </div>
      </header>
      <div className="attendance-audit-wrap">
        <div className="attendance-ops-actions" style={{ justifyContent: 'flex-start', marginBottom: 8 }}>
          <button
            type="button"
            className={`neutral-btn ${trackingTab === 'overview' ? 'active' : ''}`}
            onClick={() => setTrackingTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={`neutral-btn ${trackingTab === 'risk-events' ? 'active' : ''}`}
            onClick={() => setTrackingTab('risk-events')}
          >
            Risk Events
          </button>
        </div>
        {trackingTab === 'overview' ? (
          <>
        <div className="attendance-audit-head">
          <h4>Live Presence Monitor</h4>
          <div className="attendance-audit-filters">
            <p>
              {isViewingToday
                ? 'Tracking refreshes every 3 seconds. Click a marker or row to inspect movement.'
                : `Viewing saved movement for ${selectedTrackingDate}.`}
            </p>
            <label>
              <span>Tracking Date</span>
              <input
                type="date"
                value={selectedTrackingDate}
                max={todayTrackingDate}
                onChange={(event) => setSelectedTrackingDate(event.target.value || todayTrackingDate)}
              />
            </label>
            <div className="attendance-ops-actions" style={{ alignSelf: 'end' }}>
              <button
                type="button"
                className="neutral-btn"
                onClick={() => setSelectedTrackingDate(todayTrackingDate)}
                disabled={isViewingToday}
              >
                Today
              </button>
            </div>
          </div>
        </div>
        <div className="attendance-ops-grid">
          <div className="employee-ops-card" style={{ flex: 1, minHeight: 280 }}>
            <div className="employee-ops-header">
              <h5>Live Map View</h5>
              <div className="employee-ops-actions">
                <span>
                  {employeesWithCoordinates.length > 0
                    ? `${employeesWithCoordinates.length} devices with location`
                    : 'No coordinates yet'}
                </span>
                <button type="button" className="neutral-btn" onClick={() => setIsFullMapModalOpen(true)}>
                  Full Map
                </button>
              </div>
            </div>
            <div
              ref={overviewMapElementRef}
              style={{
                position: 'relative',
                width: '100%',
                height: 400,
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid #d9e6fb',
                background: '#ecf2ff',
              }}
            />
            {employeesWithCoordinates.length === 0 ? (
              <p className="form-error" style={{ marginTop: 8 }}>
                Waiting for location updates from mobile app. Make sure employee tracking is active and location permission is granted.
              </p>
            ) : null}
            <div className="employee-ops-list">
              <div className="employee-ops-row">
                <div>
                  <p>Legend</p>
                  <span>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: '#0f9d58', marginRight: 6 }} />
                    Inside
                  </span>
                </div>
                <div className="employee-ops-actions">
                  <span>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: '#db4437', marginRight: 6 }} />
                    Outside
                  </span>
                </div>
                <div className="employee-ops-actions">
                  <span>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: '#f4b400', marginRight: 6 }} />
                    Offline
                  </span>
                </div>
                <div className="employee-ops-actions">
                  <span>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', backgroundColor: '#7e57c2', marginRight: 6 }} />
                    Location Off
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="employee-ops-card" style={{ flex: 1, minHeight: 280 }}>
            <div className="employee-ops-header">
              <h5>Live Summary</h5>
              <span>{trackingEmployees.length} employee device(s)</span>
            </div>
            <div className="employee-ops-list">
              <div className="employee-ops-row">
                <div>
                  <p>Selected</p>
                  <span>
                    {selectedEmployee
                      ? `${selectedEmployee.fullName} (${selectedEmployee.employeeId})`
                      : 'Click a row to inspect details'}
                  </span>
                </div>
                <div className="employee-ops-actions">
                  <span>{selectedEmployee?.status || '—'}</span>
                </div>
              </div>
              <div className="employee-ops-row">
                <div>
                  <p>Movement</p>
                  <span>{trailLoading ? 'Loading trail...' : `${movementTrail.length} movement point(s)`}</span>
                </div>
                <div className="employee-ops-actions">
                  <span>{trailError ? 'Trail error' : isViewingToday ? 'Live today' : selectedTrackingDate}</span>
                </div>
              </div>
              <div className="employee-ops-header">
                <h5>WhatsApp Alerts</h5>
                <span>{alerts.length > 0 ? `${alerts.length} alert${alerts.length === 1 ? '' : 's'}` : 'No alerts yet'}</span>
              </div>
              {alertsError ? <p className="form-error">{alertsError}</p> : null}
              {alerts.length === 0 ? (
                <div className="employee-ops-row">
                  <div>
                    <p>No WhatsApp alerts recorded</p>
                    <span>Employees will appear here when they trigger rules</span>
                  </div>
                </div>
              ) : (
                alerts
                  .slice()
                  .reverse()
                  .slice(0, 6)
                  .map((alert) => (
                    <div key={alert.id} className="employee-ops-row">
                      <div>
                        <p>{alert.fullName && alert.employeeId ? `${alert.fullName} (${alert.employeeId})` : alert.employeeId || 'Unknown Employee'}</p>
                        <span>{alert.reason === 'outside-premises' ? 'Outside premises geofence' : alert.reason === 'offline-threshold' ? 'Offline beyond threshold' : alert.reason === 'manual' ? 'Manual alert' : alert.reason || 'Alert'}</span>
                      </div>
                      <div className="employee-ops-actions">
                        <span>{alert.status || ''}</span>
                        <span style={{ fontSize: 11, color: '#627099' }}>{alert.createdAt}</span>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
        {trackingError ? <p className="form-error">{trackingError}</p> : null}
        <div className="attendance-audit-table">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Status</th>
                <th>Distance (m)</th>
                <th>Coordinates</th>
                <th>Real Location</th>
                <th>Last Seen</th>
                <th>WiFi</th>
                <th>Flags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trackingLoading ? (
                <tr>
                  <td colSpan={9}>Loading tracking data...</td>
                </tr>
              ) : trackingEmployees.length > 0 ? (
                trackingEmployees.map((employee) => (
                  <tr
                    key={employee.employeeId}
                    onClick={() => setSelectedEmployeeId(employee.employeeId)}
                    style={{
                      cursor: 'pointer',
                      backgroundColor: selectedEmployeeId === employee.employeeId ? 'rgba(10,115,217,0.09)' : 'transparent',
                    }}
                  >
                    <td>
                      {employee.fullName} ({employee.employeeId})
                    </td>
                    <td>{employee.status || 'OFFLINE'}</td>
                    <td>{typeof employee.distanceMeters === 'number' ? Math.round(employee.distanceMeters) : '—'}</td>
                    <td>
                      {typeof employee.lat === 'number' && typeof employee.lng === 'number'
                        ? `${employee.lat.toFixed(6)}, ${employee.lng.toFixed(6)}`
                        : '—'}
                    </td>
                    <td>{employee.locationAddress || employee.locationLabel || '—'}</td>
                    <td>{employee.lastSeen || '—'}</td>
                    <td>{employee.wifiSsid || '—'}</td>
                    <td>
                      {employee.outsidePremises ? 'OUTSIDE PREMISES' : ''}
                      {employee.offline ? (employee.outsidePremises ? ' • OFFLINE' : 'OFFLINE') : ''}
                      {!employee.wifiValid ? (employee.outsidePremises || employee.offline ? ' • WiFi Mismatch' : 'WiFi Mismatch') : ''}
                      {employee.gpsSpoofSuspected
                        ? employee.outsidePremises || employee.offline || !employee.wifiValid
                          ? ' • GPS Suspicious'
                          : 'GPS Suspicious'
                        : ''}
                      {employee.networkRisk
                        ? employee.outsidePremises || employee.offline || !employee.wifiValid || employee.gpsSpoofSuspected
                          ? ' • Network Risk'
                          : 'Network Risk'
                        : ''}
                      {employee.locationDisabled
                        ? employee.outsidePremises || employee.offline || !employee.wifiValid || employee.gpsSpoofSuspected || employee.networkRisk
                          ? ' • Location Off'
                          : 'Location Off'
                        : ''}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedEmployeeId(employee.employeeId);
                          setIsEmployeeDetailModalOpen(true);
                        }}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9}>No tracking data available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {isFullMapModalOpen ? (
          <div className="modal-backdrop" onClick={() => setIsFullMapModalOpen(false)}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ width: 'min(1240px, 98vw)' }}>
              <div className="modal-header">
                <h3>Live Movement Map</h3>
                <div className="attendance-ops-actions">
                  <button type="button" className="neutral-btn" onClick={() => setPlaybackRunning((prev) => !prev)}>
                    {playbackRunning ? 'Pause Playback' : 'Resume Playback'}
                  </button>
                  <button type="button" className="neutral-btn" onClick={() => setPlaybackIndex(0)}>
                    Restart
                  </button>
                  <button type="button" className="neutral-btn" onClick={() => setIsFullMapModalOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
              <div
                ref={fullMapElementRef}
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 620,
                  borderRadius: 12,
                  overflow: 'hidden',
                  border: '1px solid #d9e6fb',
                  background: '#ecf2ff',
                }}
              />
              <div className="employee-ops-list" style={{ marginTop: 12 }}>
                <div className="employee-ops-row">
                  <div>
                    <p>Playback Progress</p>
                    <span>
                      {trailCoordinates.length > 0
                        ? `${Math.min(playbackIndex + 1, trailCoordinates.length)} of ${trailCoordinates.length} movement points`
                        : 'No movement points'}
                    </span>
                  </div>
                  <div className="employee-ops-actions">
                    <span>{selectedEmployee ? `${selectedEmployee.fullName} (${selectedEmployee.employeeId})` : 'No employee selected'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {isEmployeeDetailModalOpen && selectedEmployee ? (
          <div className="modal-backdrop" onClick={() => setIsEmployeeDetailModalOpen(false)}>
            <div className="modal-card" onClick={(event) => event.stopPropagation()} style={{ width: 'min(980px, 96vw)' }}>
              <div className="modal-header">
                <h3>
                  {selectedEmployee.fullName} ({selectedEmployee.employeeId})
                </h3>
                <button type="button" className="neutral-btn" onClick={() => setIsEmployeeDetailModalOpen(false)}>
                  Close
                </button>
              </div>
              <div className="attendance-ops-grid">
                <div className="employee-ops-card" style={{ minHeight: 260 }}>
                  <div className="employee-ops-header">
                    <h5>Live Detail</h5>
                    <span>{selectedEmployee.status || 'UNKNOWN'}</span>
                  </div>
                  <div className="employee-ops-row" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: '#2d5cd6',
                          color: '#ffffff',
                          fontWeight: 700,
                        }}
                      >
                        {String(selectedEmployee.fullName || 'U')
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700 }}>{selectedEmployee.fullName}</p>
                        <span>{selectedEmployee.employeeId}</span>
                      </div>
                    </div>
                    <div className="employee-ops-actions">
                      <span>{selectedEmployee.status || 'UNKNOWN'}</span>
                    </div>
                  </div>
                  <div
                    ref={detailMapElementRef}
                    style={{
                      width: '100%',
                      height: 280,
                      borderRadius: 10,
                      overflow: 'hidden',
                      border: '1px solid #d9e6fb',
                      background: '#ecf2ff',
                      marginBottom: 10,
                    }}
                  />
                  <div className="employee-ops-list">
                    <div className="employee-ops-row">
                      <div>
                        <p>Last Seen</p>
                        <span>{selectedEmployee.lastSeen || '—'}</span>
                      </div>
                      <div className="employee-ops-actions">
                        <span>{typeof selectedEmployee.distanceMeters === 'number' ? `${Math.round(selectedEmployee.distanceMeters)} m` : '—'}</span>
                      </div>
                    </div>
                    <div className="employee-ops-row">
                      <div>
                        <p>Coordinates</p>
                        <span>
                          {typeof selectedEmployee.lat === 'number' ? selectedEmployee.lat.toFixed(6) : '—'},{' '}
                          {typeof selectedEmployee.lng === 'number' ? selectedEmployee.lng.toFixed(6) : '—'}
                        </span>
                      </div>
                      <div className="employee-ops-actions">
                        {typeof selectedEmployee.lat === 'number' && typeof selectedEmployee.lng === 'number' ? (
                          <a href={`https://www.google.com/maps?q=${selectedEmployee.lat},${selectedEmployee.lng}`} target="_blank" rel="noreferrer">
                            Open in Maps
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="employee-ops-row">
                      <div>
                        <p>Resolved Address</p>
                        <span>
                          {selectedEmployee.locationAddress ||
                            selectedEmployee.locationLabel ||
                            resolvedAddress ||
                            (addressLoading ? 'Resolving location...' : 'Address not available yet')}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="employee-ops-card" style={{ minHeight: 260 }}>
                  <div className="employee-ops-header">
                    <h5>Movement Trail</h5>
                    <span>{trailLoading ? 'Loading...' : `${movementTrail.length} points`}</span>
                  </div>
                  <div className="attendance-audit-table">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Time</th>
                          <th>Latitude</th>
                          <th>Longitude</th>
                          <th>Accuracy</th>
                          <th>Map</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movementTrail.length > 0 ? (
                          movementTrail
                            .slice()
                            .reverse()
                            .slice(0, 40)
                            .map((point, index) => (
                              <tr key={point.id || `${point.time}-${index}`}>
                                <td>{index + 1}</td>
                                <td>{point.recordedAt || point.lastSeen || point.createdAt || '—'}</td>
                                <td>{typeof point.lat === 'number' ? point.lat.toFixed(6) : '—'}</td>
                                <td>{typeof point.lng === 'number' ? point.lng.toFixed(6) : '—'}</td>
                                <td>{typeof point.accuracy === 'number' ? `${Math.round(point.accuracy)} m` : '—'}</td>
                                <td>
                                  {typeof point.lat === 'number' && typeof point.lng === 'number' ? (
                                    <a href={`https://www.google.com/maps?q=${point.lat},${point.lng}`} target="_blank" rel="noreferrer">
                                      Open
                                    </a>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              </tr>
                            ))
                        ) : (
                          <tr>
                            <td colSpan={6}>{trailLoading ? 'Loading movement...' : 'No movement records found.'}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {trailError ? <p className="form-error">{trailError}</p> : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
          </>
        ) : (
          <div className="employee-ops-card">
            <div className="employee-ops-header">
              <h5>Risk Events Ledger</h5>
              <div className="employee-ops-actions">
                <span>{filteredRiskEvents.length} event(s)</span>
                <button type="button" className="neutral-btn" onClick={downloadRiskEventsCsv}>
                  Export CSV
                </button>
              </div>
            </div>
            <div className="attendance-audit-filters">
              <label>
                <span>Risk Type</span>
                <select value={riskTypeFilter} onChange={(event) => setRiskTypeFilter(event.target.value)}>
                  {riskTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Search</span>
                <input
                  value={riskSearchText}
                  onChange={(event) => setRiskSearchText(event.target.value)}
                  placeholder="Employee, ID, risk type, details"
                />
              </label>
              <label>
                <span>From Date</span>
                <input type="date" value={riskFromDate} onChange={(event) => setRiskFromDate(event.target.value)} />
              </label>
              <label>
                <span>To Date</span>
                <input type="date" value={riskToDate} onChange={(event) => setRiskToDate(event.target.value)} />
              </label>
              <div className="attendance-ops-actions" style={{ alignSelf: 'end' }}>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => {
                    setRiskTypeFilter('All');
                    setRiskSearchText('');
                    setRiskFromDate('');
                    setRiskToDate('');
                  }}
                >
                  Reset Filters
                </button>
              </div>
            </div>
            {riskEventsError ? <p className="form-error">{riskEventsError}</p> : null}
            <div className="attendance-audit-table">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Employee</th>
                    <th>Risk Type</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRiskEvents.length > 0 ? (
                    filteredRiskEvents.map((eventRow) => (
                      <tr key={eventRow.id}>
                        <td>{eventRow.createdAt || '—'}</td>
                        <td>
                          {eventRow.fullName} ({eventRow.employeeId || '—'})
                        </td>
                        <td>{eventRow.riskType || '—'}</td>
                        <td>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              borderRadius: 999,
                              padding: '3px 10px',
                              fontWeight: 700,
                              fontSize: 12,
                              ...getSeverityStyle(eventRow.severity),
                            }}
                          >
                            {String(eventRow.severity || 'low').toUpperCase()}
                          </span>
                        </td>
                        <td>{eventRow.status || '—'}</td>
                        <td>{eventRow.details || '—'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>No risk events found for the selected filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
