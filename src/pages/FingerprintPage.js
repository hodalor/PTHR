import React from 'react';

export default function FingerprintPage({
  fingerprintConnectionState,
  fingerprintDraft,
  setFingerprintDraft,
  employeeBaseRows,
  handleEnrollFingerprint,
  handleQueueFingerprintSync,
  fingerprintRows,
  appSettings,
  selectedFingerprintEmployee,
}) {
  return (
    <div className="fingerprint-ops-card">
      <div className="attendance-ops-head">
        <h4>Fingerprint Enrollment Console</h4>
        <span>{fingerprintConnectionState}</span>
      </div>
      <div className="attendance-ops-form">
        <label>
          <span>Employee</span>
          <select
            className="filter-select"
            value={fingerprintDraft.employeeId}
            onChange={(event) =>
              setFingerprintDraft((prev) => ({
                ...prev,
                employeeId: event.target.value,
              }))
            }
          >
            <option value="">Select employee</option>
            {employeeBaseRows.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} ({employee.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Device User ID</span>
          <input
            placeholder="e.g. BIO-3042"
            value={fingerprintDraft.deviceUserId}
            onChange={(event) =>
              setFingerprintDraft((prev) => ({
                ...prev,
                deviceUserId: event.target.value,
              }))
            }
          />
        </label>
        <div className="attendance-ops-actions">
          <button type="button" className="primary-btn" onClick={handleEnrollFingerprint}>
            Enroll Employee
          </button>
          <button type="button" className="neutral-btn" onClick={handleQueueFingerprintSync}>
            Queue Device Sync
          </button>
        </div>
      </div>
      <div className="fingerprint-meta-grid">
        <article className="attendance-stat">
          <strong>{fingerprintRows.length}</strong>
          <span>Total Enrolled</span>
        </article>
        <article className="attendance-stat">
          <strong>{appSettings.fingerprintIntegration.mode}</strong>
          <span>Integration Mode</span>
        </article>
        <article className="attendance-stat">
          <strong>{appSettings.fingerprintIntegration.apiVersion}</strong>
          <span>API Version</span>
        </article>
      </div>
      <p className="fingerprint-hint">
        Current endpoint: {appSettings.fingerprintIntegration.gatewayUrl || 'Not set'} • Heartbeat every{' '}
        {appSettings.fingerprintIntegration.heartbeatSeconds}s
        {selectedFingerprintEmployee ? ` • Employee: ${selectedFingerprintEmployee.fullName}` : ''}
      </p>
    </div>
  );
}
