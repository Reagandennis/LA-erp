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
import { utcToZoned } from './zoned-time';

/**
 * Fills the flight form from a flight number, callsign or tail number. FR24
 * has no schedule or search endpoint, so the answer is built from the
 * flight's recent runs: the route it flew, and the gate times a schedule
 * would quote, as the median of those runs. A tail number gives the flights
 * that aircraft has flown lately, the one in the air first.
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

/** The median of some instants as "HH:MM" in `zone`, to the nearest five minutes. */
function typicalTime(instants: number[], zone: string): string | null {
  const minutes = instants
    .map((at) => utcToZoned(new Date(at).toISOString(), zone).time)
    .filter(Boolean)
    .map((time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)));
  if (minutes.length === 0) return null;
  const typical = roundTo(median(minutes), 5) % (24 * 60);
  return `${String(Math.floor(typical / 60)).padStart(2, '0')}:${String(typical % 60).padStart(2, '0')}`;
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

/** One candidate from the runs of one flight on one route, the latest run first. */
async function candidateFrom(runs: Fr24SummaryFull[]): Promise<FlightCandidate> {
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
  };
}

/** The runs grouped by flight and route, each as one candidate; the one in the air first, then the best known. */
export async function candidatesFrom(rows: Fr24SummaryFull[]): Promise<FlightCandidate[]> {
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
  for (const runs of groups.values()) candidates.push(await candidateFrom(runs));
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

/** What FR24 has flown lately under `raw`: a flight number, callsign or tail number. */
export async function lookupFlights(raw: string, now = Date.now()): Promise<FlightLookup> {
  const query = classifyQuery(raw);
  if (!query) throw new FlightTrackingError('Enter a flight number like KQ100 or a tail number like 5Y-KZX.', 400);

  const key = `${query.kind}:${query.value}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.lookup;

  const rows = await fr24Get<Fr24SummaryFull>(
    `/api/flight-summary/full?${FILTER[query.kind]}=${encodeURIComponent(query.value)}` +
      `&flight_datetime_from=${fr24Time(now - HISTORY_DAYS * DAY)}&flight_datetime_to=${fr24Time(now)}&limit=${RESULT_LIMIT}&sort=desc`,
  );
  const lookup: FlightLookup = { query, candidates: await candidatesFrom(rows), checkedAt: new Date(now).toISOString() };
  remember(key, lookup, now);
  return lookup;
}
