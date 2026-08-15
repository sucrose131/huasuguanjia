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
export const moneyText = (value: unknown) => {
  const level = localStorage.getItem('hspsi_amount_access') ?? 'none';
  if (!['view', 'edit'].includes(level) || value === null || value === undefined) return '****';
  return Number(value).toFixed(2);
};
