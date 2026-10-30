import { describe, expect, it } from 'vitest';

import { findTimeClash } from '../app/modules/trip-planning/[tripId]/itinerary-model';

const items = [
  { id: 1, scheduledAt: '2026-11-02T06:00:00.000Z', description: 'Airport pickup' },
  { id: 2, scheduledAt: '2026-11-02T06:00:30.000Z', description: 'Meet and greet' },
  { id: 3, scheduledAt: null, description: 'Unscheduled note' },
];

describe('findTimeClash', () => {
  it('finds another event at the same minute', () => {
    expect(findTimeClash('2026-11-02T06:00:00.000Z', items)?.id).toBe(1);
    expect(findTimeClash('2026-11-02T06:00:59.000Z', items)?.id).toBe(1);
    expect(findTimeClash('2026-11-02T06:01:00.000Z', items)).toBeNull();
  });

  it('never reports the event being edited, nor anything without a time', () => {
    expect(findTimeClash('2026-11-02T06:00:00.000Z', items, 1)?.id).toBe(2);
    expect(findTimeClash('2026-11-02T06:00:00.000Z', items.slice(0, 1), 1)).toBeNull();
    expect(findTimeClash(null, items)).toBeNull();
    expect(findTimeClash('not a date', items)).toBeNull();
  });
});
