import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: {} }));

import {
  computeConversion,
  lastNMonths,
  sumAgingGroups,
  sumMonthGroups,
  tallyStatusCounts,
  toCurrency,
} from '@/lib/reports';
import type { RateTable } from '@/lib/exchange-rates';

const NOW = new Date('2026-06-16T00:00:00Z');

const TABLE: RateTable = { base: 'USD', rates: { USD: 1, KES: 130 }, asOf: '2026-06-15T00:00:00.000Z' };

describe('lastNMonths', () => {
  it('returns n months ending with the month of `now`, oldest first', () => {
    const months = lastNMonths(3, NOW);
    expect(months.map((m) => m.key)).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('crosses year boundaries correctly', () => {
    const months = lastNMonths(3, new Date('2026-01-15T00:00:00Z'));
    expect(months.map((m) => m.key)).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('sumMonthGroups', () => {
  it('lays per-currency month sums onto the window, zero-filling and dropping months outside it', () => {
    const months = lastNMonths(2, NOW); // 2026-05, 2026-06
    const rows = [
      { month: '2026-05', amount: 100 },
      { month: '2026-06', amount: 50 },
      { month: '2026-06', amount: 25.555 }, // a second currency's group for the same month
      { month: '2026-01', amount: 999 }, // outside the window → dropped
    ];
    expect(sumMonthGroups(rows, ['amount'], months)).toEqual([{ amount: 100 }, { amount: 75.56 }]);
  });

  it('converts each group before summing, so a shilling month and a dollar month add up', () => {
    const months = lastNMonths(1, NOW);
    const rows = toCurrency(
      [
        { currency: 'USD', month: '2026-06', billed: 10 },
        { currency: 'KES', month: '2026-06', billed: 1300 },
      ],
      ['billed'],
      'USD',
      TABLE,
    ).converted;
    expect(sumMonthGroups(rows, ['billed'], months)).toEqual([{ billed: 20 }]);
  });
});

describe('sumAgingGroups', () => {
  it('adds per-currency bucket balances into the five buckets and ignores unknown buckets', () => {
    const rows = [
      { bucket: 'current', balance: 100 },
      { bucket: 'd1_30', balance: 200 },
      { bucket: 'd1_30', balance: 0.005 },
      { bucket: 'd31_60', balance: 50 },
      { bucket: 'd90plus', balance: 80 },
      { bucket: 'nonsense', balance: 999 },
    ];
    expect(sumAgingGroups(rows)).toEqual({ current: 100, d1_30: 200.01, d31_60: 50, d61_90: 0, d90plus: 80 });
  });
});

describe('computeConversion', () => {
  it('counts won/lost/open from status counts and rate = won / decided', () => {
    const result = computeConversion({ Approved: 1, Sent: 1, Declined: 1, Draft: 1, Submitted: 1, Expired: 0 });
    expect(result).toEqual({ won: 2, lost: 1, open: 2, rate: 67 });
  });

  it('returns rate 0 when nothing is decided', () => {
    expect(computeConversion({ Draft: 1 }).rate).toBe(0);
  });
});

describe('tallyStatusCounts', () => {
  it('seeds every known status at 0 and keeps statuses the seed did not know', () => {
    const groups = [
      { status: 'Active', count: 2 },
      { status: 'Completed', count: 1 },
      { status: 'Pending Approval', count: 3 },
    ];
    expect(tallyStatusCounts(groups, ['Active', 'Completed', 'Cancelled'])).toEqual({
      Active: 2,
      Completed: 1,
      Cancelled: 0,
      'Pending Approval': 3,
    });
  });
});
