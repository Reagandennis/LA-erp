import { APP_LOCALE } from '@/lib/locale';

import { TRIP_SORTS, TRIP_STATUSES, type TripSort, type TripStatus, type TripStatusFilter, type TripSummary } from './types';

/**
 * What the Trips list is showing: the search box (settled), the status pill
 * and the sort. It lives in the URL so a refresh, a shared link or coming
 * back from an itinerary lands on the same view.
 */
export interface TripListQuery {
  q: string;
  status: TripStatusFilter;
  sort: TripSort;
}

export const DEFAULT_LIST_QUERY: TripListQuery = { q: '', status: 'All', sort: 'updated' };

export const TRIP_SORT_OPTIONS: { value: TripSort; label: string }[] = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'start-asc', label: 'Starting soonest' },
  { value: 'start-desc', label: 'Starting latest' },
];

export const STATUS_FILTERS: TripStatusFilter[] = ['All', ...TRIP_STATUSES];

type ParamSource = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

function readParam(source: ParamSource, name: string): string | null {
  if (typeof (source as { get?: unknown }).get === 'function') {
    return (source as { get(name: string): string | null }).get(name);
  }
  const value = (source as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** The list query in a URL's search params (or Next's `searchParams` object); anything unknown falls back. */
export function parseListQuery(source: ParamSource): TripListQuery {
  const q = (readParam(source, 'q') ?? '').trim().slice(0, 200);
  const status = readParam(source, 'status');
  const sort = readParam(source, 'sort');
  return {
    q,
    status: status && (TRIP_STATUSES as string[]).includes(status) ? (status as TripStatus) : 'All',
    sort: sort && (TRIP_SORTS as string[]).includes(sort) ? (sort as TripSort) : 'updated',
  };
}

/** Writes the query onto `params`, leaving other keys (such as `tab`) alone; defaults are omitted. */
export function applyListQuery(params: URLSearchParams, query: TripListQuery): URLSearchParams {
  if (query.q) params.set('q', query.q);
  else params.delete('q');
  if (query.status !== 'All') params.set('status', query.status);
  else params.delete('status');
  if (query.sort !== 'updated') params.set('sort', query.sort);
  else params.delete('sort');
  return params;
}

/** The `/api/trips` query string for one page of this query. */
export function listPageSearchParams(query: TripListQuery, page: number): URLSearchParams {
  const params = applyListQuery(new URLSearchParams(), query);
  params.set('page', String(page));
  return params;
}

/** Identifies one query, so rows loaded for another are never shown as its own. */
export function listQueryKey(query: TripListQuery): string {
  return `${query.sort}\u0000${query.status}\u0000${query.q}`;
}

/** Appends a later page to the rows loaded so far, dropping any row already shown (rows can shift between pages). */
export function appendTripPage(current: TripSummary[], next: TripSummary[]): TripSummary[] {
  const seen = new Set(current.map((t) => t.id));
  return [...current, ...next.filter((t) => !seen.has(t.id))];
}

/**
 * Trip dates are stored as UTC midnight, so they are read back in UTC: the
 * same calendar day everywhere, and the same on the server as in the browser.
 */
export function formatTripDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** "YYYY-MM-DD" of a moment in the viewer's own calendar, for a date input's default. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The viewer's calendar date `days` from `from` (default now). */
export function localDateKeyPlusDays(days: number, from: Date = new Date()): string {
  const copy = new Date(from);
  copy.setHours(12, 0, 0, 0);
  copy.setDate(copy.getDate() + days);
  return localDateKey(copy);
}
