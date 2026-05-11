import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

const invoiceCreateSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(40),
  status: z.enum(['draft', 'sent', 'paid']).default('draft'),
  amountCents: z.number().int().nonnegative(),
  dueDate: z.string().trim().optional().nullable(),
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

function serializeInvoice(item: {
  id: number;
  invoiceNumber: string;
  status: string;
  amountCents: number;
  dueDate: Date | null;
}) {
  return {
    id: item.id,
    invoiceNumber: item.invoiceNumber,
    status: item.status,
    amountCents: item.amountCents,
    dueDate: item.dueDate?.toISOString() ?? null,
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

  const invoices = await prisma.tripInvoice.findMany({
    where: { tripId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ invoices: invoices.map(serializeInvoice) });
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
  const validation = invoiceCreateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const dueDate = parseDate(validation.data.dueDate);

  if (validation.data.dueDate && !dueDate) {
    return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
  }

  await prisma.tripInvoice.create({
    data: {
      tripId,
      invoiceNumber: validation.data.invoiceNumber,
      status: validation.data.status,
      amountCents: validation.data.amountCents,
      dueDate,
      issuedAt: validation.data.status === 'sent' ? new Date() : null,
      paidAt: validation.data.status === 'paid' ? new Date() : null,
    },
  });

  const invoices = await prisma.tripInvoice.findMany({
    where: { tripId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ invoices: invoices.map(serializeInvoice) }, { status: 201 });
}
