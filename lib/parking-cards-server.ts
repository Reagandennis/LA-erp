import 'server-only';

import type { Prisma } from '@prisma/client';
import type { z } from 'zod';

import { type ParkingCardDto, type ParkingEntryDto, defaultParkingThreshold } from './parking-cards';
import { prisma } from './prisma';
import type {
  parkingCardCreateSchema,
  parkingCardUpdateSchema,
  parkingEntryCreateSchema,
  parkingEntryUpdateSchema,
} from './validation';

/**
 * Parking cards: the database side of lib/parking-cards.ts. A card's balance
 * is the sum of its entries, worked out whenever it is asked for.
 */

export type ParkingCardCreateInput = z.infer<typeof parkingCardCreateSchema>;
export type ParkingCardUpdateInput = z.infer<typeof parkingCardUpdateSchema>;
export type ParkingEntryCreateInput = z.infer<typeof parkingEntryCreateSchema>;
export type ParkingEntryUpdateInput = z.infer<typeof parkingEntryUpdateSchema>;

export type ParkingWriteResult<T> = { item: T } | { error: string; status: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const textOrNull = (value: string | null | undefined): string | null => value?.trim() || null;
const VEHICLE_REF = { select: { id: true, registration: true } } as const;

const CARD_SELECT = {
  id: true,
  name: true,
  provider: true,
  cardNumber: true,
  lowBalanceThreshold: true,
  active: true,
  notes: true,
  vehicle: VEHICLE_REF,
} as const;

type CardRow = Prisma.ParkingCardGetPayload<{ select: typeof CARD_SELECT }>;
type Totals = { balance: number; entries: number; lastEntryAt: string | null };

async function cardTotals(cardIds?: number[]): Promise<Map<number, Totals>> {
  const rows = await prisma.parkingCardEntry.groupBy({
    by: ['cardId'],
    where: cardIds ? { cardId: { in: cardIds } } : undefined,
    _sum: { amount: true },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  return new Map(
    rows.map((row) => [
      row.cardId,
      {
        balance: round2(row._sum.amount?.toNumber() ?? 0),
        entries: row._count._all,
        lastEntryAt: row._max.occurredAt?.toISOString() ?? null,
      },
    ]),
  );
}

function serializeCard(row: CardRow, totals: Totals | undefined): ParkingCardDto {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    vehicle: row.vehicle,
    cardNumber: row.cardNumber,
    lowBalanceThreshold: row.lowBalanceThreshold.toNumber(),
    active: row.active,
    notes: row.notes,
    balance: totals?.balance ?? 0,
    lastEntryAt: totals?.lastEntryAt ?? null,
    entries: totals?.entries ?? 0,
  };
}

export async function listParkingCards(): Promise<ParkingCardDto[]> {
  const [rows, totals] = await Promise.all([
    prisma.parkingCard.findMany({ orderBy: [{ active: 'desc' }, { provider: 'asc' }, { name: 'asc' }], select: CARD_SELECT }),
    cardTotals(),
  ]);
  return rows.map((row) => serializeCard(row, totals.get(row.id)));
}

async function getParkingCard(id: number): Promise<ParkingCardDto | null> {
  const [row, totals] = await Promise.all([
    prisma.parkingCard.findUnique({ where: { id }, select: CARD_SELECT }),
    cardTotals([id]),
  ]);
  return row ? serializeCard(row, totals.get(id)) : null;
}

const ENTRY_SELECT = {
  id: true,
  cardId: true,
  kind: true,
  amount: true,
  observedBalance: true,
  occurredAt: true,
  location: true,
  reference: true,
  notes: true,
  vehicle: VEHICLE_REF,
  createdBy: { select: { id: true, name: true } },
} as const;

function serializeEntry(row: Prisma.ParkingCardEntryGetPayload<{ select: typeof ENTRY_SELECT }>): ParkingEntryDto {
  return {
    id: row.id,
    cardId: row.cardId,
    kind: row.kind,
    amount: row.amount.toNumber(),
    observedBalance: row.observedBalance?.toNumber() ?? null,
    occurredAt: row.occurredAt.toISOString(),
    vehicle: row.vehicle,
    location: row.location,
    reference: row.reference,
    notes: row.notes,
    createdBy: row.createdBy,
  };
}

export async function getParkingStatement(id: number): Promise<{ card: ParkingCardDto; entries: ParkingEntryDto[] } | null> {
  const [card, entries] = await Promise.all([
    getParkingCard(id),
    prisma.parkingCardEntry.findMany({ where: { cardId: id }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: ENTRY_SELECT }),
  ]);
  return card ? { card, entries: entries.map(serializeEntry) } : null;
}

async function vehicleProblem(vehicleId: number | null | undefined): Promise<string | null> {
  if (vehicleId == null) return null;
  return (await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } })) ? null : 'Vehicle not found';
}

// --- Cards -------------------------------------------------------------------

export async function createParkingCard(userId: number, input: ParkingCardCreateInput): Promise<ParkingWriteResult<ParkingCardDto>> {
  const problem = await vehicleProblem(input.vehicleId);
  if (problem) return { error: problem, status: 400 };
  const row = await prisma.parkingCard.create({
    data: {
      name: input.name,
      provider: input.provider,
      vehicleId: input.vehicleId,
      cardNumber: textOrNull(input.cardNumber),
      lowBalanceThreshold: input.lowBalanceThreshold ?? defaultParkingThreshold(input.provider),
      active: input.active,
      notes: textOrNull(input.notes),
      createdById: userId,
    },
    select: CARD_SELECT,
  });
  return { item: serializeCard(row, undefined) };
}

export async function updateParkingCard(id: number, input: ParkingCardUpdateInput): Promise<ParkingWriteResult<ParkingCardDto>> {
  if (!(await prisma.parkingCard.findUnique({ where: { id }, select: { id: true } }))) {
    return { error: 'Parking card not found', status: 404 };
  }
  const problem = await vehicleProblem(input.vehicleId);
  if (problem) return { error: problem, status: 400 };
  const data: Prisma.ParkingCardUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.provider !== undefined) data.provider = input.provider;
  if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
  if (input.cardNumber !== undefined) data.cardNumber = textOrNull(input.cardNumber);
  if (input.lowBalanceThreshold !== undefined) data.lowBalanceThreshold = input.lowBalanceThreshold;
  if (input.active !== undefined) data.active = input.active;
  if (input.notes !== undefined) data.notes = textOrNull(input.notes);
  await prisma.parkingCard.update({ where: { id }, data });
  const card = await getParkingCard(id);
  return card ? { item: card } : { error: 'Parking card not found', status: 404 };
}

/** Only a card with no entries can go; one with history is retired instead. */
export async function deleteParkingCard(id: number): Promise<ParkingWriteResult<{ deleted: true }>> {
  const [card, entries] = await Promise.all([
    prisma.parkingCard.findUnique({ where: { id }, select: { id: true } }),
    prisma.parkingCardEntry.count({ where: { cardId: id } }),
  ]);
  if (!card) return { error: 'Parking card not found', status: 404 };
  if (entries > 0) return { error: 'This card has entries on record. Retire it instead, to keep its history.', status: 409 };
  await prisma.parkingCard.delete({ where: { id } });
  return { item: { deleted: true } };
}

// --- Entries -----------------------------------------------------------------

/**
 * Logs parking (taken off), a top-up (added) or a balance check. A balance
 * check records the difference between what the card showed and the balance
 * the platform had at that moment, so the card reads what was seen.
 */
export async function createParkingEntry(
  userId: number,
  cardId: number,
  input: ParkingEntryCreateInput,
): Promise<ParkingWriteResult<ParkingEntryDto>> {
  const card = await prisma.parkingCard.findUnique({ where: { id: cardId }, select: { active: true, vehicleId: true } });
  if (!card) return { error: 'Parking card not found', status: 404 };
  if (!card.active) return { error: 'This card is retired; bring it back into use first.', status: 400 };
  const problem = await vehicleProblem(input.vehicleId);
  if (problem) return { error: problem, status: 400 };

  const occurredAt = new Date(input.occurredAt);
  let amount: number;
  let observedBalance: number | null = null;
  if (input.kind === 'Balance check') {
    const before = await prisma.parkingCardEntry.aggregate({ where: { cardId, occurredAt: { lte: occurredAt } }, _sum: { amount: true } });
    observedBalance = input.observedBalance!;
    amount = round2(observedBalance - (before._sum.amount?.toNumber() ?? 0));
  } else {
    amount = input.kind === 'Parking' ? -input.amount! : input.amount!;
  }

  const row = await prisma.parkingCardEntry.create({
    data: {
      cardId,
      kind: input.kind,
      amount,
      observedBalance,
      occurredAt,
      // A card that lives in one vehicle is used by that vehicle unless the entry says otherwise.
      vehicleId: input.vehicleId ?? (input.kind === 'Parking' ? card.vehicleId : null),
      location: textOrNull(input.location),
      reference: textOrNull(input.reference),
      notes: textOrNull(input.notes),
      createdById: userId,
    },
    select: ENTRY_SELECT,
  });
  return { item: serializeEntry(row) };
}

export async function updateParkingEntry(
  cardId: number,
  entryId: number,
  input: ParkingEntryUpdateInput,
): Promise<ParkingWriteResult<ParkingEntryDto>> {
  const existing = await prisma.parkingCardEntry.findFirst({ where: { id: entryId, cardId }, select: { kind: true } });
  if (!existing) return { error: 'Entry not found', status: 404 };
  if (existing.kind === 'Balance check') {
    return { error: 'A balance check can’t be edited; delete it and record the check again.', status: 400 };
  }
  const problem = await vehicleProblem(input.vehicleId);
  if (problem) return { error: problem, status: 400 };

  const data: Prisma.ParkingCardEntryUncheckedUpdateInput = {};
  if (input.amount !== undefined) data.amount = existing.kind === 'Parking' ? -input.amount : input.amount;
  if (input.occurredAt !== undefined) data.occurredAt = new Date(input.occurredAt);
  if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
  if (input.location !== undefined) data.location = textOrNull(input.location);
  if (input.reference !== undefined) data.reference = textOrNull(input.reference);
  if (input.notes !== undefined) data.notes = textOrNull(input.notes);
  const row = await prisma.parkingCardEntry.update({ where: { id: entryId }, data, select: ENTRY_SELECT });
  return { item: serializeEntry(row) };
}

export async function deleteParkingEntry(cardId: number, entryId: number): Promise<boolean> {
  const { count } = await prisma.parkingCardEntry.deleteMany({ where: { id: entryId, cardId } });
  return count > 0;
}
