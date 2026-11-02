export default function PayrollPage({
  startCreate,
  payrollUploadInputRef,
  handlePayrollBulkUpload,
  handleDownloadPayrollTemplate,
  handleOpenPayrollUpload,
  payrollLoansForModal,
  payrollGenerateMonth,
  setPayrollGenerateMonth,
  payrollGenerating,
  payrollGenerateMessage,
  handleGeneratePayroll,
}) {
  return (
    <>
      <div className="panel-title-actions">
        <input
          ref={payrollUploadInputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handlePayrollBulkUpload}
        />
        <button type="button" className="primary-btn" onClick={startCreate}>
          + Add Payroll
        </button>
        <label className="payroll-generate-month">
          <span>Month</span>
          <input
            type="month"
            value={payrollGenerateMonth || ''}
            onChange={(event) => setPayrollGenerateMonth?.(event.target.value)}
          />
        </label>
        <button type="button" className="primary-btn" onClick={handleGeneratePayroll} disabled={payrollGenerating}>
          {payrollGenerating ? 'Generating...' : 'Generate / Update'}
        </button>
        <button type="button" className="neutral-btn" onClick={handleDownloadPayrollTemplate}>
          Download Template
        </button>
        <button type="button" className="neutral-btn" onClick={handleOpenPayrollUpload}>
          Bulk Upload
        </button>
      </div>
      {payrollGenerateMessage ? <p className="settings-action-status">{payrollGenerateMessage}</p> : null}
      {payrollLoansForModal.length > 0 ? (
        <div className="employee-ops-card">
          <div className="employee-ops-header">
            <h5>Employee Loans</h5>
            <span>{`${payrollLoansForModal.length} loan(s)`}</span>
          </div>
          <div className="employee-ops-list">
            {payrollLoansForModal.map((loanRow) => (
              <div className="employee-ops-row" key={loanRow.id}>
                <div>
                  <p>{loanRow.type || 'Loan Record'}</p>
                  <span>
                    {loanRow.issuedOn || '—'} • {loanRow.amount || '—'}
                  </span>
                </div>
                <div className="employee-ops-actions">
                  <strong>{loanRow.status || 'Active'}</strong>
                  <span>{loanRow.balance ? `Balance: ${loanRow.balance}` : 'Balance: —'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
