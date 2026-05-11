import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';


const tripCreateSchema = z.object({
  title: z.string().trim().min(1, 'Trip name is required').max(120),
  destination: z.string().trim().max(120).optional().nullable(),
  imageUrl: z.union([z.string().trim().url(), z.literal('')]).optional().nullable(),
  startDate: z.string().trim().optional().nullable(),
  endDate: z.string().trim().optional().nullable(),
  status: z.enum(['draft', 'in-progress', 'confirmed', 'archived']).optional(),
});

function parseDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeTrip(trip: any) {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    imageUrl: trip.imageUrl,
    startDate: trip.startDate instanceof Date ? trip.startDate.toISOString() : null,
    endDate: trip.endDate instanceof Date ? trip.endDate.toISOString() : null,
    status: trip.status,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const trips = await prisma.trip.findMany({
    where: { userId: auth.user.id },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json({ trips: trips.map(serializeTrip) });
}

export async function POST(request: NextRequest) {
  try {
    const { auth, response } = await requireRequestAuth(request);

    if (response || !auth) {
      return response;
    }

    const body = await request.json().catch(() => null);
    const validation = tripCreateSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const startDate = parseDate(validation.data.startDate);
    const endDate = parseDate(validation.data.endDate);

    if (validation.data.startDate && !startDate) {
      return NextResponse.json({ error: 'Invalid start date' }, { status: 400 });
    }

    if (validation.data.endDate && !endDate) {
      return NextResponse.json({ error: 'Invalid end date' }, { status: 400 });
    }

    const trip = await prisma.trip.create({
      data: {
        userId: auth.user.id,
        title: validation.data.title,
        destination: validation.data.destination ?? null,
        imageUrl: validation.data.imageUrl ?? null,
        startDate,
        endDate,
        status: validation.data.status ?? 'draft',
      } as any,
    });

    return NextResponse.json({ trip: serializeTrip(trip) }, { status: 201 });
  } catch (err: any) {
    console.error('GLOBAL TRIP CREATE ERROR:', err);

    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
