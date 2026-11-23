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

// ── Arrival / departure events and tracked progress ─────────────────────────

/** Whether the itinerary event is meeting an arrival or seeing off a departure. */
export type FlightDirection = 'departure' | 'arrival';

export function flightDirection(timeLabel: string | null | undefined): FlightDirection {
  return timeLabel === 'ARRIVAL' ? 'arrival' : 'departure';
}

export interface FlightSchedule {
  departure: string | null;
  arrival: string | null;
}

/**
 * The event's own time is the departure or the arrival, per its direction;
 * the other end follows from the duration when there is one.
 */
export function scheduledFlightTimes(input: {
  direction: FlightDirection;
  scheduledAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
}): FlightSchedule {
  const at = input.scheduledAt ? new Date(input.scheduledAt).getTime() : NaN;
  if (Number.isNaN(at)) return { departure: null, arrival: null };
  const span = input.durationMinutes ? input.durationMinutes * 60_000 : null;
  if (input.direction === 'arrival') {
    return {
      departure: span !== null ? new Date(at - span).toISOString() : null,
      arrival: new Date(at).toISOString(),
    };
  }
  return {
    departure: new Date(at).toISOString(),
    arrival: input.endsAt ?? (span !== null ? new Date(at + span).toISOString() : null),
  };
}

/** What FlightRadar24 has seen of one flight; shape of `/api/flight-radar/status`. */
export interface FlightTrack {
  /** False when FR24 has no record of the flight in the window. */
  found: boolean;
  takeoffAt: string | null;
  /**
   * When FR24 first picked the flight up. Where its coverage is thin (Addis
   * Ababa among them) it never records a take-off and first sees the flight
   * already in the air, so this is proof it has left, not when.
   */
  seenAt?: string | null;
  landedAt: string | null;
  ended: boolean;
  /** Live estimate while airborne. */
  eta: string | null;
  altFt: number | null;
  gspeedKt: number | null;
  /** IATA codes FR24 recorded. */
  origin: string | null;
  destination: string | null;
  checkedAt: string;
}

/**
 * FR24 records wheels-up, while a schedule quotes leaving the gate. Allowing
 * for the taxi keeps an ordinary take-off from reading as a delay.
 */
export const TAXI_OUT_MINUTES = 15;

/** Past this, a flight FR24 still hasn't seen is more likely untracked than delayed. */
const UNSEEN_GIVE_UP_MINUTES = 180;

/**
 * A run this far from the itinerary's time is more likely a wrong time on the
 * itinerary (a.m. for p.m., the wrong zone) than a delay, so it is flagged
 * for checking rather than reported as "Delayed 11h".
 */
export const MISMATCH_MINUTES = 6 * 60;

function mismatch(phase: FlightPhase, deltaMinutes: number, what: string): FlightProgress {
  const amount = formatDuration(deltaMinutes * 60_000);
  return {
    phase,
    status: 'unknown',
    deltaMinutes: null,
    label: 'Check time',
    detail: `FlightRadar24 shows it ${what} ${amount} ${deltaMinutes > 0 ? 'after' : 'before'} the time on the itinerary. Check the date, time and time zone.`,
  };
}

export interface FlightProgress {
  phase: FlightPhase;
  status: Punctuality;
  deltaMinutes: number | null;
  /** The status chip: "On time", "Delayed 25m", "12m early", "Scheduled". */
  label: string;
  /** What that's based on, when there's more to say. */
  detail: string | null;
}

function judge(deltaMinutes: number): Punctuality {
  if (deltaMinutes <= -ON_TIME_TOLERANCE_MINUTES) return 'early';
  if (deltaMinutes > ON_TIME_TOLERANCE_MINUTES) return 'late';
  return 'ontime';
}

function chipLabel(status: Punctuality, deltaMinutes: number): string {
  const amount = formatDuration(deltaMinutes * 60_000);
  if (status === 'early') return `${amount} early`;
  if (status === 'late') return `Delayed ${amount}`;
  return 'On time';
}

function judged(
  phase: FlightPhase,
  deltaMinutes: number,
  detail: (status: Punctuality, amount: string) => string,
): FlightProgress {
  const status = judge(deltaMinutes);
  return {
    phase,
    status,
    deltaMinutes,
    label: chipLabel(status, deltaMinutes),
    detail: detail(status, formatDuration(deltaMinutes * 60_000)),
  };
}

/**
 * Early, on time or delayed, from the best evidence available: the actual
 * landing, then the live ETA, then the take-off, then "should have left by now".
 * `track` is null until a lookup has answered, and then nothing is claimed.
 */
export function flightProgress(
  now: number,
  schedule: FlightSchedule,
  track: FlightTrack | null,
): FlightProgress {
  const dep = schedule.departure ? new Date(schedule.departure).getTime() : null;
  const arr = schedule.arrival ? new Date(schedule.arrival).getTime() : null;
  const minutes = (from: number, to: string) => Math.round((new Date(to).getTime() - from) / 60_000);

  // Wheels-down is a few minutes before the gate time a schedule quotes.
  const atGate = (iso: string) => new Date(new Date(iso).getTime() + TAXI_IN_MINUTES * 60_000).toISOString();
  const takeoffDelta = track?.takeoffAt && dep !== null ? minutes(dep + TAXI_OUT_MINUTES * 60_000, track.takeoffAt) : null;
  // The matched run is far from the itinerary's times: say so instead of
  // reporting it as a delay. Without a take-off, when FR24 first saw it will
  // do: it is near enough for a gap of hours.
  const seenDelta = takeoffDelta === null && track?.seenAt && dep !== null ? minutes(dep + TAXI_OUT_MINUTES * 60_000, track.seenAt) : null;
  const leftDelta = takeoffDelta ?? seenDelta;
  if (leftDelta !== null && Math.abs(leftDelta) > MISMATCH_MINUTES) {
    return mismatch(track?.landedAt || track?.ended ? 'landed' : 'airborne', leftDelta, takeoffDelta !== null ? 'took off' : 'in the air');
  }
  if (dep === null && track?.landedAt && arr !== null) {
    const landingDelta = minutes(arr, atGate(track.landedAt));
    if (Math.abs(landingDelta) > MISMATCH_MINUTES) return mismatch('landed', landingDelta, 'landed');
  }

  if (track?.landedAt) {
    if (arr === null) {
      return { phase: 'landed', status: 'unknown', deltaMinutes: null, label: 'Landed', detail: null };
    }
    return judged('landed', minutes(arr, atGate(track.landedAt)), (status, amount) =>
      status === 'early'
        ? `Landed ${amount} ahead of schedule`
        : status === 'late'
          ? `Landed ${amount} behind schedule`
          : 'Landed on schedule',
    );
  }

  // FR24 stopped tracking it without recording a landing: it is down, not still in the air.
  if (track?.takeoffAt && track.ended) {
    if (takeoffDelta === null) {
      return { phase: 'landed', status: 'unknown', deltaMinutes: null, label: 'Flight ended', detail: 'Landing time not recorded' };
    }
    return judged('landed', takeoffDelta, (status, amount) =>
      status === 'early'
        ? `Flight ended · took off ${amount} early, landing time not recorded`
        : status === 'late'
          ? `Flight ended · took off ${amount} late, landing time not recorded`
          : 'Flight ended · took off on time, landing time not recorded',
    );
  }

  // Seen in the air with no take-off on record: it has left; how late is only known from the ETA.
  if (!track?.takeoffAt && track?.seenAt) {
    if (track.ended) {
      return { phase: 'landed', status: 'unknown', deltaMinutes: null, label: 'Flight ended', detail: 'Landing time not recorded' };
    }
    if (track.eta && arr !== null) {
      return judged('airborne', minutes(arr, atGate(track.eta)), (status, amount) =>
        status === 'early'
          ? `In the air · expected ${amount} early`
          : status === 'late'
            ? `In the air · expected ${amount} late`
            : 'In the air · expected on time',
      );
    }
    return { phase: 'airborne', status: 'unknown', deltaMinutes: null, label: 'Departed', detail: 'On its way · take-off time not recorded by FlightRadar24' };
  }

  if (track?.takeoffAt) {
    if (track.eta && arr !== null) {
      return judged('airborne', minutes(arr, atGate(track.eta)), (status, amount) =>
        status === 'early'
          ? `In the air · expected ${amount} early`
          : status === 'late'
            ? `In the air · expected ${amount} late`
            : 'In the air · expected on time',
      );
    }
    if (takeoffDelta !== null) {
      return judged('airborne', takeoffDelta, (status, amount) =>
        status === 'early'
          ? `Took off ${amount} early`
          : status === 'late'
            ? `Took off ${amount} late`
            : 'Took off on time',
      );
    }
    return { phase: 'airborne', status: 'unknown', deltaMinutes: null, label: 'In the air', detail: null };
  }

  // Not seen in the air. Only a lookup that answered can say it hasn't left.
  if (track && dep !== null) {
    const overdue = Math.round((now - dep) / 60_000) - TAXI_OUT_MINUTES;
    if (overdue > ON_TIME_TOLERANCE_MINUTES) {
      if (!track.found && overdue > UNSEEN_GIVE_UP_MINUTES) {
        return {
          phase: 'unknown',
          status: 'unknown',
          deltaMinutes: null,
          label: 'No flight data',
          detail: 'FlightRadar24 has no record of this flight. Check the flight number.',
        };
      }
      return {
        phase: 'departing',
        status: 'late',
        deltaMinutes: overdue,
        label: `Delayed ${formatDuration(overdue * 60_000)}`,
        detail: 'Not departed yet',
      };
    }
  }

  return {
    phase: dep !== null ? flightPhase(now, schedule.departure, schedule.arrival) : 'unknown',
    status: 'unknown',
    deltaMinutes: null,
    label: 'Scheduled',
    detail: null,
  };
}

/** The headline countdown, for events that only know their arrival as well. */
export function scheduleCountdown(now: number, schedule: FlightSchedule): CountdownResult {
  if (schedule.departure) return flightCountdown(now, schedule.departure, schedule.arrival);
  if (!schedule.arrival) return { phase: 'unknown', label: 'No time set', imminent: false };
  const arr = new Date(schedule.arrival).getTime();
  if (Number.isNaN(arr)) return { phase: 'unknown', label: 'No time set', imminent: false };
  if (now >= arr) return { phase: 'landed', label: `Due ${formatDuration(now - arr)} ago`, imminent: false };
  return { phase: 'scheduled', label: `Lands in ${formatDuration(arr - now)}`, imminent: arr - now <= 60 * 60_000 };
}

// ── Filling the flight form from FlightRadar24 ───────────────────────────────

/** A schedule's arrival is at the gate, a few minutes after FR24's touchdown. */
export const TAXI_IN_MINUTES = 10;

export interface LookupAirport {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  /** IANA zone the airport's local times are in; null when the table has none. */
  tz: string | null;
}

export interface LookupAirline {
  name: string;
  iata: string | null;
  icao: string | null;
}

/**
 * One flight as FR24 has flown it recently: its route, and the gate times a
 * schedule would quote, taken as the median of its recent runs. Shape of
 * `/api/flight-radar/lookup`.
 */
export interface FlightCandidate {
  flightNumber: string;
  airline: LookupAirline | null;
  origin: LookupAirport | null;
  destination: LookupAirport | null;
  /** "HH:MM", local to the origin; null without a zone or a run to read it from. */
  departureTime: string | null;
  /**
   * True when FR24 recorded no take-offs (thin coverage at the origin, e.g.
   * Addis Ababa) and the departure and duration were worked back from the
   * landings and the route's distance: an estimate to check against the ticket.
   */
  departureEstimated?: boolean;
  /** "HH:MM", local to the destination. */
  arrivalTime: string | null;
  /** Gate to gate, to the nearest five minutes. */
  durationMinutes: number | null;
  /** ICAO type code of the aircraft usually flying it, e.g. B77W. */
  aircraft: string | null;
  /** The tail number of the latest run. */
  registration: string | null;
  /** How many runs the times are drawn from, and when the latest was last seen. */
  runs: number;
  lastSeen: string | null;
  /** In the air right now. */
  airborne: boolean;
  /**
   * What the times are: the flight as it flew on the event's date, the typical
   * times of its runs on that weekday, or of its recent runs regardless.
   */
  basis: 'date' | 'weekday' | 'recent';
  /** "YYYY-MM-DD" when `basis` is 'date', or the date asked about. */
  onDate: string | null;
  /**
   * What this leg does on the date asked about: it flew (actual times), is
   * expected (it usually flies that weekday), doesn't usually fly that
   * weekday, or the day has passed with no record of it. Absent without a date.
   */
  dayStatus?: 'flown' | 'expected' | 'not-usual' | 'no-record';
  /** "Daily" or "Mon, Wed, Fri": the days it flew in the last two weeks. */
  frequency?: string | null;
  /** The local dates it leaves its origin and lands at its destination, for the date asked about. */
  departDate?: string | null;
  arriveDate?: string | null;
}

export interface FlightLookup {
  query: { kind: 'flight' | 'callsign' | 'registration'; value: string };
  /** The date looked up, local to the event's end; null for "recently". */
  date?: string | null;
  end?: 'departure' | 'arrival';
  candidates: FlightCandidate[];
  checkedAt: string;
}
