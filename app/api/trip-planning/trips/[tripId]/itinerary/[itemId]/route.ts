import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

const itineraryUpdateSchema = z.object({
  dayNumber: z.number().int().positive().max(365).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  itemType: z.string().trim().optional(),
  location: z.string().trim().max(160).optional().nullable(),
  startLocation: z.string().trim().max(160).optional().nullable(),
  endLocation: z.string().trim().max(160).optional().nullable(),
  startTime: z.string().trim().optional().nullable(),
  endTime: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
}).refine(
  (value) =>
    value.dayNumber !== undefined ||
    value.title !== undefined ||
    value.itemType !== undefined ||
    value.location !== undefined ||
    value.startLocation !== undefined ||
    value.endLocation !== undefined ||
    value.startTime !== undefined ||
    value.endTime !== undefined ||
    value.notes !== undefined,
  { message: 'At least one field must be updated' },
);

function parseId(value: string) {
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const { tripId: rawTripId, itemId: rawItemId } = await params;
  const tripId = parseId(rawTripId);
  const itemId = parseId(rawItemId);

  if (!tripId || !itemId) {
    return NextResponse.json({ error: 'Invalid itinerary item' }, { status: 400 });
  }

  const trip = await ensureTripAccess(tripId, auth.user.id);
  if (!trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const existingItem = await prisma.tripItineraryItem.findFirst({
    where: { id: itemId, tripId },
  });

  if (!existingItem) {
    return NextResponse.json({ error: 'Itinerary item not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const validation = itineraryUpdateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const startTime = validation.data.startTime === undefined
    ? undefined
    : parseDate(validation.data.startTime);
  const endTime = validation.data.endTime === undefined
    ? undefined
    : parseDate(validation.data.endTime);

  if (validation.data.startTime && !startTime) {
    return NextResponse.json({ error: 'Invalid start time' }, { status: 400 });
  }

  if (validation.data.endTime && !endTime) {
    return NextResponse.json({ error: 'Invalid end time' }, { status: 400 });
  }

  await prisma.tripItineraryItem.update({
    where: { id: itemId },
    data: {
      dayNumber: validation.data.dayNumber,
      title: validation.data.title,
      itemType: validation.data.itemType,
      location: validation.data.location,
      startLocation: validation.data.startLocation,
      endLocation: validation.data.endLocation,
      startTime,
      endTime,
      notes: validation.data.notes,
    } as any,
  });

  const updatedItem = await prisma.tripItineraryItem.findFirst({
    where: { id: itemId, tripId },
  });

  if (!updatedItem) {
    return NextResponse.json({ error: 'Itinerary item not found' }, { status: 404 });
  }

  return NextResponse.json({ item: serializeItem(updatedItem) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const { tripId: rawTripId, itemId: rawItemId } = await params;
  const tripId = parseId(rawTripId);
  const itemId = parseId(rawItemId);

  if (!tripId || !itemId) {
    return NextResponse.json({ error: 'Invalid itinerary item' }, { status: 400 });
  }

  const trip = await ensureTripAccess(tripId, auth.user.id);
  if (!trip) {
    return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  }

  const existingItem = await prisma.tripItineraryItem.findFirst({
    where: { id: itemId, tripId },
  });

  if (!existingItem) {
    return NextResponse.json({ error: 'Itinerary item not found' }, { status: 404 });
  }

  await prisma.tripItineraryItem.delete({
    where: { id: itemId },
  });

  return NextResponse.json({ success: true });
}
