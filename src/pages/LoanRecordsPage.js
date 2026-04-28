import React from 'react';

export default function LoanRecordsPage({
  formValues,
  setFormValues,
  visibleFormFields,
  loanInstallmentPreview,
  renderFormFieldControl,
  loanFormEmployeeMatches,
  selectedLoanFormEmployee,
}) {
  const getFieldByKey = (key) => visibleFormFields.find((field) => field.key === key);

  const leftFieldKeys = ['employee', 'employeeId', 'type', 'amount', 'interestPercent'];
  const rightFieldKeys = ['tenorMonths', 'monthlyInstallment', 'issuedOn', 'balance', 'status'];

  const leftFields = leftFieldKeys.map(getFieldByKey).filter(Boolean);
  const rightFields = rightFieldKeys.map(getFieldByKey).filter(Boolean);

  return (
    <div className="form-section-grid">
      <div className="form-section">
        <p className="form-section-title">Loan Record Details</p>
        <div className="form-grid">
          <label>
            <span>Employee Search *</span>
            <input
              value={formValues.loanEmployeeSearch || ''}
              placeholder="Search by name or ID"
              onChange={(event) =>
                setFormValues((prev) => ({
                  ...prev,
                  loanEmployeeSearch: event.target.value,
                  employee: '',
                  employeeId: '',
                }))
              }
            />
          </label>
          {selectedLoanFormEmployee ? (
            <div className="detail-cell">
              <span>Selected Employee</span>
              <strong>
                {selectedLoanFormEmployee.fullName} ({selectedLoanFormEmployee.id})
              </strong>
              <span>{selectedLoanFormEmployee.department || 'Unassigned'}</span>
            </div>
          ) : null}
          {loanFormEmployeeMatches.length > 0 ? (
            <div className="row-actions">
              {loanFormEmployeeMatches.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  className="mini-btn"
                  onClick={() =>
                    setFormValues((prev) => ({
                      ...prev,
                      loanEmployeeSearch: `${employee.fullName} (${employee.id})`,
                      employee: employee.fullName,
                      employeeId: employee.id,
                    }))
                  }
                >
                  {employee.fullName} ({employee.id})
                </button>
              ))}
            </div>
          ) : null}
          {leftFields.map((field) => renderFormFieldControl(field))}
        </div>
      </div>
      <div className="form-section">
        <p className="form-section-title">More Details</p>
        <div className="form-grid">
          {rightFields.map((field) => renderFormFieldControl(field))}
        </div>
      </div>
      {loanInstallmentPreview ? (
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
      ) : null}
    </div>
  );
}
