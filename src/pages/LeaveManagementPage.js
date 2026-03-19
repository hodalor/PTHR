import React from 'react';

export default function LeaveManagementPage({
  appSettings,
  selectedRowId,
  leaveDepartmentFilter,
  setLeaveDepartmentFilter,
  leaveDepartmentOptions,
  leaveStatusFilter,
  setLeaveStatusFilter,
  leaveStatusOptions,
  leaveSortBy,
  setLeaveSortBy,
  leaveSearchText,
  setLeaveSearchText,
  leaveRequestFilteredRows,
  getLeaveViewStatus,
  leaveActionMessage,
  leaveViewTab,
  leaveRequestPageTab,
  setLeaveRequestPageTab,
  openDetails,
  getApprovalBadgeClass,
  leaveBalanceFilteredRows,
  leaveApprovalDrafts,
  setLeaveApprovalDrafts,
}) {
  return (
    <div className="attendance-ops-card">
      <div className="attendance-ops-head">
        <h4>Leave System</h4>
        <span>Request list • Department approval • HR approval • Manager approval</span>
      </div>
      <div className="attendance-audit-filters">
        <label>
          <span>Department</span>
          <select
            className="filter-select"
            value={leaveDepartmentFilter}
            onChange={(event) => setLeaveDepartmentFilter(event.target.value)}
          >
            {leaveDepartmentOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select
            className="filter-select"
            value={leaveStatusFilter}
            onChange={(event) => setLeaveStatusFilter(event.target.value)}
          >
            {leaveStatusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select className="filter-select" value={leaveSortBy} onChange={(event) => setLeaveSortBy(event.target.value)}>
            <option value="date-desc">Date (Newest)</option>
            <option value="date-asc">Date (Oldest)</option>
            <option value="employee-asc">Employee (A-Z)</option>
            <option value="employee-desc">Employee (Z-A)</option>
            <option value="days-desc">Days (High-Low)</option>
            <option value="days-asc">Days (Low-High)</option>
          </select>
        </label>
        <label>
          <span>Search</span>
          <input
            placeholder="Name, ID, type, department"
            value={leaveSearchText}
            onChange={(event) => setLeaveSearchText(event.target.value)}
          />
        </label>
      </div>
      <div className="attendance-stats-grid">
        <article className="attendance-stat">
          <strong>{leaveRequestFilteredRows.length}</strong>
          <span>Total Requests</span>
        </article>
        <article className="attendance-stat">
          <strong>
            {leaveRequestFilteredRows.filter((row) =>
              String(getLeaveViewStatus(row)).toLowerCase().includes('pending')
            ).length}
          </strong>
          <span>Pending Requests</span>
        </article>
        <article className="attendance-stat">
          <strong>{leaveRequestFilteredRows.filter((row) => String(getLeaveViewStatus(row)) === 'Approved').length}</strong>
          <span>Approved Requests</span>
        </article>
        <article className="attendance-stat">
          <strong>{leaveRequestFilteredRows.filter((row) => String(getLeaveViewStatus(row)) === 'Rejected').length}</strong>
          <span>Rejected Requests</span>
        </article>
      </div>
      {leaveActionMessage ? <p className="field-title">{leaveActionMessage}</p> : null}
      {leaveViewTab === 'requests' ? (
        <div className="settings-tab-strip leave-request-page-tabs">
          <button
            type="button"
            className={`settings-tab-btn ${leaveRequestPageTab === 'requests' ? 'active' : ''}`}
            onClick={() => setLeaveRequestPageTab('requests')}
          >
            Request List
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${leaveRequestPageTab === 'balances' ? 'active' : ''}`}
            onClick={() => setLeaveRequestPageTab('balances')}
          >
            Leave Balance
          </button>
        </div>
      ) : null}
      <div className="attendance-audit-wrap">
        {leaveViewTab !== 'requests' || leaveRequestPageTab === 'requests' ? (
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Employee</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th>Type</th>
                  <th>Department</th>
                  <th>HR</th>
                  <th>Manager</th>
                  <th>Approval Trail</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {leaveRequestFilteredRows.length > 0 ? (
                  leaveRequestFilteredRows.map((row) => {
                    return (
                      <tr
                        key={row.id}
                        className={selectedRowId === row.id ? 'selected-row' : ''}
                        onClick={() => openDetails(row.id)}
                      >
                        <td>{row.id}</td>
                        <td>
                          {row.employee} ({row.employeeId})
                        </td>
                        <td>
                          {row.startDate} → {row.endDate}
                        </td>
                        <td>{row.daysRequested}</td>
                        <td>{row.type}</td>
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
                          {[
                            row.departmentApprover
                              ? `Department: ${row.departmentApprover} (${row.departmentComment || 'No comment'})`
                              : '',
                            row.hrApprover ? `HR: ${row.hrApprover} (${row.hrComment || 'No comment'})` : '',
                            row.managerApprover
                              ? `Manager: ${row.managerApprover} (${row.managerComment || 'No comment'})`
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' | ') || 'No approvals yet'}
                        </td>
                        <td>
                          <span className={`approval-stage-badge ${getApprovalBadgeClass(getLeaveViewStatus(row))}`}>
                            {getLeaveViewStatus(row)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10}>No leave requests for the selected filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        {leaveViewTab === 'requests' && leaveRequestPageTab === 'balances' ? (
          <div className="attendance-audit-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Contract End</th>
                  <th>Opening Balance</th>
                  <th>Approved Days</th>
                  <th>Pending Days</th>
                  <th>Available Balance</th>
                  <th>Daily Basic Pay</th>
                  <th>Unused Leave Days</th>
                  <th>Leave Payout</th>
                  <th>Payout Status</th>
                </tr>
              </thead>
              <tbody>
                {leaveBalanceFilteredRows.length > 0 ? (
                  leaveBalanceFilteredRows.map((row) => (
                    <tr key={row.employeeId}>
                      <td>
                        {row.employee} ({row.employeeId})
                      </td>
                      <td>{row.department}</td>
                      <td>{row.contractEndDate}</td>
                      <td>{row.openingBalance.toFixed(1)}</td>
                      <td>{row.approvedDays.toFixed(1)}</td>
                      <td>{row.pendingDays.toFixed(1)}</td>
                      <td>{row.availableBalance.toFixed(1)}</td>
                      <td>
                        {appSettings.defaultCurrency} {row.dailyBasicPay.toFixed(2)}
                      </td>
                      <td>{row.unusedLeaveDays.toFixed(1)}</td>
                      <td>
                        {appSettings.defaultCurrency} {row.leavePayoutAmount.toFixed(2)}
                      </td>
                      <td>{row.payoutStatus}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11}>No leave balance rows for the selected filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
