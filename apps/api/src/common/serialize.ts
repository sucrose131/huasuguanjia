export function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object' && 'toJSON' in value) {
    return serialize((value as { toJSON(): unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}
