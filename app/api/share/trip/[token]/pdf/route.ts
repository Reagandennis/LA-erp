import { NextRequest, NextResponse } from 'next/server';

import { buildTripItineraryPdf } from '@/lib/document-pdf';
import { enforceRateLimit } from '@/lib/rate-limit';
import { itineraryFilename, openSharedTrip } from '@/lib/trip-share';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Public: the PDF behind a client's share link. The token is the credential
 * (lib/trip-share.ts), so this answers whoever holds the link, and only while
 * the trip is active.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const shared = await openSharedTrip(token);
  if (!shared) return NextResponse.json({ error: 'Link not found' }, { status: 404 });
  if (shared.state === 'ended') {
    return NextResponse.json({ error: 'This trip has ended, so its link no longer works' }, { status: 410 });
  }

  // Rendering is the expensive part; a link passed around shouldn't be able to run the server hot.
  const rateLimit = await enforceRateLimit({
    scope: 'trip-share.pdf',
    key: `link:${shared.linkId}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many downloads. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const pdf = await buildTripItineraryPdf(shared.itinerary, shared.brandProfileId);
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${itineraryFilename(shared.itinerary.reference)}"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  });
}
