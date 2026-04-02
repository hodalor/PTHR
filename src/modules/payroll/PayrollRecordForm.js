import { buildPayrollFormValuesFromEmployee } from './payrollUtils';

const computedFieldKeys = [
  'grossPay',
  'napsaDeduction',
  'nhimaDeduction',
  'taxDeduction',
  'totalAttendancePenalty',
  'totalDeductions',
  'netPayable',
];

export default function PayrollRecordForm({
  formValues,
  setFormValues,
  payrollFormEmployeeMatches,
  selectedPayrollFormEmployee,
  payrollPreviewValues,
  payrollDetailSections,
  payrollFormFieldMap,
  payrollFormLoans,
  renderFormFieldControl,
}) {
  return (
    <>
      <div className="form-grid">
        <label>
          <span>Employee Search *</span>
          <input
            value={formValues.payrollEmployeeSearch || ''}
            placeholder="Search by name or ID"
            onChange={(event) =>
              setFormValues((prev) => ({
                ...prev,
                payrollEmployeeSearch: event.target.value,
                employee: '',
                employeeId: '',
              }))
            }
          />
        </label>
        {selectedPayrollFormEmployee ? (
          <div className="detail-cell">
            <span>Selected Employee</span>
            <strong>
              {selectedPayrollFormEmployee.fullName} ({selectedPayrollFormEmployee.id})
            </strong>
            <span>
              {selectedPayrollFormEmployee.department || 'Unassigned'} • {selectedPayrollFormEmployee.employmentState || 'Active'}
            </span>
          </div>
        ) : null}
        {payrollFormEmployeeMatches.length > 0 ? (
          <div className="row-actions">
            {payrollFormEmployeeMatches.map((employee) => (
              <button
                key={employee.id}
                type="button"
                className="mini-btn"
                onClick={() => setFormValues((prev) => buildPayrollFormValuesFromEmployee(employee, prev))}
              >
                {employee.fullName} ({employee.id})
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="form-section-grid">
        {payrollDetailSections
          .map((section) => ({
            id: section.id,
            title: section.title,
            fields: section.fields.map((key) => payrollFormFieldMap[key]).filter(Boolean),
          }))
          .filter((section) => section.fields.length > 0)
          .map((section) => (
            <div key={section.id} className="form-section">
              <p className="form-section-title">{section.title}</p>
              <div className="form-grid">
                {section.fields.map((field) => {
                  if (computedFieldKeys.includes(field.key)) {
                    return (
                      <label key={field.key}>
                        <span>{field.label || field.key}</span>
                        <input value={payrollPreviewValues[field.key] || ''} readOnly />
                      </label>
                    );
                  }
                  return renderFormFieldControl(field);
                })}
              </div>
            </div>
          ))}
        {payrollFormLoans.length > 0 ? (
          <div className="form-section">
            <p className="form-section-title">Employee Loans</p>
            <div className="form-grid">
              {payrollFormLoans.map((loanRow) => (
                <div key={loanRow.id} className="detail-cell">
                  <span>
                    {loanRow.type || 'Loan'} • {loanRow.issuedOn || '—'}
                  </span>
                  <strong>
                    {loanRow.amount || '—'} {loanRow.balance ? `• Balance: ${loanRow.balance}` : ''}
                  </strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

