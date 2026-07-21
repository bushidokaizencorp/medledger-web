import { describe, it, expect } from 'vitest';
import {
  toCents, fromCents, toUnits4, fromUnits4, lineNetCents,
  splitVatInclusive, addVatExclusive, pctOfCents,
} from '../src/lib/money.js';

describe('money — 2dp amounts', () => {
  it('round-trips cents', () => {
    expect(fromCents(toCents('2500.00'))).toBe('2500.00');
    expect(toCents('2500.00')).toBe(250000);
  });
  it('avoids the float trap', () => {
    expect(fromCents(toCents('0.1') + toCents('0.2'))).toBe('0.30');
  });
});

describe('money — 4dp unit values', () => {
  it('round-trips units4', () => {
    expect(toUnits4('1.2345')).toBe(12345);
    expect(fromUnits4(12345)).toBe('1.2345');
  });
  it('computes a line at 4dp precision, committing at 2dp', () => {
    // 12.5 units @ 3.3333 = 41.66625 -> 41.67
    expect(fromCents(lineNetCents(toUnits4('12.5'), toUnits4('3.3333')))).toBe('41.67');
  });
  it('handles fractional unit prices exactly (per-tablet costing)', () => {
    // 1000 tablets @ 0.0125 = 12.50
    expect(fromCents(lineNetCents(toUnits4('1000'), toUnits4('0.0125')))).toBe('12.50');
  });
});

describe('VAT', () => {
  it('splits a VAT-inclusive gross', () => {
    const { netCents, vatCents } = splitVatInclusive(toCents('115.00'), 15);
    expect(fromCents(netCents)).toBe('100.00');
    expect(fromCents(vatCents)).toBe('15.00');
  });
  it('adds VAT to an exclusive net', () => {
    const { netCents, vatCents } = addVatExclusive(toCents('100.00'), 15);
    expect(fromCents(netCents)).toBe('100.00');
    expect(fromCents(vatCents)).toBe('15.00');
  });
  it('inclusive then reconstruct equals the original gross', () => {
    const gross = toCents('57.49');
    const { netCents, vatCents } = splitVatInclusive(gross, 15);
    expect(netCents + vatCents).toBe(gross); // no cent lost to rounding
  });
});
