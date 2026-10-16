import { NextRequest, NextResponse } from 'next/server';

import { findAirport } from '@/lib/airports';
import { enforceRateLimit } from '@/lib/rate-limit';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FR24_BASE = 'https://fr24api.flightradar24.com';

/**
 * FR24 bills 8 credits per flight returned (1 for an empty answer). The
 * Explorer plan returns at most 20 flights per request; set
 * FR24_RESPONSE_LIMIT to the plan's figure after an upgrade (Essential: 300).
 */
const RESPONSE_LIMIT = Number(process.env.FR24_RESPONSE_LIMIT) || 20;

/** Identical lookups inside this window share one paid call, across all users. */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;
type FlightOut = ReturnType<typeof toFlight>;
const cache = new Map<string, { at: number; flights: FlightOut[] }>();

function remember(key: string, flights: FlightOut[], at: number) {
  for (const [k, entry] of cache) {
    if (at - entry.at > CACHE_TTL_MS) cache.delete(k);
  }
  const oldest = cache.keys().next().value;
  if (cache.size >= CACHE_MAX_ENTRIES && oldest !== undefined) cache.delete(oldest);
  cache.set(key, { at, flights });
}

type Fr24Position = {
  fr24_id?: string;
  flight?: string | null;
  callsign?: string | null;
  hex?: string | null;
  lat?: number | null;
  lon?: number | null;
  track?: number | null;
  alt?: number | null;
  gspeed?: number | null;
  vspeed?: number | null;
  type?: string | null;
  reg?: string | null;
  painted_as?: string | null;
  operating_as?: string | null;
  orig_iata?: string | null;
  orig_icao?: string | null;
  dest_iata?: string | null;
  dest_icao?: string | null;
  eta?: string | null;
  timestamp?: string | null;
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.flights);
  if (response || !auth) return response;

  // Every call hits the paid FR24 API — keep per-user usage bounded.
  const rateLimit = await enforceRateLimit({
    scope: 'flight.radar',
    key: `${auth.user.id}`,
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many flight lookups. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const token = process.env.FR24_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'FlightRadar24 API token is not configured.' }, { status: 500 });
  }

  const sp = request.nextUrl.searchParams;

  // Targeted, global search filters (no bounding box needed) take priority.
  const filters: string[] = [];
  const flightsParam = sp.get('flights');
  const callsigns = sp.get('callsigns');
  const registrations = sp.get('registrations');
  const airline = sp.get('airline');
  const airport = sp.get('airport');
  if (flightsParam) filters.push(`flights=${encodeURIComponent(flightsParam.toUpperCase())}`);
  if (callsigns) filters.push(`callsigns=${encodeURIComponent(callsigns.toUpperCase())}`);
  if (registrations) filters.push(`registrations=${encodeURIComponent(registrations.toUpperCase())}`);
  if (airline) filters.push(`operating_as=${encodeURIComponent(airline.toUpperCase())}`);
  if (airport) filters.push(`airports=${encodeURIComponent(`both:${airport.toUpperCase()}`)}`);

  let upstreamQuery: string;
  if (filters.length > 0) {
    upstreamQuery = filters.join('&');
  } else {
    const lamin = sp.get('lamin') ?? '-4.9';
    const lomin = sp.get('lomin') ?? '33.9';
    const lamax = sp.get('lamax') ?? '5.2';
    const lomax = sp.get('lomax') ?? '41.9';
    // FR24 bounds order: north, south, west, east
    upstreamQuery = `bounds=${encodeURIComponent(`${lamax},${lamin},${lomin},${lomax}`)}`;
  }
  upstreamQuery += `&limit=${RESPONSE_LIMIT}`;

  const cached = cache.get(upstreamQuery);
  if (cached && Date.now() - cached.at <= CACHE_TTL_MS) {
    return NextResponse.json({ flights: cached.flights, limit: RESPONSE_LIMIT, updatedAt: new Date(cached.at).toISOString() });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${FR24_BASE}/api/live/flight-positions/full?${upstreamQuery}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Version': 'v1',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Could not reach FlightRadar24.' }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    const message =
      upstream.status === 401 || upstream.status === 403
        ? 'FlightRadar24 rejected the API token.'
        : upstream.status === 429
          ? 'FlightRadar24 rate limit reached. Try again shortly.'
          : `FlightRadar24 error (${upstream.status}).`;
    return NextResponse.json({ error: message, detail: detail.slice(0, 300) }, { status: upstream.status });
  }

  const data = (await upstream.json().catch(() => null)) as { data?: Fr24Position[] } | null;
  const rows = data?.data ?? [];

  const flights = rows.map(toFlight);
  const at = Date.now();
  remember(upstreamQuery, flights, at);

  return NextResponse.json({ flights, limit: RESPONSE_LIMIT, updatedAt: new Date(at).toISOString() });
}

function toFlight(r: Fr24Position) {
  return {
    id: str(r.fr24_id) ?? str(r.hex) ?? Math.random().toString(36).slice(2),
    flight: str(r.flight),
    callsign: str(r.callsign),
    hex: str(r.hex),
    lat: num(r.lat),
    lon: num(r.lon),
    track: num(r.track),
    altFt: num(r.alt),
    gspeedKt: num(r.gspeed),
    vspeedFpm: num(r.vspeed),
    type: str(r.type),
    reg: str(r.reg),
    airline: str(r.painted_as) ?? str(r.operating_as),
    origIata: str(r.orig_iata),
    origIcao: str(r.orig_icao),
    destIata: str(r.dest_iata),
    destIcao: str(r.dest_icao),
    eta: str(r.eta),
    // City names and coordinates for the cards, route line and progress.
    origin: findAirport(str(r.orig_icao), str(r.orig_iata)),
    destination: findAirport(str(r.dest_icao), str(r.dest_iata)),
  };
}
