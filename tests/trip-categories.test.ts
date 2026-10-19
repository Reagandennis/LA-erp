import { describe, expect, it } from 'vitest';

import {
  CATEGORY_META,
  TRIP_ITEM_CATEGORIES,
  categoryMeta,
  detailSummary,
  isTripItemCategory,
  mapLegacyItemType,
  pruneDetails,
} from '../app/modules/trip-planning/[tripId]/categories';
import { tripItemDetailsSchema } from '../lib/validation';

describe('categories', () => {
  it('offers flights first and transport beside them, without cruises', () => {
    expect(TRIP_ITEM_CATEGORIES).toEqual([
      'flight', 'transportation', 'activity', 'lodging',
      'tour', 'booking', 'information',
    ]);
  });

  it('gives each category its own fields — they are not interchangeable', () => {
    const keysFor = (c: keyof typeof CATEGORY_META) =>
      CATEGORY_META[c].fields.map((f) => f.key);

    expect(keysFor('flight')).toContain('flightNumber');
    expect(keysFor('flight')).toContain('departAirport');
    expect(keysFor('lodging')).toContain('roomType');
    expect(keysFor('lodging')).toContain('nights');
    expect(keysFor('transportation')).toContain('pickupLocation');
    expect(keysFor('tour')).toContain('meetingPoint');
    expect(keysFor('booking')).toContain('bookingRef');

    // The actual complaint: these must not be the same form.
    expect(keysFor('flight')).not.toEqual(keysFor('lodging'));
    expect(keysFor('lodging')).not.toEqual(keysFor('transportation'));
  });

  it('labels the title field for what the category actually is', () => {
    expect(CATEGORY_META.flight.titleLabel).toBe('Route');
    expect(CATEGORY_META.lodging.titleLabel).toBe('Property');
    expect(CATEGORY_META.flight.providerLabel).toBe('Airline');
    expect(CATEGORY_META.lodging.providerLabel).toBe('Chain / brand');
    // An activity has no supplier field to fill in.
    expect(CATEGORY_META.activity.providerLabel).toBeNull();
  });

  it('offers time labels that suit the category', () => {
    expect(CATEGORY_META.flight.timeLabels).toContain('ARRIVAL');
    expect(CATEGORY_META.lodging.timeLabels).toContain('CHECK-IN');
    expect(CATEGORY_META.transportation.timeLabels).toContain('PICK-UP');
    expect(CATEGORY_META.information.timeLabels).toEqual([]);
  });
});

describe('mapLegacyItemType', () => {
  // Must match the CASE in the trip_item_categories migration exactly, or
  // backfilled rows render under the wrong icon and the wrong form.
  it('maps every legacy value the old editor could produce', () => {
    expect(mapLegacyItemType('flight')).toBe('flight');
    expect(mapLegacyItemType('car')).toBe('transportation');
    expect(mapLegacyItemType('hotel')).toBe('lodging');
    expect(mapLegacyItemType('location')).toBe('activity');
    expect(mapLegacyItemType('activity')).toBe('activity');
  });

  it('falls back to activity for anything unrecognised', () => {
    expect(mapLegacyItemType('nonsense')).toBe('activity');
    expect(mapLegacyItemType('')).toBe('activity');
  });
});

describe('pruneDetails', () => {
  it('keeps only what the category declares', () => {
    const pruned = pruneDetails('flight', { flightNumber: 'KQ 762', roomType: 'Suite' });
    expect(pruned).toEqual({ flightNumber: 'KQ 762' });
  });

  it('drops empty values so blank inputs are not persisted', () => {
    expect(pruneDetails('flight', { flightNumber: '   ', gate: '' })).toBeNull();
  });

  it('returns null when a category has no fields at all', () => {
    expect(pruneDetails('information', { anything: 'x' })).toBeNull();
  });

  it('is what stops a stale flight number surviving a switch to lodging', () => {
    expect(pruneDetails('lodging', { flightNumber: 'KQ 762', nights: '3' }))
      .toEqual({ nights: '3' });
  });

  it('coerces numbers to strings', () => {
    expect(pruneDetails('lodging', { nights: 3 })).toEqual({ nights: '3' });
  });
});

describe('detailSummary', () => {
  it('reads a flight the way a flight reads', () => {
    expect(detailSummary('flight', { flightNumber: 'KQ 762', seat: '14A', gate: '7' }))
      .toBe('KQ 762 · Gate 7 · Seat 14A');
  });

  it('reads a hotel the way a hotel reads', () => {
    expect(detailSummary('lodging', { roomType: 'Deluxe double', nights: '3', guests: '2' }))
      .toBe('Deluxe double · 3 nights · 2 guests');
  });

  it('singularises a one-night stay', () => {
    expect(detailSummary('lodging', { nights: '1' })).toBe('1 night');
  });

  it('is empty when there is nothing to say', () => {
    expect(detailSummary('activity', null)).toBe('');
    expect(detailSummary('activity', {})).toBe('');
  });
});

describe('details validation', () => {
  it('accepts a well-formed flight payload', () => {
    expect(tripItemDetailsSchema.safeParse({ flightNumber: 'KQ 762', seat: '14A' }).success)
      .toBe(true);
  });

  it('rejects a key no category declares', () => {
    expect(tripItemDetailsSchema.safeParse({ totallyMadeUp: 'x' }).success).toBe(false);
  });

  it('accepts an empty details object', () => {
    expect(tripItemDetailsSchema.safeParse({}).success).toBe(true);
  });
});

describe('categoryMeta', () => {
  it('falls back to activity rather than throwing on unknown input', () => {
    expect(categoryMeta('who-knows')).toBe(CATEGORY_META.activity);
  });

  it('recognises valid categories', () => {
    expect(isTripItemCategory('lodging')).toBe(true);
    expect(isTripItemCategory('hotel')).toBe(false);
  });
});
