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
import { utcToZoned } from './zoned-time';

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

/** How far back a flight's recent runs are read. A weekly service still shows. */
export const HISTORY_DAYS = 10;
const DAY = 86_400_000;
const RESULT_LIMIT = 20;
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
function typicalTime(instants: number[], zone: string): string | null {
  const minutes = instants
    .map((at) => utcToZoned(new Date(at).toISOString(), zone).time)
    .filter(Boolean)
    .map((time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));
  if (minutes.length === 0) return null;
  const typical = roundTo(median(minutes), minutes.length === 1 ? 1 : 5) % (24 * 60);
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

/** The day a run took off, local to its origin. */
function departedOn(run: Fr24SummaryFull): string | null {
  const origin = findAirport(str(run.orig_icao), str(run.orig_iata));
  return localDay(str(run.datetime_takeoff) ?? str(run.first_seen), origin?.tz ?? null);
}
/** The day a run landed, local to where it landed. */
function landedOn(run: Fr24SummaryFull): string | null {
  const destination = findAirport(str(run.dest_icao_actual) ?? str(run.dest_icao), str(run.dest_iata_actual) ?? str(run.dest_iata));
  return localDay(str(run.datetime_landed), destination?.tz ?? null);
}
/** Whether a run is the flight of `dateKey`: it left or landed on that local day. */
function flewOn(run: Fr24SummaryFull, dateKey: string): boolean {
  return departedOn(run) === dateKey || landedOn(run) === dateKey;
}

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

/** Which runs a candidate's times are read from, and what that makes them. */
interface TimesFrom {
  basis: FlightCandidate['basis'];
  onDate: string | null;
  /** Keep only the runs on this weekday (0–6) when there are any. */
  weekday?: number;
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
          const day = departedOn(run);
          return day !== null && weekdayOfKey(day) === from.weekday;
        });
  const runs = sameWeekday.length > 0 ? sameWeekday : allRuns;
  const basis: FlightCandidate['basis'] = from.basis === 'date' ? 'date' : sameWeekday.length > 0 ? 'weekday' : 'recent';
  const latest = [...runs].sort(
    (a, b) => (instant(b.datetime_takeoff) ?? instant(b.first_seen) ?? 0) - (instant(a.datetime_takeoff) ?? instant(a.first_seen) ?? 0),
  );
  const first = latest[0]!;
  const flightNumber = (str(first.flight) ?? str(first.callsign))!;
  const origin = toLookupAirport(findAirport(str(first.orig_icao), str(first.orig_iata)));
  const destination = toLookupAirport(
    findAirport(str(first.dest_icao_actual) ?? str(first.dest_icao), str(first.dest_iata_actual) ?? str(first.dest_iata)),
  );

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

  return {
    flightNumber,
    airline: await airlineFor(str(first.operating_as) ?? str(first.painted_as), flightNumber),
    origin,
    destination,
    departureTime: origin?.tz ? typicalTime(departures, origin.tz) : null,
    arrivalTime: destination?.tz ? typicalTime(arrivals, destination.tz) : null,
    durationMinutes: durations.length > 0 ? roundTo(median(durations), 5) : null,
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

/** FR24's summaries for `query` between two instants, newest first. */
async function summaries(query: LookupQuery, from: number, to: number): Promise<Fr24SummaryFull[]> {
  return fr24Get<Fr24SummaryFull>(
    `/api/flight-summary/full?${FILTER[query.kind]}=${encodeURIComponent(query.value)}` +
      `&flight_datetime_from=${fr24Time(from)}&flight_datetime_to=${fr24Time(to)}&limit=${RESULT_LIMIT}&sort=desc`,
  );
}

/**
 * What FR24 knows of `raw` (a flight number, callsign or tail number) for an
 * event on `dateKey`. A date that has come: the flight as it flew that day,
 * falling back to recent runs when it didn't. A date ahead, or none: the
 * recent runs, with that weekday's preferred for the times.
 */
export async function lookupFlights(raw: string, now = Date.now(), dateKey: string | null = null): Promise<FlightLookup> {
  const query = classifyQuery(raw);
  if (!query) throw new FlightTrackingError('Enter a flight number like KQ100 or a tail number like 5Y-KZX.', 400);
  const date = dateKey && parseDateKey(dateKey) ? dateKey.slice(0, 10) : null;

  const key = `${query.kind}:${query.value}:${date ?? ''}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.lookup;

  let candidates: FlightCandidate[] | null = null;
  const dayStart = date ? Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) : null;
  if (date && dayStart !== null && dayStart <= now) {
    // That day in every zone: from the evening before (UTC) to the morning after.
    const rows = await summaries(query, dayStart - DAY, Math.min(dayStart + 2 * DAY, now));
    const onDay = rows.filter((run) => flewOn(run, date));
    if (onDay.length > 0) candidates = await candidatesFrom(onDay, { basis: 'date', onDate: date });
  }
  if (candidates === null) {
    const rows = await summaries(query, now - HISTORY_DAYS * DAY, now);
    candidates = await candidatesFrom(rows, { basis: 'recent', onDate: null, weekday: date ? weekdayOfKey(date) : undefined });
  }

  const lookup: FlightLookup = { query, candidates, checkedAt: new Date(now).toISOString() };
  remember(key, lookup, now);
  return lookup;
}
