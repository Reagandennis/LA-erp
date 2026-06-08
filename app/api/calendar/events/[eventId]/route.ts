import { NextRequest, NextResponse } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { deleteEvent, updateEvent } from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { eventId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description;
  if (typeof body.location === 'string' || body.location === null) patch.location = body.location;
  if (typeof body.tag === 'string' || body.tag === null) patch.tag = body.tag;
  if (typeof body.allDay === 'boolean') patch.allDay = body.allDay;
  if (typeof body.googleEventId === 'string' || body.googleEventId === null) patch.googleEventId = body.googleEventId;
  if (typeof body.startsAt === 'string' && body.startsAt) {
    const d = new Date(body.startsAt);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid start time' }, { status: 400 });
    patch.startsAt = d;
  }
  if (typeof body.endsAt === 'string' && body.endsAt) {
    const d = new Date(body.endsAt);
    if (!Number.isNaN(d.getTime())) patch.endsAt = d;
  } else if (body.endsAt === null) {
    patch.endsAt = null;
  }
  if (body.reminderMinutesBefore === null) patch.reminderMinutesBefore = null;
  else if (body.reminderMinutesBefore !== undefined) {
    const n = Number(body.reminderMinutesBefore);
    if (Number.isFinite(n)) patch.reminderMinutesBefore = n;
  }

  const result = await updateEvent(id, auth.user.id, patch);
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  return NextResponse.json({ event: result.event });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { eventId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid event id' }, { status: 400 });

  const ok = await deleteEvent(id, auth.user.id);
  if (!ok) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
