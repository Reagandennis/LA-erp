import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { normalizeFlightNumber } from '@/lib/flight-status';
import { FlightTrackingError, lookupFlightTrack } from '@/lib/flight-tracking';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseInstant(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Take-off, landing and live ETA for one scheduled flight (see lib/flight-tracking). */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.flights);
  if (response || !auth) return response;

  // Shares the live map's budget: both spend the same paid FR24 credits.
  const rateLimit = await enforceRateLimit({
    scope: 'flight.radar',
    key: `${auth.user.id}`,
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many flight lookups. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const sp = request.nextUrl.searchParams;
  const flightNumber = normalizeFlightNumber(sp.get('flight'));
  if (!flightNumber) return NextResponse.json({ error: 'A valid flight number is required' }, { status: 400 });

  const departure = parseInstant(sp.get('departure'));
  const arrival = parseInstant(sp.get('arrival'));
  if (!departure && !arrival) {
    return NextResponse.json({ error: 'A departure or arrival time is required' }, { status: 400 });
  }

  try {
    const track = await lookupFlightTrack({ flightNumber, departure, arrival });
    return NextResponse.json({ track });
  } catch (error) {
    if (error instanceof FlightTrackingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
