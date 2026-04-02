export default function LoanApprovalPanel({
  selectedLoanDetailRow,
  loanViewTab,
  loanApprovalDrafts,
  setLoanApprovalDrafts,
  loanApprovalSavingId,
  appSettings,
  getApprovalBadgeClass,
  handleDepartmentLoanDecision,
  handleHrLoanDecision,
  handleManagerLoanDecision,
}) {
  if (!selectedLoanDetailRow) {
    return null;
  }
  return (
    <div className="penalty-action-card">
      <strong>Loan Approval Details</strong>
      <span>
        {selectedLoanDetailRow.type || 'Loan'} • {appSettings.defaultCurrency} {selectedLoanDetailRow.amount || '—'} • Issued{' '}
        {selectedLoanDetailRow.issuedOn || '—'}
      </span>
      <span>{selectedLoanDetailRow.purpose || selectedLoanDetailRow.reason || 'No purpose provided.'}</span>
      <div className="details-badges">
        <span className={`approval-stage-badge ${getApprovalBadgeClass(selectedLoanDetailRow.departmentApproval)}`}>
          Department: {selectedLoanDetailRow.departmentApproval}
        </span>
        <span className={`approval-stage-badge ${getApprovalBadgeClass(selectedLoanDetailRow.hrApproval)}`}>
          HR: {selectedLoanDetailRow.hrApproval}
        </span>
        <span className={`approval-stage-badge ${getApprovalBadgeClass(selectedLoanDetailRow.managerApproval)}`}>
          Manager: {selectedLoanDetailRow.managerApproval}
        </span>
      </div>
      <div className="details-grid-table">
        <div className="detail-cell">
          <span>Department Actor</span>
          <strong>{selectedLoanDetailRow.departmentApprover || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>Department Comment</span>
          <strong>{selectedLoanDetailRow.departmentComment || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>HR Actor</span>
          <strong>{selectedLoanDetailRow.hrApprover || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>HR Comment</span>
          <strong>{selectedLoanDetailRow.hrComment || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>Manager Actor</span>
          <strong>{selectedLoanDetailRow.managerApprover || '—'}</strong>
        </div>
        <div className="detail-cell">
          <span>Manager Comment</span>
          <strong>{selectedLoanDetailRow.managerComment || '—'}</strong>
        </div>
      </div>
      {loanViewTab !== 'requests' ? (
        <div className="attendance-ops-form">
          <label>
            <span>Actor</span>
            <input
              value={(loanApprovalDrafts[selectedLoanDetailRow.id] || {}).actorName || appSettings.penaltyActorUsername || ''}
              onChange={(event) =>
                setLoanApprovalDrafts((prev) => ({
                  ...prev,
                  [selectedLoanDetailRow.id]: {
                    ...(prev[selectedLoanDetailRow.id] || {}),
                    actorName: event.target.value,
                  },
                }))
              }
            />
          </label>
          <label>
            <span>Comment</span>
            <input
              value={(loanApprovalDrafts[selectedLoanDetailRow.id] || {}).comment || ''}
              onChange={(event) =>
                setLoanApprovalDrafts((prev) => ({
                  ...prev,
                  [selectedLoanDetailRow.id]: {
                    ...(prev[selectedLoanDetailRow.id] || {}),
                    comment: event.target.value,
                  },
                }))
              }
            />
          </label>
          <div className="row-actions">
            {loanViewTab === 'department' ? (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={
                    String(selectedLoanDetailRow.departmentApproval || '') !== 'Pending' ||
                    loanApprovalSavingId === selectedLoanDetailRow.id
                  }
                  onClick={() => handleDepartmentLoanDecision(selectedLoanDetailRow.id, 'Approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="mini-btn danger"
                  disabled={
                    String(selectedLoanDetailRow.departmentApproval || '') !== 'Pending' ||
                    loanApprovalSavingId === selectedLoanDetailRow.id
                  }
                  onClick={() => handleDepartmentLoanDecision(selectedLoanDetailRow.id, 'Rejected')}
                >
                  Reject
                </button>
              </>
            ) : null}
            {loanViewTab === 'hr' ? (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={
                    String(selectedLoanDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLoanDetailRow.hrApproval || '') !== 'Pending' ||
                    loanApprovalSavingId === selectedLoanDetailRow.id
                  }
                  onClick={() => handleHrLoanDecision(selectedLoanDetailRow.id, 'Approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="mini-btn danger"
                  disabled={
                    String(selectedLoanDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLoanDetailRow.hrApproval || '') !== 'Pending' ||
                    loanApprovalSavingId === selectedLoanDetailRow.id
                  }
                  onClick={() => handleHrLoanDecision(selectedLoanDetailRow.id, 'Rejected')}
                >
                  Reject
                </button>
              </>
            ) : null}
            {loanViewTab === 'manager' ? (
              <>
                <button
                  type="button"
                  className="mini-btn"
                  disabled={
                    String(selectedLoanDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLoanDetailRow.hrApproval || '') !== 'Approved' ||
                    String(selectedLoanDetailRow.managerApproval || '') !== 'Pending' ||
                    loanApprovalSavingId === selectedLoanDetailRow.id
                  }
                  onClick={() => handleManagerLoanDecision(selectedLoanDetailRow.id, 'Approved')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="mini-btn danger"
                  disabled={
                    String(selectedLoanDetailRow.departmentApproval || '') !== 'Approved' ||
                    String(selectedLoanDetailRow.hrApproval || '') !== 'Approved' ||
                    String(selectedLoanDetailRow.managerApproval || '') !== 'Pending' ||
                    loanApprovalSavingId === selectedLoanDetailRow.id
                  }
                  onClick={() => handleManagerLoanDecision(selectedLoanDetailRow.id, 'Rejected')}
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

