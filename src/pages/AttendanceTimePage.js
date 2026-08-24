import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterEmployeesBySearch } from '../utils/employeeSearch';
import { toApiUrl } from '../config/api';

const getAttendanceRowPhoto = (row) => {
  if (!Array.isArray(row?.clockings)) {
    return '';
  }
  const clockingWithPhoto = row.clockings.find((clocking) => String(clocking?.photoDataUrl || '').trim());
  return String(clockingWithPhoto?.photoDataUrl || '').trim();
};

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
  handleAssignEmployeeShift,
}) {
  const [trackingEmployees, setTrackingEmployees] = useState([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [isClockModalOpen, setIsClockModalOpen] = useState(false);
  const [isClockCameraOpen, setIsClockCameraOpen] = useState(false);
  const [clockCameraMode, setClockCameraMode] = useState('clock-in');
  const [clockCameraError, setClockCameraError] = useState('');
  const [attendancePhotoModal, setAttendancePhotoModal] = useState({ open: false, src: '', title: '' });
  const [attendancePhotoZoom, setAttendancePhotoZoom] = useState(1);
  const [clockActionLoading, setClockActionLoading] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [complianceSort, setComplianceSort] = useState({ key: 'employee', direction: 'asc' });
  const [penaltySort, setPenaltySort] = useState({ key: 'date', direction: 'desc' });
  const [performanceSort, setPerformanceSort] = useState({ key: 'attendanceScore', direction: 'desc' });
  const [shiftAssignmentSort, setShiftAssignmentSort] = useState({ key: 'fullName', direction: 'asc' });
  const [shiftAssignmentDepartmentFilter, setShiftAssignmentDepartmentFilter] = useState('All');
  const [shiftAssignmentShiftFilter, setShiftAssignmentShiftFilter] = useState('All');
  const [shiftAssignmentSearchText, setShiftAssignmentSearchText] = useState('');
  const [shiftAssignmentSavingId, setShiftAssignmentSavingId] = useState('');
  const shiftOptions = useMemo(
    () =>
      Array.isArray(appSettings.shifts) && appSettings.shifts.length > 0
        ? appSettings.shifts.map((shift) => String(shift?.name || '').trim()).filter(Boolean)
        : ['Default'],
    [appSettings.shifts]
  );
  const toggleSort = (setSort, key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };
  const compareValues = useCallback((left, right, direction) => {
    const leftValue = left ?? '';
    const rightValue = right ?? '';
    const leftNumber = Number(leftValue);
    const rightNumber = Number(rightValue);
    const bothNumbers = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
    const base = bothNumbers
      ? leftNumber - rightNumber
      : String(leftValue).localeCompare(String(rightValue));
    return direction === 'asc' ? base : -base;
  }, []);
  const sortArrow = (state, key) => {
    if (state.key !== key) {
      return '';
    }
    return state.direction === 'asc' ? ' ▲' : ' ▼';
  };
  const downloadAttendancePhoto = useCallback(() => {
    if (!attendancePhotoModal.src) {
      return;
    }
    const link = document.createElement('a');
    link.href = attendancePhotoModal.src;
    link.download = `${String(attendancePhotoModal.title || 'clock-photo')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'clock-photo'}.jpg`;
    link.click();
  }, [attendancePhotoModal.src, attendancePhotoModal.title]);
  const sortedComplianceRows = useMemo(() => {
    return [...attendanceComplianceFilteredRows].sort((a, b) => {
      if (complianceSort.key === 'lateFlag') {
        return compareValues(Number(Boolean(a.isLate)), Number(Boolean(b.isLate)), complianceSort.direction);
      }
      return compareValues(a?.[complianceSort.key], b?.[complianceSort.key], complianceSort.direction);
    });
  }, [attendanceComplianceFilteredRows, compareValues, complianceSort]);
  const sortedPenaltyRows = useMemo(() => {
    return [...attendancePenaltyFilteredRows].sort((a, b) => {
      if (penaltySort.key === 'status') {
        const leftStatus = a.outstandingAmount > 0 ? 'Outstanding' : 'Cleared';
        const rightStatus = b.outstandingAmount > 0 ? 'Outstanding' : 'Cleared';
        return compareValues(leftStatus, rightStatus, penaltySort.direction);
      }
      return compareValues(a?.[penaltySort.key], b?.[penaltySort.key], penaltySort.direction);
    });
  }, [attendancePenaltyFilteredRows, compareValues, penaltySort]);
  const sortedPerformanceRows = useMemo(() => {
    return [...attendancePerformanceRows].sort((a, b) =>
      compareValues(a?.[performanceSort.key], b?.[performanceSort.key], performanceSort.direction)
    );
  }, [attendancePerformanceRows, compareValues, performanceSort]);
  const shiftAssignmentDepartmentOptions = useMemo(() => {
    const departments = new Set(
      (employeeBaseRows || [])
        .map((row) => String(row.department || '').trim())
        .filter(Boolean)
    );
    return ['All', ...Array.from(departments).sort((a, b) => String(a).localeCompare(String(b)))];
  }, [employeeBaseRows]);
  const shiftAssignmentRows = useMemo(() => {
    const query = String(shiftAssignmentSearchText || '').trim().toLowerCase();
    return (employeeBaseRows || [])
      .filter((row) => {
        const department = String(row.department || '').trim() || 'Unassigned';
        const assignedShift = String(row.assignedShift || '').trim() || shiftOptions[0] || 'Default';
        const matchesDepartment = shiftAssignmentDepartmentFilter === 'All' || department === shiftAssignmentDepartmentFilter;
        const matchesShift = shiftAssignmentShiftFilter === 'All' || assignedShift === shiftAssignmentShiftFilter;
        const matchesSearch =
          !query ||
          String(row.fullName || '').toLowerCase().includes(query) ||
          String(row.id || '').toLowerCase().includes(query) ||
          department.toLowerCase().includes(query);
        return matchesDepartment && matchesShift && matchesSearch;
      })
      .sort((a, b) => compareValues(a?.[shiftAssignmentSort.key], b?.[shiftAssignmentSort.key], shiftAssignmentSort.direction));
  }, [
    compareValues,
    employeeBaseRows,
    shiftAssignmentDepartmentFilter,
    shiftAssignmentSearchText,
    shiftAssignmentShiftFilter,
    shiftAssignmentSort,
    shiftOptions,
  ]);

  const stopClockCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopClockCamera();
    };
  }, [stopClockCamera]);

  useEffect(() => {
    if (!isClockCameraOpen) {
      stopClockCamera();
      return undefined;
    }
    let cancelled = false;
    const startClockCamera = async () => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setClockCameraError('Camera access is not available in this browser. Use HTTPS or localhost and try again.');
        return;
      }
      setClockCameraError('');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (error) {
        setClockCameraError('Camera permission was denied or the camera is unavailable.');
      }
    };
    startClockCamera();
    return () => {
      cancelled = true;
      stopClockCamera();
    };
  }, [isClockCameraOpen, stopClockCamera]);

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
        const response = await fetch(toApiUrl('http://localhost:8000/api/tracking/employees'));
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

  const resetClockModalState = useCallback(() => {
    setAttendanceSearchText('');
    setIsClockCameraOpen(false);
    setClockCameraMode('clock-in');
    setClockCameraError('');
    stopClockCamera();
    setAttendanceClockDraft((prev) => ({
      ...prev,
      employeeId: '',
      shift: shiftOptions[0] || prev.shift || 'Default',
    }));
    setIsClockModalOpen(false);
  }, [setAttendanceClockDraft, setAttendanceSearchText, shiftOptions, stopClockCamera]);

  const handleClockInSubmit = useCallback(async () => {
    if (clockActionLoading) {
      return;
    }
    if (Boolean(appSettings.requireWebClockInPhoto)) {
      setClockCameraMode('clock-in');
      setClockCameraError('');
      setIsClockCameraOpen(true);
      return;
    }
    setClockActionLoading('clock-in');
    try {
      const success = await handleClockIn();
      if (success) {
        resetClockModalState();
      }
    } finally {
      setClockActionLoading('');
    }
  }, [appSettings.requireWebClockInPhoto, clockActionLoading, handleClockIn, resetClockModalState]);

  const handleCaptureClockPhoto = useCallback(async () => {
    if (clockActionLoading) {
      return;
    }
    if (!videoRef.current || !canvasRef.current) {
      setClockCameraError('Camera preview is not ready yet. Please wait a moment and try again.');
      return;
    }
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const width = video.videoWidth || 720;
    const height = video.videoHeight || 960;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      setClockCameraError('Unable to process the captured photo.');
      return;
    }
    context.drawImage(video, 0, 0, width, height);
    const photoDataUrl = canvas.toDataURL('image/jpeg', 0.72);
    setClockActionLoading(clockCameraMode);
    try {
      const success =
        clockCameraMode === 'clock-out'
          ? await handleClockOut(null, { photoDataUrl })
          : await handleClockIn({ photoDataUrl });
      if (success) {
        resetClockModalState();
      }
    } finally {
      setClockActionLoading('');
    }
  }, [clockActionLoading, clockCameraMode, handleClockIn, handleClockOut, resetClockModalState]);

  const handleClockOutSubmit = useCallback(async () => {
    if (clockActionLoading) {
      return;
    }
    if (Boolean(appSettings.requireWebClockInPhoto)) {
      setClockCameraMode('clock-out');
      setClockCameraError('');
      setIsClockCameraOpen(true);
      return;
    }
    setClockActionLoading('clock-out');
    try {
      const success = await handleClockOut();
      if (success) {
        resetClockModalState();
      }
    } finally {
      setClockActionLoading('');
    }
  }, [appSettings.requireWebClockInPhoto, clockActionLoading, handleClockOut, resetClockModalState]);

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
              onClick={() => {
                setAttendanceViewTab('compliance');
                setAttendanceAuditFilter('All');
                setAttendanceAuditSearchText('');
              }}
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
            <button
              type="button"
              className={`settings-tab-btn ${attendanceViewTab === 'shifts' ? 'active' : ''}`}
              onClick={() => setAttendanceViewTab('shifts')}
            >
              Shift Assignment
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
            <article className="attendance-stat">
              <strong>
                {toNumberValue(
                  attendanceTodayRows.reduce((total, row) => total + toNumberValue(row.deductionAmount), 0)
                ).toFixed(2)}
              </strong>
              <span>Total Deductions Today</span>
            </article>
          </div>
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Photo</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Status</th>
                  <th>Minutes Late</th>
                  <th>Late Deduction</th>
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
                      <td>
                        {getAttendanceRowPhoto(row) ? (
                          <button
                            type="button"
                            className="neutral-btn"
                            style={{ padding: 0, border: 'none', background: 'transparent' }}
                            onClick={() => {
                              setAttendancePhotoModal({
                                open: true,
                                src: getAttendanceRowPhoto(row),
                                title: `${row.employee} (${row.employeeId})`,
                              });
                              setAttendancePhotoZoom(1);
                            }}
                          >
                            <img
                              src={getAttendanceRowPhoto(row)}
                              alt={`${row.employee} attendance proof`}
                              style={{
                                width: 48,
                                height: 48,
                                objectFit: 'cover',
                                borderRadius: 10,
                                border: '1px solid rgba(15, 23, 42, 0.12)',
                              }}
                            />
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{row.checkIn || '—'}</td>
                      <td>{row.checkOut || '—'}</td>
                      <td>{row.status}</td>
                      <td>{row.lateMinutes || 0}</td>
                      <td>{toNumberValue(row.deductionAmount).toFixed(2)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8}>No attendance logs for today.</td>
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
                  <option value="All">All</option>
                  <option value="On Time">On Time</option>
                  <option value="Late">Late</option>
                  <option value="Pending Clock In">Pending Clock In</option>
                  <option value="No Clock In">No Clock In</option>
                  <option value="Left Early">Left Early</option>
                  <option value="Clocked In Once">Clocked In Once</option>
                  <option value="Absent">Absent</option>
                  <option value="On Leave">On Leave</option>
                  <option value="Off Duty">Off Duty</option>
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
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setComplianceSort, 'employee')}>
                      Employee{sortArrow(complianceSort, 'employee')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setComplianceSort, 'shift')}>
                      Shift{sortArrow(complianceSort, 'shift')}
                    </button>
                  </th>
                  <th>Photo</th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setComplianceSort, 'checkIn')}>
                      Clock In{sortArrow(complianceSort, 'checkIn')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setComplianceSort, 'checkOut')}>
                      Clock Out{sortArrow(complianceSort, 'checkOut')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setComplianceSort, 'dailyStatus')}>
                      Status{sortArrow(complianceSort, 'dailyStatus')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setComplianceSort, 'lateFlag')}>
                      Minutes Late{sortArrow(complianceSort, 'lateFlag')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedComplianceRows.length > 0 ? (
                  sortedComplianceRows.map((row) => (
                    <tr
                      key={`${row.employeeId}-${row.date}`}
                      className={selectedComplianceKey === `${row.employeeId}-${row.date}` ? 'selected-row' : ''}
                      onClick={() => {
                        const detailKey = `${row.employeeId}-${row.date}`;
                        setSelectedComplianceKey(detailKey);
                        setAttendanceDetailModal({ type: 'compliance', key: detailKey });
                      }}
                    >
                      <td>
                        {row.employee} ({row.employeeId})
                      </td>
                      <td>{row.shift}</td>
                      <td>
                        {getAttendanceRowPhoto(row) ? (
                          <button
                            type="button"
                            className="neutral-btn"
                            style={{ padding: 0, border: 'none', background: 'transparent' }}
                            onClick={() => {
                              setAttendancePhotoModal({
                                open: true,
                                src: getAttendanceRowPhoto(row),
                                title: `${row.employee} (${row.employeeId})`,
                              });
                              setAttendancePhotoZoom(1);
                            }}
                          >
                            <img
                              src={getAttendanceRowPhoto(row)}
                              alt={`${row.employee} compliance proof`}
                              style={{
                                width: 44,
                                height: 44,
                                objectFit: 'cover',
                                borderRadius: 10,
                                border: '1px solid rgba(15, 23, 42, 0.12)',
                              }}
                            />
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{row.checkIn || '—'}</td>
                      <td>{row.checkOut || '—'}</td>
                      <td>{row.dailyStatus}</td>
                      <td>{row.isLate ? '1' : '0'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <span>
                          {attendanceAuditFilter !== 'All' || attendanceAuditSearchText.trim()
                            ? 'No records match the current compliance filters.'
                            : 'No compliance records are available for the selected date.'}
                        </span>
                        {attendanceAuditFilter !== 'All' || attendanceAuditSearchText.trim() ? (
                          <button
                            type="button"
                            className="neutral-btn"
                            onClick={() => {
                              setAttendanceAuditFilter('All');
                              setAttendanceAuditSearchText('');
                            }}
                          >
                            Show All Records
                          </button>
                        ) : null}
                      </div>
                    </td>
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
                  <option value="All">All</option>
                  <option value="Outstanding">Outstanding</option>
                  <option value="Cleared">Cleared</option>
                </select>
              </label>
            </div>
          </div>
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setPenaltySort, 'employee')}>
                      Employee{sortArrow(penaltySort, 'employee')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setPenaltySort, 'date')}>
                      Date{sortArrow(penaltySort, 'date')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setPenaltySort, 'penaltyLabel')}>
                      Penalty{sortArrow(penaltySort, 'penaltyLabel')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setPenaltySort, 'outstandingAmount')}
                    >
                      Amount{sortArrow(penaltySort, 'outstandingAmount')}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="neutral-btn" onClick={() => toggleSort(setPenaltySort, 'status')}>
                      Status{sortArrow(penaltySort, 'status')}
                    </button>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedPenaltyRows.length > 0 ? (
                  sortedPenaltyRows.map((row) => (
                    <tr
                      key={row.key}
                      className={selectedPenaltyKey === row.key ? 'selected-row' : ''}
                      onClick={() => setSelectedPenaltyKey(row.key)}
                    >
                      <td>
                        {row.employee} ({row.employeeId})
                      </td>
                      <td>{row.date}</td>
                      <td>{row.penaltyLabel}</td>
                      <td>
                        {appSettings.defaultCurrency}{' '}
                        {toNumberValue(row.outstandingAmount).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td>{row.outstandingAmount > 0 ? 'Outstanding' : 'Cleared'}</td>
                      <td>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() => {
                            setSelectedPenaltyKey(row.key);
                            setAttendanceDetailModal({ type: 'penalties', key: row.key });
                          }}
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
                  <span>Penalty</span>
                  <input value={selectedPenaltyRow.penaltyLabel} readOnly />
                </label>
                <label>
                  <span>Outstanding Amount</span>
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
                    value={penaltyActionDraft.mode}
                    onChange={(event) =>
                      setPenaltyActionDraft((prev) => ({
                        ...prev,
                        mode: event.target.value === 'full' ? 'full' : 'partial',
                      }))
                    }
                  >
                    <option value="partial">Partial Clearance</option>
                    <option value="full">Full Clearance</option>
                  </select>
                </label>
                <label>
                  <span>Remark</span>
                  <textarea
                    rows={3}
                    value={penaltyActionDraft.remark}
                    onChange={(event) =>
                      setPenaltyActionDraft((prev) => ({
                        ...prev,
                        remark: event.target.value,
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
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
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
                  <option value="perfect-attendance">Perfect Attendance</option>
                  <option value="least-late">Least Late</option>
                  <option value="most-late">Most Late</option>
                  <option value="least-absent">Least Absent</option>
                  <option value="most-absent">Most Absent</option>
                  <option value="least-leave-applications">Least Leave Applications</option>
                  <option value="most-leave-applications">Most Leave Applications</option>
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
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setPerformanceSort, 'employee')}
                    >
                      Employee{sortArrow(performanceSort, 'employee')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setPerformanceSort, 'department')}
                    >
                      Department{sortArrow(performanceSort, 'department')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setPerformanceSort, 'onTimeCompleteDays')}
                    >
                      On Time{sortArrow(performanceSort, 'onTimeCompleteDays')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setPerformanceSort, 'lateDays')}
                    >
                      Late{sortArrow(performanceSort, 'lateDays')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setPerformanceSort, 'absentDays')}
                    >
                      Absent{sortArrow(performanceSort, 'absentDays')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setPerformanceSort, 'attendanceScore')}
                    >
                      Score{sortArrow(performanceSort, 'attendanceScore')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPerformanceRows.length > 0 ? (
                  sortedPerformanceRows.map((row, index) => (
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
                      <td>{row.onTimeCompleteDays}</td>
                      <td>{row.lateDays}</td>
                      <td>{row.absentDays}</td>
                      <td>{row.attendanceScore.toFixed(1)}%</td>
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
      {attendanceViewTab === 'shifts' ? (
        <div className="attendance-audit-wrap">
          <div className="attendance-audit-head">
            <h4>Shift Assignment</h4>
            <div className="attendance-audit-filters">
              <label>
                <span>Department</span>
                <select
                  className="filter-select"
                  value={shiftAssignmentDepartmentFilter}
                  onChange={(event) => setShiftAssignmentDepartmentFilter(event.target.value)}
                >
                  {shiftAssignmentDepartmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Shift</span>
                <select
                  className="filter-select"
                  value={shiftAssignmentShiftFilter}
                  onChange={(event) => setShiftAssignmentShiftFilter(event.target.value)}
                >
                  <option value="All">All</option>
                  {shiftOptions.map((shiftName) => (
                    <option key={shiftName} value={shiftName}>
                      {shiftName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Search</span>
                <input
                  placeholder="Name, ID or department"
                  value={shiftAssignmentSearchText}
                  onChange={(event) => setShiftAssignmentSearchText(event.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setShiftAssignmentSort, 'fullName')}
                    >
                      Employee{sortArrow(shiftAssignmentSort, 'fullName')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setShiftAssignmentSort, 'department')}
                    >
                      Department{sortArrow(shiftAssignmentSort, 'department')}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      className="neutral-btn"
                      onClick={() => toggleSort(setShiftAssignmentSort, 'assignedShift')}
                    >
                      Assigned Shift{sortArrow(shiftAssignmentSort, 'assignedShift')}
                    </button>
                  </th>
                  <th>Update</th>
                </tr>
              </thead>
              <tbody>
                {shiftAssignmentRows.length > 0 ? (
                  shiftAssignmentRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.fullName} ({row.id})
                      </td>
                      <td>{row.department || 'Unassigned'}</td>
                      <td>
                        <select
                          className="filter-select"
                          value={String(row.assignedShift || shiftOptions[0] || 'Default')}
                          disabled={shiftAssignmentSavingId === row.id}
                          onChange={async (event) => {
                            const nextShift = event.target.value;
                            if (nextShift === String(row.assignedShift || '')) {
                              return;
                            }
                            setShiftAssignmentSavingId(row.id);
                            try {
                              await handleAssignEmployeeShift(row.id, nextShift);
                            } finally {
                              setShiftAssignmentSavingId('');
                            }
                          }}
                        >
                          {shiftOptions.map((shiftName) => (
                            <option key={shiftName} value={shiftName}>
                              {shiftName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{shiftAssignmentSavingId === row.id ? 'Saving...' : 'Ready'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>No employees found for selected filters.</td>
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
                      const matchedEmployee = filterEmployeesBySearch(employeeBaseRows, query, 1)[0] || null;
                      setAttendanceSearchText(query);
                      if (matchedEmployee?.id) {
                        setAttendanceClockDraft((prev) => ({
                          ...prev,
                          employeeId: matchedEmployee.id,
                        }));
                      }
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
                                shift: String(employee.assignedShift || prev.shift || shiftOptions[0] || 'Default'),
                              }));
                              setAttendanceSearchText(`${employee.fullName} (${employee.id})`);
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
              {currentUser && currentUser.role !== 'employee' ? (
                <label>
                  <span>Selected Employee</span>
                  <input
                    readOnly
                    value={
                      selectedAttendanceEmployee
                        ? `${selectedAttendanceEmployee.fullName} (${selectedAttendanceEmployee.id})`
                        : ''
                    }
                    placeholder="Select an employee from search results"
                  />
                </label>
              ) : null}
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
                  {shiftOptions.map((shiftName) => (
                    <option key={shiftName} value={shiftName}>
                      {shiftName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Punch Time</span>
                <input value={getCurrentClockValue()} readOnly />
              </label>
              <div className="attendance-ops-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleClockInSubmit}
                  disabled={Boolean(clockActionLoading)}
                >
                  {clockActionLoading === 'clock-in' ? 'Clocking In...' : 'Clock In'}
                </button>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={handleClockOutSubmit}
                  disabled={Boolean(clockActionLoading)}
                >
                  {clockActionLoading === 'clock-out' ? 'Clocking Out...' : 'Clock Out'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {attendanceViewTab === 'clock' && isClockCameraOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsClockCameraOpen(false);
            setClockCameraMode('clock-in');
            setClockCameraError('');
          }}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{clockCameraMode === 'clock-out' ? 'Capture Clock-Out Selfie' : 'Capture Clock-In Selfie'}</h3>
              <button
                type="button"
                className="neutral-btn"
                onClick={() => {
                  setIsClockCameraOpen(false);
                  setClockCameraMode('clock-in');
                  setClockCameraError('');
                }}
              >
                Close
              </button>
            </div>
            <div className="attendance-ops-form">
              <p>
                {clockCameraMode === 'clock-out'
                  ? 'Take a clear selfie to complete this web clock-out.'
                  : 'Take a clear selfie to complete this web clock-in.'}
              </p>
              {clockCameraError ? <p className="form-error">{clockCameraError}</p> : null}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{
                  width: '100%',
                  maxHeight: '360px',
                  backgroundColor: '#111827',
                  borderRadius: '16px',
                  objectFit: 'cover',
                }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div className="attendance-ops-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={handleCaptureClockPhoto}
                  disabled={Boolean(clockActionLoading)}
                >
                  {clockActionLoading === 'clock-out'
                    ? 'Clocking Out...'
                    : clockActionLoading === 'clock-in'
                      ? 'Clocking In...'
                      : clockCameraMode === 'clock-out'
                        ? 'Take Selfie & Clock Out'
                        : 'Take Selfie & Clock In'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {attendancePhotoModal.open && attendancePhotoModal.src ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setAttendancePhotoModal({ open: false, src: '', title: '' });
            setAttendancePhotoZoom(1);
          }}
        >
          <div
            className="modal-card"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 'min(96vw, 1280px)', width: 'min(96vw, 1280px)' }}
          >
            <div className="modal-header">
              <h3>{attendancePhotoModal.title || 'Clock Photo'}</h3>
              <div className="employee-ops-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => setAttendancePhotoZoom((prev) => Math.max(0.5, Number((prev - 0.25).toFixed(2))))}
                >
                  Zoom Out
                </button>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => setAttendancePhotoZoom((prev) => Math.min(3, Number((prev + 0.25).toFixed(2))))}
                >
                  Zoom In
                </button>
                <button type="button" className="neutral-btn" onClick={() => setAttendancePhotoZoom(1)}>
                  Reset
                </button>
                <button type="button" className="neutral-btn" onClick={downloadAttendancePhoto}>
                  Download
                </button>
                <button
                  type="button"
                  className="neutral-btn"
                  onClick={() => {
                    setAttendancePhotoModal({ open: false, src: '', title: '' });
                    setAttendancePhotoZoom(1);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div
              className="attendance-ops-form"
              style={{
                overflow: 'auto',
                maxHeight: '82vh',
                background: '#020617',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <div
                style={{
                  width: `${Math.max(100, Math.round(attendancePhotoZoom * 100))}%`,
                  minWidth: '420px',
                  margin: '0 auto',
                }}
              >
                <img
                  src={attendancePhotoModal.src}
                  alt={attendancePhotoModal.title || 'Clock photo'}
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    borderRadius: 16,
                    background: '#0f172a',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
