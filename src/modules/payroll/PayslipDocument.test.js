import { buildDeductionsBreakdown, buildEarningsBreakdown } from './PayslipDocument';

describe('payslip deduction breakdown', () => {
  test('lists pension, health, tax, other and attendance lines and totals them', () => {
    const { rows, total } = buildDeductionsBreakdown({
      napsaDeduction: '35.00',
      nhimaDeduction: '7.00',
      taxDeduction: '20.00',
      otherDeduction: '15.00',
      lateDeduction: '10.00',
      noClockInPenalty: '0',
      noClockOutPenalty: '0',
      absentPenalty: '5.00',
      totalDeductions: '92.00',
    });

    expect(rows.find((row) => row.key === 'napsaDeduction').value).toBe(35);
    expect(rows.find((row) => row.key === 'nhimaDeduction').value).toBe(7);
    expect(rows.find((row) => row.key === 'taxDeduction').value).toBe(20);
    expect(rows.find((row) => row.key === 'otherDeduction').value).toBe(15);
    expect(rows.find((row) => row.key === 'lateDeduction').value).toBe(10);
    expect(rows.find((row) => row.key === 'absentPenalty').value).toBe(5);
    expect(total).toBe(92);
  });

  test('puts an unexplained stored total into other deductions', () => {
    const { rows, total } = buildDeductionsBreakdown({
      napsaDeduction: 0,
      nhimaDeduction: 0,
      taxDeduction: 0,
      otherDeduction: 0,
      lateDeduction: 0,
      totalDeductions: 10,
    });

    expect(rows.find((row) => row.key === 'otherDeduction').value).toBe(10);
    expect(total).toBe(10);
  });
});

describe('payslip earnings breakdown', () => {
  test('adds allowances and overtime into gross pay', () => {
    const { rows, total } = buildEarningsBreakdown({
      basicPay: '700',
      transportAllowance: '50',
      overtimeEarnings: '25',
      overtimeMinutes: '60',
      totalEarnings: '775',
    });

    expect(rows.find((row) => row.key === 'basicPay').value).toBe(700);
    expect(rows.find((row) => row.key === 'overtimeEarnings').label).toContain('1 hrs');
    expect(total).toBe(775);
  });
});
