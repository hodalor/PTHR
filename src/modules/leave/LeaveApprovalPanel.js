export default function LeaveApprovalPanel({
  selectedLeaveDetailRow,
  leaveViewTab,
  leaveApprovalDrafts,
  setLeaveApprovalDrafts,
  leaveApprovalSavingId,
  appSettings,
  getApprovalBadgeClass,
  handleDepartmentLeaveDecision,
  handleHrLeaveDecision,
  handleManagerLeaveDecision,
}) {
  if (!selectedLeaveDetailRow) {
    return null;
  }
  return (
    <div className="penalty-action-card">
      <strong>Leave Approval Details</strong>
      <span>
        {selectedLeaveDetailRow.startDate} → {selectedLeaveDetailRow.endDate} • {selectedLeaveDetailRow.daysRequested} day(s) •{' '}
        {selectedLeaveDetailRow.type}
      </span>
      <span>{selectedLeaveDetailRow.reason || 'No reason provided.'}</span>
      <div className="details-badges">
        <span className={`approval-stage-badge ${getApprovalBadgeClass(selectedLeaveDetailRow.departmentApproval)}`}>
          Department: {selectedLeaveDetailRow.departmentApproval}
        </span>
        <span className={`approval-stage-badge ${getApprovalBadgeClass(selectedLeaveDetailRow.hrApproval)}`}>
          HR: {selectedLeaveDetailRow.hrApproval}
        </span>
        <span className={`approval-stage-badge ${getApprovalBadgeClass(selectedLeaveDetailRow.managerApproval)}`}>
          Manager: {selectedLeaveDetailRow.managerApproval}
        </span>
      </div>
      <div className="details-grid-table">
        <div className="detail-cell">
          <span>Department Actor</span>
          <strong>{selectedLeaveDetailRow.departmentApprover || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>Department Comment</span>
          <strong>{selectedLeaveDetailRow.departmentComment || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>HR Actor</span>
          <strong>{selectedLeaveDetailRow.hrApprover || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>HR Comment</span>
          <strong>{selectedLeaveDetailRow.hrComment || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>Manager Actor</span>
          <strong>{selectedLeaveDetailRow.managerApprover || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>Manager Comment</span>
          <strong>{selectedLeaveDetailRow.managerComment || '—'}</strong>
        </div>
      </div>
      {leaveViewTab !== 'requests' ? (
        <div className="attendance-ops-form">
          <label>
            <span>Actor</span>
            <input
              value={
                (leaveApprovalDrafts[selectedLeaveDetailRow.id] || {}).actorName || appSettings.penaltyActorUsername || ''
              }
              onChange={(event) =>
                setLeaveApprovalDrafts((prev) => ({
                  ...prev,
                  [selectedLeaveDetailRow.id]: {
                    ...(prev[selectedLeaveDetailRow.id] || {}),
                    actorName: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label>
            <span>Comment</span>
            <input
              value={(leaveApprovalDrafts[selectedLeaveDetailRow.id] || {}).comment || ''}
              onChange={(event) =>
                setLeaveApprovalDrafts((prev) => ({
                  ...prev,
                  [selectedLeaveDetailRow.id]: {
                    ...(prev[selectedLeaveDetailRow.id] || {}),
                    comment: event.target.value,
                  },
                }))
              }
            />
          </label>
          <div className="row-actions">
            {leaveViewTab === 'department' ? (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={
                    String(selectedLeaveDetailRow.departmentApproval || '') !== 'Pending' ||
                    leaveApprovalSavingId === selectedLeaveDetailRow.id
                  }
                  onClick={() => handleDepartmentLeaveDecision(selectedLeaveDetailRow.id, 'Approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="mini-btn danger"
                  disabled={
                    String(selectedLeaveDetailRow.departmentApproval || '') !== 'Pending' ||
                    leaveApprovalSavingId === selectedLeaveDetailRow.id
                  }
                  onClick={() => handleDepartmentLeaveDecision(selectedLeaveDetailRow.id, 'Rejected')}
                >
                  Reject
                </button>
              </>
            ) : null}
            {leaveViewTab === 'hr' ? (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={
                    String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLeaveDetailRow.hrApproval || '') !== 'Pending' ||
                    leaveApprovalSavingId === selectedLeaveDetailRow.id
                  }
                  onClick={() => handleHrLeaveDecision(selectedLeaveDetailRow.id, 'Approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="mini-btn danger"
                  disabled={
                    String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLeaveDetailRow.hrApproval || '') !== 'Pending'
                  }
                  onClick={() => handleHrLeaveDecision(selectedLeaveDetailRow.id, 'Rejected')}
                >
                  Reject
                </button>
              </>
            ) : null}
            {leaveViewTab === 'manager' ? (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={
                    String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLeaveDetailRow.hrApproval || '') !== 'Approved' ||
                    String(selectedLeaveDetailRow.managerApproval || '') !== 'Pending' ||
                    leaveApprovalSavingId === selectedLeaveDetailRow.id
                  }
                  onClick={() => handleManagerLeaveDecision(selectedLeaveDetailRow.id, 'Approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="mini-btn danger"
                  disabled={
                    String(selectedLeaveDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLeaveDetailRow.hrApproval || '') !== 'Approved' ||
                    String(selectedLeaveDetailRow.managerApproval || '') !== 'Pending'
                  }
                  onClick={() => handleManagerLeaveDecision(selectedLeaveDetailRow.id, 'Rejected')}
                >
                  Reject
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

