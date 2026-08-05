import { NextRequest, NextResponse } from 'next/server';

import { getAllPresence, getPresenceFor } from '@/lib/presence';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Presence for the requested users, or for every active user when no ids are
 * given. `?ids=1,2,3`
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const raw = new URL(request.url).searchParams.get('ids');

  const presence = raw
    ? await getPresenceFor(
        raw
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((value) => Number.isInteger(value) && value > 0),
      )
    : await getAllPresence();

  return NextResponse.json({ presence });
}
