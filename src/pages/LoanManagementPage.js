export default function LoanManagementPage({
  appSettings,
  currentUser,
  startCreate,
  selectedRowId,
  loanSearchText,
  setLoanSearchText,
  loanStatusFilter,
  setLoanStatusFilter,
  loanStatusOptions,
  loanRequestFilteredRows,
  getLoanViewStatus,
  loanActionMessage,
  loanViewTab,
  openDetails,
  getApprovalBadgeClass,
}) {
  return (
    <div className="attendance-ops-card">
      <div className="attendance-ops-head">
        <h4>Loan System</h4>
        <span>Request list • Department approval • HR approval • Manager approval</span>
      </div>
      {loanViewTab === 'requests' ? (
        <div className="attendance-ops-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" onClick={startCreate}>
            + Add Loan
          </button>
        </div>
      ) : null}
      <div className="attendance-audit-filters">
        <label>
          <span>Status</span>
          <select
            className="filter-select"
            value={loanStatusFilter}
            onChange={(event) => setLoanStatusFilter(event.target.value)}
          >
            {loanStatusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Search</span>
          <input
            placeholder="Name, ID, type, department"
            value={loanSearchText}
            onChange={(event) => setLoanSearchText(event.target.value)}
          />
        </label>
      </div>
      <div className="attendance-stats-grid">
        <article className="attendance-stat">
          <strong>{loanRequestFilteredRows.length}</strong>
          <span>Total Requests</span>
        </article>
        <article className="attendance-stat">
          <strong>
            {loanRequestFilteredRows.filter((row) =>
              String(getLoanViewStatus(row, loanViewTab)).toLowerCase().includes('pending')
            ).length}
          </strong>
          <span>Pending Requests</span>
        </article>
        <article className="attendance-stat">
          <strong>{loanRequestFilteredRows.filter((row) => String(getLoanViewStatus(row)) === 'Approved').length}</strong>
          <span>Approved</span>
        </article>
        <article className="attendance-stat">
          <strong>{loanRequestFilteredRows.filter((row) => String(getLoanViewStatus(row)) === 'Rejected').length}</strong>
          <span>Rejected</span>
        </article>
      </div>
      {loanActionMessage ? <p className="field-title">{loanActionMessage}</p> : null}
      <div className="attendance-audit-wrap">
        <div className="attendance-audit-table">
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Employee</th>
                <th>Issued</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Department</th>
                <th>HR</th>
                <th>Manager</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loanRequestFilteredRows.length > 0 ? (
                loanRequestFilteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className={selectedRowId === row.id ? 'selected-row' : ''}
                    onClick={() => openDetails(row.id)}
                  >
                    <td>{row.id}</td>
                    <td>
                      {row.employee} ({row.employeeId})
                    </td>
                    <td>{row.issuedOn || '—'}</td>
                    <td>{row.type || '—'}</td>
                    <td>
                      {appSettings.defaultCurrency} {row.amount || '—'}
                    </td>
                    <td>
                      <span className={`approval-stage-badge ${getApprovalBadgeClass(row.departmentApproval)}`}>
                        {row.departmentApproval}
                      </span>
                    </td>
                    <td>
                      <span className={`approval-stage-badge ${getApprovalBadgeClass(row.hrApproval)}`}>
                        {row.hrApproval}
                      </span>
                    </td>
                    <td>
                      <span className={`approval-stage-badge ${getApprovalBadgeClass(row.managerApproval)}`}>
                        {row.managerApproval}
                      </span>
                    </td>
                    <td>
                      <span className={`approval-stage-badge ${getApprovalBadgeClass(getLoanViewStatus(row))}`}>
                        {getLoanViewStatus(row)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9}>No loan requests for the selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
