import { useMemo, useRef } from 'react';
import PayrollPage from '../../pages/PayrollPage';
import PayrollRecordForm from './PayrollRecordForm';
import PayslipDocument from './PayslipDocument';
import { enhancePayrollRows } from './enhancePayrollRows';
import { parsePayrollCsvRows, downloadPayrollTemplate } from './payrollImport';
import { computePayrollPreviewValues, formatPayrollPeriodLabel, toPayrollMonthInputValue } from './payrollUtils';
import { usePayrollForm } from './usePayrollForm';

const payrollDetailSections = [
  {
    id: 'employee-period',
    title: 'Employee & Period',
    fields: ['month', 'employee', 'employeeId', 'status'],
  },
  {
    id: 'statutory',
    title: 'Statutory IDs',
    fields: ['taxId', 'pensionId', 'nhimaNumber'],
  },
  {
    id: 'wallet-bank',
    title: 'Wallet & Bank',
    fields: ['accessAccount', 'mobileMoneyNumber', 'mobileMoneyNetwork', 'bankName', 'bankAccountName', 'bankAccountNumber'],
  },
  {
    id: 'pay-allowances',
    title: 'Pay & Allowances',
    fields: [
      'basicPay',
      'monthlyBonuses',
      'transportAllowance',
      'housingAllowance',
      'foodAllowance',
      'grossPay',
      'overtimeMinutes',
      'overtimeEarnings',
      'totalEarnings',
      'workingDays',
    ],
  },
  {
    id: 'deductions-penalties',
    title: 'Deductions & Penalties',
    fields: [
      'napsaDeduction',
      'nhimaDeduction',
      'taxDeduction',
      'otherDeduction',
      'totalAttendancePenalty',
      'lateMinutes',
      'deductionRatePerMinute',
      'lateDeduction',
      'noClockInPenalty',
      'noClockOutPenalty',
      'absentPenalty',
      'totalDeductions',
    ],
  },
  {
    id: 'summary',
    title: 'Summary',
    fields: ['netPayable'],
  },
];

export const usePayrollAdapter = ({
  activeModuleId,
  activeModuleConfig,
  appSettings,
  currentUser,
  employeeBaseRows,
  formValues,
  modalState,
  moduleRowsState,
  setFormError,
  setFormValues,
  setModuleRowsState,
  showToast,
  getTodayIsoDate,
  getCurrentClockValue,
  toMinutesFromClock,
  getMinutesBetweenClocks,
  isLoanCountableRecord,
}) => {
  const active = activeModuleId === 'payroll-management';
  const payrollUploadInputRef = useRef(null);

  const { payrollFormEmployeeMatches, selectedPayrollFormEmployee, payrollPreviewValues } = usePayrollForm({
    active,
    appSettings,
    employeeBaseRows,
    formValues,
    modalState,
    setFormValues,
  });

  const payrollFormFieldMap = useMemo(() => {
    if (!active || !activeModuleConfig) {
      return {};
    }
    const map = {};
    activeModuleConfig.formFields.forEach((field) => {
      map[field.key] = field;
    });
    return map;
  }, [active, activeModuleConfig]);

  const payrollFormLoans = useMemo(() => {
    if (!active) {
      return [];
    }
    const loanRows = moduleRowsState['loan-records'] || [];
    const key = String(formValues.employeeId || '').trim();
    const employeeName = String(formValues.employee || '').trim();
    return loanRows
      .filter((loanRow) => {
        if (!isLoanCountableRecord(loanRow)) {
          return false;
        }
        const loanEmployeeId = String(loanRow.employeeId || '').trim();
        const loanEmployeeName = String(loanRow.employee || '').trim();
        return (key && loanEmployeeId === key) || (employeeName && loanEmployeeName === employeeName);
      })
      .sort((a, b) => String(b.issuedOn || '').localeCompare(String(a.issuedOn || '')))
      .slice(0, 3);
  }, [active, formValues.employee, formValues.employeeId, isLoanCountableRecord, moduleRowsState]);

  const payrollLoansForHeader = useMemo(() => {
    if (!active || !modalState.rowId) {
      return [];
    }
    const payrollRows = moduleRowsState['payroll-management'] || [];
    const selectedPayrollRow = payrollRows.find((row) => String(row.id || '') === String(modalState.rowId || '')) || null;
    if (!selectedPayrollRow) {
      return [];
    }
    const loans = moduleRowsState['loan-records'] || [];
    const employeeId = String(selectedPayrollRow.employeeId || '').trim();
    const employeeName = String(selectedPayrollRow.employee || '').trim();
    return loans
      .filter((loanRow) => {
        if (!isLoanCountableRecord(loanRow)) {
          return false;
        }
        const loanEmployeeId = String(loanRow.employeeId || '').trim();
        const loanEmployeeName = String(loanRow.employee || '').trim();
        return (employeeId && loanEmployeeId === employeeId) || (employeeName && loanEmployeeName === employeeName);
      })
      .sort((a, b) => String(b.issuedOn || '').localeCompare(String(a.issuedOn || '')))
      .slice(0, 5);
  }, [active, isLoanCountableRecord, modalState.rowId, moduleRowsState]);

  const handleOpenPayrollUpload = () => {
    if (!payrollUploadInputRef.current) {
      return;
    }
    payrollUploadInputRef.current.value = '';
    payrollUploadInputRef.current.click();
  };

  const handlePayrollBulkUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const importedRows = await parsePayrollCsvRows(file);
      if (!importedRows.length) {
        showToast('No valid payroll rows found in file.', 'error');
        return;
      }
      setModuleRowsState((prev) => ({
        ...prev,
        'payroll-management': [...importedRows, ...(prev['payroll-management'] || [])],
      }));
      showToast(`Imported ${importedRows.length} payroll row(s).`, 'success');
    } catch (error) {
      showToast('Failed to import payroll file.', 'error');
    }
  };

  const augmentColumns = (columns) => {
    if (!active) {
      return columns;
    }
    if (!columns.some((column) => column.key === 'loanSummary')) {
      const statusIndex = columns.findIndex((column) => column.key === 'status');
      if (statusIndex === -1) {
        return [...columns, { key: 'loanSummary', label: 'Loans' }];
      }
      return [...columns.slice(0, statusIndex), { key: 'loanSummary', label: 'Loans' }, ...columns.slice(statusIndex)];
    }
    return columns;
  };

  const getRows = (baseRows) => {
    if (!active) {
      return baseRows;
    }
    return enhancePayrollRows({
      baseRows,
      moduleRowsState,
      appSettings,
      getTodayIsoDate,
      getCurrentClockValue,
      toMinutesFromClock,
      getMinutesBetweenClocks,
      isLoanCountableRecord,
    });
  };

  const getInitialFormValues = () => ({
    payrollEmployeeSearch: '',
    employee: '',
    employeeId: '',
    month: '',
    status: 'Processing',
  });

  const getEditFormValues = (row) => ({
    ...row,
    month: toPayrollMonthInputValue(row.month),
    payrollEmployeeSearch: `${row.employee || ''} ${row.employeeId || ''}`.trim(),
  });

  const beforeSave = () => {
    const matchedEmployeeFromSearch = selectedPayrollFormEmployee;
    if (!matchedEmployeeFromSearch) {
      const message = 'Select a valid employee from payroll search.';
      setFormError(message);
      showToast(message, 'error');
      return { ok: false };
    }
    const payrollPreviewNumeric = computePayrollPreviewValues(formValues, appSettings);
    const loanRules = appSettings.loanRules || {};
    const minTakeHomePercent = Math.max(1, Math.min(100, Number(loanRules.minTakeHomePercent) || 45));
    const maxLoanDeductionPercentOfGross = Math.max(0, Math.min(100, Number(loanRules.maxLoanDeductionPercentOfGross) || 35));
    const grossPositive = payrollPreviewNumeric.grossPay > 0;
    const effectiveLoanPercentOfGross = grossPositive ? (payrollPreviewNumeric.otherDeduction / payrollPreviewNumeric.grossPay) * 100 : 0;
    const takeHomePercent = grossPositive ? (payrollPreviewNumeric.netPayable / payrollPreviewNumeric.grossPay) * 100 : 0;
    if (grossPositive && effectiveLoanPercentOfGross > maxLoanDeductionPercentOfGross) {
      const message = `Loan and other deductions exceed allowed ${maxLoanDeductionPercentOfGross.toFixed(1)}% of gross pay.`;
      setFormError(message);
      showToast(message, 'error');
      return { ok: false };
    }
    if (grossPositive && takeHomePercent < minTakeHomePercent) {
      const message = `Net pay (${takeHomePercent.toFixed(1)}%) is below minimum take-home of ${minTakeHomePercent.toFixed(1)}%.`;
      setFormError(message);
      showToast(message, 'error');
      return { ok: false };
    }
    return {
      ok: true,
      computedValues: {
        employee: matchedEmployeeFromSearch.fullName || formValues.employee || '',
        employeeId: matchedEmployeeFromSearch.id || formValues.employeeId || '',
        taxId: formValues.taxId || matchedEmployeeFromSearch.taxId || '',
        pensionId: formValues.pensionId || matchedEmployeeFromSearch.pensionId || '',
        nhimaNumber: formValues.nhimaNumber || matchedEmployeeFromSearch.nhimaNumber || '',
        accessAccount: formValues.accessAccount || matchedEmployeeFromSearch.accessAccount || '',
        mobileMoneyNumber: formValues.mobileMoneyNumber || matchedEmployeeFromSearch.mobileMoneyNumber || '',
        mobileMoneyNetwork: formValues.mobileMoneyNetwork || matchedEmployeeFromSearch.mobileMoneyNetwork || '',
        bankName: formValues.bankName || matchedEmployeeFromSearch.bankName || '',
        bankAccountName: formValues.bankAccountName || matchedEmployeeFromSearch.bankAccountName || '',
        bankAccountNumber: formValues.bankAccountNumber || matchedEmployeeFromSearch.bankAccountNumber || '',
        month: formatPayrollPeriodLabel(formValues.month),
        grossPay: payrollPreviewValues.grossPay,
        overtimeEarnings: payrollPreviewValues.overtimeEarnings,
        totalEarnings: payrollPreviewValues.totalEarnings,
        totalAttendancePenalty: payrollPreviewValues.totalAttendancePenalty,
        totalDeductions: payrollPreviewValues.totalDeductions,
        netPayable: payrollPreviewValues.netPayable,
        napsaDeduction: payrollPreviewValues.napsaDeduction,
        nhimaDeduction: payrollPreviewValues.nhimaDeduction,
        taxDeduction: payrollPreviewValues.taxDeduction,
      },
    };
  };

  const renderHeader = ({ startCreate }) => (
    <PayrollPage
      startCreate={startCreate}
      payrollUploadInputRef={payrollUploadInputRef}
      handlePayrollBulkUpload={handlePayrollBulkUpload}
      handleDownloadPayrollTemplate={downloadPayrollTemplate}
      handleOpenPayrollUpload={handleOpenPayrollUpload}
      payrollLoansForModal={payrollLoansForHeader}
    />
  );

  const renderFormBody = ({ renderFormFieldControl: renderField }) => (
    <PayrollRecordForm
      formValues={formValues}
      setFormValues={setFormValues}
      payrollFormEmployeeMatches={payrollFormEmployeeMatches}
      selectedPayrollFormEmployee={selectedPayrollFormEmployee}
      payrollPreviewValues={payrollPreviewValues}
      payrollDetailSections={payrollDetailSections}
      payrollFormFieldMap={payrollFormFieldMap}
      payrollFormLoans={payrollFormLoans}
      renderFormFieldControl={renderField}
    />
  );

  const renderDetailsExtras = ({ modalRow }) => {
    const payrollRow = modalRow || null;
    if (!payrollRow) {
      return null;
    }
    const matchedEmployee = Array.isArray(employeeBaseRows)
      ? employeeBaseRows.find((row) => {
          const rowId = String(row.id || '').trim();
          const rowName = String(row.fullName || '').trim().toLowerCase();
          const payrollId = String(payrollRow.employeeId || '').trim();
          const payrollName = String(payrollRow.employee || '').trim().toLowerCase();
          return (
            (payrollId && rowId === payrollId) ||
            (payrollName && rowName === payrollName) ||
            (payrollName && rowName && rowName.includes(payrollName))
          );
        }) || null
      : null;
    const employee = {
      fullName: payrollRow.employee || matchedEmployee?.fullName || '',
      employeeId: payrollRow.employeeId || matchedEmployee?.id || '',
      address: matchedEmployee?.address || matchedEmployee?.location || '',
      location: matchedEmployee?.location || '',
      phone: payrollRow.mobileMoneyNumber || matchedEmployee?.phone || matchedEmployee?.personalPhone || matchedEmployee?.contactNumber || matchedEmployee?.mobileNumber || '',
      email: matchedEmployee?.email || '',
      department: matchedEmployee?.department || '',
      position: matchedEmployee?.position || '',
      taxId: payrollRow.taxId || matchedEmployee?.taxId || '',
      pensionId: payrollRow.pensionId || matchedEmployee?.pensionId || '',
      nhimaNumber: payrollRow.nhimaNumber || matchedEmployee?.nhimaNumber || '',
    };
    const idCardDesign = appSettings?.idCardDesign || {};
    const company = {
      companyName: String(idCardDesign.companyName || appSettings?.appName || currentUser?.tenantId || 'PTHR').trim(),
      logoUrl: String(idCardDesign.logoUrl || '').trim(),
      primaryColor: String(idCardDesign.primaryColor || '#0f4ca3'),
      secondaryColor: String(idCardDesign.secondaryColor || '#21aa9c'),
      companyAddress: String(idCardDesign.companyAddress || '').trim(),
      companyPhone: String(idCardDesign.companyPhone || '').trim(),
      companyEmail: String(idCardDesign.companyEmail || '').trim(),
      companyWebsite: String(idCardDesign.companyWebsite || '').trim(),
      defaultCurrency: String(appSettings?.defaultCurrency || 'GHS'),
    };
    const payroll = {
      payrollId: String(payrollRow.id || '').trim(),
      payDate: String(payrollRow.month || '').trim(),
      status: String(payrollRow.status || 'Processing').trim(),
      period: String(payrollRow.month || '').trim(),
      workingDays: Number(payrollRow.workingDays) || '—',
      paymentMethod: payrollRow.bankAccountNumber || payrollRow.mobileMoneyNumber ? 'Bank / Mobile Money Transfer' : 'Bank Transfer',
    };
    const allPayrollRows = Array.isArray(moduleRowsState?.['payroll-management']) ? moduleRowsState['payroll-management'] : [];
    const handleOpenPrintPayslip = () => {
      try {
        const body = document.body;
        if (!body) {
          return;
        }
        body.classList.add('payslip-print-mode');
        const cleanup = () => {
          body.classList.remove('payslip-print-mode');
          window.removeEventListener('afterprint', cleanup);
          window.removeEventListener('beforeprint', clearFocus);
        };
        const clearFocus = () => {
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
        };
        clearFocus();
        window.addEventListener('afterprint', cleanup, { once: true });
        setTimeout(() => {
          try {
            window.print();
          } catch (error) {
            cleanup();
            showToast('Unable to open print dialog. Please use Ctrl+P / Cmd+P instead.', 'error');
          } finally {
            setTimeout(() => cleanup(), 100);
          }
        }, 240);
      } catch (error) {
        showToast('Unable to open print dialog. Please use Ctrl+P / Cmd+P instead.', 'error');
      }
    };
    return (
      <>
        <div className="payslip-print-root">
          <div className="payslip-actions">
            <button type="button" className="primary-btn" onClick={handleOpenPrintPayslip}>
              🖨️ Generate / Download Payslip
            </button>
            <span className="muted-subtext">
              Tip: In the print dialog choose <strong>Save as PDF</strong> to download. Use Ctrl+P or Cmd+P at any time.
            </span>
          </div>
          <PayslipDocument
            company={company}
            employee={employee}
            payroll={payroll}
            payrollRow={payrollRow}
            allPayrollRows={allPayrollRows}
            currency={company.defaultCurrency}
          />
        </div>
        {payrollLoansForHeader.length > 0 ? (
          <div className="employee-ops-card">
            <div className="employee-ops-header">
              <h5>Employee Loans</h5>
              <span>{`${payrollLoansForHeader.length} loan(s)`}</span>
            </div>
            <div className="employee-ops-list">
              {payrollLoansForHeader.map((loanRow) => (
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
  };

  return {
    active,
    augmentColumns,
    getRows,
    getInitialFormValues,
    getEditFormValues,
    beforeSave,
    renderHeader,
    renderFormBody,
    renderDetailsExtras,
  };
};
