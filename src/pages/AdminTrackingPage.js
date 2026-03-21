import React, { useEffect, useMemo, useState } from 'react';

export default function AdminTrackingPage() {
  const [trackingEmployees, setTrackingEmployees] = useState([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [alertsError, setAlertsError] = useState('');

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

  const mapBounds = useMemo(() => {
    if (!employeesWithCoordinates.length) {
      return null;
    }
    let minLat = employeesWithCoordinates[0].lat;
    let maxLat = employeesWithCoordinates[0].lat;
    let minLng = employeesWithCoordinates[0].lng;
    let maxLng = employeesWithCoordinates[0].lng;
    employeesWithCoordinates.forEach((employee) => {
      if (employee.lat < minLat) {
        minLat = employee.lat;
      }
      if (employee.lat > maxLat) {
        maxLat = employee.lat;
      }
      if (employee.lng < minLng) {
        minLng = employee.lng;
      }
      if (employee.lng > maxLng) {
        maxLng = employee.lng;
      }
    });
    return {
      minLat,
      maxLat,
      minLng,
      maxLng,
    };
  }, [employeesWithCoordinates]);

  const mapMarkers = useMemo(() => {
    if (!mapBounds) {
      return [];
    }
    const latRange = mapBounds.maxLat - mapBounds.minLat || 1;
    const lngRange = mapBounds.maxLng - mapBounds.minLng || 1;
    return employeesWithCoordinates.map((employee) => {
      const normalizedLat = (mapBounds.maxLat - employee.lat) / latRange;
      const normalizedLng = (employee.lng - mapBounds.minLng) / lngRange;
      const top = Math.max(0, Math.min(100, normalizedLat * 100));
      const left = Math.max(0, Math.min(100, normalizedLng * 100));
      let color = '#999999';
      if (employee.status === 'INSIDE') {
        color = '#0f9d58';
      } else if (employee.status === 'OUTSIDE') {
        color = '#db4437';
      } else if (employee.status === 'OFFLINE') {
        color = '#f4b400';
      }
      return {
        id: employee.employeeId,
        label: `${employee.fullName} (${employee.employeeId})`,
        status: employee.status,
        top,
        left,
        color,
      };
    });
  }, [employeesWithCoordinates, mapBounds]);

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
          setTrackingEmployees(
            Array.isArray(trackingData.employees) ? trackingData.employees : []
          );
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
    intervalId = setInterval(fetchTracking, 10000);

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  return (
    <section className="panel">
      <header className="panel-title-row">
        <div>
          <h2>Monitoring & Tracking</h2>
          <p>Live presence overview for all employees</p>
        </div>
      </header>
      <div className="attendance-audit-wrap">
        <div className="attendance-audit-head">
          <h4>Live Presence Monitor</h4>
          <div className="attendance-audit-filters">
            <p>Status values: INSIDE, OUTSIDE, OFFLINE. Distance uses office GPS settings.</p>
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
                height: 260,
                borderRadius: 8,
                background:
                  'radial-gradient(circle at 50% 50%, rgba(10,115,217,0.12), rgba(10,115,217,0.04))',
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
                mapMarkers.map((marker) => (
                  <div
                    key={marker.id}
                    style={{
                      position: 'absolute',
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      backgroundColor: marker.color,
                      transform: 'translate(-50%, -50%)',
                      left: `${marker.left}%`,
                      top: `${marker.top}%`,
                      boxShadow: '0 0 0 6px rgba(0,0,0,0.16)',
                      cursor: 'pointer',
                    }}
                    title={`${marker.label} - ${marker.status || 'UNKNOWN'}`}
                  />
                ))
              )}
            </div>
            <div className="employee-ops-list">
              <div className="employee-ops-row">
                <div>
                  <p>Legend</p>
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: '#0f9d58',
                        marginRight: 6,
                      }}
                    />
                    Inside
                  </span>
                </div>
                <div className="employee-ops-actions">
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: '#db4437',
                        marginRight: 6,
                      }}
                    />
                    Outside
                  </span>
                </div>
                <div className="employee-ops-actions">
                  <span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: '#f4b400',
                        marginRight: 6,
                      }}
                    />
                    Offline
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="employee-ops-card" style={{ flex: 1, minHeight: 280 }}>
            <div className="employee-ops-header">
              <h5>WhatsApp Alerts</h5>
              <span>
                {alerts.length > 0
                  ? `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`
                  : 'No alerts yet'}
              </span>
            </div>
            <div className="employee-ops-list">
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
                  .slice(0, 8)
                  .map((alert) => (
                    <div key={alert.id} className="employee-ops-row">
                      <div>
                        <p>
                          {alert.fullName && alert.employeeId
                            ? `${alert.fullName} (${alert.employeeId})`
                            : alert.employeeId || 'Unknown Employee'}
                        </p>
                        <span>
                          {alert.reason === 'outside-premises'
                            ? 'Outside premises geofence'
                            : alert.reason === 'offline-threshold'
                            ? 'Offline beyond threshold'
                            : alert.reason === 'manual'
                            ? 'Manual alert'
                            : alert.reason || 'Alert'}
                        </span>
                      </div>
                      <div className="employee-ops-actions">
                        <span>{alert.status || ''}</span>
                        <span style={{ fontSize: 11, color: '#627099' }}>
                          {alert.createdAt}
                        </span>
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
                  <tr key={employee.employeeId}>
                    <td>
                      {employee.fullName} ({employee.employeeId})
                    </td>
                    <td>{employee.status || 'OFFLINE'}</td>
                    <td>
                      {typeof employee.distanceMeters === 'number'
                        ? Math.round(employee.distanceMeters)
                        : '—'}
                    </td>
                    <td>{employee.lastSeen || '—'}</td>
                    <td>{employee.wifiSsid || '—'}</td>
                    <td>
                      {employee.outsidePremises ? 'OUTSIDE PREMISES' : ''}
                      {employee.offline
                        ? employee.outsidePremises
                          ? ' • OFFLINE'
                          : 'OFFLINE'
                        : ''}
                      {!employee.wifiValid
                        ? employee.outsidePremises || employee.offline
                          ? ' • WiFi Mismatch'
                          : 'WiFi Mismatch'
                        : ''}
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
