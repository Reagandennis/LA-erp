import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { crossRate, describeRate, parseOpenErApi, type RateTable } from '@/lib/exchange-rates';
import { toCurrency } from '@/lib/reports';

const TABLE: RateTable = { base: 'USD', rates: { USD: 1, KES: 129.5, EUR: 0.9 }, asOf: '2026-10-15T00:02:31.000Z' };

describe('crossRate', () => {
  it('is 1 for the same currency, even with no table', () => {
    expect(crossRate(null, 'KES', 'KES')).toBe(1);
  });

  it('converts from the base and back to it', () => {
    expect(crossRate(TABLE, 'USD', 'KES')).toBe(129.5);
    expect(crossRate(TABLE, 'KES', 'USD')).toBeCloseTo(1 / 129.5, 10);
  });

  it('crosses two non-base currencies through the base', () => {
    expect(crossRate(TABLE, 'EUR', 'KES')).toBeCloseTo(129.5 / 0.9, 10);
  });

  it('returns null rather than guessing when a rate is missing', () => {
    expect(crossRate(null, 'USD', 'KES')).toBeNull();
    expect(crossRate(TABLE, 'GBP', 'KES')).toBeNull();
  });
});

describe('describeRate', () => {
  it('quotes from the stronger currency whichever way the report runs', () => {
    expect(describeRate('USD', 'KES', 129.5)).toBe('1 USD = 129.50 KES');
    expect(describeRate('KES', 'USD', 1 / 129.5)).toBe('1 USD = 129.50 KES');
  });
});

describe('parseOpenErApi', () => {
  const ok = { result: 'success', base_code: 'USD', time_last_update_unix: 1_791_331_351, rates: { USD: 1, KES: 129.7 } };

  it('reads base, rates and publish time', () => {
    expect(parseOpenErApi(ok)).toEqual({
      base: 'USD',
      rates: { USD: 1, KES: 129.7 },
      asOf: new Date(1_791_331_351_000).toISOString(),
    });
  });

  it('drops non-positive or non-numeric rates', () => {
    expect(parseOpenErApi({ ...ok, rates: { USD: 1, KES: 0, XYZ: 'n/a' } })?.rates).toEqual({ USD: 1 });
  });

  it('rejects error responses and malformed bodies', () => {
    expect(parseOpenErApi({ result: 'error', 'error-type': 'unsupported-code' })).toBeNull();
    expect(parseOpenErApi({ ...ok, rates: {} })).toBeNull();
    expect(parseOpenErApi(null)).toBeNull();
    expect(parseOpenErApi('nope')).toBeNull();
  });
});

describe('toCurrency', () => {
  const invoices = [
    { id: 1, currency: 'USD', total: 100, balanceDue: 40 },
    { id: 2, currency: 'KES', total: 19_300, balanceDue: 19_300 },
    { id: 3, currency: 'GBP', total: 50, balanceDue: 50 },
  ];

  it('converts the named fields into the report currency and relabels the record', () => {
    const { converted } = toCurrency(invoices, ['total', 'balanceDue'], 'KES', TABLE);
    expect(converted).toEqual([
      { id: 1, currency: 'KES', total: 12_950, balanceDue: 5_180 },
      { id: 2, currency: 'KES', total: 19_300, balanceDue: 19_300 },
    ]);
  });

  it('sets aside records with no rate instead of summing them unconverted', () => {
    expect(toCurrency(invoices, ['total'], 'KES', TABLE).skipped.map((i) => i.id)).toEqual([3]);
    expect(toCurrency(invoices, ['total'], 'KES', null).skipped.map((i) => i.id)).toEqual([1, 3]);
  });
});
