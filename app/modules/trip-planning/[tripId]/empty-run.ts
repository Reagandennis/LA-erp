import type { TripItineraryItemSummary } from '../types';

/**
 * An empty run: the vehicle moving with no passenger — out to a pick-up, or
 * back after a drop-off. A transport event whose time label says so.
 */
export const EMPTY_RUN = 'EMPTY RUN';

/** A first guess at the drive; the form shows when it arrives, so it's easy to correct. */
export const DEFAULT_EMPTY_RUN_MINUTES = 60;

export function isEmptyRun(item: { category: string; timeLabel: string | null }): boolean {
  return item.category === 'transportation' && item.timeLabel === EMPTY_RUN;
}

/**
 * The empty run that goes with a pick-up (getting there, arriving as it
 * starts) or a drop-off (heading back once it ends). The other end is the
 * base, which is typed in.
 */
export function emptyRunFor(
  item: Pick<TripItineraryItemSummary, 'timeLabel' | 'details' | 'scheduledAt' | 'endsAt'>,
  minutes: number = DEFAULT_EMPTY_RUN_MINUTES,
): { from: string; to: string; startsAt: string | null; durationMinutes: number } {
  const details = item.details ?? {};
  if (item.timeLabel === 'DROP-OFF') {
    return { from: details.dropoffLocation ?? '', to: '', startsAt: item.endsAt ?? item.scheduledAt, durationMinutes: minutes };
  }
  const startsAt = item.scheduledAt
    ? new Date(new Date(item.scheduledAt).getTime() - minutes * 60_000).toISOString()
    : null;
  return { from: '', to: details.pickupLocation ?? '', startsAt, durationMinutes: minutes };
}

/** "Empty run · Base → JKIA T1A" */
export function emptyRunTitle(from: string, to: string): string {
  const start = from.trim();
  const end = to.trim();
  if (!start && !end) return 'Empty run';
  return `Empty run · ${start || 'Base'} → ${end || 'Base'}`;
}
