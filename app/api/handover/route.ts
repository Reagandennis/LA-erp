import { NextRequest, NextResponse } from 'next/server';

import { computeStats, createHandover, listHandovers } from '@/lib/handover';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function canAccess(user: Parameters<typeof userHasModule>[0]): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'handover');
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canAccess(auth.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const handovers = await listHandovers();
  return NextResponse.json({ handovers, stats: computeStats(handovers) });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canAccess(auth.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createHandover({
      userId: auth.user.id,
      shiftDate: typeof body.shiftDate === 'string' ? body.shiftDate : null,
      shiftPeriod: typeof body.shiftPeriod === 'string' ? body.shiftPeriod : undefined,
      post: body.post ?? null,
      status: typeof body.status === 'string' ? body.status : undefined,
      summary: String(body.summary ?? ''),
      incidents: body.incidents ?? null,
      watchItems: body.watchItems ?? null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save handover';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
