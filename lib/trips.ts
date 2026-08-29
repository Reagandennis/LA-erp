import 'server-only';

import { Prisma } from '@prisma/client';

import { addDays, dateKey, parseDateKey } from './date-grid';
import { prisma } from './prisma';

export type TripStatus = 'Draft' | 'Planned' | 'Active' | 'Completed' | 'Cancelled';

export const TRIP_STATUSES: TripStatus[] = ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

export type TripItemType = 'flight' | 'car' | 'hotel' | 'location' | 'activity';

export interface TripItineraryItemDraft {
  category?: string;
  body?: string | null;
  timeLabel?: string | null;
  providerName?: string | null;
  bookingUrl?: string | null;
  phone?: string | null;
  placeName?: string | null;
  address?: string | null;
  details?: Record<string, string> | null;
  dayId?: number | null;
  itemType?: TripItemType;
  description: string;
  subtitle?: string | null;
  quantity: number;
  unitPrice?: number | null;
  sourceQuoteItemId?: number | null;
  scheduledAt?: string | null;
  endsAt?: string | null;
  durationMinutes?: number | null;
  reminderMinutesBefore?: number | null;
  imageUrl?: string | null;
  confirmationCode?: string | null;
}

export interface TripDaySummary {
  id: number;
  /** "YYYY-MM-DD", or null while the trip's dates are still TBD. */
  dateKey: string | null;
  /** Dense 1..N — the ordering key and the "Day 3" label. */
  dayNumber: number;
  title: string | null;
  summary: string | null;
}

export interface TripItineraryItemSummary {
  id: number;
  dayId: number | null;
  position: number;
  itemType: TripItemType;
  category: string;
  body: string | null;
  timeLabel: string | null;
  providerName: string | null;
  bookingUrl: string | null;
  phone: string | null;
  placeName: string | null;
  address: string | null;
  details: Record<string, string> | null;
  description: string;
  subtitle: string | null;
  quantity: number;
  unitPrice: number | null;
  completedAt: string | null;
  sourceQuoteItemId: number | null;
  scheduledAt: string | null;
  endsAt: string | null;
  durationMinutes: number | null;
  reminderMinutesBefore: number | null;
  reminderAt: string | null;
  imageUrl: string | null;
  confirmationCode: string | null;
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
  assignmentCount: number;
}

export interface TripDetail extends TripSummary {
  items: TripItineraryItemSummary[];
  days: TripDaySummary[];
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
  days: TripDayRecord[];
  _count?: { assignments: number };
}

interface TripDayRecord {
  id: number;
  tripId: number;
  dateKey: string | null;
  dayNumber: number;
  title: string | null;
  summary: string | null;
}

interface TripItineraryItemRecord {
  id: number;
  dayId: number | null;
  position: number;
  itemType: string;
  category: string;
  body: string | null;
  timeLabel: string | null;
  providerName: string | null;
  bookingUrl: string | null;
  phone: string | null;
  placeName: string | null;
  address: string | null;
  details: unknown;
  description: string;
  subtitle: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal | null;
  completedAt: Date | null;
  sourceQuoteItemId: number | null;
  scheduledAt: Date | null;
  endsAt: Date | null;
  durationMinutes: number | null;
  reminderMinutesBefore: number | null;
  reminderAt: Date | null;
  reminderSentAt: Date | null;
  imageUrl: string | null;
  confirmationCode: string | null;
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
  days: {
    orderBy: [{ dayNumber: 'asc' as const }],
  },
  _count: { select: { assignments: true } },
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
      dayId?: number | null;
      position: number;
      itemType?: string;
      category?: string;
      body?: string | null;
      timeLabel?: string | null;
      providerName?: string | null;
      bookingUrl?: string | null;
      phone?: string | null;
      placeName?: string | null;
      address?: string | null;
      details?: unknown;
      description: string;
      subtitle?: string | null;
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal | null;
      sourceQuoteItemId: number | null;
      scheduledAt?: Date | null;
      endsAt?: Date | null;
      durationMinutes?: number | null;
      reminderMinutesBefore?: number | null;
      reminderAt?: Date | null;
      imageUrl?: string | null;
      confirmationCode?: string | null;
    }>;
  }) => Promise<{ count: number }>;
  findUnique: (args: { where: { id: number } }) => Promise<TripItineraryItemRecord | null>;
  update: (args: {
    where: { id: number };
    data: Record<string, unknown>;
  }) => Promise<TripItineraryItemRecord>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<{ count: number }>;
  delete: (args: { where: { id: number } }) => Promise<TripItineraryItemRecord>;
  deleteMany: (args: { where: Record<string, unknown> }) => Promise<{ count: number }>;
};

type TripDayCollectionClient = {
  findMany: (args: {
    where: { tripId: number };
    orderBy?: Array<{ dayNumber?: 'asc' | 'desc' }>;
  }) => Promise<TripDayRecord[]>;
  findUnique: (args: { where: { id: number } }) => Promise<TripDayRecord | null>;
  create: (args: { data: Record<string, unknown> }) => Promise<TripDayRecord>;
  update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<TripDayRecord>;
  updateMany: (args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<{ count: number }>;
  delete: (args: { where: { id: number } }) => Promise<TripDayRecord>;
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
    tripDay: TripDayCollectionClient;
    tripSequence: TripSequenceCollectionClient;
    trackingSequence: TrackingSequenceCollectionClient;
    quote: QuoteForTripUpdateClient;
  };
  return {
    trip: handle.trip,
    tripItineraryItem: handle.tripItineraryItem,
    tripDay: handle.tripDay,
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
    dayId: item.dayId,
    position: item.position,
    itemType: (item.itemType as TripItemType) ?? 'activity',
    category: item.category ?? 'activity',
    body: item.body,
    timeLabel: item.timeLabel,
    providerName: item.providerName,
    bookingUrl: item.bookingUrl,
    phone: item.phone,
    placeName: item.placeName,
    address: item.address,
    details:
      item.details && typeof item.details === 'object' && !Array.isArray(item.details)
        ? (item.details as Record<string, string>)
        : null,
    description: item.description,
    subtitle: item.subtitle,
    quantity: toNumber(item.quantity) ?? 0,
    unitPrice: toNumber(item.unitPrice),
    completedAt: item.completedAt?.toISOString() ?? null,
    sourceQuoteItemId: item.sourceQuoteItemId,
    scheduledAt: item.scheduledAt?.toISOString() ?? null,
    endsAt: item.endsAt?.toISOString() ?? null,
    durationMinutes: item.durationMinutes,
    reminderMinutesBefore: item.reminderMinutesBefore,
    reminderAt: item.reminderAt?.toISOString() ?? null,
    imageUrl: item.imageUrl,
    confirmationCode: item.confirmationCode,
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
    assignmentCount: record._count?.assignments ?? 0,
  };
}

function serializeDay(day: TripDayRecord): TripDaySummary {
  return {
    id: day.id,
    dateKey: day.dateKey,
    dayNumber: day.dayNumber,
    title: day.title,
    summary: day.summary,
  };
}

function serializeDetail(record: TripRecord): TripDetail {
  return {
    ...serializeSummary(record),
    items: record.items.map(serializeItem),
    days: (record.days ?? []).map(serializeDay),
  };
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
          const endsAt = parseScheduledAt(item.endsAt);
          const reminderMinutesBefore = item.reminderMinutesBefore ?? null;
          return {
            tripId: created.id,
            position: index,
            itemType: item.itemType ?? 'activity',
            description: item.description,
            subtitle: item.subtitle ?? null,
            quantity: asDecimal(item.quantity),
            unitPrice: item.unitPrice == null ? null : asDecimal(item.unitPrice),
            sourceQuoteItemId: item.sourceQuoteItemId ?? null,
            scheduledAt,
            endsAt,
            durationMinutes: item.durationMinutes ?? null,
            reminderMinutesBefore,
            reminderAt: computeReminderAt(scheduledAt, reminderMinutesBefore),
            imageUrl: item.imageUrl ?? null,
            confirmationCode: item.confirmationCode ?? null,
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

  const dayIds = new Set((existing.days ?? []).map((day) => day.id));
  if (params.items.some((item) => item.dayId != null && !dayIds.has(item.dayId))) {
    return { error: 'Day not found on this trip', status: 400 };
  }

  return prisma.$transaction(async (tx) => {
    const { trip, tripItineraryItem } = txClients(tx);
    // One past the highest position in use, not the item count. Deleting an
    // item leaves a gap, so counting would hand the new item a position that
    // an existing one already holds.
    const startPosition = existing.items.reduce(
      (highest, item) => Math.max(highest, item.position + 1),
      0,
    );
    await tripItineraryItem.createMany({
      data: params.items.map((item, idx) => {
        const scheduledAt = parseScheduledAt(item.scheduledAt);
        const endsAt = parseScheduledAt(item.endsAt);
        const reminderMinutesBefore = item.reminderMinutesBefore ?? null;
        return {
          tripId: params.tripId,
          dayId: item.dayId ?? null,
          position: startPosition + idx,
          itemType: item.itemType ?? 'activity',
          category: item.category ?? 'activity',
          body: item.body ?? null,
          timeLabel: item.timeLabel ?? null,
          providerName: item.providerName ?? null,
          bookingUrl: item.bookingUrl ?? null,
          phone: item.phone ?? null,
          placeName: item.placeName ?? null,
          address: item.address ?? null,
          details: item.details ?? undefined,
          description: item.description,
          subtitle: item.subtitle ?? null,
          quantity: asDecimal(item.quantity),
          unitPrice: item.unitPrice == null ? null : asDecimal(item.unitPrice),
          sourceQuoteItemId: item.sourceQuoteItemId ?? null,
          scheduledAt,
          endsAt,
          durationMinutes: item.durationMinutes ?? null,
          reminderMinutesBefore,
          reminderAt: computeReminderAt(scheduledAt, reminderMinutesBefore),
          imageUrl: item.imageUrl ?? null,
          confirmationCode: item.confirmationCode ?? null,
        };
      }),
    });
    const fresh = await trip.findUnique({ where: { id: params.tripId }, include: tripInclude });
    return serializeDetail(fresh!);
  });
}

export interface TripItineraryItemUpdateInput {
  category?: string;
  body?: string | null;
  timeLabel?: string | null;
  providerName?: string | null;
  bookingUrl?: string | null;
  phone?: string | null;
  placeName?: string | null;
  address?: string | null;
  details?: Record<string, string> | null;
  dayId?: number | null;
  itemType?: TripItemType;
  description?: string;
  subtitle?: string | null;
  quantity?: number;
  unitPrice?: number | null;
  completed?: boolean;
  scheduledAt?: string | null;
  endsAt?: string | null;
  durationMinutes?: number | null;
  reminderMinutesBefore?: number | null;
  imageUrl?: string | null;
  confirmationCode?: string | null;
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

  const nextDayId = params.input.dayId;
  if (nextDayId != null && !(existing.days ?? []).some((day) => day.id === nextDayId)) {
    return { error: 'Day not found on this trip', status: 400 };
  }

  return prisma.$transaction(async (tx) => {
    const { trip, tripItineraryItem } = txClients(tx);
    const data: Record<string, unknown> = {};
    if (params.input.dayId !== undefined) data.dayId = params.input.dayId;
    if (params.input.itemType !== undefined) data.itemType = params.input.itemType;
    if (params.input.category !== undefined) data.category = params.input.category;
    if (params.input.body !== undefined) data.body = params.input.body;
    if (params.input.timeLabel !== undefined) data.timeLabel = params.input.timeLabel;
    if (params.input.providerName !== undefined) data.providerName = params.input.providerName;
    if (params.input.bookingUrl !== undefined) data.bookingUrl = params.input.bookingUrl;
    if (params.input.phone !== undefined) data.phone = params.input.phone;
    if (params.input.placeName !== undefined) data.placeName = params.input.placeName;
    if (params.input.address !== undefined) data.address = params.input.address;
    if (params.input.details !== undefined) data.details = params.input.details ?? null;
    if (params.input.description !== undefined) data.description = params.input.description;
    if (params.input.subtitle !== undefined) data.subtitle = params.input.subtitle;
    if (params.input.quantity !== undefined) data.quantity = asDecimal(params.input.quantity);
    if (params.input.unitPrice !== undefined) {
      data.unitPrice = params.input.unitPrice == null ? null : asDecimal(params.input.unitPrice);
    }
    if (params.input.completed !== undefined) {
      data.completedAt = params.input.completed ? new Date() : null;
    }
    if (params.input.imageUrl !== undefined) data.imageUrl = params.input.imageUrl;
    if (params.input.confirmationCode !== undefined) {
      data.confirmationCode = params.input.confirmationCode;
    }
    if (params.input.endsAt !== undefined) {
      data.endsAt = parseScheduledAt(params.input.endsAt);
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

// ── Itinerary days ─────────────────────────────────────────────────────────
//
// Days are first-class rows now. They used to be derived on the client by
// bucketing items on `scheduledAt`, which meant a day with no events could not
// exist — "Add another day" lived in React state and vanished on refresh.

const MAX_TRIP_DAYS = 60;

/** Shift a "YYYY-MM-DD" key by whole days, staying in local calendar terms. */
function shiftDateKey(key: string, days: number): string | null {
  const parsed = parseDateKey(key);
  return parsed ? dateKey(addDays(parsed, days)) : null;
}

type DayGuard =
  | { error: string; status: number }
  | { trip: TripRecord; days: TripDayRecord[] };

async function loadTripForDayEdit(
  tripId: number,
  userId: number,
  isAdmin: boolean,
): Promise<DayGuard> {
  const trip = await tripClient.findUnique({ where: { id: tripId }, include: tripInclude });
  if (!trip) return { error: 'Trip not found', status: 404 };
  if (!canEditTrip(trip, userId, isAdmin)) {
    return { error: `Cannot edit a trip in status "${trip.status}"`, status: 400 };
  }
  const days = [...(trip.days ?? [])].sort((a, b) => a.dayNumber - b.dayNumber);
  return { trip, days };
}

/**
 * Rewrite `dayNumber` to a dense 1..N in the given order.
 *
 * Deliberately not a unique constraint on `(tripId, dayNumber)`: Postgres
 * checks uniqueness per row, so any bulk shift would transiently collide and
 * force a two-phase negative-offset dance. Renumbering after the fact is
 * simpler and idempotent.
 */
async function renumberDays(
  client: TripDayCollectionClient,
  ordered: Array<{ id: number; dayNumber: number }>,
): Promise<void> {
  for (let index = 0; index < ordered.length; index += 1) {
    const target = index + 1;
    if (ordered[index].dayNumber !== target) {
      await client.update({ where: { id: ordered[index].id }, data: { dayNumber: target } });
    }
  }
}

async function refreshDetail(client: TripCollectionClient, tripId: number): Promise<TripDetail> {
  const fresh = await client.findUnique({ where: { id: tripId }, include: tripInclude });
  return serializeDetail(fresh!);
}

export async function createTripDay(params: {
  tripId: number;
  userId: number;
  isAdmin: boolean;
  /** Insert directly after this day. Omit to append. */
  afterDayId?: number | null;
  /** Insert before every existing day. */
  atStart?: boolean;
  dateKey?: string | null;
  title?: string | null;
}): Promise<TripDetail | { error: string; status?: number }> {
  const guard = await loadTripForDayEdit(params.tripId, params.userId, params.isAdmin);
  if ('error' in guard) return guard;
  const { days } = guard;

  if (days.length >= MAX_TRIP_DAYS) {
    return { error: `A trip cannot have more than ${MAX_TRIP_DAYS} days`, status: 400 };
  }

  let index = days.length;
  if (params.atStart) {
    index = 0;
  } else if (params.afterDayId != null) {
    const at = days.findIndex((day) => day.id === params.afterDayId);
    if (at === -1) return { error: 'Day not found on this trip', status: 400 };
    index = at + 1;
  }

  // Suggest a date from whichever neighbour we can see. Other days keep their
  // own dates — an insert should not silently reschedule the rest of the trip.
  let dateKey = params.dateKey ?? null;
  if (dateKey === null) {
    const before = index > 0 ? days[index - 1] : null;
    const after = index < days.length ? days[index] : null;
    if (before?.dateKey) dateKey = shiftDateKey(before.dateKey, 1);
    else if (after?.dateKey) dateKey = shiftDateKey(after.dateKey, -1);
  }

  return prisma.$transaction(async (tx) => {
    const { trip, tripDay } = txClients(tx);
    const created = await tripDay.create({
      data: {
        tripId: params.tripId,
        dateKey,
        dayNumber: days.length + 1,
        title: params.title ?? null,
      },
    });
    const ordered = [...days];
    ordered.splice(index, 0, created);
    await renumberDays(tripDay, ordered);
    return refreshDetail(trip, params.tripId);
  });
}

export async function updateTripDay(params: {
  tripId: number;
  dayId: number;
  userId: number;
  isAdmin: boolean;
  title?: string | null;
  summary?: string | null;
  dateKey?: string | null;
}): Promise<TripDetail | { error: string; status?: number }> {
  const guard = await loadTripForDayEdit(params.tripId, params.userId, params.isAdmin);
  if ('error' in guard) return guard;
  if (!guard.days.some((day) => day.id === params.dayId)) {
    return { error: 'Day not found on this trip', status: 404 };
  }

  const data: Record<string, unknown> = {};
  if (params.title !== undefined) data.title = params.title;
  if (params.summary !== undefined) data.summary = params.summary;
  if (params.dateKey !== undefined) data.dateKey = params.dateKey;
  if (Object.keys(data).length === 0) return { error: 'Nothing to update', status: 400 };

  return prisma.$transaction(async (tx) => {
    const { trip, tripDay } = txClients(tx);
    await tripDay.update({ where: { id: params.dayId }, data });
    return refreshDetail(trip, params.tripId);
  });
}

export async function deleteTripDay(params: {
  tripId: number;
  dayId: number;
  userId: number;
  isAdmin: boolean;
  /** `unschedule` (default) keeps the events; `delete` removes them too. */
  mode?: 'unschedule' | 'delete';
}): Promise<TripDetail | { error: string; status?: number }> {
  const guard = await loadTripForDayEdit(params.tripId, params.userId, params.isAdmin);
  if ('error' in guard) return guard;
  if (!guard.days.some((day) => day.id === params.dayId)) {
    return { error: 'Day not found on this trip', status: 404 };
  }

  return prisma.$transaction(async (tx) => {
    const { trip, tripDay, tripItineraryItem } = txClients(tx);

    if (params.mode === 'delete') {
      await tripItineraryItem.deleteMany({ where: { tripId: params.tripId, dayId: params.dayId } });
    } else {
      // Default: events survive and drop into the Unscheduled tray. Deleting a
      // day should never silently destroy the work that was on it.
      await tripItineraryItem.updateMany({
        where: { tripId: params.tripId, dayId: params.dayId },
        data: { dayId: null },
      });
    }

    await tripDay.delete({ where: { id: params.dayId } });
    await renumberDays(
      tripDay,
      guard.days.filter((day) => day.id !== params.dayId),
    );
    return refreshDetail(trip, params.tripId);
  });
}

export async function duplicateTripDay(params: {
  tripId: number;
  dayId: number;
  userId: number;
  isAdmin: boolean;
  includeEvents?: boolean;
}): Promise<TripDetail | { error: string; status?: number }> {
  const guard = await loadTripForDayEdit(params.tripId, params.userId, params.isAdmin);
  if ('error' in guard) return guard;
  const { trip: record, days } = guard;

  if (days.length >= MAX_TRIP_DAYS) {
    return { error: `A trip cannot have more than ${MAX_TRIP_DAYS} days`, status: 400 };
  }
  const index = days.findIndex((day) => day.id === params.dayId);
  if (index === -1) return { error: 'Day not found on this trip', status: 404 };
  const source = days[index];
  const sourceItems = record.items.filter((item) => item.dayId === params.dayId);

  return prisma.$transaction(async (tx) => {
    const { trip, tripDay, tripItineraryItem } = txClients(tx);
    const created = await tripDay.create({
      data: {
        tripId: params.tripId,
        dateKey: source.dateKey ? shiftDateKey(source.dateKey, 1) : null,
        dayNumber: days.length + 1,
        title: source.title ? `${source.title} (copy)` : null,
        summary: source.summary,
      },
    });

    if (params.includeEvents !== false && sourceItems.length > 0) {
      await tripItineraryItem.createMany({
        data: sourceItems.map((item, offset) => ({
          tripId: params.tripId,
          dayId: created.id,
          position: offset,
          itemType: item.itemType,
          category: item.category,
          body: item.body,
          timeLabel: item.timeLabel,
          providerName: item.providerName,
          bookingUrl: item.bookingUrl,
          phone: item.phone,
          placeName: item.placeName,
          address: item.address,
          details: item.details ?? undefined,
          description: item.description,
          subtitle: item.subtitle,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          sourceQuoteItemId: null,
          // The copy lands on a new date, so the old instant would be wrong.
          // It stays untimed until the user schedules it.
          scheduledAt: null,
          endsAt: null,
          durationMinutes: item.durationMinutes,
          reminderMinutesBefore: item.reminderMinutesBefore,
          reminderAt: null,
          imageUrl: item.imageUrl,
          confirmationCode: item.confirmationCode,
        })),
      });
    }

    const ordered = [...days];
    ordered.splice(index + 1, 0, created);
    await renumberDays(tripDay, ordered);
    return refreshDetail(trip, params.tripId);
  });
}

export async function reorderTripDays(params: {
  tripId: number;
  userId: number;
  isAdmin: boolean;
  dayIds: number[];
}): Promise<TripDetail | { error: string; status?: number }> {
  const guard = await loadTripForDayEdit(params.tripId, params.userId, params.isAdmin);
  if ('error' in guard) return guard;
  const { days } = guard;

  const known = new Set(days.map((day) => day.id));
  if (params.dayIds.length !== days.length || params.dayIds.some((id) => !known.has(id))) {
    return { error: 'The day order must list every day on this trip exactly once', status: 400 };
  }
  if (new Set(params.dayIds).size !== params.dayIds.length) {
    return { error: 'The day order contains duplicates', status: 400 };
  }

  const byId = new Map(days.map((day) => [day.id, day]));
  const ordered = params.dayIds.map((id) => byId.get(id)!);

  return prisma.$transaction(async (tx) => {
    const { trip, tripDay } = txClients(tx);
    await renumberDays(tripDay, ordered);
    return refreshDetail(trip, params.tripId);
  });
}

/**
 * Set the day and order of items in one shot.
 *
 * Takes complete per-day orderings rather than a `{itemId, toDay, toIndex}`
 * delta: that shape is idempotent, so a lost response followed by a retry is
 * harmless, it validates trivially, and a single call covers a cross-day move.
 */
export async function reorderTripItems(params: {
  tripId: number;
  userId: number;
  isAdmin: boolean;
  days: Array<{ dayId: number | null; itemIds: number[] }>;
}): Promise<{ ok: true } | { error: string; status?: number }> {
  const existing = await tripClient.findUnique({
    where: { id: params.tripId },
    include: tripInclude,
  });
  if (!existing) return { error: 'Trip not found', status: 404 };
  if (!canEditTrip(existing, params.userId, params.isAdmin)) {
    return { error: `Cannot edit a trip in status "${existing.status}"`, status: 400 };
  }

  const tripItemIds = new Set(existing.items.map((item) => item.id));
  const tripDayIds = new Set((existing.days ?? []).map((day) => day.id));
  const seen = new Set<number>();

  for (const group of params.days) {
    if (group.dayId !== null && !tripDayIds.has(group.dayId)) {
      return { error: 'Day not found on this trip', status: 400 };
    }
    for (const itemId of group.itemIds) {
      // Never let a reorder reach across trips.
      if (!tripItemIds.has(itemId)) {
        return { error: 'Item not found on this trip', status: 400 };
      }
      if (seen.has(itemId)) {
        return { error: 'An item appears more than once in the new order', status: 400 };
      }
      seen.add(itemId);
    }
  }

  await prisma.$transaction(async (tx) => {
    const { tripItineraryItem } = txClients(tx);
    for (const group of params.days) {
      for (let index = 0; index < group.itemIds.length; index += 1) {
        await tripItineraryItem.update({
          where: { id: group.itemIds[index] },
          data: { dayId: group.dayId, position: index },
        });
      }
    }
  });

  // Deliberately not the refreshed trip: the client is mid-drag with its own
  // optimistic state, and re-hydrating would fight it and flash the list.
  return { ok: true };
}
