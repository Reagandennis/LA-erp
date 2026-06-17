import { NextRequest, NextResponse } from 'next/server';

import { canManageHandover, deleteHandover, getHandover, updateHandover } from '@/lib/handover';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function canAccess(user: Parameters<typeof userHasModule>[0]): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, 'handover');
}

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canAccess(auth.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid handover id' }, { status: 400 });

  const item = await getHandover(id);
  if (!item) return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canAccess(auth.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid handover id' }, { status: 400 });

  const owns = await canManageHandover(id, auth.user.id);
  if (owns === null) return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
  if (!owns && !userHasRole(auth.user, ADMIN_ROLE_NAME)) {
    return NextResponse.json({ error: 'Only the author can edit this handover' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: {
    shiftDate?: string | null;
    shiftPeriod?: string;
    post?: string | null;
    status?: string;
    summary?: string;
    incidents?: string | null;
    watchItems?: string | null;
  } = {};
  if (typeof body.shiftDate === 'string' || body.shiftDate === null) patch.shiftDate = body.shiftDate;
  if (typeof body.shiftPeriod === 'string') patch.shiftPeriod = body.shiftPeriod;
  if (typeof body.post === 'string' || body.post === null) patch.post = body.post;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.summary === 'string') patch.summary = body.summary;
  if (typeof body.incidents === 'string' || body.incidents === null) patch.incidents = body.incidents;
  if (typeof body.watchItems === 'string' || body.watchItems === null) patch.watchItems = body.watchItems;

  const item = await updateHandover(id, patch);
  if (item === null) return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canAccess(auth.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid handover id' }, { status: 400 });

  const owns = await canManageHandover(id, auth.user.id);
  if (owns === null) return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
  if (!owns && !userHasRole(auth.user, ADMIN_ROLE_NAME)) {
    return NextResponse.json({ error: 'Only the author can delete this handover' }, { status: 403 });
  }

  const ok = await deleteHandover(id);
  if (!ok) return NextResponse.json({ error: 'Handover not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
