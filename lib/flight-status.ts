/**
 * Flight punctuality and countdown maths.
 *
 * Client-safe and free of side effects so it can be unit-tested. The live data
 * this works against comes from `/api/flight-radar`, which proxies
 * FlightRadar24 and returns an `eta` for an airborne flight.
 */

export type FlightPhase = 'scheduled' | 'departing' | 'airborne' | 'landed' | 'unknown';
export type Punctuality = 'early' | 'ontime' | 'late' | 'unknown';

/**
 * The industry convention: a flight counts as on time if it arrives within
 * 15 minutes of schedule. Outside that it is genuinely early or late.
 */
export const ON_TIME_TOLERANCE_MINUTES = 15;

/** Minutes between two instants, positive when `actual` is after `scheduled`. */
export function minutesBetween(scheduled: string | null, actual: string | null): number | null {
  if (!scheduled || !actual) return null;
  const a = new Date(scheduled).getTime();
  const b = new Date(actual).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60_000);
}

export interface PunctualityResult {
  status: Punctuality;
  /** Positive = late, negative = early. Null when it can't be known. */
  deltaMinutes: number | null;
  label: string;
}

/**
 * Compare a live ETA against the scheduled arrival.
 *
 * Returns `unknown` rather than guessing when either side is missing — an
 * itinerary with no arrival time cannot tell you whether a flight is late, and
 * saying "on time" would be a lie rather than a default.
 */
export function flightPunctuality(
  scheduledArrival: string | null,
  liveEta: string | null,
): PunctualityResult {
  const deltaMinutes = minutesBetween(scheduledArrival, liveEta);
  if (deltaMinutes === null) {
    return { status: 'unknown', deltaMinutes: null, label: 'No live data' };
  }
  if (deltaMinutes <= -ON_TIME_TOLERANCE_MINUTES) {
    return { status: 'early', deltaMinutes, label: `${Math.abs(deltaMinutes)} min early` };
  }
  if (deltaMinutes > ON_TIME_TOLERANCE_MINUTES) {
    return { status: 'late', deltaMinutes, label: `${deltaMinutes} min late` };
  }
  return { status: 'ontime', deltaMinutes, label: 'On time' };
}

/** Where the flight is in its own timeline, from the schedule alone. */
export function flightPhase(
  now: number,
  departure: string | null,
  arrival: string | null,
): FlightPhase {
  if (!departure) return 'unknown';
  const dep = new Date(departure).getTime();
  if (Number.isNaN(dep)) return 'unknown';

  const arr = arrival ? new Date(arrival).getTime() : null;
  if (arr !== null && !Number.isNaN(arr) && now >= arr) return 'landed';
  if (now >= dep) return 'airborne';
  // Inside an hour of departure the useful framing is "get to the gate".
  if (dep - now <= 60 * 60_000) return 'departing';
  return 'scheduled';
}

/**
 * "3h 12m", "45m", "2d 4h". Always a magnitude — the caller supplies the
 * direction in its own wording ("in 3h 12m" vs "3h 12m ago").
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (totalMinutes < 1) return 'less than a minute';

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export interface CountdownResult {
  phase: FlightPhase;
  /** The headline line on the card. */
  label: string;
  /** True while the flight is still ahead — drives the urgent styling. */
  imminent: boolean;
}

/** The human sentence a flight card leads with. */
export function flightCountdown(
  now: number,
  departure: string | null,
  arrival: string | null,
): CountdownResult {
  const phase = flightPhase(now, departure, arrival);
  if (phase === 'unknown' || !departure) {
    return { phase, label: 'No departure time set', imminent: false };
  }

  const dep = new Date(departure).getTime();
  const arr = arrival ? new Date(arrival).getTime() : null;

  if (phase === 'landed') {
    return { phase, label: `Landed ${formatDuration(now - (arr ?? dep))} ago`, imminent: false };
  }
  if (phase === 'airborne') {
    return {
      phase,
      label: arr ? `In the air · lands in ${formatDuration(arr - now)}` : 'In the air',
      imminent: true,
    };
  }
  return { phase, label: `Departs in ${formatDuration(dep - now)}`, imminent: phase === 'departing' };
}

/**
 * Normalise a flight number for the FR24 lookup: "KQ 762" → "KQ762".
 * Returns null when there's nothing usable to search with.
 */
export function normalizeFlightNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[A-Z0-9]{3,8}$/.test(cleaned) ? cleaned : null;
}
