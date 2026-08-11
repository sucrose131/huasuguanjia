import { describe, expect, it } from 'vitest';
import { lineUnitName, unitNameById } from './unit-name';

const units = [
  { value: 1, label: 'piece' },
  { value: '2', label: 'box' },
];

describe('unit name display', () => {
  it('maps numeric and string unit ids to their names', () => {
    expect(unitNameById(units, '1')).toBe('piece');
    expect(unitNameById(units, 2)).toBe('box');
  });

  it('prefers the unit name returned by the business API', () => {
    expect(lineUnitName(units, { unitName: 'case', unitType: 1 })).toBe('case');
  });

  it('never displays a raw unit id when the mapping is missing', () => {
    expect(lineUnitName(units, { unitType: 99 })).toBe('\u2014');
  });
});
