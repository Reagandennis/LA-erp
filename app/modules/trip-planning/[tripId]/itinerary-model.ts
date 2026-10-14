/**
 * Pure itinerary logic — no React, no DOM.
 *
 * Day membership used to be a function of `scheduledAt`: the client bucketed
 * items with `toISOString().slice(0, 10)` (UTC) while writing times in local
 * time, so anything scheduled before the UTC offset landed in the previous
 * day. Days are rows now and `dayId` is the bucket, which removes that whole
 * class of bug rather than patching it.
 */

import { APP_LOCALE } from '@/lib/locale';
import { addDays, dateKey, parseDateKey } from '@/lib/date-grid';

import type { TripDaySummary, TripItineraryItemSummary } from '../types';

export interface DayGroup {
  day: TripDaySummary;
  items: TripItineraryItemSummary[];
}

export interface GroupedItinerary {
  groups: DayGroup[];
  /** Items not attached to any day. */
  unscheduled: TripItineraryItemSummary[];
}

/** Within a day: timed items first in clock order, then untimed, then stable. */
export function sortDayItems(
  items: TripItineraryItemSummary[],
): TripItineraryItemSummary[] {
  return [...items].sort((a, b) => {
    const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : null;
    const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : null;
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    return a.position - b.position || a.id - b.id;
  });
}

export function groupItemsByDay(
  days: TripDaySummary[],
  items: TripItineraryItemSummary[],
): GroupedItinerary {
  const byDay = new Map<number, TripItineraryItemSummary[]>();
  const unscheduled: TripItineraryItemSummary[] = [];

  for (const item of items) {
    if (item.dayId == null) {
      unscheduled.push(item);
      continue;
    }
    const bucket = byDay.get(item.dayId);
    if (bucket) bucket.push(item);
    else byDay.set(item.dayId, [item]);
  }

  const ordered = [...days].sort((a, b) => a.dayNumber - b.dayNumber);
  return {
    groups: ordered.map((day) => ({ day, items: sortDayItems(byDay.get(day.id) ?? []) })),
    unscheduled: sortDayItems(unscheduled),
  };
}

export interface DayLabel {
  /** "MAY" */
  month: string;
  /** "13" */
  dayOfMonth: string;
  /** "Tuesday" */
  weekday: string;
  /** "May 13" — the rail's compact line. */
  short: string;
}

/** Falls back to "Day 3" when the trip has no dates yet. */
export function dayLabel(day: TripDaySummary): DayLabel {
  const parsed = day.dateKey ? parseDateKey(day.dateKey) : null;
  if (!parsed) {
    return { month: 'DAY', dayOfMonth: String(day.dayNumber), weekday: '', short: `Day ${day.dayNumber}` };
  }
  return {
    month: parsed.toLocaleDateString(APP_LOCALE, { month: 'short' }).toUpperCase(),
    dayOfMonth: String(parsed.getDate()),
    weekday: parsed.toLocaleDateString(APP_LOCALE, { weekday: 'long' }),
    short: parsed.toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric' }),
  };
}

/** The heading shown for a day in the right-hand pane. */
export function dayHeading(day: TripDaySummary): string {
  if (day.title) return day.title;
  const label = dayLabel(day);
  return label.weekday || `Day ${day.dayNumber}`;
}

/** The date a newly appended day should default to. */
export function nextDateKey(days: TripDaySummary[]): string | null {
  const dated = [...days].sort((a, b) => a.dayNumber - b.dayNumber).filter((d) => d.dateKey);
  const last = dated[dated.length - 1];
  if (!last?.dateKey) return null;
  const parsed = parseDateKey(last.dateKey);
  return parsed ? dateKey(addDays(parsed, 1)) : null;
}

/** Distinct item types on a day, in first-appearance order — the rail's chips. */
export function dayTypeChips(items: TripItineraryItemSummary[], cap = 6): string[] {
  const seen: string[] = [];
  for (const item of items) {
    if (!seen.includes(item.itemType)) seen.push(item.itemType);
    if (seen.length >= cap) break;
  }
  return seen;
}

/**
 * Where a pointer at `pointerY` should insert, given each candidate's rect.
 * Extracted from the drag hit-test so it can be tested without a DOM.
 */
export function insertionIndex(
  rects: Array<{ top: number; height: number }>,
  pointerY: number,
): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (pointerY < rect.top + rect.height / 2) return index;
  }
  return rects.length;
}

/**
 * Move an item to `toDayId` at `toIndex`, returning the full new ordering.
 *
 * **`toIndex` indexes the destination list with the dragged item already
 * removed.** That is the convention `kanban-board.tsx` uses — its
 * `computeTarget` takes the dragged id specifically so it can exclude that card
 * from the hit-test, and its ghost placeholder renders in the gap. Any drag
 * hit-test feeding this function must exclude the dragged item too, or every
 * downward move inside a day lands one slot short.
 */
export function applyReorder(
  items: TripItineraryItemSummary[],
  itemId: number,
  toDayId: number | null,
  toIndex: number,
): TripItineraryItemSummary[] {
  const moving = items.find((item) => item.id === itemId);
  if (!moving) return items;

  const sameDay = items.filter((item) => item.dayId === toDayId && item.id !== itemId);
  const others = items.filter((item) => item.dayId !== toDayId && item.id !== itemId);

  const target = Math.max(0, Math.min(toIndex, sameDay.length));
  const reordered = [...sameDay];
  reordered.splice(target, 0, { ...moving, dayId: toDayId });

  return [
    ...others,
    ...reordered.map((item, index) => ({ ...item, position: index })),
  ];
}

/** The payload for the reorder endpoint: only the days that actually changed. */
export function reorderPayload(
  items: TripItineraryItemSummary[],
  touchedDayIds: Array<number | null>,
): Array<{ dayId: number | null; itemIds: number[] }> {
  const unique = Array.from(new Set(touchedDayIds));
  return unique.map((dayId) => ({
    dayId,
    itemIds: sortDayItems(items.filter((item) => item.dayId === dayId)).map((item) => item.id),
  }));
}
