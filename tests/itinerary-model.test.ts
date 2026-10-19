import { describe, expect, it } from 'vitest';

import {
  applyReorder,
  dayHeading,
  dayLabel,
  dayTypeChips,
  groupItemsByDay,
  insertionIndex,
  nextDateKey,
  reorderPayload,
  sortDayItems,
} from '../app/modules/trip-planning/[tripId]/itinerary-model';
import type { TripDaySummary, TripItineraryItemSummary } from '../app/modules/trip-planning/types';

function day(id: number, dayNumber: number, dateKey: string | null = null, title: string | null = null): TripDaySummary {
  return { id, dayNumber, dateKey, title, summary: null };
}

function item(
  id: number,
  dayId: number | null,
  position: number,
  extra: Partial<TripItineraryItemSummary> = {},
): TripItineraryItemSummary {
  return {
    id,
    dayId,
    position,
    itemType: 'activity',
    category: 'activity',
    body: null,
    timeLabel: null,
    providerName: null,
    bookingUrl: null,
    phone: null,
    placeName: null,
    address: null,
    details: null,
    description: `Item ${id}`,
    subtitle: null,
    quantity: 1,
    unitPrice: null,
    completedAt: null,
    sourceQuoteItemId: null,
    scheduledAt: null,
    endsAt: null,
    durationMinutes: null,
    reminderMinutesBefore: null,
    reminderAt: null,
    imageUrl: null,
    confirmationCode: null,
    attachments: [],
    driver: null,
    officer: null,
    vehicle: null,
    ...extra,
  };
}

describe('groupItemsByDay', () => {
  it('buckets on dayId, never on the timestamp', () => {
    // The old client bucketed by UTC date while writing local times, so an
    // 01:00 event fell into the previous day. dayId makes that impossible.
    const days = [day(1, 1, '2026-05-13'), day(2, 2, '2026-05-14')];
    const items = [
      item(10, 2, 0, { scheduledAt: '2026-05-13T22:30:00.000Z' }),
      item(11, 1, 0, { scheduledAt: '2026-05-14T01:00:00.000Z' }),
    ];
    const { groups } = groupItemsByDay(days, items);
    expect(groups[0].items.map((i) => i.id)).toEqual([11]);
    expect(groups[1].items.map((i) => i.id)).toEqual([10]);
  });

  it('keeps empty days — the whole point of persisting them', () => {
    const { groups } = groupItemsByDay([day(1, 1), day(2, 2)], []);
    expect(groups).toHaveLength(2);
    expect(groups[1].items).toEqual([]);
  });

  it('collects dayless items into the unscheduled tray', () => {
    const { groups, unscheduled } = groupItemsByDay([day(1, 1)], [item(5, null, 0), item(6, 1, 0)]);
    expect(unscheduled.map((i) => i.id)).toEqual([5]);
    expect(groups[0].items.map((i) => i.id)).toEqual([6]);
  });

  it('orders groups by dayNumber regardless of input order', () => {
    const { groups } = groupItemsByDay([day(9, 3), day(4, 1), day(7, 2)], []);
    expect(groups.map((g) => g.day.dayNumber)).toEqual([1, 2, 3]);
  });
});

describe('sortDayItems', () => {
  it('puts timed items in clock order ahead of untimed ones', () => {
    const sorted = sortDayItems([
      item(1, 1, 0),
      item(2, 1, 1, { scheduledAt: '2026-05-13T15:00:00.000Z' }),
      item(3, 1, 2, { scheduledAt: '2026-05-13T09:00:00.000Z' }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it('falls back to position then id for untimed items', () => {
    const sorted = sortDayItems([item(8, 1, 2), item(3, 1, 1), item(5, 1, 1)]);
    expect(sorted.map((i) => i.id)).toEqual([3, 5, 8]);
  });
});

describe('applyReorder', () => {
  const items = [item(1, 10, 0), item(2, 10, 1), item(3, 10, 2)];

  // toIndex indexes the destination list with the dragged item already removed,
  // matching kanban-board's computeTarget. These two pin that convention down:
  // get it wrong and every downward move inside a day lands one slot short.
  it('moves an item to the end of its own day', () => {
    const next = applyReorder(items, 1, 10, 2);
    expect(next.filter((i) => i.dayId === 10).sort((a, b) => a.position - b.position).map((i) => i.id))
      .toEqual([2, 3, 1]);
  });

  it('moves an item down by exactly one slot', () => {
    const next = applyReorder(items, 1, 10, 1);
    expect(next.sort((a, b) => a.position - b.position).map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it('moves an item up within its own day', () => {
    const next = applyReorder(items, 3, 10, 0);
    expect(next.sort((a, b) => a.position - b.position).map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it('is a no-op when dropped back where it started', () => {
    const next = applyReorder(items, 2, 10, 1);
    expect(next.sort((a, b) => a.position - b.position).map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('moves an item to another day and renumbers both', () => {
    const mixed = [...items, item(4, 20, 0)];
    const next = applyReorder(mixed, 1, 20, 0);
    const moved = next.find((i) => i.id === 1)!;
    expect(moved.dayId).toBe(20);
    expect(moved.position).toBe(0);
    expect(next.filter((i) => i.dayId === 20).map((i) => i.position).sort()).toEqual([0, 1]);
  });

  it('moves an item into an empty day', () => {
    const next = applyReorder(items, 2, 99, 0);
    expect(next.find((i) => i.id === 2)).toMatchObject({ dayId: 99, position: 0 });
  });

  it('moves an item to the unscheduled tray', () => {
    const next = applyReorder(items, 2, null, 0);
    expect(next.find((i) => i.id === 2)).toMatchObject({ dayId: null, position: 0 });
  });

  it('clamps an out-of-range index instead of leaving a hole', () => {
    const next = applyReorder(items, 1, 10, 99);
    expect(next.sort((a, b) => a.position - b.position).map((i) => i.id)).toEqual([2, 3, 1]);
  });

  it('returns the list untouched for an unknown id', () => {
    expect(applyReorder(items, 404, 10, 0)).toBe(items);
  });
});

describe('insertionIndex', () => {
  const rects = [
    { top: 0, height: 40 },
    { top: 40, height: 40 },
    { top: 80, height: 40 },
  ];

  it('inserts before a card once the pointer passes its midpoint', () => {
    expect(insertionIndex(rects, 5)).toBe(0);
    expect(insertionIndex(rects, 25)).toBe(1);
    expect(insertionIndex(rects, 65)).toBe(2);
  });

  it('appends past the last midpoint', () => {
    expect(insertionIndex(rects, 500)).toBe(3);
  });

  it('returns 0 for an empty list', () => {
    expect(insertionIndex([], 100)).toBe(0);
  });
});

describe('reorderPayload', () => {
  it('sends only the days that were touched, in order', () => {
    const items = [item(1, 10, 0), item(2, 10, 1), item(3, 20, 0)];
    expect(reorderPayload(items, [10])).toEqual([{ dayId: 10, itemIds: [1, 2] }]);
  });

  it('dedupes when a move touches the same day twice', () => {
    const items = [item(1, 10, 0)];
    expect(reorderPayload(items, [10, 10])).toHaveLength(1);
  });

  it('handles the unscheduled tray', () => {
    const items = [item(1, null, 0)];
    expect(reorderPayload(items, [null])).toEqual([{ dayId: null, itemIds: [1] }]);
  });
});

describe('labels', () => {
  it('reads the local calendar day out of a date key, in any timezone', () => {
    const label = dayLabel(day(1, 1, '2026-05-13'));
    expect(label.dayOfMonth).toBe('13');
    expect(label.weekday).toBe('Wednesday');
  });

  it('falls back to a day number when the trip has no dates', () => {
    expect(dayLabel(day(1, 3)).short).toBe('Day 3');
    expect(dayHeading(day(1, 3))).toBe('Day 3');
  });

  it('prefers a custom day title for the heading', () => {
    expect(dayHeading(day(1, 1, '2026-05-13', 'Welcome to Los Angeles')))
      .toBe('Welcome to Los Angeles');
  });

  it('suggests the next date after the last dated day', () => {
    expect(nextDateKey([day(1, 1, '2026-05-13'), day(2, 2, '2026-05-14')])).toBe('2026-05-15');
    expect(nextDateKey([])).toBeNull();
  });

  it('crosses a month boundary when suggesting the next date', () => {
    expect(nextDateKey([day(1, 1, '2026-05-31')])).toBe('2026-06-01');
  });
});

describe('dayTypeChips', () => {
  it('dedupes types in first-appearance order', () => {
    const chips = dayTypeChips([
      item(1, 1, 0, { itemType: 'flight' }),
      item(2, 1, 1, { itemType: 'hotel' }),
      item(3, 1, 2, { itemType: 'flight' }),
    ]);
    expect(chips).toEqual(['flight', 'hotel']);
  });

  it('caps the chip row', () => {
    const many = ['flight', 'car', 'hotel', 'location', 'activity'] as const;
    const chips = dayTypeChips(many.map((t, i) => item(i, 1, i, { itemType: t })), 3);
    expect(chips).toHaveLength(3);
  });
});
