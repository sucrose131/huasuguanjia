/** 报表为跨单据视图，不沿用单据「仅自己经办」的放行规则。 */
export type ReportAmountAccess = { canViewAmount: boolean; amountScope?: string };
export type ReportColumn = { key: string; kind?: 'text' | 'money' | 'number' };
export const REPORT_AMOUNT_MASK = '¥ ****';
export const REPORT_REQUEST_PARAMS = { amountContext: 'report' } as const;

export function canViewReportAmount(access: ReportAmountAccess): boolean {
  return access.canViewAmount === true && access.amountScope === 'all';
}

export function reportNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function reportMoney(value: unknown, access: ReportAmountAccess): string {
  const number = reportNumber(value);
  if (!canViewReportAmount(access) || number === null) return REPORT_AMOUNT_MASK;
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 映射/聚合后再保护一次，避免脱敏 null 被聚合成 0，以及保留旧授权缓存。 */
export function protectReportRows<T extends Record<string, any>>(
  rows: T[],
  columns: ReportColumn[],
  access: ReportAmountAccess,
): T[] {
  if (canViewReportAmount(access)) return rows;
  const keys = columns.filter((column) => column.kind === 'money').map((column) => column.key);
  return rows.map((row) => {
    const copy = { ...row };
    for (const key of keys) (copy as Record<string, any>)[key] = null;
    return copy;
  });
}

/** 任一缺失/脱敏金额使合计不可用，不把局部金额合计冒充完整合计。 */
export function reportAmountTotal(
  rows: Record<string, any>[],
  key: string | undefined,
  access: ReportAmountAccess,
): number | null {
  if (!key || !canViewReportAmount(access)) return null;
  let total = 0;
  for (const row of rows) {
    const value = reportNumber(row[key]);
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function reportExportCell(
  row: Record<string, any>,
  column: ReportColumn,
  access: ReportAmountAccess,
): unknown {
  if (column.kind !== 'money') return row[column.key];
  if (!canViewReportAmount(access)) return REPORT_AMOUNT_MASK;
  return reportNumber(row[column.key]) ?? REPORT_AMOUNT_MASK;
}
