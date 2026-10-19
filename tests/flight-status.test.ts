import { describe, expect, it } from 'vitest';

import {
  flightCountdown,
  flightDirection,
  flightPhase,
  flightProgress,
  flightPunctuality,
  formatDuration,
  minutesBetween,
  normalizeFlightNumber,
  scheduleCountdown,
  scheduledFlightTimes,
  type FlightTrack,
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

function track(overrides: Partial<FlightTrack> = {}): FlightTrack {
  return {
    found: true,
    takeoffAt: null,
    landedAt: null,
    ended: false,
    eta: null,
    altFt: null,
    gspeedKt: null,
    origin: null,
    destination: null,
    checkedAt: iso(0),
    ...overrides,
  };
}

describe('flightDirection / scheduledFlightTimes', () => {
  it('reads ARRIVAL as an arrival and anything else as a departure', () => {
    expect(flightDirection('ARRIVAL')).toBe('arrival');
    expect(flightDirection('DEPARTURE')).toBe('departure');
    expect(flightDirection(null)).toBe('departure');
  });

  it("puts a departure's landing a duration later", () => {
    expect(
      scheduledFlightTimes({ direction: 'departure', scheduledAt: iso(10), endsAt: null, durationMinutes: 150 }),
    ).toEqual({ departure: iso(10), arrival: iso(12, 30) });
  });

  it("puts an arrival's take-off a duration earlier, and leaves it unknown without one", () => {
    expect(
      scheduledFlightTimes({ direction: 'arrival', scheduledAt: iso(10), endsAt: null, durationMinutes: 90 }),
    ).toEqual({ departure: iso(8, 30), arrival: iso(10) });
    expect(
      scheduledFlightTimes({ direction: 'arrival', scheduledAt: iso(10), endsAt: null, durationMinutes: null }),
    ).toEqual({ departure: null, arrival: iso(10) });
  });
});

describe('flightProgress', () => {
  const schedule = { departure: iso(10), arrival: iso(12) };

  it('judges a landed flight on its actual landing', () => {
    expect(flightProgress(at(13), schedule, track({ takeoffAt: iso(10, 20), landedAt: iso(11, 40) }))).toMatchObject({
      phase: 'landed',
      status: 'early',
      label: '20m early',
      detail: 'Landed 20m ahead of schedule',
    });
    expect(flightProgress(at(13), schedule, track({ takeoffAt: iso(10, 50), landedAt: iso(12, 45) }))).toMatchObject({
      status: 'late',
      label: 'Delayed 45m',
    });
    expect(flightProgress(at(13), schedule, track({ landedAt: iso(12, 10) })).status).toBe('ontime');
  });

  it('uses the live ETA while airborne', () => {
    expect(flightProgress(at(11), schedule, track({ takeoffAt: iso(10, 15), eta: iso(12, 40) }))).toMatchObject({
      phase: 'airborne',
      status: 'late',
      detail: 'In the air · expected 40m late',
    });
  });

  it('allows for the taxi when only the take-off is known', () => {
    const departureOnly = { departure: iso(10), arrival: null };
    // Wheels-up 15 minutes after the gate time is an on-time departure.
    expect(flightProgress(at(11), departureOnly, track({ takeoffAt: iso(10, 15) })).status).toBe('ontime');
    expect(flightProgress(at(11), departureOnly, track({ takeoffAt: iso(11) }))).toMatchObject({
      status: 'late',
      detail: 'Took off 45m late',
    });
  });

  it("calls a flight delayed once it should have left and hasn't", () => {
    expect(flightProgress(at(10, 50), schedule, track({ found: false }))).toMatchObject({
      status: 'late',
      label: 'Delayed 35m',
      detail: 'Not departed yet',
    });
    // Still inside the taxi allowance and tolerance: no claim either way.
    expect(flightProgress(at(10, 25), schedule, track({ found: false })).status).toBe('unknown');
  });

  it('stops blaming a delay on a flight FR24 never saw', () => {
    expect(flightProgress(at(14), schedule, track({ found: false }))).toMatchObject({
      status: 'unknown',
      label: 'No flight data',
    });
  });

  it('claims nothing before a lookup has answered', () => {
    expect(flightProgress(at(11), schedule, null)).toMatchObject({ status: 'unknown', label: 'Scheduled' });
  });
});

describe('scheduleCountdown', () => {
  it('counts down to an arrival when only the arrival is known', () => {
    expect(scheduleCountdown(at(9), { departure: null, arrival: iso(12) }).label).toBe('Lands in 3h');
    expect(scheduleCountdown(at(11, 30), { departure: null, arrival: iso(12) }).imminent).toBe(true);
    expect(scheduleCountdown(at(13), { departure: null, arrival: iso(12) }).label).toBe('Due 1h ago');
  });

  it('defers to the departure countdown when there is one', () => {
    expect(scheduleCountdown(at(9), { departure: iso(10), arrival: iso(12) }).label).toBe('Departs in 1h');
  });
});
