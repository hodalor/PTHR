import React, { useMemo } from 'react';

const DEFAULT_CURRENCY_CODE = 'GHS';

const formatCurrency = (value, currency = DEFAULT_CURRENCY_CODE) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '—';
  }
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: String(currency || DEFAULT_CURRENCY_CODE).toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch (error) {
    return `${currency || DEFAULT_CURRENCY_CODE} ${numeric.toFixed(2)}`;
  }
};

const formatNumber = (value, digits = 2) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '—';
  }
  return new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numeric);
};

const buildEarningsRows = (payrollRow) => {
  const rows = [];
  if (Number(payrollRow?.basicPay) > 0) {
    rows.push({ label: 'Basic Pay', value: Number(payrollRow.basicPay) || 0 });
  }
  if (Number(payrollRow?.overtimeEarnings) > 0) {
    rows.push({
      label: 'Overtime Pay',
      hours: Math.round((Number(payrollRow.overtimeMinutes) || 0) / 60),
      value: Number(payrollRow.overtimeEarnings) || 0,
    });
  }
  if (Number(payrollRow?.monthlyBonuses) > 0) {
    rows.push({ label: 'Bonus / Commission', value: Number(payrollRow.monthlyBonuses) || 0 });
  }
  if (Number(payrollRow?.transportAllowance) > 0) {
    rows.push({ label: 'Transport Allowance', value: Number(payrollRow.transportAllowance) || 0 });
  }
  if (Number(payrollRow?.housingAllowance) > 0) {
    rows.push({ label: 'Housing Allowance', value: Number(payrollRow.housingAllowance) || 0 });
  }
  if (Number(payrollRow?.foodAllowance) > 0) {
    rows.push({ label: 'Food Allowance', value: Number(payrollRow.foodAllowance) || 0 });
  }
  if (Number(payrollRow?.grossPay) > 0) {
    rows.push({ label: 'Gross Pay (pre-deductions)', value: Number(payrollRow.grossPay) || 0 });
  }
  if (rows.length === 0 && Number(payrollRow?.totalEarnings) > 0) {
    rows.push({ label: 'Total Earnings', value: Number(payrollRow.totalEarnings) || 0 });
  }
  return rows;
};

const buildDeductionsRows = (payrollRow) => {
  const rows = [];
  if (Number(payrollRow?.napsaDeduction) > 0) {
    rows.push({ label: 'NAPSA / Pension', value: Number(payrollRow.napsaDeduction) || 0 });
  }
  if (Number(payrollRow?.nhimaDeduction) > 0) {
    rows.push({ label: 'NHIMA / Health', value: Number(payrollRow.nhimaDeduction) || 0 });
  }
  if (Number(payrollRow?.taxDeduction) > 0) {
    rows.push({ label: 'PAYE / Income Tax', value: Number(payrollRow.taxDeduction) || 0 });
  }
  if (Number(payrollRow?.otherDeduction) > 0) {
    rows.push({ label: 'Other Deductions / Loans', value: Number(payrollRow.otherDeduction) || 0 });
  }
  if (Number(payrollRow?.totalAttendancePenalty) > 0) {
    rows.push({ label: 'Attendance Penalties', value: Number(payrollRow.totalAttendancePenalty) || 0 });
  }
  if (Number(payrollRow?.totalDeductions) > 0) {
    rows.push({ label: 'Total Deductions before rounding', value: Number(payrollRow.totalDeductions) || 0 });
  }
  return rows;
};

const computePayrollYtd = ({ payrollRow, allPayrollRows = [] }) => {
  const employeeKey = String(payrollRow?.employeeId || payrollRow?.employee || '').trim().toLowerCase();
  if (!employeeKey) {
    return {
      grossPay: Number(payrollRow?.totalEarnings || payrollRow?.grossPay || 0) || 0,
      totalDeductions: Number(payrollRow?.totalDeductions || 0) || 0,
      netPay: Number(payrollRow?.netPayable || 0) || 0,
    };
  }
  const currentMonth = String(payrollRow?.month || '').slice(0, 7);
  const totals = allPayrollRows.reduce(
    (acc, row) => {
      const rowKey = String(row?.employeeId || row?.employee || '').trim().toLowerCase();
      const rowMonth = String(row?.month || '').slice(0, 7);
      if (rowKey !== employeeKey) {
        return acc;
      }
      if (currentMonth && rowMonth && rowMonth > currentMonth) {
        return acc;
      }
      acc.grossPay += Number(row?.totalEarnings || row?.grossPay || 0) || 0;
      acc.totalDeductions += Number(row?.totalDeductions || 0) || 0;
      acc.netPay += Number(row?.netPayable || 0) || 0;
      return acc;
    },
    { grossPay: 0, totalDeductions: 0, netPay: 0 }
  );
  return totals;
};

export function PayslipDocument({ company, employee, payroll, payrollRow, allPayrollRows, currency }) {
  const currencyCode = String(currency || company?.defaultCurrency || DEFAULT_CURRENCY_CODE).toUpperCase();
  const primaryColor = String(company?.primaryColor || '#0f4ca3');
  const secondaryColor = String(company?.secondaryColor || '#21aa9c');
  const companyName = String(company?.companyName || 'PTHR');
  const logoUrl = String(company?.logoUrl || '').trim();
  const earningsRows = useMemo(() => buildEarningsRows(payrollRow), [payrollRow]);
  const deductionsRows = useMemo(() => buildDeductionsRows(payrollRow), [payrollRow]);
  const ytd = useMemo(
    () => computePayrollYtd({ payrollRow, allPayrollRows: Array.isArray(allPayrollRows) ? allPayrollRows : [] }),
    [payrollRow, allPayrollRows]
  );
  const grossPay = Number(payrollRow?.totalEarnings || payrollRow?.grossPay || 0) || 0;
  const totalDeductions = Number(payrollRow?.totalDeductions || 0) || 0;
  const netPay = Number(payrollRow?.netPayable || 0) || 0;
  return (
    <div className="payslip-document" style={{ background: '#fff' }}>
      <div className="payslip-letterhead" style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)` }}>
        <div>
          <div className="payslip-company-name">{companyName}</div>
          <div className="payslip-company-contact">
            {company?.companyAddress ? <span>{company.companyAddress}</span> : null}
            {company?.companyPhone || company?.companyEmail ? (
              <span>
                {company?.companyPhone ? <>Tel: {company.companyPhone}{company?.companyEmail ? ' • ' : null}</> : null}
                {company?.companyEmail ? <>Email: {company.companyEmail}</> : null}
              </span>
            ) : null}
            {company?.companyWebsite ? <span>{company.companyWebsite}</span> : null}
          </div>
        </div>
        <div className="payslip-title">
          <span>PAYSLIP</span>
        </div>
        {logoUrl ? (
          <div className="payslip-logo">
            <img src={logoUrl} alt={`${companyName} logo`} />
          </div>
        ) : null}
      </div>

      <div className="payslip-grid">
        <div className="payslip-panel payslip-employee-info">
          <div className="payslip-panel-title">EMPLOYEE INFORMATION</div>
          <div className="payslip-rows">
            <div>
              <span>Full Name</span>
              <strong>{employee?.fullName || payrollRow?.employee || '—'}</strong>
            </div>
            {employee?.address || employee?.location ? (
              <div>
                <span>Address</span>
                <strong>{employee.address || employee.location || '—'}</strong>
              </div>
            ) : null}
            {employee?.phone || payrollRow?.mobileMoneyNumber ? (
              <div>
                <span>Phone</span>
                <strong>{employee.phone || payrollRow.mobileMoneyNumber || '—'}</strong>
              </div>
            ) : null}
            {employee?.email ? (
              <div>
                <span>Email</span>
                <strong>{employee.email || '—'}</strong>
              </div>
            ) : null}
            <div>
              <span>Employee ID</span>
              <strong>{employee?.employeeId || payrollRow?.employeeId || '—'}</strong>
            </div>
            {employee?.department || employee?.position ? (
              <div>
                <span>Department / Role</span>
                <strong>
                  {employee?.department || '—'}
                  {employee?.position ? ` • ${employee.position}` : ''}
                </strong>
              </div>
            ) : null}
            {employee?.taxId || payrollRow?.taxId ? (
              <div>
                <span>Tax ID (PAYE)</span>
                <strong>{employee.taxId || payrollRow.taxId || '—'}</strong>
              </div>
            ) : null}
            {employee?.pensionId || payrollRow?.pensionId ? (
              <div>
                <span>Pension / NAPSA ID</span>
                <strong>{employee.pensionId || payrollRow.pensionId || '—'}</strong>
              </div>
            ) : null}
            {employee?.nhimaNumber || payrollRow?.nhimaNumber ? (
              <div>
                <span>NHIMA ID</span>
                <strong>{employee.nhimaNumber || payrollRow.nhimaNumber || '—'}</strong>
              </div>
            ) : null}
          </div>
        </div>

        <div className="payslip-panel payslip-pay-info">
          <div className="payslip-info-grid">
            <div>
              <span className="payslip-info-label">PAY DATE</span>
              <strong>{payroll?.payDate || payrollRow?.month || '—'}</strong>
            </div>
            <div>
              <span className="payslip-info-label">PAY TYPE</span>
              <strong>{payroll?.payType || 'Monthly'}</strong>
            </div>
            <div>
              <span className="payslip-info-label">PERIOD</span>
              <strong>{payroll?.period || payrollRow?.month || '—'}</strong>
            </div>
            <div>
              <span className="payslip-info-label">PAYROLL #</span>
              <strong>{payroll?.payrollId || payrollRow?.id || '—'}</strong>
            </div>
            <div>
              <span className="payslip-info-label">STATUS</span>
              <strong>{payroll?.status || payrollRow?.status || '—'}</strong>
            </div>
            <div>
              <span className="payslip-info-label">WORKING DAYS</span>
              <strong>{payroll?.workingDays || payrollRow?.workingDays || '—'}</strong>
            </div>
          </div>
          <div className="payslip-payment-method">
            <span>Payment Method:</span>
            <strong>{payroll?.paymentMethod || 'Bank Transfer'}</strong>
          </div>
        </div>
      </div>

      <div className="payslip-table-card">
        <table className="payslip-table">
          <thead>
            <tr>
              <th colSpan="3" className="payslip-table-header" style={{ background: primaryColor }}>
                EARNINGS
              </th>
              <th className="payslip-table-header" style={{ background: primaryColor }}>
                CURRENT
              </th>
              <th className="payslip-table-header payslip-table-header-alt" style={{ background: secondaryColor }}>
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            {earningsRows.map((row, index) => (
              <tr key={`earn-${index}`}>
                <td>{row.label}</td>
                <td className="payslip-num">{row.hours !== undefined && row.hours !== null ? formatNumber(row.hours, 0) : ''}</td>
                <td className="payslip-num">{row.rate ? formatCurrency(row.rate, currencyCode) : ''}</td>
                <td className="payslip-num payslip-strong">{formatCurrency(row.value, currencyCode)}</td>
                <td className="payslip-num payslip-alt">—</td>
              </tr>
            ))}
            <tr className="payslip-table-total">
              <td colSpan="3" className="payslip-total-label">
                GROSS PAY
              </td>
              <td className="payslip-num payslip-strong payslip-total-value">{formatCurrency(grossPay, currencyCode)}</td>
              <td className="payslip-num payslip-alt payslip-strong payslip-total-value">{formatCurrency(ytd.grossPay, currencyCode)}</td>
            </tr>
          </tbody>
        </table>

        <table className="payslip-table">
          <thead>
            <tr>
              <th className="payslip-table-header" colSpan="3" style={{ background: primaryColor }}>
                DEDUCTIONS
              </th>
              <th className="payslip-table-header" style={{ background: primaryColor }}>
                CURRENT
              </th>
              <th className="payslip-table-header payslip-table-header-alt" style={{ background: secondaryColor }}>
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            {deductionsRows.map((row, index) => (
              <tr key={`ded-${index}`}>
                <td colSpan="3">{row.label}</td>
                <td className="payslip-num payslip-strong">{formatCurrency(row.value, currencyCode)}</td>
                <td className="payslip-num payslip-alt">—</td>
              </tr>
            ))}
            <tr className="payslip-table-total">
              <td colSpan="3" className="payslip-total-label">
                TOTAL DEDUCTIONS
              </td>
              <td className="payslip-num payslip-strong payslip-total-value">{formatCurrency(totalDeductions, currencyCode)}</td>
              <td className="payslip-num payslip-alt payslip-strong payslip-total-value">{formatCurrency(ytd.totalDeductions, currencyCode)}</td>
            </tr>
          </tbody>
        </table>

        <div className="payslip-net-pay-section">
          <div />
          <div />
          <div className="payslip-net-pay-tile" style={{ borderTop: `4px solid ${primaryColor}` }}>
            <span>NET PAY</span>
            <strong>{formatCurrency(netPay, currencyCode)}</strong>
          </div>
          <div className="payslip-net-pay-tile payslip-net-pay-tile-alt" style={{ borderTop: `4px solid ${secondaryColor}` }}>
            <span>YTD NET PAY</span>
            <strong>{formatCurrency(ytd.netPay, currencyCode)}</strong>
          </div>
        </div>
      </div>

      <div className="payslip-footer">
        <p>
          If you have any questions about this payslip, please contact your HR / Payroll administrator.
        </p>
        <p>
          This document was generated by <strong>{companyName}</strong>.
        </p>
      </div>
    </div>
  );
}

export default PayslipDocument;
