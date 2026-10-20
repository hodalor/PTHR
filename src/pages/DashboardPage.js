import { useMemo, useState } from 'react';

const formatMoney = (value, currency) => {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  return `${currency} ${safeValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const cardStyle = {
  border: '1px solid #d9e5fb',
  borderRadius: 18,
  background: 'linear-gradient(180deg, #ffffff 0%, #f7faff 100%)',
  padding: 18,
  boxShadow: '0 10px 30px rgba(15, 23, 42, 0.05)',
};

const statCardStyle = {
  ...cardStyle,
  minHeight: 132,
};

function SummaryCard({ label, value, helper, tone = 'default', onClick }) {
  const toneMap = {
    default: { valueColor: '#16346e', helperColor: '#607098' },
    success: { valueColor: '#177245', helperColor: '#4d7b65' },
    warning: { valueColor: '#93540a', helperColor: '#8d6a33' },
    danger: { valueColor: '#b42318', helperColor: '#8b5a5a' },
  };
  const palette = toneMap[tone] || toneMap.default;
  const interactive = typeof onClick === 'function';

  return (
    <article
      style={{
        ...statCardStyle,
        cursor: interactive ? 'pointer' : 'default',
        borderColor: interactive ? '#7aa7ef' : cardStyle.border,
      }}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div style={{ color: '#607098', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ marginTop: 10, color: palette.valueColor, fontSize: 28, fontWeight: 800 }}>{value}</div>
      {helper ? (
        <div style={{ marginTop: 8, color: palette.helperColor, fontSize: 13, lineHeight: 1.5 }}>
          {helper}
        </div>
      ) : null}
      {interactive ? (
        <div style={{ marginTop: 8, color: '#0a73d9', fontSize: 12, fontWeight: 700 }}>Tap for details</div>
      ) : null}
    </article>
  );
}

function LoadingState() {
  return (
    <div style={{ ...cardStyle, color: '#607098' }}>
      Loading dashboard summary...
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ ...cardStyle, color: '#607098' }}>
      {message}
    </div>
  );
}

function formatPayrollSource(source) {
  return source === 'latest-payroll' ? 'Latest payroll' : 'Live estimate';
}

function formatMonthLabel(monthValue) {
  const match = String(monthValue || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return monthValue || '';
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleString(undefined, {
    month: 'short',
    year: 'numeric',
  });
}

function SalaryPeriodCards({ periodSummary, currency, onOpenDeductions }) {
  if (!periodSummary) {
    return null;
  }
  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
      <SummaryCard
        label="Total Salary"
        value={formatMoney(periodSummary.totalSalary, currency)}
        helper={`${formatMonthLabel(periodSummary.monthFrom)}${
          periodSummary.monthFrom === periodSummary.monthTo ? '' : ` → ${formatMonthLabel(periodSummary.monthTo)}`
        } • ${Number(periodSummary.monthCount || 1)} month(s)`}
      />
      <SummaryCard
        label="Amount Deducted"
        value={formatMoney(periodSummary.amountDeducted, currency)}
        helper={`${Number(periodSummary.deductionItems?.length || 0)} contributing item(s)`}
        tone="danger"
        onClick={onOpenDeductions}
      />
      <SummaryCard
        label="Remaining Balance"
        value={formatMoney(periodSummary.remainingBalance, currency)}
        helper="Salary minus selected-period deductions"
        tone="success"
      />
    </div>
  );
}

function DeductionDetailsPanel({ periodSummary, currency, onClose }) {
  const items = Array.isArray(periodSummary?.deductionItems) ? periodSummary.deductionItems : [];
  return (
    <div style={{ ...cardStyle, borderColor: '#f2c7c7', background: '#fff9f8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: '0 0 6px', color: '#16346e' }}>Deduction details</h3>
          <p style={{ margin: 0, color: '#607098' }}>
            {formatMonthLabel(periodSummary?.monthFrom)}
            {periodSummary?.monthFrom === periodSummary?.monthTo ? '' : ` → ${formatMonthLabel(periodSummary?.monthTo)}`}
            {` • ${formatMoney(periodSummary?.amountDeducted, currency)}`}
          </p>
        </div>
        <button type="button" className="neutral-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        {items.length === 0 ? (
          <div style={{ color: '#607098' }}>No lateness or attendance deductions in the selected months.</div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="dashboard-detail-row">
              <span>
                <strong>{item.label || 'Lateness'}</strong>
                <div style={{ color: '#607098', fontSize: 13 }}>
                  {item.date} at {item.time || '—'} • {Number(item.lateMinutes || 0)} min late
                </div>
              </span>
              <strong>{formatMoney(item.amount, currency)}</strong>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EmployeeSummaryBody({ summary, currency, dashboardDate, showDeductionDetails, onToggleDeductions }) {
  return (
    <>
      <SalaryPeriodCards
        periodSummary={summary?.periodSummary}
        currency={currency}
        onOpenDeductions={onToggleDeductions}
      />

      {showDeductionDetails ? (
        <DeductionDetailsPanel
          periodSummary={summary?.periodSummary}
          currency={currency}
          onClose={onToggleDeductions}
        />
      ) : null}

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        <SummaryCard
          label="Take Home"
          value={formatMoney(summary?.compensation?.takeHomePay, currency)}
          helper={summary?.compensation?.payrollPeriod || formatPayrollSource(summary?.compensation?.source)}
          tone="success"
        />
        <SummaryCard
          label="Total Deductions"
          value={formatMoney(summary?.compensation?.totalDeductions, currency)}
          helper={`Today's deduction ${formatMoney(summary?.attendance?.deductionAmount, currency)}`}
          tone="warning"
        />
        <SummaryCard
          label="Month To Date Deductions"
          value={formatMoney(summary?.monthToDate?.deductionAmount, currency)}
          helper={`${Number(summary?.monthToDate?.lateMinutes || 0)} minute(s) late this month`}
          tone="danger"
        />
        <SummaryCard
          label="Today Status"
          value={String(summary?.attendance?.status || 'No Record')}
          helper={`${Number(summary?.attendance?.lateMinutes || 0)} minute(s) late on ${summary?.date || dashboardDate}`}
          tone={String(summary?.attendance?.status || '').toLowerCase() === 'late' ? 'warning' : 'default'}
        />
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 14px', color: '#16346e' }}>Pay Summary</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="dashboard-detail-row">
              <span>Gross Pay</span>
              <strong>{formatMoney(summary?.compensation?.grossPay, currency)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Total Deductions</span>
              <strong>{formatMoney(summary?.compensation?.totalDeductions, currency)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Take Home</span>
              <strong>{formatMoney(summary?.compensation?.takeHomePay, currency)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Source</span>
              <strong>{formatPayrollSource(summary?.compensation?.source)}</strong>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 14px', color: '#16346e' }}>Attendance Summary</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="dashboard-detail-row">
              <span>Today's deduction</span>
              <strong>{formatMoney(summary?.attendance?.deductionAmount, currency)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Month-to-date deductions</span>
              <strong>{formatMoney(summary?.monthToDate?.deductionAmount, currency)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Today's late minutes</span>
              <strong>{Number(summary?.attendance?.lateMinutes || 0)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Month-to-date late minutes</span>
              <strong>{Number(summary?.monthToDate?.lateMinutes || 0)}</strong>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 14px', color: '#16346e' }}>Loan & Leave Summary</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="dashboard-detail-row">
              <span>Active loans</span>
              <strong>{Number(summary?.loans?.activeCount || 0)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Outstanding loan balance</span>
              <strong>{formatMoney(summary?.loans?.outstandingAmount, currency)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Pending leave requests</span>
              <strong>{Number(summary?.leaves?.pendingCount || 0)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Approved leave requests</span>
              <strong>{Number(summary?.leaves?.approvedCount || 0)}</strong>
            </div>
            <div className="dashboard-detail-row">
              <span>Leave balance</span>
              <strong>{Number(summary?.employee?.leaveBalanceDays || 0)} day(s)</strong>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage({
  summary,
  loading,
  error,
  dashboardDate,
  onDateChange,
  monthFrom,
  monthTo,
  onMonthFromChange,
  onMonthToChange,
  selectedEmployeeId,
  onSelectedEmployeeChange,
  onRefresh,
  currency = 'USD',
}) {
  const [showDeductionDetails, setShowDeductionDetails] = useState(false);
  const isAdminView = summary?.view === 'admin';
  const employeeOptions = useMemo(
    () => (Array.isArray(summary?.employees) ? summary.employees : []),
    [summary?.employees]
  );
  const focusedSummary = isAdminView ? summary?.selectedEmployee : summary;

  if (loading && !summary) {
    return <LoadingState />;
  }

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#607098', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Dashboard Summary
          </p>
          <h2 style={{ margin: '6px 0 4px', color: '#16346e', fontSize: 28 }}>
            {isAdminView ? 'Operations Summary' : 'My Summary'}
          </h2>
          <p style={{ margin: 0, color: '#607098' }}>
            Salary, deductions, remaining balance, attendance, loans, and leave for the selected period.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 6, color: '#4f638a', fontSize: 13, fontWeight: 700 }}>
            <span>Date</span>
            <input
              type="date"
              value={dashboardDate}
              onChange={(event) => onDateChange(event.target.value)}
              style={{
                minWidth: 160,
                borderRadius: 12,
                border: '1px solid #cfdcf4',
                background: '#ffffff',
                color: '#16346e',
                padding: '10px 12px',
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#4f638a', fontSize: 13, fontWeight: 700 }}>
            <span>From month</span>
            <input
              type="month"
              value={monthFrom}
              onChange={(event) => onMonthFromChange(event.target.value)}
              style={{
                minWidth: 150,
                borderRadius: 12,
                border: '1px solid #cfdcf4',
                background: '#ffffff',
                color: '#16346e',
                padding: '10px 12px',
              }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#4f638a', fontSize: 13, fontWeight: 700 }}>
            <span>To month</span>
            <input
              type="month"
              value={monthTo}
              onChange={(event) => onMonthToChange(event.target.value)}
              style={{
                minWidth: 150,
                borderRadius: 12,
                border: '1px solid #cfdcf4',
                background: '#ffffff',
                color: '#16346e',
                padding: '10px 12px',
              }}
            />
          </label>
          {isAdminView ? (
            <label style={{ display: 'grid', gap: 6, color: '#4f638a', fontSize: 13, fontWeight: 700 }}>
              <span>Employee</span>
              <select
                value={selectedEmployeeId || ''}
                onChange={(event) => onSelectedEmployeeChange(event.target.value)}
                style={{
                  minWidth: 220,
                  borderRadius: 12,
                  border: '1px solid #cfdcf4',
                  background: '#ffffff',
                  color: '#16346e',
                  padding: '10px 12px',
                }}
              >
                <option value="">All employees (operations)</option>
                {employeeOptions.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName || employee.id}
                    {employee.department ? ` • ${employee.department}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="neutral-btn" onClick={onRefresh} style={{ height: 42 }}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ ...cardStyle, borderColor: '#f2c7c7', background: '#fff7f7', color: '#b42318' }}>
          {error}
        </div>
      ) : null}

      {loading && summary ? (
        <div style={{ color: '#607098', fontSize: 13 }}>Refreshing summary...</div>
      ) : null}

      {!summary ? (
        <EmptyState message="No dashboard data is available yet." />
      ) : summary.view === 'employee' ? (
        <EmployeeSummaryBody
          summary={summary}
          currency={currency}
          dashboardDate={dashboardDate}
          showDeductionDetails={showDeductionDetails}
          onToggleDeductions={() => setShowDeductionDetails((prev) => !prev)}
        />
      ) : (
        <>
          <SalaryPeriodCards
            periodSummary={summary?.periodSummary}
            currency={currency}
            onOpenDeductions={
              focusedSummary?.periodSummary
                ? () => setShowDeductionDetails((prev) => !prev)
                : undefined
            }
          />

          <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
            <SummaryCard
              label="Active Employees"
              value={String(Number(summary?.workforce?.activeEmployees || 0))}
              helper={`Out of ${Number(summary?.workforce?.totalEmployees || 0)} total employees`}
              tone="success"
            />
            <SummaryCard
              label="Inactive Employees"
              value={String(Number(summary?.workforce?.inactiveEmployees || 0))}
              helper="Stopped, inactive, resigned, fired, or expired"
              tone="warning"
            />
            <SummaryCard
              label="On Time"
              value={String(Number(summary?.attendance?.onTimeCount || 0))}
              helper={`For ${summary?.date || dashboardDate}`}
              tone="success"
            />
            <SummaryCard
              label="Late"
              value={String(Number(summary?.attendance?.lateCount || 0))}
              helper={`Clocked ${Number(summary?.attendance?.clockedCount || 0)} employee(s)`}
              tone="danger"
            />
            <SummaryCard
              label="Today's Deductions"
              value={formatMoney(summary?.attendance?.totalDeductionAmount, currency)}
              helper="Late attendance impact for selected date"
              tone="warning"
            />
            <SummaryCard
              label="Month To Date"
              value={formatMoney(summary?.monthToDate?.totalDeductionAmount, currency)}
              helper="Accumulated deduction amount this month"
              tone="danger"
            />
          </div>

          {selectedEmployeeId && focusedSummary ? (
            <>
              <div style={cardStyle}>
                <h3 style={{ margin: '0 0 6px', color: '#16346e' }}>
                  Employee summary • {focusedSummary?.employee?.fullName || selectedEmployeeId}
                </h3>
                <p style={{ margin: 0, color: '#607098' }}>
                  Select another employee above to compare, or clear the selection to return to operations-only view.
                </p>
              </div>
              <EmployeeSummaryBody
                summary={focusedSummary}
                currency={currency}
                dashboardDate={dashboardDate}
                showDeductionDetails={showDeductionDetails}
                onToggleDeductions={() => setShowDeductionDetails((prev) => !prev)}
              />
            </>
          ) : null}

          {!selectedEmployeeId ? (
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              <div style={cardStyle}>
                <h3 style={{ margin: '0 0 14px', color: '#16346e' }}>Workforce Snapshot</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div className="dashboard-detail-row">
                    <span>Total employees</span>
                    <strong>{Number(summary?.workforce?.totalEmployees || 0)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Active employees</span>
                    <strong>{Number(summary?.workforce?.activeEmployees || 0)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Inactive employees</span>
                    <strong>{Number(summary?.workforce?.inactiveEmployees || 0)}</strong>
                  </div>
                </div>
              </div>

              <div style={cardStyle}>
                <h3 style={{ margin: '0 0 14px', color: '#16346e' }}>Attendance Summary</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div className="dashboard-detail-row">
                    <span>On time</span>
                    <strong>{Number(summary?.attendance?.onTimeCount || 0)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Late</span>
                    <strong>{Number(summary?.attendance?.lateCount || 0)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Clocked</span>
                    <strong>{Number(summary?.attendance?.clockedCount || 0)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Deductions</span>
                    <strong>{formatMoney(summary?.attendance?.totalDeductionAmount, currency)}</strong>
                  </div>
                </div>
              </div>

              <div style={cardStyle}>
                <h3 style={{ margin: '0 0 14px', color: '#16346e' }}>Loans & Leave</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div className="dashboard-detail-row">
                    <span>Active loans</span>
                    <strong>{Number(summary?.loans?.activeCount || 0)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Outstanding loans</span>
                    <strong>{formatMoney(summary?.loans?.outstandingAmount, currency)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Pending leaves</span>
                    <strong>{Number(summary?.leaves?.pendingCount || 0)}</strong>
                  </div>
                  <div className="dashboard-detail-row">
                    <span>Approved leaves</span>
                    <strong>{Number(summary?.leaves?.approvedCount || 0)}</strong>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
