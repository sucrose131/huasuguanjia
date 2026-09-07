import { describe, expect, it } from 'vitest';
import {
  canViewReportAmount,
  protectReportRows,
  reportMoney,
  reportAmountTotal,
  reportExportCell,
  REPORT_AMOUNT_MASK,
} from './amount-policy';

const columns = [
  { key: 'amount', kind: 'money' as const },
  { key: 'quantity', kind: 'number' as const },
];
describe('报表金额策略', () => {
  it.each([
    { canViewAmount: false, amountScope: 'own' },
    { canViewAmount: false, amountScope: 'all' },
    { canViewAmount: true, amountScope: 'own' },
    { canViewAmount: true },
  ])('无权限/自己范围/缺失范围不显示本人金额、合计或导出金额：%j', (access) => {
    const row = { createdBy: '61', amount: 123.45, quantity: 7 };
    expect(canViewReportAmount(access)).toBe(false);
    expect(reportMoney(row.amount, access)).toBe(REPORT_AMOUNT_MASK);
    expect(reportExportCell(row, columns[0]!, access)).toBe(REPORT_AMOUNT_MASK);
    expect(reportAmountTotal([row], 'amount', access)).toBeNull();
    expect(protectReportRows([row], columns, access)[0]).toEqual({ ...row, amount: null });
    expect(row.amount).toBe(123.45);
  });
  it('all 保留小数及真实0，不完整金额不兜0也不计算部分合计', () => {
    const access = { canViewAmount: true, amountScope: 'all' };
    expect(reportMoney(0, access)).toBe('¥0.00');
    expect(reportMoney(123.45, access)).toBe('¥123.45');
    expect(reportMoney(null, access)).toBe(REPORT_AMOUNT_MASK);
    expect(reportMoney('invalid', access)).toBe(REPORT_AMOUNT_MASK);
    expect(reportAmountTotal([{ amount: 5 }, { amount: null }], 'amount', access)).toBeNull();
    expect(reportAmountTotal([{ amount: 5 }, { amount: 0 }], 'amount', access)).toBe(5);
  });
});
