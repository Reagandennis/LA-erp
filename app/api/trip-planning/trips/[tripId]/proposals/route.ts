import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

const proposalCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  status: z.enum(['draft', 'sent', 'accepted']).default('draft'),
  amountCents: z.number().int().nonnegative(),
});

function parseTripId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serializeProposal(item: {
  id: number;
  title: string;
  status: string;
  version: number;
  amountCents: number;
  createdAt: Date;
}) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    version: item.version,
    amountCents: item.amountCents,
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

  const proposals = await prisma.tripProposal.findMany({
    where: { tripId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ proposals: proposals.map(serializeProposal) });
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
  const validation = proposalCreateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  await prisma.tripProposal.create({
    data: {
      tripId,
      title: validation.data.title,
      status: validation.data.status,
      amountCents: validation.data.amountCents,
    },
  });

  const proposals = await prisma.tripProposal.findMany({
    where: { tripId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ proposals: proposals.map(serializeProposal) }, { status: 201 });
}
