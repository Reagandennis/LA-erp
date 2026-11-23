import 'server-only';

import { type AirlineInfo, airlineCodeOf, findAirline } from './airlines';
import { type AirportInfo, findAirport } from './airports';
import {
  type FlightCandidate,
  type FlightLookup,
  type LookupAirline,
  type LookupAirport,
  TAXI_IN_MINUTES,
  TAXI_OUT_MINUTES,
  normalizeFlightNumber,
} from './flight-status';
import { FlightTrackingError, fr24Fetch, fr24Get, fr24Time } from './flight-tracking';
import { parseDateKey } from './date-grid';
import { utcToZoned, zonedToUtcIso } from './zoned-time';

/**
 * Fills the flight form from a flight number, callsign or tail number. FR24
 * has no schedule or search endpoint, so the answer is built from the
 * flight's runs. Given the event's date: a date that has come is answered
 * with the flight as it actually flew that day; a date still ahead with the
 * typical times of its recent runs, preferring the ones on that weekday
 * (schedules often differ by day). Without a date, the recent runs regardless.
 * A tail number gives the flights that aircraft has flown lately, the one in
 * the air first.
 */

/** How far back a flight's recent runs are read: two weeks, so a weekly service shows twice. */
export const HISTORY_DAYS = 14;
const DAY = 86_400_000;
/** Enough for a two-leg daily flight over the whole history (ET552 flies ADD → FCO → YYZ). */
const RESULT_LIMIT = 50;
/** Recent history doesn't change by the minute, and every answer is paid for. */
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { expires: number; lookup: FlightLookup }>();
/** Airlines FR24 named that the table didn't know, for the life of the process. */
const airlinesFromFr24 = new Map<string, AirlineInfo | null>();

type Fr24SummaryFull = {
  fr24_id?: string;
  flight?: string | null;
  callsign?: string | null;
  operating_as?: string | null;
  painted_as?: string | null;
  type?: string | null;
  reg?: string | null;
  orig_icao?: string | null;
  orig_iata?: string | null;
  datetime_takeoff?: string | null;
  dest_icao?: string | null;
  dest_iata?: string | null;
  dest_icao_actual?: string | null;
  dest_iata_actual?: string | null;
  datetime_landed?: string | null;
  flight_time?: number | null;
  first_seen?: string | null;
  last_seen?: string | null;
  flight_ended?: boolean | null;
};

export type LookupQuery = FlightLookup['query'];

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function instant(value: unknown): number | null {
  const at = str(value) ? new Date(str(value)!).getTime() : NaN;
  return Number.isNaN(at) ? null : at;
}
const present = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

function mostCommon(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * "KQ 100" → a flight number; "KQA100" → a callsign; "5Y-KZX" or "N123AB" → a
 * registration. Null when it is none of these.
 */
export function classifyQuery(raw: string): LookupQuery | null {
  const compact = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!compact) return null;
  if (/^[A-Z0-9]{1,3}-[A-Z0-9]{1,5}$/.test(compact) || /^N[0-9]{1,5}[A-Z]{0,2}$/.test(compact)) {
    return { kind: 'registration', value: compact };
  }
  const flight = normalizeFlightNumber(compact);
  if (!flight) return null;
  // Three letters before the digits is an ICAO callsign (KQA100), not an IATA flight number (KQ100).
  return { kind: /^[A-Z]{3}[0-9]/.test(flight) ? 'callsign' : 'flight', value: flight };
}

const FILTER: Record<LookupQuery['kind'], string> = { flight: 'flights', callsign: 'callsigns', registration: 'registrations' };

/** The median of some instants as "HH:MM" in `zone`, to the nearest five minutes; a single run to the minute. */
export function typicalTime(instants: number[], zone: string): string | null {
  const minutes = instants
    .map((at) => utcToZoned(new Date(at).toISOString(), zone).time)
    .filter(Boolean)
    .map((time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));
  if (minutes.length === 0) return null;
  // A flight around midnight (23:50 one night, 00:05 the next) must not
  // average to midday: read the early-morning runs as after midnight.
  const day = 24 * 60;
  const spread = Math.max(...minutes) - Math.min(...minutes);
  const unwrapped = spread > day / 2 ? minutes.map((m) => (m < day / 2 ? m + day : m)) : minutes;
  const typical = ((roundTo(median(unwrapped), minutes.length === 1 ? 1 : 5) % day) + day) % day;
  return `${String(Math.floor(typical / 60)).padStart(2, '0')}:${String(typical % 60).padStart(2, '0')}`;
}

/** The calendar day, local to `zone` (UTC without one), of an instant. */
function localDay(iso: string | null, zone: string | null): string | null {
  if (!iso) return null;
  if (zone) return utcToZoned(iso, zone).date || null;
  return iso.slice(0, 10);
}
/** 0–6, Sunday first, of a "YYYY-MM-DD". */
function weekdayOfKey(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

/**
 * When a run left the gate. FR24's take-off, less the taxi; without one (it
 * first saw the flight already in the air, as at Addis Ababa) worked back from
 * the landing over the route's length. FR24's "first seen" is a last resort:
 * at Addis it is hours after departure, which put a 23:20 departure on the
 * next day.
 */
function departureInstant(run: Fr24SummaryFull): number | null {
  const takeoff = instant(run.datetime_takeoff);
  if (takeoff !== null) return takeoff - TAXI_OUT_MINUTES * 60_000;
  const landed = instant(run.datetime_landed);
  const origin = findAirport(str(run.orig_icao), str(run.orig_iata));
  const destination = findAirport(str(run.dest_icao_actual) ?? str(run.dest_icao), str(run.dest_iata_actual) ?? str(run.dest_iata));
  const block = origin && destination ? estimatedBlockMinutes(origin, destination) : null;
  if (landed !== null && block !== null) return landed + TAXI_IN_MINUTES * 60_000 - block * 60_000;
  return instant(run.first_seen);
}

/** The day a run left, local to its origin. */
function departedOn(run: Fr24SummaryFull): string | null {
  const origin = findAirport(str(run.orig_icao), str(run.orig_iata));
  const at = departureInstant(run);
  return localDay(at === null ? null : new Date(at).toISOString(), origin?.tz ?? null);
}
/** The day a run landed, local to where it landed. */
function landedOn(run: Fr24SummaryFull): string | null {
  const destination = findAirport(str(run.dest_icao_actual) ?? str(run.dest_icao), str(run.dest_iata_actual) ?? str(run.dest_iata));
  return localDay(str(run.datetime_landed), destination?.tz ?? null);
}
/**
 * The local day of the end the event is at: the departure day at the origin
 * for a departure, the landing day at the destination for an arrival. ET552
 * leaves Addis at 23:20 on the 22nd and lands in Rome on the 23rd: it is the
 * 22nd's departure and the 23rd's arrival, never both.
 */
function dayAtEnd(run: Fr24SummaryFull, end: LookupEnd): string | null {
  return end === 'arrival' ? landedOn(run) : departedOn(run);
}

/** Which end of the flight the event is at, and so which local date it is looked up by. */
export type LookupEnd = 'departure' | 'arrival';

function toLookupAirport(airport: AirportInfo | null): LookupAirport | null {
  return airport && { iata: airport.iata, icao: airport.icao, name: airport.name, city: airport.city, country: airport.country, tz: airport.tz };
}

/**
 * The carrier. The operator FR24 names (by ICAO code) is authoritative: the
 * table first, then FR24's airline endpoint, once per code. Only without one
 * is the two-letter prefix of the flight number read as the airline.
 */
async function airlineFor(icao: string | null, flightNumber: string): Promise<LookupAirline | null> {
  if (icao) {
    const known = findAirline(icao, null);
    if (known) return known;
    if (!airlinesFromFr24.has(icao)) {
      const info = await fr24Fetch<{ name?: string; iata?: string; icao?: string }>(`/api/static/airlines/${encodeURIComponent(icao)}/light`).catch(
        () => null,
      );
      const name = str(info?.name);
      airlinesFromFr24.set(icao, name ? { name, iata: str(info?.iata), icao: str(info?.icao) ?? icao } : null);
    }
    const named = airlinesFromFr24.get(icao);
    if (named) return named;
  }
  return findAirline(null, airlineCodeOf(flightNumber));
}

/** Great-circle distance in km. */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Gate to gate for a route FR24 never saw take off, as a timetable would
 * quote it: about 880 km/h over the ground, plus time on the ground and the
 * airline's padding, which grows with the distance up to an hour and a half.
 * Fitted to published (OAG) schedules: ADD→FCO 6h30 (ET552), FCO→YYZ 9h30
 * (ET552), NBO→LHR ~9h15 (BA64), and right for short hops (NBO→MBA ~1h).
 * Still an estimate: the form says so and asks for the ticket's time.
 */
export function estimatedBlockMinutes(origin: { lat: number; lon: number }, destination: { lat: number; lon: number }): number | null {
  const km = distanceKm(origin, destination);
  if (!Number.isFinite(km) || km < 50) return null;
  const padding = Math.min(90, 25 + km / 70);
  return roundTo((km / 880) * 60 + padding, 5);
}

/** Which runs a candidate's times are read from, and what that makes them. */
interface TimesFrom {
  basis: FlightCandidate['basis'];
  onDate: string | null;
  /** Keep only the runs on this weekday (0–6) when there are any. */
  weekday?: number;
  /** Which end's local day the weekday is read at; the departure's by default. */
  end?: LookupEnd;
}

/**
 * One candidate from the runs of one flight on one route, the latest run
 * first. The times come from the runs on the wanted weekday when there are
 * any, else from all of them.
 */
async function candidateFrom(allRuns: Fr24SummaryFull[], from: TimesFrom): Promise<FlightCandidate> {
  const sameWeekday =
    from.weekday === undefined
      ? []
      : allRuns.filter((run) => {
          const day = dayAtEnd(run, from.end ?? 'departure');
          return day !== null && weekdayOfKey(day) === from.weekday;
        });
  // One run is too few to set times by (they wander by half an hour day to
  // day): that weekday's runs only when there are two or more of them.
  const runs = sameWeekday.length >= 2 ? sameWeekday : allRuns;
  const basis: FlightCandidate['basis'] = from.basis === 'date' ? 'date' : sameWeekday.length >= 2 ? 'weekday' : 'recent';
  const latest = [...runs].sort(
    (a, b) => (instant(b.datetime_takeoff) ?? instant(b.first_seen) ?? 0) - (instant(a.datetime_takeoff) ?? instant(a.first_seen) ?? 0),
  );
  const first = latest[0]!;
  const flightNumber = (str(first.flight) ?? str(first.callsign))!;
  const originInfo = findAirport(str(first.orig_icao), str(first.orig_iata));
  const destinationInfo = findAirport(str(first.dest_icao_actual) ?? str(first.dest_icao), str(first.dest_iata_actual) ?? str(first.dest_iata));
  const origin = toLookupAirport(originInfo);
  const destination = toLookupAirport(destinationInfo);

  // FR24 records wheels-up and touchdown; a schedule quotes the gate either side.
  const departures = runs.map((run) => instant(run.datetime_takeoff)).filter(present).map((at) => at - TAXI_OUT_MINUTES * 60_000);
  const arrivals = runs.map((run) => instant(run.datetime_landed)).filter(present).map((at) => at + TAXI_IN_MINUTES * 60_000);
  const durations = runs
    .map((run) => {
      const takeoff = instant(run.datetime_takeoff);
      const landed = instant(run.datetime_landed);
      return takeoff !== null && landed !== null && landed > takeoff ? (landed - takeoff) / 60_000 + TAXI_OUT_MINUTES + TAXI_IN_MINUTES : null;
    })
    .filter(present);

  // No take-off on record anywhere (FR24 first sees the flight already in the
  // air): work the departure back from the landings and the route's length.
  const block = departures.length === 0 && arrivals.length > 0 && originInfo && destinationInfo ? estimatedBlockMinutes(originInfo, destinationInfo) : null;
  const estimated = block !== null;
  if (estimated) departures.push(...arrivals.map((at) => at - block * 60_000));

  return {
    flightNumber,
    airline: await airlineFor(str(first.operating_as) ?? str(first.painted_as), flightNumber),
    origin,
    destination,
    departureTime: origin?.tz ? typicalTime(departures, origin.tz) : null,
    arrivalTime: destination?.tz ? typicalTime(arrivals, destination.tz) : null,
    departureEstimated: estimated || undefined,
    durationMinutes: durations.length > 0 ? roundTo(median(durations), 5) : block,
    aircraft: mostCommon(runs.map((run) => str(run.type))),
    registration: str(first.reg),
    runs: runs.length,
    lastSeen: str(first.last_seen) ?? str(first.datetime_takeoff) ?? str(first.first_seen),
    airborne: runs.some((run) => run.flight_ended === false && Boolean(str(run.datetime_takeoff)) && !str(run.datetime_landed)),
    basis,
    onDate: basis === 'date' ? from.onDate : null,
  };
}

/** The runs grouped by flight and route, each as one candidate; the one in the air first, then the best known. */
export async function candidatesFrom(
  rows: Fr24SummaryFull[],
  from: TimesFrom = { basis: 'recent', onDate: null },
): Promise<FlightCandidate[]> {
  const groups = new Map<string, Fr24SummaryFull[]>();
  for (const row of rows) {
    const flight = str(row.flight) ?? str(row.callsign);
    if (!flight) continue;
    const origin = str(row.orig_iata) ?? str(row.orig_icao) ?? '';
    const destination = str(row.dest_iata_actual) ?? str(row.dest_iata) ?? str(row.dest_icao) ?? '';
    const key = `${flight}|${origin}|${destination}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const candidates: FlightCandidate[] = [];
  for (const runs of groups.values()) candidates.push(await candidateFrom(runs, from));
  return candidates.sort(
    (a, b) => Number(b.airborne) - Number(a.airborne) || b.runs - a.runs || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''),
  );
}

function remember(key: string, lookup: FlightLookup, now: number) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
    const oldest = cache.keys().next().value;
    if (cache.size >= CACHE_MAX_ENTRIES && oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expires: now + CACHE_TTL_MS, lookup });
}

/** Forget every cached answer. For tests. */
export function clearLookupCache(): void {
  cache.clear();
  historyCache.clear();
}

/**
 * The last two weeks of runs, shared by every date asked about: flicking
 * through the dates in the form costs one paid call, not one per date.
 */
const historyCache = new Map<string, { expires: number; rows: Fr24SummaryFull[] }>();
async function recentRuns(query: LookupQuery, from: number, now: number): Promise<Fr24SummaryFull[]> {
  const key = `${query.kind}:${query.value}`;
  const hit = historyCache.get(key);
  if (hit && hit.expires > now) return hit.rows;
  const rows = await summaries(query, from, now);
  if (historyCache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, entry] of historyCache) if (entry.expires <= now) historyCache.delete(k);
    const oldest = historyCache.keys().next().value;
    if (historyCache.size >= CACHE_MAX_ENTRIES && oldest !== undefined) historyCache.delete(oldest);
  }
  historyCache.set(key, { expires: now + CACHE_TTL_MS, rows });
  return rows;
}

/** FR24's summaries for `query` between two instants, newest first. */
async function summaries(query: LookupQuery, from: number, to: number): Promise<Fr24SummaryFull[]> {
  return fr24Get<Fr24SummaryFull>(
    `/api/flight-summary/full?${FILTER[query.kind]}=${encodeURIComponent(query.value)}` +
      `&flight_datetime_from=${fr24Time(from)}&flight_datetime_to=${fr24Time(to)}&limit=${RESULT_LIMIT}&sort=desc`,
  );
}

function flownDays(runs: Fr24SummaryFull[]): string[] {
  return [...new Set(runs.map(departedOn).filter((day): day is string => day !== null))].sort();
}

/** How many calendar days the runs cover, first to last. */
function daysSpanned(runs: Fr24SummaryFull[]): number {
  const days = flownDays(runs);
  if (days.length === 0) return 0;
  return Math.round((Date.parse(`${days.at(-1)}T00:00:00Z`) - Date.parse(`${days[0]}T00:00:00Z`)) / DAY) + 1;
}

/** "Daily", or the weekdays a leg flew on in the runs read: "Mon, Wed, Fri". */
function frequencyOf(runs: Fr24SummaryFull[]): string | null {
  const days = flownDays(runs);
  if (days.length === 0) return null;
  const span = daysSpanned(runs);
  if (span >= 5 && days.length / span >= 0.85) return 'Daily';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdays = [...new Set(days.map(weekdayOfKey))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return weekdays.map((day) => names[day]).join(', ');
}

/** "YYYY-MM-DD" plus whole days. */
function addDaysKey(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/**
 * The local dates a candidate leaves and lands on, for a flight on `date` at
 * the event's end: the departure from its typical times and duration on that
 * date, the other end following from them.
 */
function projectedDates(candidate: FlightCandidate, date: string, end: LookupEnd): { departDate: string | null; arriveDate: string | null } {
  const span = candidate.durationMinutes;
  if (end === 'departure') {
    const departs = candidate.departureTime && candidate.origin?.tz ? zonedToUtcIso(date, candidate.departureTime, candidate.origin.tz) : null;
    if (departs && span && candidate.destination?.tz) {
      return { departDate: date, arriveDate: utcToZoned(new Date(Date.parse(departs) + span * 60_000).toISOString(), candidate.destination.tz).date };
    }
    const overnight = candidate.departureTime && candidate.arrivalTime && candidate.arrivalTime < candidate.departureTime;
    return { departDate: date, arriveDate: candidate.arrivalTime ? (overnight ? addDaysKey(date, 1) : date) : null };
  }
  const arrives = candidate.arrivalTime && candidate.destination?.tz ? zonedToUtcIso(date, candidate.arrivalTime, candidate.destination.tz) : null;
  if (arrives && span && candidate.origin?.tz) {
    return { departDate: utcToZoned(new Date(Date.parse(arrives) - span * 60_000).toISOString(), candidate.origin.tz).date, arriveDate: date };
  }
  const overnight = candidate.departureTime && candidate.arrivalTime && candidate.arrivalTime < candidate.departureTime;
  return { departDate: candidate.departureTime ? (overnight ? addDaysKey(date, -1) : date) : null, arriveDate: date };
}

const DAY_ORDER: Record<NonNullable<FlightCandidate['dayStatus']>, number> = { flown: 0, expected: 1, 'not-usual': 2, 'no-record': 3 };

/**
 * What FR24 knows of `raw` (a flight number, callsign or tail number) for a
 * flight on `dateKey`, the local date at the event's `end`. Every leg the
 * number flies is offered, each as one of:
 *  - flown: it flew that day; the times are its actual ones;
 *  - expected: the day is still ahead (or today's hasn't flown yet), and it
 *    usually flies that weekday; the times are those of its recent runs;
 *  - not-usual: it hasn't flown that weekday lately;
 *  - no-record: the day has passed and FR24 has no record of it flying.
 * Without a date: the recent runs, as before. FR24 publishes no timetable, so
 * "expected" is the pattern of the last two weeks, not the airline's schedule.
 */
export async function lookupFlights(
  raw: string,
  now = Date.now(),
  dateKey: string | null = null,
  end: LookupEnd = 'departure',
): Promise<FlightLookup> {
  const query = classifyQuery(raw);
  if (!query) throw new FlightTrackingError('Enter a flight number like KQ100 or a tail number like 5Y-KZX.', 400);
  const date = dateKey && parseDateKey(dateKey) ? dateKey.slice(0, 10) : null;

  const key = `${query.kind}:${query.value}:${date ?? ''}:${end}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.lookup;

  const historyStart = now - HISTORY_DAYS * DAY;
  const history = await recentRuns(query, historyStart, now);
  let rows = history;
  const dayStart = date ? Date.parse(`${date}T00:00:00Z`) : null;
  // A day before the history: read that day too (from the evening before in UTC to the morning after).
  if (dayStart !== null && dayStart <= now && dayStart - DAY < historyStart) {
    const day = await summaries(query, dayStart - DAY, Math.min(dayStart + 2 * DAY, now));
    const seen = new Set(history.map((row) => row.fr24_id));
    rows = [...history, ...day.filter((row) => !row.fr24_id || !seen.has(row.fr24_id))];
  }

  let candidates: FlightCandidate[];
  if (!date) {
    candidates = await candidatesFrom(rows, { basis: 'recent', onDate: null });
  } else {
    const legs = new Map<string, Fr24SummaryFull[]>();
    for (const row of rows) {
      const flight = str(row.flight) ?? str(row.callsign);
      if (!flight) continue;
      const leg = `${flight}|${str(row.orig_iata) ?? str(row.orig_icao) ?? ''}|${str(row.dest_iata_actual) ?? str(row.dest_iata) ?? str(row.dest_icao) ?? ''}`;
      legs.set(leg, [...(legs.get(leg) ?? []), row]);
    }
    const weekday = weekdayOfKey(date);
    const today = utcToZoned(new Date(now).toISOString(), 'UTC').date;
    candidates = [];
    for (const legRuns of legs.values()) {
      const frequency = frequencyOf(legRuns);
      const flown = legRuns.filter((run) => dayAtEnd(run, end) === date);
      if (flown.length > 0) {
        const actual = await candidateFrom(flown, { basis: 'date', onDate: date });
        // Still in the air (or a time FR24 didn't record): the rest from its usual runs.
        const usual = actual.arrivalTime && actual.durationMinutes ? null : await candidateFrom(legRuns, { basis: 'recent', onDate: null });
        const candidate = usual
          ? { ...actual, arrivalTime: actual.arrivalTime ?? usual.arrivalTime, durationMinutes: actual.durationMinutes ?? usual.durationMinutes }
          : actual;
        const run = flown[0]!;
        candidates.push({ ...candidate, frequency, dayStatus: 'flown', departDate: departedOn(run), arriveDate: landedOn(run) ?? projectedDates(candidate, date, end).arriveDate });
        continue;
      }
      // A daily flight keeps one timetable: every run sets its times. Otherwise that weekday's runs do.
      const candidate = await candidateFrom(legRuns, { basis: 'recent', onDate: null, weekday: frequency === 'Daily' ? undefined : weekday, end });
      // Under a week of runs can't show which weekdays it skips: only a full week can say "not on Thursdays".
      const usual = legRuns.some((run) => {
        const day = dayAtEnd(run, end);
        return day !== null && weekdayOfKey(day) === weekday;
      }) || daysSpanned(legRuns) < 7;
      // A passed day inside the history it didn't fly on; today (it may yet) and later days are projected.
      const passed = date < today && (dayStart ?? 0) >= historyStart;
      const dayStatus: FlightCandidate['dayStatus'] = passed ? 'no-record' : usual ? 'expected' : 'not-usual';
      // Its run in the air now is another day's, not this one.
      candidates.push({ ...candidate, airborne: false, frequency, dayStatus, onDate: date, ...projectedDates(candidate, date, end) });
    }
    candidates.sort(
      (a, b) =>
        Number(b.airborne) - Number(a.airborne) ||
        DAY_ORDER[a.dayStatus ?? 'no-record'] - DAY_ORDER[b.dayStatus ?? 'no-record'] ||
        b.runs - a.runs ||
        (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''),
    );
  }

  const lookup: FlightLookup = { query, date, end, candidates, checkedAt: new Date(now).toISOString() };
  remember(key, lookup, now);
  return lookup;
}
