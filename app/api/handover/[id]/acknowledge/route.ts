import { NextRequest, NextResponse } from 'next/server';

import { acknowledgeHandover } from '@/lib/handover';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'handover')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid handover id' }, { status: 400 });

  try {
    const item = await acknowledgeHandover(id, auth.user.id);
    if (item === null) return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not acknowledge handover';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
