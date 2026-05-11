import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.number().int().positive(),
    dayNumber: z.number().int().positive().max(365),
    sortOrder: z.number().int().nonnegative(),
  })).min(1),
});

function parseTripId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serializeItem(item: any) {
  return {
    id: item.id,
    dayNumber: item.dayNumber,
    title: item.title,
    location: item.location,
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
  const validation = reorderSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const existingItems = await prisma.tripItineraryItem.findMany({
    where: { tripId },
    orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const existingIds = new Set(existingItems.map((item) => item.id));
  const proposedIds = new Set(validation.data.items.map((item) => item.id));

  if (existingIds.size !== proposedIds.size || existingItems.some((item) => !proposedIds.has(item.id))) {
    return NextResponse.json({ error: 'Reorder payload must include every itinerary item exactly once' }, { status: 400 });
  }

  await prisma.$transaction(
    validation.data.items.map((item) =>
      prisma.tripItineraryItem.update({
        where: { id: item.id },
        data: {
          dayNumber: item.dayNumber,
          sortOrder: item.sortOrder,
        },
      }),
    ),
  );

  const items = await prisma.tripItineraryItem.findMany({
    where: { tripId },
    orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  return NextResponse.json({ items: items.map(serializeItem) });
}
