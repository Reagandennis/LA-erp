import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'node:crypto';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

const portalCreateSchema = z.object({
  expiresAt: z.string().trim().optional().nullable(),
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

function serializePortal(item: {
  id: number;
  token: string;
  isActive: boolean;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: item.id,
    token: item.token,
    isActive: item.isActive,
    expiresAt: item.expiresAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
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

  const portals = await prisma.tripClientPortal.findMany({
    where: { tripId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ portals: portals.map(serializePortal) });
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
  const validation = portalCreateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const expiresAt = parseDate(validation.data.expiresAt);

  if (validation.data.expiresAt && !expiresAt) {
    return NextResponse.json({ error: 'Invalid expiry date' }, { status: 400 });
  }

  const token = crypto.randomBytes(16).toString('hex');

  await prisma.tripClientPortal.create({
    data: {
      tripId,
      token,
      expiresAt,
    },
  });

  const portals = await prisma.tripClientPortal.findMany({
    where: { tripId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ portals: portals.map(serializePortal) }, { status: 201 });
}
