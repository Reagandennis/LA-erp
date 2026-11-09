import { describe, expect, it } from 'vitest';

import {
  conflictsFor,
  dateKeyOf,
  describeConflict,
  type Engagement,
  formatWindow,
  occupiedDays,
  windowsOverlap,
} from '../lib/resource-availability';

function booking(partial: Partial<Engagement> & Pick<Engagement, 'tripId' | 'from' | 'to'>): Engagement {
  return {
    kind: 'vehicle',
    resourceId: 30,
    reference: `TR-${partial.tripId}`,
    title: 'Trip',
    source: 'assignment',
    assignmentId: partial.tripId * 10,
    itemId: null,
    status: 'Confirmed',
    ...partial,
  };
}

describe('windowsOverlap', () => {
  it('counts shared days, inclusive at both ends', () => {
    expect(windowsOverlap({ from: '2026-11-10', to: '2026-11-14' }, { from: '2026-11-14', to: '2026-11-20' })).toBe(true);
    expect(windowsOverlap({ from: '2026-11-10', to: '2026-11-14' }, { from: '2026-11-15', to: '2026-11-20' })).toBe(false);
    expect(windowsOverlap({ from: '2026-11-12', to: '2026-11-12' }, { from: '2026-11-10', to: '2026-11-14' })).toBe(true);
  });

  it('treats a trip without dates as overlapping everything', () => {
    expect(windowsOverlap({ from: null, to: null }, { from: '2026-11-10', to: '2026-11-14' })).toBe(true);
    expect(windowsOverlap({ from: '2026-11-10', to: '2026-11-14' }, { from: '2026-11-01', to: null })).toBe(true);
  });
});

describe('conflictsFor', () => {
  const engagements: Engagement[] = [
    booking({ tripId: 1, from: '2026-11-10', to: '2026-11-14' }),
    booking({ tripId: 2, from: '2026-11-20', to: '2026-11-22' }),
    booking({ tripId: 3, from: '2026-11-13', to: '2026-11-13', source: 'movement', assignmentId: null }),
    booking({ tripId: 4, from: '2026-11-12', to: '2026-11-12', kind: 'driver', resourceId: 30 }),
  ];

  it('returns only this resource’s bookings on other trips that share a day, oldest first', () => {
    const found = conflictsFor(engagements, {
      kind: 'vehicle',
      resourceId: 30,
      tripId: 9,
      window: { from: '2026-11-13', to: '2026-11-21' },
    });
    expect(found.map((e) => e.tripId)).toEqual([1, 3, 2]);
  });

  it('ignores the same trip, so one car can work several of its movements', () => {
    const found = conflictsFor(engagements, {
      kind: 'vehicle',
      resourceId: 30,
      tripId: 1,
      window: { from: '2026-11-10', to: '2026-11-14' },
    });
    expect(found.map((e) => e.tripId)).toEqual([3]);
  });

  it('never clashes an allocation with itself while it is being edited', () => {
    const found = conflictsFor(engagements, {
      kind: 'vehicle',
      resourceId: 30,
      tripId: 9,
      window: { from: '2026-11-10', to: '2026-11-11' },
      excludeAssignmentId: 10,
    });
    expect(found).toEqual([]);
  });

  it('leaves a resource free when the dates do not touch', () => {
    const found = conflictsFor(engagements, {
      kind: 'vehicle',
      resourceId: 30,
      tripId: 9,
      window: { from: '2026-11-15', to: '2026-11-19' },
    });
    expect(found).toEqual([]);
  });
});

describe('formatting', () => {
  it('prints a window compactly', () => {
    expect(formatWindow({ from: '2026-11-12', to: '2026-11-15' })).toBe('12–15 Nov');
    expect(formatWindow({ from: '2026-10-30', to: '2026-11-02' })).toBe('30 Oct – 2 Nov');
    expect(formatWindow({ from: '2026-11-12', to: '2026-11-12' })).toBe('12 Nov');
    expect(formatWindow({ from: null, to: null })).toBe('dates TBD');
  });

  it('tells the user who is busy, where, and what to do', () => {
    const text = describeConflict('Car KDA 123A', 'vehicle', [
      booking({ tripId: 1, from: '2026-11-10', to: '2026-11-14' }),
      booking({ tripId: 2, from: '2026-11-20', to: '2026-11-22' }),
      booking({ tripId: 3, from: '2026-11-25', to: '2026-11-25' }),
    ]);
    expect(text).toBe('Car KDA 123A is already on TR-1 (10–14 Nov) and TR-2 (20–22 Nov) and 1 more. Pick another car.');
  });

  it('reads a date key off a stored UTC-midnight date', () => {
    expect(dateKeyOf(new Date('2026-11-12T00:00:00.000Z'))).toBe('2026-11-12');
    expect(dateKeyOf('2026-11-12T21:30:00.000Z')).toBe('2026-11-12');
    expect(dateKeyOf(null)).toBeNull();
  });
});

describe('occupiedDays', () => {
  it('maps each grid day to the bookings covering it, skipping undated ones', () => {
    const days = ['2026-11-11', '2026-11-12', '2026-11-13'];
    const byDay = occupiedDays(
      [
        booking({ tripId: 1, from: '2026-11-12', to: '2026-11-13' }),
        booking({ tripId: 2, from: '2026-11-13', to: '2026-11-13', source: 'movement', assignmentId: null }),
        booking({ tripId: 3, from: null, to: null }),
        booking({ tripId: 4, from: '2026-11-11', to: '2026-11-11', resourceId: 31 }),
      ],
      'vehicle',
      30,
      days,
    );
    expect([...byDay.keys()]).toEqual(['2026-11-12', '2026-11-13']);
    expect(byDay.get('2026-11-13')!.map((e) => e.tripId)).toEqual([1, 2]);
  });
});

describe('engagementHref', () => {
  it('opens the trip on the event for a movement, and the trip itself for an allocation', async () => {
    const { engagementHref } = await import('../lib/resource-availability');
    expect(engagementHref({ tripId: 9, itemId: 501 })).toBe('/modules/trip-planning/9?event=501');
    expect(engagementHref({ tripId: 9, itemId: null })).toBe('/modules/trip-planning/9');
  });
});
