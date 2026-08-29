import { describe, expect, it } from 'vitest';

import {
  flightCountdown,
  flightPhase,
  flightPunctuality,
  formatDuration,
  minutesBetween,
  normalizeFlightNumber,
} from '../lib/flight-status';

const iso = (h: number, m = 0) => new Date(2026, 4, 13, h, m, 0, 0).toISOString();
const at = (h: number, m = 0) => new Date(2026, 4, 13, h, m, 0, 0).getTime();

describe('flightPunctuality', () => {
  it('calls a flight on time inside the 15-minute convention', () => {
    expect(flightPunctuality(iso(11, 45), iso(11, 45)).status).toBe('ontime');
    expect(flightPunctuality(iso(11, 45), iso(11, 59)).status).toBe('ontime');
    expect(flightPunctuality(iso(11, 45), iso(11, 31)).status).toBe('ontime');
  });

  it('calls it late past the tolerance, with the delta', () => {
    const result = flightPunctuality(iso(11, 45), iso(12, 20));
    expect(result.status).toBe('late');
    expect(result.deltaMinutes).toBe(35);
    expect(result.label).toBe('35 min late');
  });

  it('calls it early past the tolerance', () => {
    const result = flightPunctuality(iso(11, 45), iso(11, 10));
    expect(result.status).toBe('early');
    expect(result.deltaMinutes).toBe(-35);
    expect(result.label).toBe('35 min early');
  });

  it('says unknown rather than guessing when data is missing', () => {
    // An itinerary with no arrival time cannot know if a flight is late.
    expect(flightPunctuality(null, iso(11, 45)).status).toBe('unknown');
    expect(flightPunctuality(iso(11, 45), null).status).toBe('unknown');
    expect(flightPunctuality('not a date', iso(11, 45)).status).toBe('unknown');
  });
});

describe('flightPhase', () => {
  it('walks scheduled → departing → airborne → landed', () => {
    expect(flightPhase(at(2), iso(7), iso(11))).toBe('scheduled');
    expect(flightPhase(at(6, 30), iso(7), iso(11))).toBe('departing');
    expect(flightPhase(at(9), iso(7), iso(11))).toBe('airborne');
    expect(flightPhase(at(12), iso(7), iso(11))).toBe('landed');
  });

  it('treats the hour before departure as departing', () => {
    expect(flightPhase(at(6, 1), iso(7), iso(11))).toBe('departing');
    expect(flightPhase(at(5, 59), iso(7), iso(11))).toBe('scheduled');
  });

  it('stays airborne with no arrival time, since it cannot know it landed', () => {
    expect(flightPhase(at(20), iso(7), null)).toBe('airborne');
  });

  it('is unknown without a departure', () => {
    expect(flightPhase(at(9), null, iso(11))).toBe('unknown');
  });
});

describe('formatDuration', () => {
  it('reads the way a person would say it', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration((3 * 60 + 12) * 60_000)).toBe('3h 12m');
    expect(formatDuration(2 * 60 * 60_000)).toBe('2h');
    expect(formatDuration((26 * 60) * 60_000)).toBe('1d 2h');
    expect(formatDuration(48 * 60 * 60_000)).toBe('2d');
  });

  it('handles the sub-minute and negative cases', () => {
    expect(formatDuration(10_000)).toBe('less than a minute');
    expect(formatDuration(-45 * 60_000)).toBe('45m');
  });
});

describe('flightCountdown', () => {
  it('counts down to departure', () => {
    expect(flightCountdown(at(3, 48), iso(7), iso(11)).label).toBe('Departs in 3h 12m');
  });

  it('switches to time-to-land once airborne', () => {
    const result = flightCountdown(at(9), iso(7), iso(11));
    expect(result.label).toBe('In the air · lands in 2h');
    expect(result.imminent).toBe(true);
  });

  it('reports how long ago it landed', () => {
    expect(flightCountdown(at(12, 30), iso(7), iso(11)).label).toBe('Landed 1h 30m ago');
  });

  it('flags the last hour before departure as imminent', () => {
    expect(flightCountdown(at(6, 30), iso(7), iso(11)).imminent).toBe(true);
    expect(flightCountdown(at(3), iso(7), iso(11)).imminent).toBe(false);
  });

  it('says so plainly when there is no departure time', () => {
    expect(flightCountdown(at(9), null, null).label).toBe('No departure time set');
  });
});

describe('normalizeFlightNumber', () => {
  it('strips the space a person types', () => {
    expect(normalizeFlightNumber('KQ 762')).toBe('KQ762');
    expect(normalizeFlightNumber('kq-762')).toBe('KQ762');
    expect(normalizeFlightNumber('BA117')).toBe('BA117');
  });

  it('rejects anything that could not be a flight number', () => {
    expect(normalizeFlightNumber('')).toBeNull();
    expect(normalizeFlightNumber(null)).toBeNull();
    expect(normalizeFlightNumber('K')).toBeNull();
    expect(normalizeFlightNumber('a very long string indeed')).toBeNull();
  });
});

describe('minutesBetween', () => {
  it('is signed and rounded to the minute', () => {
    expect(minutesBetween(iso(11, 0), iso(11, 35))).toBe(35);
    expect(minutesBetween(iso(11, 35), iso(11, 0))).toBe(-35);
    expect(minutesBetween(iso(11), iso(11))).toBe(0);
  });
});
