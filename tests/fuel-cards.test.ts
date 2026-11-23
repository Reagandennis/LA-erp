import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { db, requireModuleRequest, requireRequestAuth, notifyNotificationsChanged, emailFuelCardLow, isEmailConfigured } = vi.hoisted(() => ({
  db: {
    vehicle: { findUnique: vi.fn(), findMany: vi.fn() },
    vehicleFuelLog: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    fuelCard: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
    fuelCardTopUp: { groupBy: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    fuelCardNotification: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
  requireModuleRequest: vi.fn(),
  requireRequestAuth: vi.fn(),
  notifyNotificationsChanged: vi.fn(),
  emailFuelCardLow: vi.fn(),
  isEmailConfigured: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/request-auth', () => ({ requireModuleRequest, requireRequestAuth }));
vi.mock('../lib/notification-events', () => ({ notifyNotificationsChanged }));
vi.mock('../lib/transactional-email', () => ({ emailFuelCardLow }));
vi.mock('../lib/email', () => ({ isEmailConfigured }));

import { POST as postFuel } from '../app/api/fleet/fuel/route';
import { DELETE as deleteFuel, PATCH as patchFuel } from '../app/api/fleet/fuel/[id]/route';
import { DELETE as deleteCardRoute } from '../app/api/fleet/fuel-cards/[id]/route';
import { POST as postTopUp } from '../app/api/fleet/fuel-cards/[id]/top-ups/route';
import { PATCH as readAlerts } from '../app/api/fleet/fuel-cards/notifications/route';
import { buildStatement, cardsForVehicle, lowBalanceMessage } from '../lib/fuel-cards';
import { checkFuelCardBalances, fuelCardPaymentProblem, listFuelCardOptions } from '../lib/fuel-cards-server';
import { fuelLogCreateSchema, topUpCreateSchema } from '../lib/validation';

const vehicle = { id: 1, registration: 'KDA 123A', make: 'Toyota', model: 'Prado' };
const dec = (n: number) => new Prisma.Decimal(n);
const json = (method: string, url: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

/** A card whose balance is `loaded - spent`, as the groupBy sums report it. */
function cardState(card: { id: number; loaded: number; spent: number; threshold?: number; active?: boolean; alertedAt?: Date | null }) {
  db.fuelCard.findMany.mockResolvedValue([
    {
      id: card.id,
      name: 'Shell Fuel Card',
      entity: 'LADYASKARI',
      active: card.active ?? true,
      lowBalanceThreshold: dec(card.threshold ?? 5000),
      lowAlertedAt: card.alertedAt ?? null,
    },
  ]);
  db.fuelCardTopUp.groupBy.mockResolvedValue([{ cardId: card.id, _sum: { amount: dec(card.loaded) } }]);
  db.vehicleFuelLog.groupBy.mockResolvedValue([{ fuelCardId: card.id, _sum: { cost: dec(card.spent) }, _count: { _all: 1 } }]);
}

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
  for (const fn of [requireModuleRequest, requireRequestAuth, notifyNotificationsChanged, emailFuelCardLow, isEmailConfigured]) fn.mockReset();
  requireModuleRequest.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
  requireRequestAuth.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
  emailFuelCardLow.mockResolvedValue({ to: [] });
  isEmailConfigured.mockReturnValue(true);
  db.vehicle.findUnique.mockResolvedValue({ id: 1, ownership: 'Internal' });
  db.fuelCard.findUnique.mockResolvedValue({ id: 3, name: 'Shell Fuel Card', active: true });
  db.fuelCard.findMany.mockResolvedValue([]);
  db.fuelCard.updateMany.mockResolvedValue({ count: 1 });
  db.fuelCardTopUp.groupBy.mockResolvedValue([]);
  db.vehicleFuelLog.groupBy.mockResolvedValue([]);
  db.fuelCardNotification.createMany.mockResolvedValue({ count: 1 });
  db.user.findMany.mockResolvedValue([
    { id: 1, name: 'Admin One', email: 'one@example.com' },
    { id: 2, name: 'Admin Two', email: null },
  ]);
  db.vehicleFuelLog.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    id: 11,
    litres: dec(data.litres as number),
    cost: data.cost == null ? null : dec(data.cost as number),
    createdAt: new Date('2026-11-23T08:00:00Z'),
    vehicle,
    fuelCard: data.fuelCardId ? { id: data.fuelCardId, name: 'Shell Fuel Card' } : null,
    createdBy: { id: 7, name: 'Fleet Manager' },
  }));
});

describe('fuel card statement', () => {
  it('runs the balance oldest to newest and lists newest first', () => {
    const entries = buildStatement(
      [
        { id: 1, cardId: 3, kind: 'Top-up', amount: 20000, occurredAt: '2026-11-01T08:00:00.000Z', reference: 'MPESA1', notes: null, createdBy: null },
        { id: 2, cardId: 3, kind: 'Adjustment', amount: -500, occurredAt: '2026-11-10T08:00:00.000Z', reference: null, notes: 'Statement', createdBy: null },
      ],
      [{ id: 9, filledAt: '2026-11-05T08:00:00.000Z', vehicle: 'KDA 123A', litres: 40, cost: 7600, station: 'Shell Westlands', filledBy: 'Peter' }],
    );
    expect(entries.map((e) => [e.kind, e.amount, e.balanceAfter])).toEqual([
      ['Adjustment', -500, 11900],
      ['Fill-up', -7600, 12400],
      ['Top-up', 20000, 20000],
    ]);
  });

  it('puts money in before taking it out at the same moment', () => {
    const at = '2026-11-01T08:00:00.000Z';
    const entries = buildStatement(
      [{ id: 1, cardId: 3, kind: 'Top-up', amount: 5000, occurredAt: at, reference: null, notes: null, createdBy: null }],
      [{ id: 9, filledAt: at, vehicle: 'KDA 123A', litres: 20, cost: 4000, station: null, filledBy: null }],
    );
    expect(entries.map((e) => e.balanceAfter)).toEqual([1000, 5000]);
  });

  it('words the alert with the card, its company and the amounts in KES', () => {
    expect(lowBalanceMessage({ name: 'Shell Fuel Card', entity: 'LIONESS' }, 3200, 5000)).toMatch(
      /^Shell Fuel Card \(Lioness Alliance\) is down to KES\s?3,200(\.00)?, below the KES\s?5,000(\.00)? alert level/,
    );
  });
});

describe('fuel card validation', () => {
  const fill = { vehicleId: 1, filledAt: '2026-11-23T08:00:00Z', litres: 40 };

  it('needs a cost when a card pays, since that is what comes off it', () => {
    expect(fuelLogCreateSchema.safeParse({ ...fill, fuelCardId: 3 }).success).toBe(false);
    expect(fuelLogCreateSchema.safeParse({ ...fill, fuelCardId: 3, cost: 0 }).success).toBe(false);
    expect(fuelLogCreateSchema.safeParse({ ...fill, fuelCardId: 3, cost: 7600 }).success).toBe(true);
  });

  it('records fuel in KES only and offers no Electric or LPG', () => {
    expect(fuelLogCreateSchema.safeParse({ ...fill, currency: 'USD' }).success).toBe(false);
    expect(fuelLogCreateSchema.parse({ ...fill, currency: 'kes' }).currency).toBe('KES');
    expect(fuelLogCreateSchema.safeParse({ ...fill, fuelType: 'Electric' }).success).toBe(false);
    expect(fuelLogCreateSchema.safeParse({ ...fill, fuelType: 'LPG' }).success).toBe(false);
  });

  it('only lets an adjustment take money off a card', () => {
    const base = { occurredAt: '2026-11-23T08:00:00Z' };
    expect(topUpCreateSchema.safeParse({ ...base, amount: -100 }).success).toBe(false);
    expect(topUpCreateSchema.safeParse({ ...base, kind: 'Adjustment', amount: -100 }).success).toBe(true);
    expect(topUpCreateSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
  });
});

describe('paying for a fill-up with a card', () => {
  const pay = { fuelCardId: 3, vehicleId: 1, cost: 7600, currency: 'KES' };

  it('lets an internal vehicle pay in KES with an active card', async () => {
    expect(await fuelCardPaymentProblem(pay)).toBeNull();
    expect(await fuelCardPaymentProblem({ ...pay, fuelCardId: null })).toBeNull();
  });

  it('turns away a supplier’s vehicle, a retired card, a missing cost or another currency', async () => {
    db.vehicle.findUnique.mockResolvedValueOnce({ id: 1, ownership: 'External' });
    expect(await fuelCardPaymentProblem(pay)).toBe('Fuel cards are for internal vehicles only');

    db.fuelCard.findUnique.mockResolvedValueOnce({ name: 'Old Card', active: false });
    expect(await fuelCardPaymentProblem(pay)).toBe("Old Card is retired and can't pay for new fill-ups");

    expect(await fuelCardPaymentProblem({ ...pay, cost: null })).toBe('Enter the cost: it comes off the fuel card');
    expect(await fuelCardPaymentProblem({ ...pay, currency: 'USD' })).toMatch(/pay in KES/);
  });

  it('lets a card issued to a vehicle pay only for that vehicle; a spare pays for any', async () => {
    db.fuelCard.findUnique.mockResolvedValueOnce({ name: 'KDK 241R · Shell · Lioness', active: true, vehicleId: 2, vehicle: { registration: 'KDK 241R' } });
    expect(await fuelCardPaymentProblem(pay)).toBe("KDK 241R · Shell · Lioness is issued to KDK 241R; pick that vehicle's card or a spare");

    db.fuelCard.findUnique.mockResolvedValueOnce({ name: 'KDK 241R · Shell · Lioness', active: true, vehicleId: 1, vehicle: { registration: 'KDK 241R' } });
    expect(await fuelCardPaymentProblem(pay)).toBeNull();

    db.fuelCard.findUnique.mockResolvedValueOnce({ name: 'Spare · Shell · Lioness', active: true, vehicleId: null, vehicle: null });
    expect(await fuelCardPaymentProblem(pay)).toBeNull();
  });

  it('offers a vehicle its own cards first, then the spares, and never another vehicle’s', () => {
    const card = (id: number, vehicleId: number | null) => ({ id, name: `#${id}`, vehicle: vehicleId ? { id: vehicleId, registration: `V${vehicleId}` } : null });
    const cards = [card(1, null), card(2, 7), card(3, 8), card(4, 7)];
    expect(cardsForVehicle(cards, 7).map((c) => c.id)).toEqual([2, 4, 1]);
    expect(cardsForVehicle(cards, null).map((c) => c.id)).toEqual([1]);
  });

  it('keeps a retired card on the fill-ups it already paid for', async () => {
    db.fuelCard.findUnique.mockResolvedValueOnce({ name: 'Old Card', active: false });
    expect(await fuelCardPaymentProblem({ ...pay, currentCardId: 3 })).toBeNull();
  });
});

describe('low-balance alerts', () => {
  it('tells every admin once, in the bell and by email, when a card falls under', async () => {
    cardState({ id: 3, loaded: 10000, spent: 7600 });

    await checkFuelCardBalances([3], { origin: 'https://erp.example.com' });

    expect(db.fuelCard.updateMany).toHaveBeenCalledWith({ where: { id: 3, lowAlertedAt: null }, data: { lowAlertedAt: expect.any(Date) } });
    const rows = db.fuelCardNotification.createMany.mock.calls[0]![0].data;
    expect(rows.map((r: { userId: number }) => r.userId)).toEqual([1, 2]);
    expect(rows[0].message).toContain('Shell Fuel Card');
    expect(notifyNotificationsChanged).toHaveBeenCalledWith([1, 2]);
    // Only admins with an address are emailed.
    expect(emailFuelCardLow).toHaveBeenCalledTimes(1);
    expect(emailFuelCardLow.mock.calls[0]![0]).toMatchObject({
      recipients: [{ name: 'Admin One', email: 'one@example.com' }],
      balance: 2400,
      threshold: 5000,
      cardUrl: 'https://erp.example.com/modules/fuel-cards?card=3',
    });
  });

  it('stays quiet when the alert for this dip already went out', async () => {
    cardState({ id: 3, loaded: 10000, spent: 7600, alertedAt: new Date() });
    db.fuelCard.updateMany.mockResolvedValue({ count: 0 });

    await checkFuelCardBalances([3]);

    expect(db.fuelCardNotification.createMany).not.toHaveBeenCalled();
    expect(emailFuelCardLow).not.toHaveBeenCalled();
  });

  it('re-arms once a top-up lifts the card back over its level', async () => {
    cardState({ id: 3, loaded: 60000, spent: 7600, alertedAt: new Date() });

    await checkFuelCardBalances([3]);

    expect(db.fuelCard.updateMany).toHaveBeenCalledWith({ where: { id: 3 }, data: { lowAlertedAt: null } });
    expect(db.fuelCardNotification.createMany).not.toHaveBeenCalled();
  });

  it('never alerts for a retired card, and skips email when mail is not set up', async () => {
    cardState({ id: 3, loaded: 0, spent: 7600, active: false });
    await checkFuelCardBalances([3]);
    expect(db.fuelCardNotification.createMany).not.toHaveBeenCalled();

    cardState({ id: 3, loaded: 0, spent: 7600 });
    isEmailConfigured.mockReturnValue(false);
    await checkFuelCardBalances([3]);
    expect(db.fuelCardNotification.createMany).toHaveBeenCalledTimes(1);
    expect(emailFuelCardLow).not.toHaveBeenCalled();
  });

  it('never throws: the save that prompted it already happened', async () => {
    db.fuelCard.findMany.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(checkFuelCardBalances([3])).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('offers only active cards, with balances, to the fill-up forms', async () => {
    db.fuelCard.findMany.mockResolvedValue([
      { id: 3, name: 'Shell Fuel Card', provider: 'Shell', entity: 'LADYASKARI', cardNumber: null, lowBalanceThreshold: dec(5000), active: true, notes: null, createdAt: new Date() },
      { id: 4, name: 'Old Card', provider: 'Other', entity: 'LIONESS', cardNumber: null, lowBalanceThreshold: dec(5000), active: false, notes: null, createdAt: new Date() },
    ]);
    db.fuelCardTopUp.groupBy.mockResolvedValue([{ cardId: 3, _sum: { amount: dec(20000) } }]);
    db.vehicleFuelLog.groupBy.mockResolvedValue([{ fuelCardId: 3, _sum: { cost: dec(7600) }, _count: { _all: 1 } }]);

    expect(await listFuelCardOptions()).toEqual([
      { id: 3, name: 'Shell Fuel Card', provider: 'Shell', entity: 'LADYASKARI', balance: 12400, lowBalanceThreshold: 5000 },
    ]);
  });
});

describe('fuel card routes', () => {
  it('logs a card-paid fill-up and re-checks that card', async () => {
    cardState({ id: 3, loaded: 50000, spent: 7600 });
    const res = await postFuel(
      json('POST', '/api/fleet/fuel', { vehicleId: 1, filledAt: '2026-11-23T08:00:00Z', litres: 40, cost: 7600, fuelCardId: 3 }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).item).toMatchObject({ currency: 'KES', fuelCard: { id: 3, name: 'Shell Fuel Card' } });
    expect(db.vehicleFuelLog.create.mock.calls[0]![0].data).toMatchObject({ fuelCardId: 3, currency: 'KES' });
    expect(db.fuelCard.findMany).toHaveBeenCalled();
  });

  it('refuses a card for a supplier’s vehicle', async () => {
    db.vehicle.findUnique.mockResolvedValue({ id: 1, ownership: 'External' });
    const res = await postFuel(
      json('POST', '/api/fleet/fuel', { vehicleId: 1, filledAt: '2026-11-23T08:00:00Z', litres: 40, cost: 7600, fuelCardId: 3 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Fuel cards are for internal vehicles only');
    expect(db.vehicleFuelLog.create).not.toHaveBeenCalled();
  });

  it('re-checks both cards when a fill-up moves from one to another, and the old one when it is deleted', async () => {
    db.vehicleFuelLog.findUnique.mockResolvedValue({ id: 11, vehicleId: 1, cost: dec(7600), currency: 'KES', fuelCardId: 3 });
    db.vehicleFuelLog.update.mockResolvedValue({
      id: 11, filledAt: new Date(), litres: dec(40), cost: dec(7600), currency: 'KES', odometerKm: null, fuelType: 'Petrol', fullTank: true,
      station: null, filledBy: null, notes: null, createdAt: new Date(), vehicle, fuelCard: { id: 4, name: 'Total' }, createdBy: null,
    });
    const patched = await patchFuel(json('PATCH', '/api/fleet/fuel/11', { fuelCardId: 4 }), params({ id: '11' }));
    expect(patched.status).toBe(200);
    expect(db.fuelCard.findMany.mock.calls.at(-1)![0].where).toEqual({ id: { in: [3, 4] } });

    db.vehicleFuelLog.findUnique.mockResolvedValue({ fuelCardId: 4 });
    db.vehicleFuelLog.deleteMany.mockResolvedValue({ count: 1 });
    const deleted = await deleteFuel(json('DELETE', '/api/fleet/fuel/11'), params({ id: '11' }));
    expect(deleted.status).toBe(200);
    expect(db.fuelCard.findMany.mock.calls.at(-1)![0].where).toEqual({ id: { in: [4] } });
  });

  it('records a top-up under Fuel Cards access and re-checks the card', async () => {
    db.fuelCard.findUnique.mockResolvedValue({ id: 3 });
    db.fuelCardTopUp.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 1, cardId: 3, kind: data.kind, amount: dec(data.amount as number), occurredAt: data.occurredAt, reference: data.reference, notes: null, createdBy: null,
    }));
    cardState({ id: 3, loaded: 50000, spent: 0, alertedAt: new Date() });

    const res = await postTopUp(json('POST', '/api/fleet/fuel-cards/3/top-ups', { amount: 50000, occurredAt: '2026-11-23T08:00:00Z', reference: 'MPESA' }), params({ id: '3' }));

    expect(res.status).toBe(201);
    expect(requireModuleRequest.mock.calls[0]!.slice(1)).toEqual(['fuel-cards']);
    expect((await res.json()).item).toMatchObject({ kind: 'Top-up', amount: 50000, reference: 'MPESA' });
    // Back over the level: re-armed.
    expect(db.fuelCard.updateMany).toHaveBeenCalledWith({ where: { id: 3 }, data: { lowAlertedAt: null } });
  });

  it('keeps a card with history: it can be retired, not deleted', async () => {
    db.fuelCard.findUnique.mockResolvedValue({ id: 3 });
    db.vehicleFuelLog.count.mockResolvedValue(2);
    db.fuelCardTopUp.count.mockResolvedValue(1);
    const res = await deleteCardRoute(json('DELETE', '/api/fleet/fuel-cards/3'), params({ id: '3' }));
    expect(res.status).toBe(409);
    expect(db.fuelCard.delete).not.toHaveBeenCalled();
  });

  it('marks only the caller’s own alerts read', async () => {
    db.fuelCardNotification.updateMany.mockResolvedValue({ count: 1 });
    const res = await readAlerts(json('PATCH', '/api/fleet/fuel-cards/notifications', { ids: [5, 5, 'x'] }));
    expect((await res.json()).updated).toBe(1);
    expect(db.fuelCardNotification.updateMany.mock.calls[0]![0].where).toEqual({ userId: 7, id: { in: [5] }, readAt: null });
  });
});
