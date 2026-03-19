import React from 'react';

export default function PayrollPage({
  appSettings,
  payrollUploadInputRef,
  handlePayrollBulkUpload,
  handleDownloadPayrollTemplate,
  handleOpenPayrollUpload,
  payrollLoansForModal,
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
        <button type="button" className="neutral-btn" onClick={handleDownloadPayrollTemplate}>
          Download Template
        </button>
        <button type="button" className="neutral-btn" onClick={handleOpenPayrollUpload}>
          Bulk Upload
        </button>
      </div>
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
