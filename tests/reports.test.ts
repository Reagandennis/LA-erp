import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  bucketByMonth,
  computeAging,
  computeConversion,
  lastNMonths,
  tallyByStatus,
} from '@/lib/reports';

// Minimal shapes — the helpers only touch the fields referenced below.
type Inv = {
  status: string;
  isOverdue: boolean;
  dueDate: string;
  balanceDue: number;
};

const NOW = new Date('2026-06-16T00:00:00Z');

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

describe('bucketByMonth', () => {
  it('sums series into the matching month and ignores out-of-range items', () => {
    const months = lastNMonths(2, NOW); // 2026-05, 2026-06
    const items = [
      { when: '2026-05-10', amount: 100 },
      { when: '2026-06-01', amount: 50 },
      { when: '2026-06-20', amount: 25 },
      { when: '2026-01-01', amount: 999 }, // outside the window → dropped
      { when: null, amount: 7 }, // no date → dropped
    ];
    const rows = bucketByMonth(items, (i) => i.when, { amount: (i) => i.amount }, months);
    expect(rows).toEqual([{ amount: 100 }, { amount: 75 }]);
  });
});

describe('computeAging', () => {
  it('buckets outstanding balances by days past due and skips void/paid', () => {
    const invoices: Inv[] = [
      { status: 'Sent', isOverdue: false, dueDate: '2026-07-01', balanceDue: 100 }, // current
      { status: 'Sent', isOverdue: true, dueDate: '2026-06-01', balanceDue: 200 }, // 15d → 1-30
      { status: 'Partial', isOverdue: true, dueDate: '2026-05-01', balanceDue: 50 }, // 46d → 31-60
      { status: 'Sent', isOverdue: true, dueDate: '2026-03-01', balanceDue: 80 }, // 107d → 90+
      { status: 'Void', isOverdue: true, dueDate: '2026-01-01', balanceDue: 500 }, // skipped
      { status: 'Paid', isOverdue: false, dueDate: '2026-06-01', balanceDue: 0 }, // skipped
    ];
    const aging = computeAging(invoices as never, NOW);
    expect(aging).toEqual({ current: 100, d1_30: 200, d31_60: 50, d61_90: 0, d90plus: 80 });
  });
});

describe('computeConversion', () => {
  it('counts won/lost/open and rate = won / decided', () => {
    const quotes = [
      { status: 'Approved' },
      { status: 'Sent' },
      { status: 'Declined' },
      { status: 'Draft' },
      { status: 'Submitted' },
    ];
    const result = computeConversion(quotes as never);
    expect(result).toEqual({ won: 2, lost: 1, open: 2, rate: 67 });
  });

  it('returns rate 0 when nothing is decided', () => {
    expect(computeConversion([{ status: 'Draft' }] as never).rate).toBe(0);
  });
});

describe('tallyByStatus', () => {
  it('seeds every known status at 0 and counts occurrences', () => {
    const items = [{ status: 'Active' }, { status: 'Active' }, { status: 'Completed' }];
    expect(tallyByStatus(items, ['Active', 'Completed', 'Cancelled'])).toEqual({
      Active: 2,
      Completed: 1,
      Cancelled: 0,
    });
  });
});
