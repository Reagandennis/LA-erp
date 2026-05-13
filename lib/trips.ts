import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';

export type TripStatus = 'Draft' | 'Planned' | 'Active' | 'Completed' | 'Cancelled';

export const TRIP_STATUSES: TripStatus[] = ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

export interface TripItineraryItemDraft {
  description: string;
  quantity: number;
  unitPrice?: number | null;
  sourceQuoteItemId?: number | null;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  reminderMinutesBefore?: number | null;
}

export interface TripItineraryItemSummary {
  id: number;
  position: number;
  description: string;
  quantity: number;
  unitPrice: number | null;
  completedAt: string | null;
  sourceQuoteItemId: number | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  reminderMinutesBefore: number | null;
  reminderAt: string | null;
}

export interface TripSummary {
  id: number;
  reference: string;
  trackingCode: string;
  title: string;
  description: string | null;
  status: TripStatus;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  owner: { id: number; name: string; email: string } | null;
  sourceQuote: { id: number; reference: string } | null;
  itemCount: number;
}

export interface TripDetail extends TripSummary {
  items: TripItineraryItemSummary[];
}

interface TripRecord {
  id: number;
  reference: string;
  trackingCode: string;
  customerId: number;
  sourceQuoteId: number | null;
  createdById: number;
  ownerId: number | null;
  title: string;
  description: string | null;
  status: string;
  startDate: Date | null;
  endDate: Date | null;
  currency: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: number; name: string; company: string | null; email: string | null };
  createdBy: { id: number; name: string; email: string };
  owner: { id: number; name: string; email: string } | null;
  sourceQuote: { id: number; reference: string } | null;
  items: TripItineraryItemRecord[];
}

interface TripItineraryItemRecord {
  id: number;
  position: number;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  completedAt: Date | null;
  sourceQuoteItemId: number | null;
  scheduledAt: Date | null;
  durationMinutes: number | null;
  reminderMinutesBefore: number | null;
  reminderAt: Date | null;
  reminderSentAt: Date | null;
}

const tripInclude = {
  customer: { select: { id: true, name: true, company: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  owner: { select: { id: true, name: true, email: true } },
  sourceQuote: { select: { id: true, reference: true } },
  items: {
    orderBy: [
      { scheduledAt: 'asc' as const },
      { position: 'asc' as const },
    ],
  },
};

type TripCollectionClient = {
  findMany: (args: {
    where?: unknown;
    include?: typeof tripInclude;
    orderBy?: Array<{ createdAt?: 'asc' | 'desc'; updatedAt?: 'asc' | 'desc' }>;
  }) => Promise<TripRecord[]>;
  findUnique: (args: { where: { id: number }; include?: typeof tripInclude }) => Promise<TripRecord | null>;
  create: (args: { data: Record<string, unknown>; include?: typeof tripInclude }) => Promise<TripRecord>;
  update: (args: { where: { id: number }; data: Record<string, unknown>; include?: typeof tripInclude }) => Promise<TripRecord>;
  delete: (args: { where: { id: number } }) => Promise<TripRecord>;
};

type TripItineraryItemCollectionClient = {
  createMany: (args: {
    data: Array<{
      tripId: number;
      position: number;
      description: string;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal | null;
      sourceQuoteItemId: number | null;
      scheduledAt?: Date | null;
      durationMinutes?: number | null;
      reminderMinutesBefore?: number | null;
      reminderAt?: Date | null;
    }>;
  }) => Promise<{ count: number }>;
  findUnique: (args: { where: { id: number } }) => Promise<TripItineraryItemRecord | null>;
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => Promise<TripItineraryItemRecord>;
  delete: (args: { where: { id: number } }) => Promise<TripItineraryItemRecord>;
};

type TripSequenceCollectionClient = {
  upsert: (args: {
    where: { year: number };
    create: { year: number; lastNumber: number };
    update: { lastNumber: { increment: number } };
  }) => Promise<{ year: number; lastNumber: number }>;
};

type TrackingSequenceCollectionClient = TripSequenceCollectionClient;

type QuoteForTripUpdateClient = {
  findUnique: (args: {
    where: { id: number };
    include: { items: true; trip: { select: { id: true } } };
  }) => Promise<
    | (Record<string, unknown> & {
        id: number;
        status: string;
        trackingCode: string | null;
        customerId: number;
        currency: string;
        subject: string;
        expiryDate: Date;
        items: Array<{ id: number; position: number; description: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal }>;
        trip: { id: number } | null;
      })
    | null
  >;
  update: (args: { where: { id: number }; data: { trackingCode: string } }) => Promise<unknown>;
};

const tripClient = (prisma as unknown as { trip: TripCollectionClient }).trip;

function txClients(tx: unknown) {
  const handle = tx as unknown as {
    trip: TripCollectionClient;
    tripItineraryItem: TripItineraryItemCollectionClient;
    tripSequence: TripSequenceCollectionClient;
    trackingSequence: TrackingSequenceCollectionClient;
    quote: QuoteForTripUpdateClient;
  };
  return {
    trip: handle.trip,
    tripItineraryItem: handle.tripItineraryItem,
    tripSequence: handle.tripSequence,
    trackingSequence: handle.trackingSequence,
    quote: handle.quote,
  };
}

function toNumber(value: Prisma.Decimal | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function asDecimal(value: number | Prisma.Decimal): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

function serializeItem(item: TripItineraryItemRecord): TripItineraryItemSummary {
  return {
    id: item.id,
    position: item.position,
    description: item.description,
    quantity: toNumber(item.quantity) ?? 0,
    unitPrice: toNumber(item.unitPrice),
    completedAt: item.completedAt?.toISOString() ?? null,
    sourceQuoteItemId: item.sourceQuoteItemId,
    scheduledAt: item.scheduledAt?.toISOString() ?? null,
    durationMinutes: item.durationMinutes,
    reminderMinutesBefore: item.reminderMinutesBefore,
    reminderAt: item.reminderAt?.toISOString() ?? null,
  };
}

function computeReminderAt(
  scheduledAt: Date | null,
  reminderMinutesBefore: number | null,
): Date | null {
  if (!scheduledAt || reminderMinutesBefore == null) return null;
  return new Date(scheduledAt.getTime() - reminderMinutesBefore * 60_000);
}

function parseScheduledAt(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function serializeSummary(record: TripRecord): TripSummary {
  return {
    id: record.id,
    reference: record.reference,
    trackingCode: record.trackingCode,
    title: record.title,
    description: record.description,
    status: record.status as TripStatus,
    currency: record.currency,
    startDate: record.startDate?.toISOString() ?? null,
    endDate: record.endDate?.toISOString() ?? null,
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    customer: record.customer,
    createdBy: record.createdBy,
    owner: record.owner,
    sourceQuote: record.sourceQuote,
    itemCount: record.items?.length ?? 0,
  };
}

function serializeDetail(record: TripRecord): TripDetail {
  return { ...serializeSummary(record), items: record.items.map(serializeItem) };
}

async function reserveSequence(
  client: TripSequenceCollectionClient | TrackingSequenceCollectionClient,
  year: number,
): Promise<number> {
  const next = await client.upsert({
    where: { year },
    create: { year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return next.lastNumber;
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function buildAccessFilter(userId: number, isAdmin: boolean) {
  if (isAdmin) return {};
  return { OR: [{ createdById: userId }, { ownerId: userId }] };
}

export async function listTripsForUser(params: {
  userId: number;
  isAdmin: boolean;
}): Promise<TripSummary[]> {
  const records = await tripClient.findMany({
    where: buildAccessFilter(params.userId, params.isAdmin),
    include: tripInclude,
    orderBy: [{ updatedAt: 'desc' }],
  });
  return records.map(serializeSummary);
}

export async function getTripForUser(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<TripDetail | null> {
  const record = await tripClient.findUnique({ where: { id: params.id }, include: tripInclude });
  if (!record) return null;
  const isParticipant =
    params.isAdmin || record.createdById === params.userId || record.ownerId === params.userId;
  if (!isParticipant) return null;
  return serializeDetail(record);
}

function canEditTrip(record: TripRecord, userId: number, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (record.status === 'Completed') {
    // mirror approver-revise-after-Approved: only owner can revise after completion
    return record.ownerId === userId;
  }
  if (record.status === 'Cancelled') return false;
  return record.createdById === userId || record.ownerId === userId;
}

export interface TripCreateInput {
  customerId: number;
  ownerId: number | null;
  title: string;
  description: string | null;
  status?: TripStatus;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  notes: string | null;
  items: TripItineraryItemDraft[];
  createdById: number;
}

export async function createTrip(input: TripCreateInput): Promise<TripDetail> {
  const year = input.startDate
    ? new Date(input.startDate).getUTCFullYear()
    : new Date().getUTCFullYear();

  return prisma.$transaction(async (tx) => {
    const { trip, tripItineraryItem, tripSequence, trackingSequence } = txClients(tx);

    const tripSeq = await reserveSequence(tripSequence, year);
    const trackingSeq = await reserveSequence(trackingSequence, year);
    const reference = `TR-${year}-${pad4(tripSeq)}`;
    const trackingCode = `LA-${year}-${pad4(trackingSeq)}`;

    const created = await trip.create({
      data: {
        reference,
        trackingCode,
        customerId: input.customerId,
        createdById: input.createdById,
        ownerId: input.ownerId,
        title: input.title,
        description: input.description,
        status: input.status ?? 'Draft',
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        currency: input.currency,
        notes: input.notes,
      },
      include: tripInclude,
    });

    if (input.items.length > 0) {
      await tripItineraryItem.createMany({
        data: input.items.map((item, index) => {
          const scheduledAt = parseScheduledAt(item.scheduledAt);
          const reminderMinutesBefore = item.reminderMinutesBefore ?? null;
          return {
            tripId: created.id,
            position: index,
            description: item.description,
            quantity: asDecimal(item.quantity),
            unitPrice: item.unitPrice == null ? null : asDecimal(item.unitPrice),
            sourceQuoteItemId: item.sourceQuoteItemId ?? null,
            scheduledAt,
            durationMinutes: item.durationMinutes ?? null,
            reminderMinutesBefore,
            reminderAt: computeReminderAt(scheduledAt, reminderMinutesBefore),
          };
        }),
      });
    }

    const fresh = await trip.findUnique({ where: { id: created.id }, include: tripInclude });
    return serializeDetail(fresh!);
  });
}

export interface TripUpdateInput {
  customerId?: number;
  ownerId?: number | null;
  title?: string;
  description?: string | null;
  status?: TripStatus;
  startDate?: string | null;
  endDate?: string | null;
  currency?: string;
  notes?: string | null;
}

export async function updateTrip(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
  input: TripUpdateInput;
}): Promise<TripDetail | { error: string; status?: number }> {
  const existing = await tripClient.findUnique({ where: { id: params.id }, include: tripInclude });
  if (!existing) return { error: 'Trip not found', status: 404 };
  if (!canEditTrip(existing, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a trip in status "${existing.status}"`, status: 400 };
  }

  await tripClient.update({
    where: { id: params.id },
    data: {
      customerId: params.input.customerId ?? existing.customerId,
      ownerId: params.input.ownerId === undefined ? existing.ownerId : params.input.ownerId,
      title: params.input.title ?? existing.title,
      description: params.input.description === undefined ? existing.description : params.input.description,
      status: params.input.status ?? existing.status,
      startDate:
        params.input.startDate === undefined
          ? existing.startDate
          : params.input.startDate === null
            ? null
            : new Date(params.input.startDate),
      endDate:
        params.input.endDate === undefined
          ? existing.endDate
          : params.input.endDate === null
            ? null
            : new Date(params.input.endDate),
      currency: params.input.currency ?? existing.currency,
      notes: params.input.notes === undefined ? existing.notes : params.input.notes,
    },
  });

  const refreshed = await tripClient.findUnique({ where: { id: params.id }, include: tripInclude });
  return serializeDetail(refreshed!);
}

export async function deleteTrip(params: {
  id: number;
  userId: number;
  isAdmin: boolean;
}): Promise<true | { error: string; status?: number }> {
  const existing = await tripClient.findUnique({ where: { id: params.id }, include: tripInclude });
  if (!existing) return { error: 'Trip not found', status: 404 };
  if (!params.isAdmin && existing.createdById !== params.userId) {
    return { error: 'Only the creator can delete this trip', status: 403 };
  }
  if (existing.status !== 'Draft' && existing.status !== 'Cancelled') {
    return { error: `Cannot delete a trip in status "${existing.status}"`, status: 400 };
  }
  await tripClient.delete({ where: { id: params.id } });
  return true;
}

export async function addTripItems(params: {
  tripId: number;
  userId: number;
  isAdmin: boolean;
  items: TripItineraryItemDraft[];
}): Promise<TripDetail | { error: string; status?: number }> {
  const existing = await tripClient.findUnique({ where: { id: params.tripId }, include: tripInclude });
  if (!existing) return { error: 'Trip not found', status: 404 };
  if (!canEditTrip(existing, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a trip in status "${existing.status}"`, status: 400 };
  }

  return prisma.$transaction(async (tx) => {
    const { trip, tripItineraryItem } = txClients(tx);
    const startPosition = existing.items.length;
    await tripItineraryItem.createMany({
      data: params.items.map((item, idx) => {
        const scheduledAt = parseScheduledAt(item.scheduledAt);
        const reminderMinutesBefore = item.reminderMinutesBefore ?? null;
        return {
          tripId: params.tripId,
          position: startPosition + idx,
          description: item.description,
          quantity: asDecimal(item.quantity),
          unitPrice: item.unitPrice == null ? null : asDecimal(item.unitPrice),
          sourceQuoteItemId: item.sourceQuoteItemId ?? null,
          scheduledAt,
          durationMinutes: item.durationMinutes ?? null,
          reminderMinutesBefore,
          reminderAt: computeReminderAt(scheduledAt, reminderMinutesBefore),
        };
      }),
    });
    const fresh = await trip.findUnique({ where: { id: params.tripId }, include: tripInclude });
    return serializeDetail(fresh!);
  });
}

export interface TripItineraryItemUpdateInput {
  description?: string;
  quantity?: number;
  unitPrice?: number | null;
  completed?: boolean;
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  reminderMinutesBefore?: number | null;
}

export async function updateTripItem(params: {
  tripId: number;
  itemId: number;
  userId: number;
  isAdmin: boolean;
  input: TripItineraryItemUpdateInput;
}): Promise<TripDetail | { error: string; status?: number }> {
  const existing = await tripClient.findUnique({ where: { id: params.tripId }, include: tripInclude });
  if (!existing) return { error: 'Trip not found', status: 404 };
  if (!canEditTrip(existing, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a trip in status "${existing.status}"`, status: 400 };
  }
  const item = existing.items.find((i) => i.id === params.itemId);
  if (!item) return { error: 'Item not found', status: 404 };

  return prisma.$transaction(async (tx) => {
    const { trip, tripItineraryItem } = txClients(tx);
    const data: Record<string, unknown> = {};
    if (params.input.description !== undefined) data.description = params.input.description;
    if (params.input.quantity !== undefined) data.quantity = asDecimal(params.input.quantity);
    if (params.input.unitPrice !== undefined) {
      data.unitPrice = params.input.unitPrice == null ? null : asDecimal(params.input.unitPrice);
    }
    if (params.input.completed !== undefined) {
      data.completedAt = params.input.completed ? new Date() : null;
    }

    // Schedule + reminder are coupled: any change recomputes reminderAt and clears reminderSentAt.
    const scheduleChanged =
      params.input.scheduledAt !== undefined ||
      params.input.reminderMinutesBefore !== undefined;

    const nextScheduledAt =
      params.input.scheduledAt !== undefined
        ? parseScheduledAt(params.input.scheduledAt)
        : item.scheduledAt;
    const nextReminderMinutes =
      params.input.reminderMinutesBefore !== undefined
        ? params.input.reminderMinutesBefore
        : item.reminderMinutesBefore;

    if (params.input.scheduledAt !== undefined) {
      data.scheduledAt = nextScheduledAt;
    }
    if (params.input.durationMinutes !== undefined) {
      data.durationMinutes = params.input.durationMinutes;
    }
    if (params.input.reminderMinutesBefore !== undefined) {
      data.reminderMinutesBefore = nextReminderMinutes;
    }
    if (scheduleChanged) {
      data.reminderAt = computeReminderAt(nextScheduledAt, nextReminderMinutes);
      data.reminderSentAt = null;
    }

    await tripItineraryItem.update({ where: { id: params.itemId }, data });
    const fresh = await trip.findUnique({ where: { id: params.tripId }, include: tripInclude });
    return serializeDetail(fresh!);
  });
}

export async function deleteTripItem(params: {
  tripId: number;
  itemId: number;
  userId: number;
  isAdmin: boolean;
}): Promise<TripDetail | { error: string; status?: number }> {
  const existing = await tripClient.findUnique({ where: { id: params.tripId }, include: tripInclude });
  if (!existing) return { error: 'Trip not found', status: 404 };
  if (!canEditTrip(existing, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a trip in status "${existing.status}"`, status: 400 };
  }
  const item = existing.items.find((i) => i.id === params.itemId);
  if (!item) return { error: 'Item not found', status: 404 };

  return prisma.$transaction(async (tx) => {
    const { trip, tripItineraryItem } = txClients(tx);
    await tripItineraryItem.delete({ where: { id: params.itemId } });
    const fresh = await trip.findUnique({ where: { id: params.tripId }, include: tripInclude });
    return serializeDetail(fresh!);
  });
}

export interface CreateTripFromQuoteInput {
  quoteId: number;
  actorUserId: number;
  ownerId?: number | null;
  title?: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
}

export async function createTripFromQuote(input: CreateTripFromQuoteInput): Promise<
  | { trip: TripDetail; trackingCode: string; quoteCustomerId: number; quoteCurrency: string }
  | { error: string; status?: number }
> {
  // Outer transaction: re-read the quote inside the tx, then build the trip.
  const result = await prisma.$transaction(async (tx) => {
    const { quote, trip, tripItineraryItem, tripSequence, trackingSequence } = txClients(tx);

    const quoteRecord = await quote.findUnique({
      where: { id: input.quoteId },
      include: { items: true, trip: { select: { id: true } } },
    });

    if (!quoteRecord) {
      return { error: 'Quote not found', status: 404 } as const;
    }
    if (quoteRecord.status !== 'Approved') {
      return {
        error: `Only Approved quotes can spawn a trip (current: ${quoteRecord.status})`,
        status: 400,
      } as const;
    }
    if (quoteRecord.trip) {
      return { error: 'A trip already exists for this quote', status: 409 } as const;
    }

    // Generate or reuse the trackingCode
    const year = new Date().getUTCFullYear();
    let trackingCode = quoteRecord.trackingCode;
    if (!trackingCode) {
      const trackingSeq = await reserveSequence(trackingSequence, year);
      trackingCode = `LA-${year}-${pad4(trackingSeq)}`;
      await quote.update({ where: { id: quoteRecord.id }, data: { trackingCode } });
    }

    const tripSeq = await reserveSequence(tripSequence, year);
    const reference = `TR-${year}-${pad4(tripSeq)}`;

    const startDate = input.startDate ? new Date(input.startDate) : new Date();
    const endDate = input.endDate
      ? new Date(input.endDate)
      : quoteRecord.expiryDate ?? null;

    const created = await trip.create({
      data: {
        reference,
        trackingCode,
        customerId: quoteRecord.customerId,
        sourceQuoteId: quoteRecord.id,
        createdById: input.actorUserId,
        ownerId: input.ownerId ?? input.actorUserId,
        title: input.title?.trim() || quoteRecord.subject,
        description: input.description ?? null,
        status: 'Planned',
        startDate,
        endDate,
        currency: quoteRecord.currency,
        notes: input.notes ?? null,
      },
      include: tripInclude,
    });

    if (quoteRecord.items.length > 0) {
      await tripItineraryItem.createMany({
        data: quoteRecord.items
          .sort((a, b) => a.position - b.position)
          .map((item, idx) => ({
            tripId: created.id,
            position: idx,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            sourceQuoteItemId: item.id,
          })),
      });
    }

    const fresh = await trip.findUnique({ where: { id: created.id }, include: tripInclude });
    return {
      trip: serializeDetail(fresh!),
      trackingCode,
      quoteCustomerId: quoteRecord.customerId,
      quoteCurrency: quoteRecord.currency,
    } as const;
  });

  return result;
}

export async function listOwnerCandidates(excludeUserId: number) {
  return prisma.user.findMany({
    where: { status: 'active', id: { not: excludeUserId } },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}
