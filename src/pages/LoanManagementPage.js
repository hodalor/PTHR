export default function LoanManagementPage({
  appSettings,
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
  loanPage,
  setLoanPage,
  loanPageSize,
  setLoanPageSize,
  loanPageMeta,
  loanPageLoading,
  openDetails,
  getApprovalBadgeClass,
}) {
  const summary = loanPageMeta?.summary || {
    totalRequests: loanRequestFilteredRows.length,
    pendingCount: loanRequestFilteredRows.filter((row) =>
      String(getLoanViewStatus(row, loanViewTab)).toLowerCase().includes('pending')
    ).length,
    approvedCount: loanRequestFilteredRows.filter((row) => String(getLoanViewStatus(row)) === 'Approved').length,
    rejectedCount: loanRequestFilteredRows.filter((row) => String(getLoanViewStatus(row)) === 'Rejected').length,
  };
  const totalPages = Math.max(1, Number(loanPageMeta?.totalPages) || 1);
  const currentPage = Math.max(1, Number(loanPageMeta?.page) || loanPage || 1);
  return (
    <div className="attendance-ops-card">
      <div className="attendance-ops-head">
        <h4>Loan System</h4>
        <span>Request list • Department approval • HR approval • Manager approval</span>
      </div>
      {loanPageLoading && loanRequestFilteredRows.length > 0 ? (
        <div style={{ marginBottom: 10, color: '#607098', fontSize: 13 }}>
          Refreshing loan records...
        </div>
      ) : null}
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
          <strong>{summary.totalRequests}</strong>
          <span>Total Requests</span>
        </article>
        <article className="attendance-stat">
          <strong>{summary.pendingCount}</strong>
          <span>Pending Requests</span>
        </article>
        <article className="attendance-stat">
          <strong>{summary.approvedCount}</strong>
          <span>Approved</span>
        </article>
        <article className="attendance-stat">
          <strong>{summary.rejectedCount}</strong>
          <span>Rejected</span>
        </article>
      </div>
      {loanActionMessage ? <p className="field-title">{loanActionMessage}</p> : null}
      <div className="pagination-controls" style={{ marginBottom: 12 }}>
        <div className="pagination-actions">
          <select
            className="filter-select"
            value={loanPageSize}
            onChange={(event) => {
              setLoanPageSize(Number(event.target.value) || 25);
              setLoanPage(1);
            }}
          >
            {[10, 25, 50, 100, 250].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <button type="button" className="mini-btn" onClick={() => setLoanPage(1)} disabled={currentPage <= 1}>
            « First
          </button>
          <button
            type="button"
            className="mini-btn"
            onClick={() => setLoanPage((page) => Math.max(1, page - 1))}
            disabled={currentPage <= 1}
          >
            ‹ Prev
          </button>
          <div className="pagination-info">
            Page {currentPage} / {totalPages}
          </div>
          <button
            type="button"
            className="mini-btn"
            onClick={() => setLoanPage((page) => Math.min(totalPages, page + 1))}
            disabled={currentPage >= totalPages}
          >
            Next ›
          </button>
          <button
            type="button"
            className="mini-btn"
            onClick={() => setLoanPage(totalPages)}
            disabled={currentPage >= totalPages}
          >
            Last »
          </button>
        </div>
      </div>
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
                  <td colSpan={9}>{loanPageLoading ? 'Loading loan requests...' : 'No loan requests for the selected filters.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
