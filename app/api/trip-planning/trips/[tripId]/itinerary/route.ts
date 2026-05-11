import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

const itineraryCreateSchema = z.object({
  dayNumber: z.number().int().positive().max(365),
  title: z.string().trim().min(1).max(160),
  itemType: z.string().trim().default('Note'),
  location: z.string().trim().max(160).optional().nullable(),
  startLocation: z.string().trim().max(160).optional().nullable(),
  endLocation: z.string().trim().max(160).optional().nullable(),
  startTime: z.string().trim().optional().nullable(),
  endTime: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

function parseTripId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeItem(item: any) {
  return {
    id: item.id,
    dayNumber: item.dayNumber,
    title: item.title,
    itemType: item.itemType,
    location: item.location,
    startLocation: item.startLocation,
    endLocation: item.endLocation,
    startTime: item.startTime?.toISOString() ?? null,
    endTime: item.endTime?.toISOString() ?? null,
    notes: item.notes,
    sortOrder: item.sortOrder,
  };
}

async function ensureTripAccess(tripId: number, userId: number) {
  return prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const { tripId: rawTripId } = await params;
  const tripId = parseTripId(rawTripId);

  if (!tripId) {
    return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });
  }

  const trip = await ensureTripAccess(tripId, auth.user.id);

  if (!trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const items = await prisma.tripItineraryItem.findMany({
    where: { tripId },
    orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  return NextResponse.json({ items: items.map(serializeItem) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const { tripId: rawTripId } = await params;
  const tripId = parseTripId(rawTripId);

  if (!tripId) {
    return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });
  }

  const trip = await ensureTripAccess(tripId, auth.user.id);

  if (!trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const validation = itineraryCreateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const startTime = parseDate(validation.data.startTime);
  const endTime = parseDate(validation.data.endTime);

  if (validation.data.startTime && !startTime) {
    return NextResponse.json({ error: 'Invalid start time' }, { status: 400 });
  }

  if (validation.data.endTime && !endTime) {
    return NextResponse.json({ error: 'Invalid end time' }, { status: 400 });
  }

  const currentMaxSortOrder = await prisma.tripItineraryItem.aggregate({
    where: { tripId, dayNumber: validation.data.dayNumber },
    _max: { sortOrder: true },
  });

  await prisma.tripItineraryItem.create({
    data: {
      tripId,
      dayNumber: validation.data.dayNumber,
      title: validation.data.title,
      itemType: validation.data.itemType,
      location: validation.data.location ?? null,
      startLocation: validation.data.startLocation ?? null,
      endLocation: validation.data.endLocation ?? null,
      startTime,
      endTime,
      notes: validation.data.notes ?? null,
      sortOrder: (currentMaxSortOrder._max.sortOrder ?? -1) + 1,
    } as any,
  });

  const items = await prisma.tripItineraryItem.findMany({
    where: { tripId },
    orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  return NextResponse.json({ items: items.map(serializeItem) }, { status: 201 });
}
