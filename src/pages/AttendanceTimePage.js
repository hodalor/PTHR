import React, { useEffect, useState } from 'react';

export default function AttendanceTimePage({
  appSettings,
  attendanceViewTab,
  setAttendanceViewTab,
  attendanceSearchText,
  setAttendanceSearchText,
  attendanceSearchMatches,
  employeeBaseRows,
  attendanceClockDraft,
  setAttendanceClockDraft,
  selectedAttendanceEmployee,
  handleClockIn,
  handleClockOut,
  attendanceTodayRows,
  attendanceLateCount,
  downloadCsv,
  downloadPdf,
  todayIsoDate,
  getTodayIsoDate,
  attendanceAuditDate,
  setAttendanceAuditDate,
  attendanceAuditFilter,
  setAttendanceAuditFilter,
  attendanceAuditSearchText,
  setAttendanceAuditSearchText,
  attendanceComplianceFilteredRows,
  setAttendanceDetailModal,
  selectedComplianceKey,
  setSelectedComplianceKey,
  attendancePenaltyStatusFilter,
  setAttendancePenaltyStatusFilter,
  attendancePenaltyFilteredRows,
  selectedPenaltyKey,
  setSelectedPenaltyKey,
  selectedPenaltyRow,
  penaltyActionDraft,
  setPenaltyActionDraft,
  handlePenaltyActionSave,
  toNumberValue,
  attendancePerformancePeriod,
  setAttendancePerformancePeriod,
  attendancePerformanceStartDate,
  setAttendancePerformanceStartDate,
  attendancePerformanceEndDate,
  setAttendancePerformanceEndDate,
  attendancePerformanceRankMetric,
  setAttendancePerformanceRankMetric,
  attendancePerformanceDepartmentFilter,
  setAttendancePerformanceDepartmentFilter,
  attendancePerformanceDepartmentOptions,
  attendancePerformanceSearchText,
  setAttendancePerformanceSearchText,
  attendancePerformanceRange,
  attendancePerformanceRows,
  selectedPerformanceEmployeeId,
  setSelectedPerformanceEmployeeId,
  getCurrentClockValue,
  currentUser,
}) {
  const [trackingEmployees, setTrackingEmployees] = useState([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [isClockModalOpen, setIsClockModalOpen] = useState(false);

  useEffect(() => {
    if (attendanceViewTab !== 'tracking') {
      return undefined;
    }
    let cancelled = false;
    let intervalId;
    const fetchTracking = async () => {
      try {
        if (cancelled) {
          return;
        }
        setTrackingLoading(true);
        const response = await fetch('http://localhost:8000/api/tracking/employees');
        if (!response.ok) {
          throw new Error('Failed to load tracking data');
        }
        const data = await response.json();
        if (!cancelled) {
          setTrackingEmployees(Array.isArray(data.employees) ? data.employees : []);
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
  }, [attendanceViewTab]);

  return (
    <div className="attendance-ops-card">
      <div className="attendance-ops-head">
        <h4>Attendance</h4>
        <span>
          Report {appSettings.attendanceReportTime} • Grace until {appSettings.attendanceLateAfter}
        </span>
      </div>
      <div className="attendance-subtabs">
        <button
          type="button"
          className={`settings-tab-btn ${attendanceViewTab === 'clock' ? 'active' : ''}`}
          onClick={() => setAttendanceViewTab('clock')}
        >
          Clock
        </button>
        {currentUser && currentUser.role !== 'employee' ? (
          <>
            <button
              type="button"
              className={`settings-tab-btn ${attendanceViewTab === 'compliance' ? 'active' : ''}`}
              onClick={() => setAttendanceViewTab('compliance')}
            >
              Daily Compliance
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${attendanceViewTab === 'penalties' ? 'active' : ''}`}
              onClick={() => setAttendanceViewTab('penalties')}
            >
              Penalty Clearance
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${attendanceViewTab === 'performance' ? 'active' : ''}`}
              onClick={() => setAttendanceViewTab('performance')}
            >
              Performance
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${attendanceViewTab === 'tracking' ? 'active' : ''}`}
              onClick={() => setAttendanceViewTab('tracking')}
            >
              Live Tracking
            </button>
          </>
        ) : null}
      </div>
      {attendanceViewTab === 'clock' ? (
        <>
          <div className="attendance-ops-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="primary-btn" onClick={() => setIsClockModalOpen(true)}>
              Record Attendance
            </button>
          </div>
          <div className="attendance-stats-grid">
            <article className="attendance-stat">
              <strong>{attendanceTodayRows.length}</strong>
              <span>Today Logs</span>
            </article>
            <article className="attendance-stat">
              <strong>{attendanceLateCount}</strong>
              <span>Late Today</span>
            </article>
            <article className="attendance-stat">
              <strong>{Math.max(0, attendanceTodayRows.length - attendanceLateCount)}</strong>
              <span>On Time Today</span>
            </article>
            <article className="attendance-stat">
              <strong>
                {attendanceTodayRows
                  .filter((row) => row.status === 'Late')
                  .reduce((total, row) => total + (row.minutesLate || 0), 0)}
              </strong>
              <span>Total Minutes Late</span>
            </article>
          </div>
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Status</th>
                  <th>Minutes Late</th>
                </tr>
              </thead>
              <tbody>
                {attendanceTodayRows.length > 0 ? (
                  attendanceTodayRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.employee} ({row.employeeId})
                      </td>
                      <td>{row.shift}</td>
                      <td>{row.clockIn}</td>
                      <td>{row.clockOut || '—'}</td>
                      <td>{row.status}</td>
                      <td>{row.minutesLate || 0}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No attendance logs for today.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {attendanceViewTab === 'compliance' ? (
        <div className="attendance-audit-wrap">
          <div className="attendance-audit-head">
            <h4>Daily Compliance</h4>
            <div className="attendance-audit-filters">
              <label>
                <span>Audit Date</span>
                <input
                  type="date"
                  value={attendanceAuditDate}
                  max={todayIsoDate}
                  onChange={(event) => setAttendanceAuditDate(event.target.value || todayIsoDate)}
                />
              </label>
              <label>
                <span>Filter</span>
                <select
                  className="filter-select"
                  value={attendanceAuditFilter}
                  onChange={(event) => setAttendanceAuditFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  <option value="late">Late</option>
                  <option value="on-time">On time</option>
                  <option value="absent">Absent</option>
                </select>
              </label>
              <label>
                <span>Search</span>
                <input
                  placeholder="Name or ID"
                  value={attendanceAuditSearchText}
                  onChange={(event) => setAttendanceAuditSearchText(event.target.value)}
                />
              </label>
            </div>
            <div className="attendance-audit-actions">
              <button type="button" className="neutral-btn" onClick={() => downloadCsv('attendance-audit')}>
                Download CSV
              </button>
              <button type="button" className="neutral-btn" onClick={() => downloadPdf('attendance-audit')}>
                Download PDF
              </button>
            </div>
          </div>
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Status</th>
                  <th>Minutes Late</th>
                </tr>
              </thead>
              <tbody>
                {attendanceComplianceFilteredRows.length > 0 ? (
                  attendanceComplianceFilteredRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.employee} ({row.employeeId})
                      </td>
                      <td>{row.shift}</td>
                      <td>{row.clockIn}</td>
                      <td>{row.clockOut || '—'}</td>
                      <td>{row.status}</td>
                      <td>{row.minutesLate || 0}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No records for the selected filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {attendanceViewTab === 'penalties' ? (
        <div className="attendance-audit-wrap">
          <div className="attendance-audit-head">
            <h4>Penalty Clearance</h4>
            <div className="attendance-audit-filters">
              <label>
                <span>Status</span>
                <select
                  className="filter-select"
                  value={attendancePenaltyStatusFilter}
                  onChange={(event) => setAttendancePenaltyStatusFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="cleared">Cleared</option>
                </select>
              </label>
            </div>
          </div>
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Date</th>
                  <th>Minutes Late</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {attendancePenaltyFilteredRows.length > 0 ? (
                  attendancePenaltyFilteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className={selectedPenaltyKey === row.id ? 'selected-row' : ''}
                      onClick={() => setSelectedPenaltyKey(row.id)}
                    >
                      <td>
                        {row.employee} ({row.employeeId})
                      </td>
                      <td>{row.date}</td>
                      <td>{row.minutesLate}</td>
                      <td>
                        {appSettings.defaultCurrency}{' '}
                        {toNumberValue(row.amount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td>{row.status}</td>
                      <td>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() => setSelectedPenaltyKey(row.id)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No penalties for the selected filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {selectedPenaltyRow ? (
            <div className="attendance-ops-card">
              <div className="attendance-ops-head">
                <h4>Penalty Details</h4>
                <span>
                  {selectedPenaltyRow.employee} ({selectedPenaltyRow.employeeId})
                </span>
              </div>
              <div className="attendance-ops-form">
                <label>
                  <span>Minutes Late</span>
                  <input value={selectedPenaltyRow.minutesLate} readOnly />
                </label>
                <label>
                  <span>Penalty Amount</span>
                  <input
                    value={toNumberValue(penaltyActionDraft.amount)}
                    onChange={(event) =>
                      setPenaltyActionDraft((prev) => ({
                        ...prev,
                        amount: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Action</span>
                  <select
                    className="filter-select"
                    value={penaltyActionDraft.action}
                    onChange={(event) =>
                      setPenaltyActionDraft((prev) => ({
                        ...prev,
                        action: event.target.value,
                      }))
                    }
                  >
                    <option value="deduct">Deduct from salary</option>
                    <option value="waive">Waive penalty</option>
                  </select>
                </label>
                <label>
                  <span>Comment</span>
                  <textarea
                    rows={3}
                    value={penaltyActionDraft.comment}
                    onChange={(event) =>
                      setPenaltyActionDraft((prev) => ({
                        ...prev,
                        comment: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="attendance-ops-actions">
                  <button type="button" className="primary-btn" onClick={handlePenaltyActionSave}>
                    Save Action
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {attendanceViewTab === 'performance' ? (
        <div className="attendance-audit-wrap">
          <div className="attendance-audit-head">
            <h4>Attendance Performance</h4>
            <div className="attendance-audit-filters">
              <label>
                <span>Period</span>
                <select
                  className="filter-select"
                  value={attendancePerformancePeriod}
                  onChange={(event) => setAttendancePerformancePeriod(event.target.value)}
                >
                  <option value="month">This Month</option>
                  <option value="quarter">This Quarter</option>
                  <option value="year">This Year</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {attendancePerformancePeriod === 'custom' ? (
                <>
                  <label>
                    <span>Start Date</span>
                    <input
                      type="date"
                      value={attendancePerformanceStartDate}
                      max={attendancePerformanceEndDate || todayIsoDate}
                      onChange={(event) => setAttendancePerformanceStartDate(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>End Date</span>
                    <input
                      type="date"
                      value={attendancePerformanceEndDate}
                      max={todayIsoDate}
                      onChange={(event) => setAttendancePerformanceEndDate(event.target.value)}
                    />
                  </label>
                </>
              ) : null}
              <label>
                <span>Rank By</span>
                <select
                  className="filter-select"
                  value={attendancePerformanceRankMetric}
                  onChange={(event) => setAttendancePerformanceRankMetric(event.target.value)}
                >
                  <option value="on-time">On time days</option>
                  <option value="late">Late days</option>
                  <option value="absent">Absent days</option>
                </select>
              </label>
              <label>
                <span>Department</span>
                <select
                  className="filter-select"
                  value={attendancePerformanceDepartmentFilter}
                  onChange={(event) => setAttendancePerformanceDepartmentFilter(event.target.value)}
                >
                  {attendancePerformanceDepartmentOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Search</span>
                <input
                  placeholder="Name or ID"
                  value={attendancePerformanceSearchText}
                  onChange={(event) => setAttendancePerformanceSearchText(event.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="attendance-stats-grid">
            <article className="attendance-stat">
              <strong>
                {attendancePerformanceRange.startDate} → {attendancePerformanceRange.endDate}
              </strong>
              <span>Period Range</span>
            </article>
            <article className="attendance-stat">
              <strong>{attendancePerformanceRows.length}</strong>
              <span>Employees</span>
            </article>
          </div>
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>On Time</th>
                  <th>Late</th>
                  <th>Absent</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {attendancePerformanceRows.length > 0 ? (
                  attendancePerformanceRows.map((row, index) => (
                    <tr
                      key={row.employeeId}
                      className={selectedPerformanceEmployeeId === row.employeeId ? 'selected-row' : ''}
                      onClick={() => setSelectedPerformanceEmployeeId(row.employeeId)}
                    >
                      <td>{index + 1}</td>
                      <td>
                        {row.employee} ({row.employeeId})
                      </td>
                      <td>{row.department}</td>
                      <td>{row.onTimeDays}</td>
                      <td>{row.lateDays}</td>
                      <td>{row.absentDays}</td>
                      <td>{row.score}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>No performance records for the selected filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {attendanceViewTab === 'tracking' ? (
        <div className="attendance-audit-wrap">
          <div className="attendance-audit-head">
            <h4>Live Presence Monitor</h4>
            <div className="attendance-audit-filters">
              <p>
                Status values: INSIDE, OUTSIDE, OFFLINE. Distance uses office GPS settings and Haversine distance.
              </p>
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
                        {employee.offline ? (employee.outsidePremises ? ' • OFFLINE' : 'OFFLINE') : ''}
                        {!employee.wifiValid ? (employee.outsidePremises || employee.offline ? ' • ' : '') + 'WiFi Mismatch' : ''}
                        {employee.gpsSpoofSuspected
                          ? (employee.outsidePremises || employee.offline || !employee.wifiValid ? ' • ' : '') +
                            'GPS Suspicious'
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
      ) : null}
      {attendanceViewTab === 'clock' && isClockModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsClockModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Clock In / Out</h3>
              <button type="button" className="neutral-btn" onClick={() => setIsClockModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="attendance-ops-form">
              {currentUser && currentUser.role === 'employee' ? (
                <label>
                  <span>Employee</span>
                  <input
                    readOnly
                    value={
                      selectedAttendanceEmployee
                        ? `${selectedAttendanceEmployee.fullName} (${selectedAttendanceEmployee.id})`
                        : `${currentUser.fullName || ''}${
                            currentUser.employeeId ? ` (${currentUser.employeeId})` : ''
                          }`
                    }
                  />
                </label>
              ) : (
                <label>
                  <span>Search Employee (Name or ID)</span>
                  <input
                    placeholder="Type employee name or ID"
                    value={attendanceSearchText}
                    onChange={(event) => {
                      const query = event.target.value;
                      const normalizedQuery = query.trim().toLowerCase();
                      const matchedEmployee = normalizedQuery
                        ? employeeBaseRows.find((employee) => {
                            const employeeId = String(employee.id || '').toLowerCase();
                            const employeeName = String(employee.fullName || '').toLowerCase();
                            return employeeId.includes(normalizedQuery) || employeeName.includes(normalizedQuery);
                          }) || null
                        : null;
                      setAttendanceSearchText(query);
                      setAttendanceClockDraft((prev) => ({
                        ...prev,
                        employeeId: matchedEmployee?.id || '',
                      }));
                    }}
                  />
                  {attendanceSearchText.trim() ? (
                    <div className="attendance-search-dropdown">
                      {attendanceSearchMatches.length > 0 ? (
                        attendanceSearchMatches.map((employee) => (
                          <button
                            key={employee.id}
                            type="button"
                            className="attendance-search-item"
                            onClick={() => {
                              setAttendanceClockDraft((prev) => ({
                                ...prev,
                                employeeId: employee.id,
                              }));
                              setAttendanceSearchText('');
                            }}
                          >
                            {employee.fullName} ({employee.id})
                          </button>
                        ))
                      ) : (
                        <span className="attendance-search-empty">No matching employee</span>
                      )}
                    </div>
                  ) : null}
                </label>
              )}
              <label>
                <span>Shift</span>
                <select
                  className="filter-select"
                  value={attendanceClockDraft.shift}
                  onChange={(event) =>
                    setAttendanceClockDraft((prev) => ({
                      ...prev,
                      shift: event.target.value,
                    }))
                  }
                >
                  <option value="Morning">Morning</option>
                  <option value="Evening">Evening</option>
                  <option value="Night">Night</option>
                  <option value="Remote">Remote</option>
                </select>
              </label>
              <label>
                <span>Punch Time</span>
                <input value={getCurrentClockValue()} readOnly />
              </label>
              <div className="attendance-ops-actions">
                <button type="button" className="primary-btn" onClick={handleClockIn}>
                  Clock In
                </button>
                <button type="button" className="neutral-btn" onClick={handleClockOut}>
                  Clock Out
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
