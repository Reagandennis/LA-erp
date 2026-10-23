import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIST_QUERY,
  appendTripPage,
  applyListQuery,
  formatTripDate,
  listPageSearchParams,
  listQueryKey,
  localDateKey,
  localDateKeyPlusDays,
  parseListQuery,
} from '../app/modules/trip-planning/list-model';
import type { TripSummary } from '../app/modules/trip-planning/types';

describe('trips list query in the URL', () => {
  it('reads the search, status and sort from search params or the page props', () => {
    const query = { q: 'nairobi', status: 'Active', sort: 'start-asc' } as const;
    expect(parseListQuery(new URLSearchParams('q=+nairobi+&status=Active&sort=start-asc&tab=close-out'))).toEqual(query);
    expect(parseListQuery({ q: ' nairobi ', status: 'Active', sort: 'start-asc', tab: 'close-out' })).toEqual(query);
    // A repeated param is read once.
    expect(parseListQuery({ q: ['a', 'b'] })).toEqual({ ...DEFAULT_LIST_QUERY, q: 'a' });
  });

  it('falls back to the defaults for anything unknown or missing', () => {
    expect(parseListQuery(new URLSearchParams(''))).toEqual(DEFAULT_LIST_QUERY);
    expect(parseListQuery(new URLSearchParams('status=Lost&sort=title'))).toEqual(DEFAULT_LIST_QUERY);
    expect(parseListQuery({ q: 'x'.repeat(500) }).q).toHaveLength(200);
  });

  it('writes only the non-default parts and leaves other params alone', () => {
    const params = new URLSearchParams('tab=close-out&q=old&sort=start-desc');
    applyListQuery(params, { q: '', status: 'Planned', sort: 'updated' });
    expect(params.toString()).toBe('tab=close-out&status=Planned');

    applyListQuery(params, DEFAULT_LIST_QUERY);
    expect(params.toString()).toBe('tab=close-out');
  });

  it('builds the API query for one page', () => {
    expect(listPageSearchParams({ q: 'Omar', status: 'All', sort: 'start-asc' }, 2).toString()).toBe('q=Omar&sort=start-asc&page=2');
    expect(listPageSearchParams(DEFAULT_LIST_QUERY, 1).toString()).toBe('page=1');
  });

  it('keys each distinct query differently', () => {
    const keys = new Set([
      listQueryKey(DEFAULT_LIST_QUERY),
      listQueryKey({ ...DEFAULT_LIST_QUERY, q: 'a' }),
      listQueryKey({ ...DEFAULT_LIST_QUERY, status: 'Draft' }),
      listQueryKey({ ...DEFAULT_LIST_QUERY, sort: 'start-desc' }),
    ]);
    expect(keys.size).toBe(4);
    expect(listQueryKey({ q: 'a', status: 'All', sort: 'updated' })).toBe(listQueryKey({ ...DEFAULT_LIST_QUERY, q: 'a' }));
  });
});

describe('trips list rows', () => {
  const trip = (id: number) => ({ id }) as TripSummary;

  it('appends the next page without repeating a row that shifted pages', () => {
    const merged = appendTripPage([trip(5), trip(4)], [trip(4), trip(3)]);
    expect(merged.map((t) => t.id)).toEqual([5, 4, 3]);
  });
});

describe('trips list dates', () => {
  it('shows a stored UTC-midnight date as that calendar day', () => {
    expect(formatTripDate('2026-03-01T00:00:00.000Z')).toBe('Mar 1, 2026');
    expect(formatTripDate(null)).toBe('—');
    expect(formatTripDate('not a date')).toBe('—');
  });

  it("defaults a date input to the viewer's own calendar day", () => {
    // Late evening local time: the UTC date may already be tomorrow east of Greenwich.
    const evening = new Date(2026, 9, 23, 23, 30);
    expect(localDateKey(evening)).toBe('2026-10-23');
    expect(localDateKeyPlusDays(0, evening)).toBe('2026-10-23');
    expect(localDateKeyPlusDays(7, evening)).toBe('2026-10-30');
    // Crossing a month end.
    expect(localDateKeyPlusDays(7, new Date(2026, 1, 25, 9, 0))).toBe('2026-03-04');
  });
});
