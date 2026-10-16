import { NextRequest, NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/rate-limit';
import { requireRequestAuth } from '@/lib/request-auth';
import { MAX_QUERY, MIN_QUERY, searchEverything } from '@/lib/search';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Global search (`?q=`), behind the search box in the top bar. Results are
 * limited to the modules — and, within them, the records — the caller can
 * already see.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  // Typing fires a request per pause; this still stops a script from crawling.
  const rateLimit = await enforceRateLimit({ scope: 'search', key: `${auth.user.id}`, limit: 120, windowMs: 60 * 1000 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Searching too fast. Wait a moment.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < MIN_QUERY) return NextResponse.json({ groups: [] });

  const groups = await searchEverything(auth.user, q.slice(0, MAX_QUERY));
  return NextResponse.json({ groups }, { headers: { 'Cache-Control': 'no-store' } });
}
