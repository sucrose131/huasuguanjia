export type UnitOption = {
  label: string;
  value: string | number;
};

type UnitLine = Record<string, unknown>;

export function unitNameById(units: UnitOption[] | undefined, value: unknown, fallback = '\u2014') {
  if (value === null || value === undefined || value === '' || Number(value) === 0) return fallback;
  return units?.find((item) => String(item.value) === String(value))?.label || fallback;
}

export function lineUnitName(units: UnitOption[] | undefined, line: UnitLine, fallback = '\u2014') {
  const explicit = String(line.unitName ?? line.unitTypeName ?? '').trim();
  if (explicit) return explicit;
  return unitNameById(
    units,
    line.unitType ?? line.unit_type ?? line.skuUnitType ?? line.sku_unit_type,
    fallback,
  );
}
