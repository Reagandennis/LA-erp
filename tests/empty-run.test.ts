import { describe, expect, it } from 'vitest';

import {
  EMPTY_RUN,
  emptyRunFor,
  emptyRunTitle,
  isEmptyRun,
} from '../app/modules/trip-planning/[tripId]/empty-run';
import { CATEGORY_META } from '../app/modules/trip-planning/[tripId]/categories';
import { tripItineraryItemAddSchema } from '../lib/validation';

describe('emptyRunFor', () => {
  it('heads out to a pick-up, arriving as it starts', () => {
    expect(
      emptyRunFor({
        timeLabel: 'PICK-UP',
        details: { pickupLocation: 'JKIA T1A' },
        scheduledAt: '2026-10-20T04:00:00.000Z',
        endsAt: null,
      }),
    ).toEqual({ from: '', to: 'JKIA T1A', startsAt: '2026-10-20T03:00:00.000Z', durationMinutes: 60 });
  });

  it('heads back once a drop-off ends', () => {
    expect(
      emptyRunFor({
        timeLabel: 'DROP-OFF',
        details: { dropoffLocation: 'Villa Rosa' },
        scheduledAt: '2026-10-20T15:00:00.000Z',
        endsAt: '2026-10-20T15:40:00.000Z',
      }),
    ).toEqual({ from: 'Villa Rosa', to: '', startsAt: '2026-10-20T15:40:00.000Z', durationMinutes: 60 });
  });

  it('leaves the time open when the movement has none', () => {
    expect(emptyRunFor({ timeLabel: 'PICK-UP', details: null, scheduledAt: null, endsAt: null }).startsAt).toBeNull();
  });
});

describe('empty runs', () => {
  it('are transport events labelled EMPTY RUN', () => {
    expect(isEmptyRun({ category: 'transportation', timeLabel: EMPTY_RUN })).toBe(true);
    expect(isEmptyRun({ category: 'transportation', timeLabel: 'PICK-UP' })).toBe(false);
    expect(isEmptyRun({ category: 'activity', timeLabel: EMPTY_RUN })).toBe(false);
    expect(CATEGORY_META.transportation.timeLabels).toContain(EMPTY_RUN);
  });

  it('name the route, defaulting the unnamed end to the base', () => {
    expect(emptyRunTitle('', 'JKIA T1A')).toBe('Empty run · Base → JKIA T1A');
    expect(emptyRunTitle('Villa Rosa', '')).toBe('Empty run · Villa Rosa → Base');
    expect(emptyRunTitle(' ', '')).toBe('Empty run');
  });

  it('still need a driver and a vehicle, with a distance allowed', () => {
    const add = (extra: Record<string, unknown>) =>
      tripItineraryItemAddSchema.safeParse({
        items: [{ description: 'Empty run · Base → JKIA', quantity: 1, category: 'transportation', timeLabel: EMPTY_RUN, ...extra }],
      }).success;
    expect(add({})).toBe(false);
    expect(add({ driverId: 1, vehicleId: 2, details: { pickupLocation: 'Yard', dropoffLocation: 'JKIA', distanceKm: '18' } })).toBe(true);
  });
});
