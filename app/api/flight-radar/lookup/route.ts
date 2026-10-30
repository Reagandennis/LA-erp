import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { classifyQuery, lookupFlights } from '@/lib/flight-lookup';
import { FlightTrackingError } from '@/lib/flight-tracking';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The flight form's "Look up": `?q=KQ100` or `?q=5Y-KZX` → what FR24 has flown lately (see lib/flight-lookup). */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.flights);
  if (response || !auth) return response;

  // Up to twenty flights come back per answer, each billed: a tighter budget than the status polls.
  const rateLimit = await enforceRateLimit({
    scope: 'flight.lookup',
    key: `${auth.user.id}`,
    limit: 20,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many flight lookups. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q || !classifyQuery(q)) {
    return NextResponse.json({ error: 'Enter a flight number like KQ100 or a tail number like 5Y-KZX.' }, { status: 400 });
  }

  try {
    return NextResponse.json({ lookup: await lookupFlights(q) });
  } catch (error) {
    if (error instanceof FlightTrackingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
