export const display = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value);
export const dateText = (value: unknown, time = false) => {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return time
    ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    : day;
};
/** 后端 UTC Instant → 浏览器本地墙钟，精确到分钟（业务列表创建时间等） */
export const dateTimeText = (value: unknown) => {
  const text = dateText(value, true);
  return text === '—' ? '—' : text.slice(0, 16);
};
export const moneyText = (value: unknown) => {
  const level = localStorage.getItem('hspsi_amount_access') ?? 'none';
  if (!['view', 'edit'].includes(level) || value === null || value === undefined || value === '')
    return '****';
  const num = Number(value);
  if (!Number.isFinite(num)) return '****';
  return num.toFixed(2);
};

/**
 * 记录级金额显示：masked=true（无查看权，或范围 own 且非本人创建的单据）统一渲染 `¥ ****`，
 * 否则按真实金额渲染 `¥ xx.xx`。所有单据详情/列表的金额展示应统一走这里，
 * 避免后端脱敏 null 被 `?? 0`/合计 兜成 `¥ 0.00`。
 */
export const moneyCell = (value: unknown, masked: boolean) =>
  masked ? '¥ ****' : `¥ ${moneyText(value)}`;
