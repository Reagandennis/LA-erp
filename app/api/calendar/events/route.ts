import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { createEvent, listEvents } from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.calendar);
  if (response || !auth) return response;

  const fromRaw = request.nextUrl.searchParams.get('from');
  const toRaw = request.nextUrl.searchParams.get('to');
  const from = fromRaw ? new Date(fromRaw) : new Date(Date.now() - 31 * 86400000);
  const to = toRaw ? new Date(toRaw) : new Date(Date.now() + 62 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  const events = await listEvents(auth.user.id, from, to);
  return NextResponse.json({ events });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.calendar);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title : '';
  const startsAt = typeof body.startsAt === 'string' ? new Date(body.startsAt) : new Date(NaN);
  if (!title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }
  if (Number.isNaN(startsAt.getTime())) {
    return NextResponse.json({ error: 'A valid start time is required' }, { status: 400 });
  }
  const endsAt = typeof body.endsAt === 'string' && body.endsAt ? new Date(body.endsAt) : null;
  const reminder =
    body.reminderMinutesBefore === null || body.reminderMinutesBefore === undefined
      ? null
      : Number(body.reminderMinutesBefore);

  try {
    const event = await createEvent(auth.user.id, {
      title,
      description: typeof body.description === 'string' ? body.description : null,
      location: typeof body.location === 'string' ? body.location : null,
      tag: typeof body.tag === 'string' ? body.tag : null,
      startsAt,
      endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
      allDay: Boolean(body.allDay),
      reminderMinutesBefore: reminder != null && Number.isFinite(reminder) ? reminder : null,
      googleEventId: typeof body.googleEventId === 'string' ? body.googleEventId : null,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create event';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
