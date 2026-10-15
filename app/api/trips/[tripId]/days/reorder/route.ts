import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { tripForViewer } from '@/lib/trip-costs';
import { reorderTripDays } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripDayReorderSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const tripId = parseId(raw);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripDayReorderSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await reorderTripDays({
    tripId,
    userId: auth.user.id,
    isAdmin,
    dayIds: validation.data.dayIds,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  // Reordering days shifts every downstream date, so the client needs the full
  // refreshed trip back rather than an acknowledgement.
  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}
