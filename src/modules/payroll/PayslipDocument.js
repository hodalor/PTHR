import React, { useMemo } from 'react';

const DEFAULT_CURRENCY_CODE = 'GHS';

const EARNING_LINES = [
  { key: 'basicPay', label: 'Basic Pay' },
  { key: 'monthlyBonuses', label: 'Bonus / Commission' },
  { key: 'transportAllowance', label: 'Transport Allowance' },
  { key: 'housingAllowance', label: 'Housing Allowance' },
  { key: 'foodAllowance', label: 'Food Allowance' },
  { key: 'overtimeEarnings', label: 'Overtime Pay' },
];

const DEDUCTION_LINES = [
  { key: 'napsaDeduction', label: 'Pension Scheme' },
  { key: 'nhimaDeduction', label: 'Health Insurance' },
  { key: 'taxDeduction', label: 'PAYE / Income Tax' },
  { key: 'otherDeduction', label: 'Other Deductions / Loans' },
  { key: 'lateDeduction', label: 'Late Deduction' },
  { key: 'noClockInPenalty', label: 'No Clock-In Penalty' },
  { key: 'noClockOutPenalty', label: 'No Clock-Out Penalty' },
  { key: 'absentPenalty', label: 'Absent Penalty' },
];

const money = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const roundMoney = (value) => Math.round((money(value) + Number.EPSILON) * 100) / 100;

export const formatCurrency = (value, currency = DEFAULT_CURRENCY_CODE) => {
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

export const buildEarningsBreakdown = (payrollRow) => {
  const rows = EARNING_LINES.map((line) => {
    const extra =
      line.key === 'overtimeEarnings' && money(payrollRow?.overtimeMinutes) > 0
        ? ` (${Math.round(money(payrollRow.overtimeMinutes) / 60)} hrs)`
        : '';
    return {
      key: line.key,
      label: `${line.label}${extra}`,
      value: roundMoney(payrollRow?.[line.key]),
    };
  });
  const total = roundMoney(rows.reduce((sum, row) => sum + row.value, 0));
  const storedGross = roundMoney(payrollRow?.totalEarnings || payrollRow?.grossPay);
  return {
    rows,
    total: storedGross > 0 ? storedGross : total,
  };
};

export const buildDeductionsBreakdown = (payrollRow) => {
  const rows = DEDUCTION_LINES.map((line) => ({
    key: line.key,
    label: line.label,
    value: roundMoney(payrollRow?.[line.key]),
  }));
  const attendanceParts =
    money(payrollRow?.lateDeduction) +
    money(payrollRow?.noClockInPenalty) +
    money(payrollRow?.noClockOutPenalty) +
    money(payrollRow?.absentPenalty);
  const attendanceTotal = roundMoney(payrollRow?.totalAttendancePenalty);
  if (attendanceTotal > attendanceParts + 0.009) {
    rows.push({
      key: 'otherAttendancePenalty',
      label: 'Other Attendance Penalties',
      value: roundMoney(attendanceTotal - attendanceParts),
    });
  }
  const partsSum = roundMoney(rows.reduce((sum, row) => sum + row.value, 0));
  const storedTotal = roundMoney(payrollRow?.totalDeductions);
  if (storedTotal > partsSum + 0.009) {
    const otherRow = rows.find((row) => row.key === 'otherDeduction');
    const remainder = roundMoney(storedTotal - partsSum);
    if (otherRow) {
      otherRow.value = roundMoney(otherRow.value + remainder);
    } else {
      rows.push({ key: 'otherDeduction', label: 'Other Deductions / Loans', value: remainder });
    }
  }
  const total = roundMoney(rows.reduce((sum, row) => sum + row.value, 0));
  return { rows, total };
};

const employeeMonthKey = (row) => String(row?.employeeId || row?.employee || '').trim().toLowerCase();

const computePayrollYtd = ({ payrollRow, allPayrollRows = [] }) => {
  const employeeKey = employeeMonthKey(payrollRow);
  const currentMonth = String(payrollRow?.month || '').slice(0, 7);
  const empty = {
    grossPay: 0,
    totalDeductions: 0,
    netPay: 0,
    earnings: {},
    deductions: {},
  };
  if (!employeeKey) {
    const currentEarnings = buildEarningsBreakdown(payrollRow);
    const currentDeductions = buildDeductionsBreakdown(payrollRow);
    return {
      grossPay: currentEarnings.total,
      totalDeductions: currentDeductions.total,
      netPay: money(payrollRow?.netPayable),
      earnings: Object.fromEntries(currentEarnings.rows.map((row) => [row.key, row.value])),
      deductions: Object.fromEntries(currentDeductions.rows.map((row) => [row.key, row.value])),
    };
  }
  return (Array.isArray(allPayrollRows) ? allPayrollRows : []).reduce((acc, row) => {
    if (employeeMonthKey(row) !== employeeKey) {
      return acc;
    }
    const rowMonth = String(row?.month || '').slice(0, 7);
    if (currentMonth && rowMonth && rowMonth > currentMonth) {
      return acc;
    }
    const earnings = buildEarningsBreakdown(row);
    const deductions = buildDeductionsBreakdown(row);
    earnings.rows.forEach((line) => {
      acc.earnings[line.key] = roundMoney((acc.earnings[line.key] || 0) + line.value);
    });
    deductions.rows.forEach((line) => {
      acc.deductions[line.key] = roundMoney((acc.deductions[line.key] || 0) + line.value);
    });
    acc.grossPay = roundMoney(acc.grossPay + earnings.total);
    acc.totalDeductions = roundMoney(acc.totalDeductions + deductions.total);
    acc.netPay = roundMoney(acc.netPay + money(row?.netPayable));
    return acc;
  }, empty);
};

export function PayslipDocument({ company, employee, payroll, payrollRow, allPayrollRows, currency, documentRef }) {
  const currencyCode = String(currency || company?.defaultCurrency || DEFAULT_CURRENCY_CODE).toUpperCase();
  const primaryColor = String(company?.primaryColor || '#0f4ca3');
  const secondaryColor = String(company?.secondaryColor || '#21aa9c');
  const companyName = String(company?.companyName || 'PTHR');
  const logoUrl = String(company?.logoUrl || '').trim();
  const earnings = useMemo(() => buildEarningsBreakdown(payrollRow), [payrollRow]);
  const deductions = useMemo(() => buildDeductionsBreakdown(payrollRow), [payrollRow]);
  const ytd = useMemo(
    () => computePayrollYtd({ payrollRow, allPayrollRows: Array.isArray(allPayrollRows) ? allPayrollRows : [] }),
    [payrollRow, allPayrollRows]
  );
  const netPay = roundMoney(money(payrollRow?.netPayable) || earnings.total - deductions.total);

  return (
    <div className="payslip-document" ref={documentRef} style={{ background: '#fff' }}>
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
                <span>Pension ID</span>
                <strong>{employee.pensionId || payrollRow.pensionId || '—'}</strong>
              </div>
            ) : null}
            {employee?.nhimaNumber || payrollRow?.nhimaNumber ? (
              <div>
                <span>Health Insurance ID</span>
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
              <th className="payslip-table-header" style={{ background: primaryColor }}>
                EARNINGS
              </th>
              <th className="payslip-table-header payslip-num" style={{ background: primaryColor }}>
                CURRENT
              </th>
              <th className="payslip-table-header payslip-num payslip-table-header-alt" style={{ background: secondaryColor }}>
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            {earnings.rows.map((row) => (
              <tr key={`earn-${row.key}`}>
                <td>{row.label}</td>
                <td className="payslip-num payslip-strong">{formatCurrency(row.value, currencyCode)}</td>
                <td className="payslip-num payslip-alt">{formatCurrency(ytd.earnings[row.key] || 0, currencyCode)}</td>
              </tr>
            ))}
            <tr className="payslip-table-total">
              <td className="payslip-total-label">GROSS PAY</td>
              <td className="payslip-num payslip-strong payslip-total-value">{formatCurrency(earnings.total, currencyCode)}</td>
              <td className="payslip-num payslip-alt payslip-strong payslip-total-value">{formatCurrency(ytd.grossPay, currencyCode)}</td>
            </tr>
          </tbody>
        </table>

        <table className="payslip-table">
          <thead>
            <tr>
              <th className="payslip-table-header" style={{ background: primaryColor }}>
                DEDUCTIONS
              </th>
              <th className="payslip-table-header payslip-num" style={{ background: primaryColor }}>
                CURRENT
              </th>
              <th className="payslip-table-header payslip-num payslip-table-header-alt" style={{ background: secondaryColor }}>
                YTD
              </th>
            </tr>
          </thead>
          <tbody>
            {deductions.rows.map((row) => (
              <tr key={`ded-${row.key}`}>
                <td>{row.label}</td>
                <td className="payslip-num payslip-strong">{formatCurrency(row.value, currencyCode)}</td>
                <td className="payslip-num payslip-alt">{formatCurrency(ytd.deductions[row.key] || 0, currencyCode)}</td>
              </tr>
            ))}
            <tr className="payslip-table-total">
              <td className="payslip-total-label">TOTAL DEDUCTIONS</td>
              <td className="payslip-num payslip-strong payslip-total-value">{formatCurrency(deductions.total, currencyCode)}</td>
              <td className="payslip-num payslip-alt payslip-strong payslip-total-value">{formatCurrency(ytd.totalDeductions, currencyCode)}</td>
            </tr>
          </tbody>
        </table>

        <div className="payslip-net-pay-section">
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
        <p>If you have any questions about this payslip, please contact your HR / Payroll administrator.</p>
        <p>
          This document was generated by <strong>{companyName}</strong>.
        </p>
      </div>
    </div>
  );
}

export default PayslipDocument;
