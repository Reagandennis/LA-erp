import 'server-only';

import type { Prisma } from '@prisma/client';
import type { z } from 'zod';

import { isEmailConfigured } from './email';
import {
  type CardFillDto,
  type FuelCardDto,
  type FuelCardOption,
  type TopUpDto,
  FUEL_CURRENCY,
  isLowBalance,
  lowBalanceMessage,
} from './fuel-cards';
import { notifyNotificationsChanged } from './notification-events';
import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';
import { emailFuelCardLow } from './transactional-email';
import type { fuelCardCreateSchema, fuelCardUpdateSchema, topUpCreateSchema, topUpUpdateSchema } from './validation';

/**
 * Fuel cards: the database side of lib/fuel-cards.ts.
 *
 * Balances are summed from the top-ups and the fill-ups paid with each card
 * whenever they are asked for. After anything that can move a balance (a
 * fill-up saved, edited or deleted; a top-up; a new alert level), call
 * checkFuelCardBalances: a card that has fallen below its alert level tells
 * every admin once, in the bell and by email, and is re-armed when a top-up
 * lifts it back over.
 */

export type FuelCardCreateInput = z.infer<typeof fuelCardCreateSchema>;
export type FuelCardUpdateInput = z.infer<typeof fuelCardUpdateSchema>;
export type TopUpCreateInput = z.infer<typeof topUpCreateSchema>;
export type TopUpUpdateInput = z.infer<typeof topUpUpdateSchema>;

export type FuelCardWriteResult<T> = { item: T } | { error: string; status: number };

/** Where the alert email's button points; the app's public address when it is configured. */
export interface AlertContext {
  origin?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toNumber = (value: Prisma.Decimal | null | undefined): number => (value == null ? 0 : value.toNumber());
const textOrNull = (value: string | null | undefined): string | null => value?.trim() || null;

const CARD_SELECT = {
  id: true,
  name: true,
  provider: true,
  entity: true,
  cardNumber: true,
  lowBalanceThreshold: true,
  active: true,
  notes: true,
  createdAt: true,
  vehicle: { select: { id: true, registration: true } },
} as const;

type CardRow = Prisma.FuelCardGetPayload<{ select: typeof CARD_SELECT }>;
type Totals = { loaded: number; spent: number; fills: number };

/** Money in and out of each card: top-ups and adjustments, and the cost of the fill-ups it paid. */
async function cardTotals(cardIds?: number[]): Promise<Map<number, Totals>> {
  const [loaded, spent] = await Promise.all([
    prisma.fuelCardTopUp.groupBy({
      by: ['cardId'],
      where: cardIds ? { cardId: { in: cardIds } } : undefined,
      _sum: { amount: true },
    }),
    prisma.vehicleFuelLog.groupBy({
      by: ['fuelCardId'],
      where: { fuelCardId: cardIds ? { in: cardIds } : { not: null } },
      _sum: { cost: true },
      _count: { _all: true },
    }),
  ]);
  const totals = new Map<number, Totals>();
  const entry = (id: number) => {
    let t = totals.get(id);
    if (!t) totals.set(id, (t = { loaded: 0, spent: 0, fills: 0 }));
    return t;
  };
  for (const row of loaded) entry(row.cardId).loaded = toNumber(row._sum.amount);
  for (const row of spent) {
    if (row.fuelCardId == null) continue;
    const t = entry(row.fuelCardId);
    t.spent = toNumber(row._sum.cost);
    t.fills = row._count._all;
  }
  return totals;
}

function serializeCard(row: CardRow, totals: Totals | undefined): FuelCardDto {
  const t = totals ?? { loaded: 0, spent: 0, fills: 0 };
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    entity: row.entity,
    vehicle: row.vehicle,
    cardNumber: row.cardNumber,
    lowBalanceThreshold: row.lowBalanceThreshold.toNumber(),
    active: row.active,
    notes: row.notes,
    loaded: round2(t.loaded),
    spent: round2(t.spent),
    fills: t.fills,
    balance: round2(t.loaded - t.spent),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every card, active ones first, with its balance. */
export async function listFuelCards(): Promise<FuelCardDto[]> {
  const [rows, totals] = await Promise.all([
    prisma.fuelCard.findMany({ orderBy: [{ active: 'desc' }, { entity: 'asc' }, { name: 'asc' }], select: CARD_SELECT }),
    cardTotals(),
  ]);
  return rows.map((row) => serializeCard(row, totals.get(row.id)));
}

/** The cards a fill-up can be paid with: the active ones. */
export async function listFuelCardOptions(): Promise<FuelCardOption[]> {
  const cards = await listFuelCards();
  return cards
    .filter((card) => card.active)
    .map(({ id, name, provider, entity, vehicle, balance, lowBalanceThreshold }) => ({
      id,
      name,
      provider,
      entity,
      vehicle,
      balance,
      lowBalanceThreshold,
    }));
}

async function getFuelCard(id: number): Promise<FuelCardDto | null> {
  const [row, totals] = await Promise.all([
    prisma.fuelCard.findUnique({ where: { id }, select: CARD_SELECT }),
    cardTotals([id]),
  ]);
  return row ? serializeCard(row, totals.get(id)) : null;
}

const TOP_UP_SELECT = {
  id: true,
  cardId: true,
  kind: true,
  amount: true,
  occurredAt: true,
  reference: true,
  notes: true,
  createdBy: { select: { id: true, name: true } },
} as const;

function serializeTopUp(row: Prisma.FuelCardTopUpGetPayload<{ select: typeof TOP_UP_SELECT }>): TopUpDto {
  return {
    id: row.id,
    cardId: row.cardId,
    kind: row.kind,
    amount: row.amount.toNumber(),
    occurredAt: row.occurredAt.toISOString(),
    reference: row.reference,
    notes: row.notes,
    createdBy: row.createdBy,
  };
}

/** A card with its top-ups and the fill-ups it paid, for its statement. */
export async function getFuelCardStatement(
  id: number,
): Promise<{ card: FuelCardDto; topUps: TopUpDto[]; fills: CardFillDto[] } | null> {
  const [card, topUps, fills] = await Promise.all([
    getFuelCard(id),
    prisma.fuelCardTopUp.findMany({ where: { cardId: id }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: TOP_UP_SELECT }),
    prisma.vehicleFuelLog.findMany({
      where: { fuelCardId: id },
      orderBy: [{ filledAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        filledAt: true,
        litres: true,
        cost: true,
        station: true,
        filledBy: true,
        vehicle: { select: { registration: true } },
      },
    }),
  ]);
  if (!card) return null;
  return {
    card,
    topUps: topUps.map(serializeTopUp),
    fills: fills.map((row) => ({
      id: row.id,
      filledAt: row.filledAt.toISOString(),
      vehicle: row.vehicle.registration,
      litres: row.litres.toNumber(),
      cost: toNumber(row.cost),
      station: row.station,
      filledBy: row.filledBy,
    })),
  };
}

// --- Cards -------------------------------------------------------------------

/** A card can only be issued to one of our own vehicles. */
async function cardVehicleProblem(vehicleId: number | null | undefined): Promise<string | null> {
  if (vehicleId == null) return null;
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { ownership: true } });
  if (!vehicle) return 'Vehicle not found';
  return vehicle.ownership === 'Internal' ? null : 'Fuel cards are for internal vehicles only';
}

export async function createFuelCard(userId: number, input: FuelCardCreateInput): Promise<FuelCardWriteResult<FuelCardDto>> {
  const problem = await cardVehicleProblem(input.vehicleId);
  if (problem) return { error: problem, status: 400 };
  const row = await prisma.fuelCard.create({
    data: {
      name: input.name,
      provider: input.provider,
      entity: input.entity,
      vehicleId: input.vehicleId ?? null,
      cardNumber: textOrNull(input.cardNumber),
      lowBalanceThreshold: input.lowBalanceThreshold,
      active: input.active,
      notes: textOrNull(input.notes),
      createdById: userId,
    },
    select: CARD_SELECT,
  });
  return { item: serializeCard(row, undefined) };
}

export async function updateFuelCard(
  id: number,
  input: FuelCardUpdateInput,
  context: AlertContext = {},
): Promise<FuelCardWriteResult<FuelCardDto>> {
  const existing = await prisma.fuelCard.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: 'Fuel card not found', status: 404 };
  const problem = await cardVehicleProblem(input.vehicleId);
  if (problem) return { error: problem, status: 400 };

  const data: Prisma.FuelCardUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.provider !== undefined) data.provider = input.provider;
  if (input.entity !== undefined) data.entity = input.entity;
  if (input.cardNumber !== undefined) data.cardNumber = textOrNull(input.cardNumber);
  if (input.vehicleId !== undefined) data.vehicleId = input.vehicleId;
  if (input.lowBalanceThreshold !== undefined) data.lowBalanceThreshold = input.lowBalanceThreshold;
  if (input.active !== undefined) data.active = input.active;
  if (input.notes !== undefined) data.notes = textOrNull(input.notes);
  await prisma.fuelCard.update({ where: { id }, data });

  // A new alert level, or bringing a card back into use, can put it under.
  if (input.lowBalanceThreshold !== undefined || input.active !== undefined) {
    await checkFuelCardBalances([id], context);
  }
  const card = await getFuelCard(id);
  return card ? { item: card } : { error: 'Fuel card not found', status: 404 };
}

/** Only a card with no history can go; one that has paid or been loaded is retired instead. */
export async function deleteFuelCard(id: number): Promise<FuelCardWriteResult<{ deleted: true }>> {
  const [card, fills, topUps] = await Promise.all([
    prisma.fuelCard.findUnique({ where: { id }, select: { id: true } }),
    prisma.vehicleFuelLog.count({ where: { fuelCardId: id } }),
    prisma.fuelCardTopUp.count({ where: { cardId: id } }),
  ]);
  if (!card) return { error: 'Fuel card not found', status: 404 };
  if (fills > 0 || topUps > 0) {
    return { error: 'This card has fill-ups or top-ups on record. Retire it instead, to keep its history.', status: 409 };
  }
  await prisma.fuelCard.delete({ where: { id } });
  return { item: { deleted: true } };
}

// --- Top-ups -----------------------------------------------------------------

export async function createTopUp(
  userId: number,
  cardId: number,
  input: TopUpCreateInput,
  context: AlertContext = {},
): Promise<FuelCardWriteResult<TopUpDto>> {
  const card = await prisma.fuelCard.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) return { error: 'Fuel card not found', status: 404 };
  const row = await prisma.fuelCardTopUp.create({
    data: {
      cardId,
      kind: input.kind,
      amount: input.amount,
      occurredAt: new Date(input.occurredAt),
      reference: textOrNull(input.reference),
      notes: textOrNull(input.notes),
      createdById: userId,
    },
    select: TOP_UP_SELECT,
  });
  await checkFuelCardBalances([cardId], context);
  return { item: serializeTopUp(row) };
}

export async function updateTopUp(
  cardId: number,
  topUpId: number,
  input: TopUpUpdateInput,
  context: AlertContext = {},
): Promise<FuelCardWriteResult<TopUpDto>> {
  const existing = await prisma.fuelCardTopUp.findFirst({
    where: { id: topUpId, cardId },
    select: { kind: true, amount: true },
  });
  if (!existing) return { error: 'Top-up not found', status: 404 };
  const kind = input.kind ?? existing.kind;
  const amount = input.amount ?? existing.amount.toNumber();
  if (kind === 'Top-up' && amount <= 0) {
    return { error: 'A top-up must be more than 0; use an adjustment to take money off', status: 400 };
  }

  const data: Prisma.FuelCardTopUpUpdateInput = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.occurredAt !== undefined) data.occurredAt = new Date(input.occurredAt);
  if (input.reference !== undefined) data.reference = textOrNull(input.reference);
  if (input.notes !== undefined) data.notes = textOrNull(input.notes);
  const row = await prisma.fuelCardTopUp.update({ where: { id: topUpId }, data, select: TOP_UP_SELECT });
  await checkFuelCardBalances([cardId], context);
  return { item: serializeTopUp(row) };
}

export async function deleteTopUp(cardId: number, topUpId: number, context: AlertContext = {}): Promise<boolean> {
  const { count } = await prisma.fuelCardTopUp.deleteMany({ where: { id: topUpId, cardId } });
  if (count > 0) await checkFuelCardBalances([cardId], context);
  return count > 0;
}

// --- Paying for a fill-up ----------------------------------------------------

/**
 * Why a fill-up can't be paid with this card, or null when it can. Only our
 * own vehicles fill up on a card, the cost is what comes off it, and the card
 * pays in KES. A retired card keeps the fill-ups it already paid for, but
 * can't take on another one.
 */
export async function fuelCardPaymentProblem(params: {
  fuelCardId: number | null;
  vehicleId: number;
  cost: number | null;
  currency: string;
  /** The card the fill-up was already paid with, when editing one. */
  currentCardId?: number | null;
}): Promise<string | null> {
  if (params.fuelCardId == null) return null;
  const [card, vehicle] = await Promise.all([
    prisma.fuelCard.findUnique({
      where: { id: params.fuelCardId },
      select: { name: true, active: true, vehicleId: true, vehicle: { select: { registration: true } } },
    }),
    prisma.vehicle.findUnique({ where: { id: params.vehicleId }, select: { ownership: true } }),
  ]);
  if (!card) return 'Fuel card not found';
  if (!card.active && params.currentCardId !== params.fuelCardId) {
    return `${card.name} is retired and can't pay for new fill-ups`;
  }
  if (vehicle?.ownership !== 'Internal') return 'Fuel cards are for internal vehicles only';
  // A card issued to one vehicle pays only for that vehicle; a spare pays for any.
  if (card.vehicleId != null && card.vehicleId !== params.vehicleId && params.currentCardId !== params.fuelCardId) {
    return `${card.name} is issued to ${card.vehicle?.registration ?? 'another vehicle'}; pick that vehicle's card or a spare`;
  }
  if (params.cost == null || params.cost <= 0) return 'Enter the cost: it comes off the fuel card';
  if (params.currency !== FUEL_CURRENCY) {
    return `Fuel cards pay in ${FUEL_CURRENCY}; this fill-up is recorded in ${params.currency}`;
  }
  return null;
}

// --- Low-balance alerts ------------------------------------------------------

function alertUrl(cardId: number, origin: string | undefined): string | null {
  const configured = process.env.WEBAUTHN_ORIGIN?.trim();
  for (const base of [configured, origin]) {
    if (!base) continue;
    try {
      return new URL(`/modules/fuel-cards?card=${cardId}`, base).toString();
    } catch {
      // Not a usable address; try the next one.
    }
  }
  return null;
}

/** The people a low balance goes to: every active admin. */
async function alertRecipients() {
  return prisma.user.findMany({
    where: { status: 'active', userRoles: { some: { role: { name: ADMIN_ROLE_NAME } } } },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Re-checks the given cards' balances against their alert levels. A card that
 * is under and hasn't alerted yet tells every admin once; a card back at or
 * over its level is re-armed. Claiming the alert is a single conditional
 * update, so two saves at once never send it twice. Never throws: the write
 * that prompted it is already saved.
 */
export async function checkFuelCardBalances(cardIds: Iterable<number | null | undefined>, context: AlertContext = {}): Promise<void> {
  const ids = [...new Set([...cardIds].filter((id): id is number => Number.isInteger(id) && (id as number) > 0))];
  if (ids.length === 0) return;
  try {
    const [cards, totals] = await Promise.all([
      prisma.fuelCard.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, entity: true, active: true, lowBalanceThreshold: true, lowAlertedAt: true },
      }),
      cardTotals(ids),
    ]);
    for (const card of cards) {
      const t = totals.get(card.id);
      const balance = round2((t?.loaded ?? 0) - (t?.spent ?? 0));
      const threshold = card.lowBalanceThreshold.toNumber();
      const under = card.active && isLowBalance(balance, threshold);
      if (!under) {
        if (card.lowAlertedAt) {
          await prisma.fuelCard.updateMany({ where: { id: card.id }, data: { lowAlertedAt: null } });
        }
        continue;
      }
      const claimed = await prisma.fuelCard.updateMany({
        where: { id: card.id, lowAlertedAt: null },
        data: { lowAlertedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      await alertLowBalance(card, balance, threshold, context);
    }
  } catch (error) {
    console.error('[fuel-cards] balance check failed:', error);
  }
}

async function alertLowBalance(
  card: { id: number; name: string; entity: string },
  balance: number,
  threshold: number,
  context: AlertContext,
): Promise<void> {
  const recipients = await alertRecipients();
  if (recipients.length === 0) return;
  const message = lowBalanceMessage(card, balance, threshold);
  await prisma.fuelCardNotification.createMany({
    data: recipients.map((r) => ({ userId: r.id, cardId: card.id, type: 'fuel-card.low', message })),
  });
  notifyNotificationsChanged(recipients.map((r) => r.id));

  const withEmail = recipients.filter((r) => r.email?.trim());
  if (withEmail.length === 0 || !isEmailConfigured()) return;
  // Not awaited: a slow mail server must not hold up the fill-up that set this off.
  void emailFuelCardLow({
    recipients: withEmail.map((r) => ({ name: r.name, email: r.email! })),
    card,
    balance,
    threshold,
    cardUrl: alertUrl(card.id, context.origin),
  }).catch((error) => console.error('[fuel-cards] low-balance email failed:', error));
}

// --- The bell ----------------------------------------------------------------

export interface FuelCardNotificationSummary {
  id: number;
  cardId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export async function listFuelCardNotifications(userId: number): Promise<FuelCardNotificationSummary[]> {
  const rows = await prisma.fuelCardNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, cardId: true, type: true, message: true, createdAt: true, readAt: true },
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }));
}

export async function markFuelCardNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const wanted = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (wanted.length === 0) return 0;
  const { count } = await prisma.fuelCardNotification.updateMany({
    where: { userId, id: { in: wanted }, readAt: null },
    data: { readAt: new Date() },
  });
  if (count > 0) notifyNotificationsChanged(userId);
  return count;
}
