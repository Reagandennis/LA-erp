/**
 * When a car, driver or close-protection officer is spoken for.
 *
 * Pure and client-safe: the Task Assignment screen uses it to grey out busy
 * resources and draw the availability grid, and the server uses the same
 * rules to refuse a double booking, so the two never disagree.
 *
 * Everything is reckoned in calendar days ("YYYY-MM-DD" keys, inclusive at
 * both ends). A trip is occupied from its first day to its last; a single
 * itinerary movement occupies the day it happens on. Two bookings clash when
 * their days overlap — unless they are for the same trip, since one person
 * routinely works several movements of one job.
 */

export type ResourceKind = 'vehicle' | 'driver' | 'officer';

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  vehicle: 'Car',
  driver: 'Driver',
  officer: 'Officer',
};

/** One commitment of one resource. */
export interface Engagement {
  kind: ResourceKind;
  resourceId: number;
  tripId: number;
  reference: string;
  title: string;
  /** First and last occupied day, or null when the trip's dates are still TBD. */
  from: string | null;
  to: string | null;
  /** A Task Assignment allocation (whole trip) or a crewed itinerary movement (one day). */
  source: 'assignment' | 'movement';
  /** The allocation this came from, so editing it never clashes with itself. */
  assignmentId: number | null;
  /** The itinerary event, for a movement: the grid opens the trip on it. */
  itemId: number | null;
  status: string;
}

/** Where a booking lives: the trip's itinerary, opened on the event when there is one. */
export function engagementHref(e: Pick<Engagement, 'tripId' | 'itemId'>): string {
  return `/modules/trip-planning/${e.tripId}${e.itemId ? `?event=${e.itemId}` : ''}`;
}

/** The window a booking would occupy. */
export interface DateWindow {
  from: string | null;
  to: string | null;
}

/**
 * Whether two day ranges share a day. A range with no dates is unknown, and
 * an unknown range is taken to overlap everything: a trip whose dates are
 * still open could land anywhere, so its crew is held rather than silently
 * double-booked.
 */
export function windowsOverlap(a: DateWindow, b: DateWindow): boolean {
  if (!a.from || !a.to || !b.from || !b.to) return true;
  return a.from <= b.to && b.from <= a.to;
}

export interface ConflictQuery {
  kind: ResourceKind;
  resourceId: number;
  /** The trip being booked; its own other bookings never count. */
  tripId: number;
  window: DateWindow;
  /** The allocation being edited, which must not clash with itself. */
  excludeAssignmentId?: number | null;
}

/** The other bookings that stop this resource taking the trip, oldest first. */
export function conflictsFor(engagements: Engagement[], query: ConflictQuery): Engagement[] {
  return engagements
    .filter(
      (e) =>
        e.kind === query.kind &&
        e.resourceId === query.resourceId &&
        e.tripId !== query.tripId &&
        !(query.excludeAssignmentId && e.assignmentId === query.excludeAssignmentId) &&
        windowsOverlap(e, query.window),
    )
    .sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

/** "12 Nov", read from a date key without any timezone shift. */
export function formatDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return DAY_MONTH.format(new Date(Date.UTC(y!, m! - 1, d!, 12)));
}

/** "12–15 Nov", "30 Oct – 2 Nov", "12 Nov", or "dates TBD". */
export function formatWindow(window: DateWindow): string {
  if (!window.from || !window.to) return 'dates TBD';
  if (window.from === window.to) return formatDay(window.from);
  const sameMonth = window.from.slice(0, 7) === window.to.slice(0, 7);
  if (sameMonth) return `${Number(window.from.slice(8, 10))}–${formatDay(window.to)}`;
  return `${formatDay(window.from)} – ${formatDay(window.to)}`;
}

/**
 * The sentence shown when a pick is not available: who is busy, where, when,
 * and what to do about it.
 */
export function describeConflict(label: string, kind: ResourceKind, conflicts: Engagement[]): string {
  const noun = RESOURCE_KIND_LABEL[kind].toLowerCase();
  const where = conflicts
    .slice(0, 2)
    .map((c) => `${c.reference} (${formatWindow(c)})`)
    .join(' and ');
  const more = conflicts.length > 2 ? ` and ${conflicts.length - 2} more` : '';
  return `${label} is already on ${where}${more}. Pick another ${noun}.`;
}

/** Which engagements occupy each of `days` for one resource, for the availability grid. */
export function occupiedDays(
  engagements: Engagement[],
  kind: ResourceKind,
  resourceId: number,
  days: string[],
): Map<string, Engagement[]> {
  const byDay = new Map<string, Engagement[]>();
  const mine = engagements.filter((e) => e.kind === kind && e.resourceId === resourceId && e.from && e.to);
  for (const day of days) {
    const hits = mine.filter((e) => e.from! <= day && day <= e.to!);
    if (hits.length > 0) byDay.set(day, hits);
  }
  return byDay;
}

/** The date key of an instant, in UTC. Trips store their dates as UTC midnight. */
export function dateKeyOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const iso = typeof value === 'string' ? value : value.toISOString();
  return iso.slice(0, 10);
}
