import React from 'react';

export default function LoanRecordsPage({ loanInstallmentPreview }) {
  if (!loanInstallmentPreview) {
    return null;
  }

  return (
    <div className="employee-ops-card">
      <div className="employee-ops-header">
        <h5>Loan Installment Preview</h5>
        <span>
          {loanInstallmentPreview.employee} ({loanInstallmentPreview.employeeId})
        </span>
      </div>
      <div className="employee-ops-list">
        <div className="employee-ops-row">
          <div>
            <p>Total Amount</p>
            <span>{loanInstallmentPreview.totalAmount || '—'}</span>
          </div>
          <div className="employee-ops-actions">
            <strong>{loanInstallmentPreview.installmentCount || 0} installments</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
