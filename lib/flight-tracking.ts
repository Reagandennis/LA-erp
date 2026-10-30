import 'server-only';

import { findAirport } from './airports';
import type { FlightTrack } from './flight-status';

const FR24_BASE = 'https://fr24api.flightradar24.com';

/** How far either side of the schedule a matching flight may be found. */
const WINDOW_HOURS = 12;

/**
 * Every lookup is paid, so answers are shared across users for a while: a
 * flight in progress briefly, one that has landed for much longer (it won't
 * change), and "not seen yet" in between.
 */
const TTL_LIVE_MS = 2 * 60_000;
const TTL_UNSEEN_MS = 5 * 60_000;
const TTL_ENDED_MS = 6 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 300;
const cache = new Map<string, { expires: number; track: FlightTrack }>();

export class FlightTrackingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fr24Summary = {
  fr24_id?: string;
  flight?: string | null;
  orig_icao?: string | null;
  dest_icao?: string | null;
  dest_icao_actual?: string | null;
  datetime_takeoff?: string | null;
  datetime_landed?: string | null;
  first_seen?: string | null;
  flight_ended?: boolean | null;
};

type Fr24Live = {
  fr24_id?: string;
  alt?: number | null;
  gspeed?: number | null;
  eta?: string | null;
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** FR24 wants whole seconds with a Z. */
export function fr24Time(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19) + 'Z';
}

/** One call to the FR24 API, as the body it returns. Shared by the status and the form's lookup. */
export async function fr24Fetch<T>(path: string): Promise<T | null> {
  const token = process.env.FR24_API_TOKEN;
  if (!token) throw new FlightTrackingError('FlightRadar24 API token is not configured.', 500);

  let response: Response;
  try {
    response = await fetch(`${FR24_BASE}${path}`, {
      headers: { Accept: 'application/json', 'Accept-Version': 'v1', Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    throw new FlightTrackingError('Could not reach FlightRadar24.', 502);
  }
  if (!response.ok) {
    const message =
      response.status === 401 || response.status === 403
        ? 'FlightRadar24 rejected the API token.'
        : response.status === 429
          ? 'FlightRadar24 rate limit reached. Try again shortly.'
          : `FlightRadar24 error (${response.status}).`;
    throw new FlightTrackingError(message, response.status === 429 ? 429 : 502);
  }
  return (await response.json().catch(() => null)) as T | null;
}

/** The rows of a list endpoint. */
export async function fr24Get<T>(path: string): Promise<T[]> {
  const body = await fr24Fetch<{ data?: T[] }>(path);
  return body?.data ?? [];
}

function iataFor(icao: string | null): string | null {
  return icao ? (findAirport(icao, null)?.iata ?? null) : null;
}

/**
 * What FR24 has seen of `flightNumber` around its scheduled times. Before the
 * window opens nothing is spent: it reports an empty, un-found track.
 */
export async function lookupFlightTrack(input: {
  flightNumber: string;
  departure: Date | null;
  arrival: Date | null;
  now?: number;
}): Promise<FlightTrack> {
  const now = input.now ?? Date.now();
  const anchor = input.departure ?? input.arrival;
  if (!anchor) throw new FlightTrackingError('A departure or arrival time is required.', 400);

  const hour = 60 * 60_000;
  const from = (input.departure?.getTime() ?? input.arrival!.getTime() - 18 * hour) - WINDOW_HOURS * hour;
  const to = Math.min(now, (input.arrival?.getTime() ?? input.departure!.getTime() + 18 * hour) + WINDOW_HOURS * hour);
  const empty: FlightTrack = {
    found: false,
    takeoffAt: null,
    landedAt: null,
    ended: false,
    eta: null,
    altFt: null,
    gspeedKt: null,
    origin: null,
    destination: null,
    checkedAt: new Date(now).toISOString(),
  };
  if (to <= from) return empty;

  const key = `${input.flightNumber}|${Math.round(anchor.getTime() / 60_000)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.track;

  const summaries = await fr24Get<Fr24Summary>(
    `/api/flight-summary/light?flights=${encodeURIComponent(input.flightNumber)}` +
      `&flight_datetime_from=${fr24Time(from)}&flight_datetime_to=${fr24Time(to)}&limit=10`,
  );

  // The same number flies daily: take the one nearest the schedule.
  const target = anchor.getTime();
  const nearest = summaries
    .map((row) => ({ row, at: new Date(str(row.datetime_takeoff) ?? str(row.first_seen) ?? '').getTime() }))
    .filter((candidate) => !Number.isNaN(candidate.at))
    .sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))[0]?.row;

  let track: FlightTrack = empty;
  if (nearest) {
    const takeoffAt = str(nearest.datetime_takeoff);
    const landedAt = str(nearest.datetime_landed);
    const ended = nearest.flight_ended === true;
    track = {
      ...empty,
      found: true,
      takeoffAt,
      landedAt,
      ended,
      origin: iataFor(str(nearest.orig_icao)),
      destination: iataFor(str(nearest.dest_icao_actual) ?? str(nearest.dest_icao)),
    };

    // Airborne: the live feed adds an ETA. Matched on FR24's own id, so a
    // different flight with the same number can't lend it one.
    if (takeoffAt && !landedAt && !ended) {
      const live = await fr24Get<Fr24Live>(
        `/api/live/flight-positions/full?flights=${encodeURIComponent(input.flightNumber)}&limit=5`,
      ).catch(() => [] as Fr24Live[]);
      const match = live.find((row) => row.fr24_id && row.fr24_id === nearest.fr24_id) ?? null;
      if (match) {
        track = { ...track, eta: str(match.eta), altFt: num(match.alt), gspeedKt: num(match.gspeed) };
      }
    }
  }

  const ttl = track.ended || track.landedAt ? TTL_ENDED_MS : track.found ? TTL_LIVE_MS : TTL_UNSEEN_MS;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [k, entry] of cache) if (entry.expires <= now) cache.delete(k);
    const oldest = cache.keys().next().value;
    if (cache.size >= CACHE_MAX_ENTRIES && oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expires: now + ttl, track });
  return track;
}
