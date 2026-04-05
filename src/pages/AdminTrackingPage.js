import React, { useEffect, useMemo, useState } from 'react';

const mapEmployeeToPoint = (employee, bounds) => {
  const latRange = bounds.maxLat - bounds.minLat || 0.000001;
  const lngRange = bounds.maxLng - bounds.minLng || 0.000001;
  const normalizedLat = (bounds.maxLat - employee.lat) / latRange;
  const normalizedLng = (employee.lng - bounds.minLng) / lngRange;
  return {
    x: Math.max(0, Math.min(100, normalizedLng * 100)),
    y: Math.max(0, Math.min(100, normalizedLat * 100)),
  };
};

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
  return '#8b97c4';
};

export default function AdminTrackingPage() {
  const [trackingEmployees, setTrackingEmployees] = useState([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [alertsError, setAlertsError] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [movementTrail, setMovementTrail] = useState([]);
  const [trailLoading, setTrailLoading] = useState(false);
  const [trailError, setTrailError] = useState('');
  const [resolvedAddress, setResolvedAddress] = useState('');
  const [addressLoading, setAddressLoading] = useState(false);

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
        const [trackingResponse, alertsResponse] = await Promise.all([
          fetch('http://localhost:8000/api/tracking/employees'),
          fetch('http://localhost:8000/api/tracking/alerts/whatsapp'),
        ]);
        if (!trackingResponse.ok) {
          throw new Error('Failed to load tracking data');
        }
        const trackingData = await trackingResponse.json();
        let alertsData = null;
        if (alertsResponse.ok) {
          alertsData = await alertsResponse.json();
        }
        if (!cancelled) {
          const employees = Array.isArray(trackingData.employees) ? trackingData.employees : [];
          setTrackingEmployees(employees);
          if (alertsData && Array.isArray(alertsData.alerts)) {
            setAlerts(alertsData.alerts);
            setAlertsError('');
          }
          setTrackingError('');
        }
      } catch (error) {
        if (!cancelled) {
          setTrackingError('Unable to load tracking data');
        }
      } finally {
        if (!cancelled) {
          setTrackingLoading(false);
        }
      }
    };
    fetchTracking();
    intervalId = setInterval(fetchTracking, 3000);
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
          `http://localhost:8000/api/tracking/movement/${encodeURIComponent(selectedEmployeeId)}?limit=80`
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
    const intervalId = setInterval(fetchTrail, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selectedEmployeeId]);

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
          `http://localhost:8000/api/tracking/reverse-geocode?lat=${encodeURIComponent(selectedEmployee.lat)}&lng=${encodeURIComponent(
            selectedEmployee.lng
          )}`
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

  const allMapPoints = useMemo(() => {
    const trailPoints = movementTrail.filter(
      (row) => typeof row.lat === 'number' && !Number.isNaN(row.lat) && typeof row.lng === 'number' && !Number.isNaN(row.lng)
    );
    return [...employeesWithCoordinates, ...trailPoints];
  }, [employeesWithCoordinates, movementTrail]);

  const mapBounds = useMemo(() => {
    if (allMapPoints.length === 0) {
      return null;
    }
    let minLat = allMapPoints[0].lat;
    let maxLat = allMapPoints[0].lat;
    let minLng = allMapPoints[0].lng;
    let maxLng = allMapPoints[0].lng;
    allMapPoints.forEach((point) => {
      if (point.lat < minLat) {
        minLat = point.lat;
      }
      if (point.lat > maxLat) {
        maxLat = point.lat;
      }
      if (point.lng < minLng) {
        minLng = point.lng;
      }
      if (point.lng > maxLng) {
        maxLng = point.lng;
      }
    });
    return { minLat, maxLat, minLng, maxLng };
  }, [allMapPoints]);

  const mapMarkers = useMemo(() => {
    if (!mapBounds) {
      return [];
    }
    return employeesWithCoordinates.map((employee) => {
      const { x, y } = mapEmployeeToPoint(employee, mapBounds);
      return {
        id: employee.employeeId,
        employee,
        x,
        y,
        color: resolveMarkerColor(employee.status),
      };
    });
  }, [employeesWithCoordinates, mapBounds]);

  const trailPath = useMemo(() => {
    if (!mapBounds) {
      return [];
    }
    return movementTrail
      .filter(
        (row) => typeof row.lat === 'number' && !Number.isNaN(row.lat) && typeof row.lng === 'number' && !Number.isNaN(row.lng)
      )
      .map((row) => mapEmployeeToPoint(row, mapBounds));
  }, [mapBounds, movementTrail]);

  const latestTrailPoint = trailPath[trailPath.length - 1] || null;

  return (
    <section className="panel">
      <header className="panel-title-row">
        <div>
          <h2>Monitoring & Tracking</h2>
          <p>Real-time employee movement monitor with clickable details</p>
        </div>
      </header>
      <div className="attendance-audit-wrap">
        <div className="attendance-audit-head">
          <h4>Live Presence Monitor</h4>
          <div className="attendance-audit-filters">
            <p>Tracking refreshes every 3 seconds. Click a marker or row to inspect movement.</p>
          </div>
        </div>
        <div className="attendance-ops-grid">
          <div className="employee-ops-card" style={{ flex: 1, minHeight: 280 }}>
            <div className="employee-ops-header">
              <h5>Live Map View</h5>
              <span>
                {employeesWithCoordinates.length > 0
                  ? `${employeesWithCoordinates.length} devices with location`
                  : 'No coordinates yet'}
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 320,
                borderRadius: 10,
                background: 'radial-gradient(circle at 50% 50%, rgba(10,115,217,0.12), rgba(10,115,217,0.04))',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  backgroundImage:
                    'linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.12) 1px, transparent 1px)',
                  backgroundSize: '36px 36px',
                  opacity: 0.5,
                }}
              />
              {mapMarkers.length === 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    color: '#444',
                  }}
                >
                  Waiting for location updates from mobile app
                </div>
              ) : (
                <>
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  >
                    {trailPath.length > 1 ? (
                      <polyline
                        points={trailPath.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke="rgba(10,115,217,0.8)"
                        strokeWidth="0.7"
                      />
                    ) : null}
                  </svg>
                  {mapMarkers.map((marker) => (
                    <button
                      type="button"
                      key={marker.id}
                      onClick={() => setSelectedEmployeeId(marker.id)}
                      style={{
                        position: 'absolute',
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        border: marker.id === selectedEmployeeId ? '2px solid #ffffff' : 'none',
                        backgroundColor: marker.color,
                        transform: 'translate(-50%, -50%)',
                        left: `${marker.x}%`,
                        top: `${marker.y}%`,
                        boxShadow: '0 0 0 6px rgba(0,0,0,0.16)',
                        cursor: 'pointer',
                      }}
                      title={`${marker.employee.fullName} (${marker.employee.employeeId}) • ${marker.employee.status || 'UNKNOWN'}`}
                    />
                  ))}
                  {latestTrailPoint ? (
                    <div
                      style={{
                        position: 'absolute',
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        border: '3px solid rgba(10,115,217,0.8)',
                        backgroundColor: '#ffffff',
                        transform: 'translate(-50%, -50%)',
                        left: `${latestTrailPoint.x}%`,
                        top: `${latestTrailPoint.y}%`,
                        boxShadow: '0 0 0 10px rgba(10,115,217,0.2)',
                        pointerEvents: 'none',
                      }}
                    />
                  ) : null}
                </>
              )}
            </div>
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
              </div>
            </div>
          </div>
          <div className="employee-ops-card" style={{ flex: 1, minHeight: 280 }}>
            <div className="employee-ops-header">
              <h5>Selected Employee Details</h5>
              <span>{selectedEmployee ? selectedEmployee.employeeId : 'No selection'}</span>
            </div>
            <div className="employee-ops-list">
              {selectedEmployee ? (
                <>
                  <div className="employee-ops-row">
                    <div>
                      <p>{selectedEmployee.fullName}</p>
                      <span>{selectedEmployee.status || 'UNKNOWN'} • Last seen {selectedEmployee.lastSeen || '—'}</span>
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
                        <a
                          href={`https://www.google.com/maps?q=${selectedEmployee.lat},${selectedEmployee.lng}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Maps
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="employee-ops-row">
                    <div>
                      <p>Address</p>
                      <span>
                        {selectedEmployee.locationAddress || selectedEmployee.locationLabel || resolvedAddress || (addressLoading ? 'Resolving location...' : 'Address not available yet')}
                      </span>
                    </div>
                  </div>
                  <div className="employee-ops-row">
                    <div>
                      <p>Movement Trail</p>
                      <span>{trailLoading ? 'Loading trail...' : `${movementTrail.length} movement points`}</span>
                    </div>
                  </div>
                  {trailError ? <p className="form-error">{trailError}</p> : null}
                </>
              ) : (
                <div className="employee-ops-row">
                  <div>
                    <p>Select an employee</p>
                    <span>Click a map marker or table row to load full movement details.</span>
                  </div>
                </div>
              )}
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
                <th>Last Seen</th>
                <th>WiFi</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {trackingLoading ? (
                <tr>
                  <td colSpan={6}>Loading tracking data...</td>
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
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No tracking data available.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
