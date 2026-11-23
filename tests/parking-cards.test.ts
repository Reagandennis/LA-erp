import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { db, requireModuleRequest } = vi.hoisted(() => ({
  db: {
    vehicle: { findUnique: vi.fn() },
    parkingCard: { findUnique: vi.fn() },
    parkingCardEntry: { create: vi.fn(), aggregate: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
  requireModuleRequest: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/request-auth', () => ({ requireModuleRequest }));

import { POST as postEntry } from '../app/api/fleet/parking-cards/[id]/entries/route';
import { PATCH as patchEntry } from '../app/api/fleet/parking-cards/[id]/entries/[entryId]/route';
import { defaultParkingThreshold, isParkingLow, parkingStatement } from '../lib/parking-cards';
import { parkingEntryCreateSchema } from '../lib/validation';

const json = (method: string, url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body) });
const at = '2026-11-23T08:00:00.000Z';

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
  requireModuleRequest.mockReset();
  requireModuleRequest.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
  db.parkingCard.findUnique.mockResolvedValue({ active: true, vehicleId: 4 });
  db.vehicle.findUnique.mockResolvedValue({ id: 4 });
  db.parkingCardEntry.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 1,
    cardId: data.cardId,
    kind: data.kind,
    amount: new Prisma.Decimal(data.amount as number),
    observedBalance: data.observedBalance == null ? null : new Prisma.Decimal(data.observedBalance as number),
    occurredAt: data.occurredAt,
    location: data.location,
    reference: data.reference,
    notes: data.notes,
    vehicle: data.vehicleId ? { id: data.vehicleId, registration: 'KDK 241R' } : null,
    createdBy: { id: 7, name: 'Ops' },
  }));
});

describe('parking card rules', () => {
  it('keeps KES 500 on a card, KES 10,000 on Express Way', () => {
    expect(defaultParkingThreshold('PAYTECH')).toBe(500);
    expect(defaultParkingThreshold('Express Way')).toBe(10000);
    expect(isParkingLow({ balance: 450, lowBalanceThreshold: 500, active: true })).toBe(true);
    expect(isParkingLow({ balance: 450, lowBalanceThreshold: 500, active: false })).toBe(false);
  });

  it('runs the statement balance oldest to newest and lists newest first', () => {
    const entry = (id: number, kind: string, amount: number, occurredAt: string) => ({
      id, cardId: 1, kind, amount, observedBalance: null, occurredAt, vehicle: null, location: null, reference: null, notes: null, createdBy: null,
    });
    const lines = parkingStatement([
      entry(1, 'Balance check', 800, '2026-11-01T08:00:00Z'),
      entry(2, 'Parking', -150, '2026-11-02T08:00:00Z'),
      entry(3, 'Top-up', 1000, '2026-11-03T08:00:00Z'),
    ]);
    expect(lines.map((l) => [l.id, l.balanceAfter])).toEqual([[3, 1650], [2, 650], [1, 800]]);
  });

  it('needs an amount for parking and top-ups, and the seen balance for a check', () => {
    expect(parkingEntryCreateSchema.safeParse({ kind: 'Parking', occurredAt: at }).success).toBe(false);
    expect(parkingEntryCreateSchema.safeParse({ kind: 'Parking', amount: -50, occurredAt: at }).success).toBe(false);
    expect(parkingEntryCreateSchema.safeParse({ kind: 'Balance check', occurredAt: at }).success).toBe(false);
    expect(parkingEntryCreateSchema.safeParse({ kind: 'Balance check', observedBalance: 0, occurredAt: at }).success).toBe(true);
  });
});

describe('logging on a parking card', () => {
  it('takes parking off the card and books it to the card’s vehicle', async () => {
    const res = await postEntry(json('POST', '/api/fleet/parking-cards/3/entries', { kind: 'Parking', amount: 150, occurredAt: at, location: 'JKIA', reference: 'MCF-KEN-NOV-2833' }), { params: Promise.resolve({ id: '3' }) });
    expect(res.status).toBe(201);
    expect(requireModuleRequest.mock.calls[0]!.slice(1)).toEqual(['parking-cards']);
    expect(db.parkingCardEntry.create.mock.calls[0]![0].data).toMatchObject({ cardId: 3, kind: 'Parking', amount: -150, vehicleId: 4, location: 'JKIA', createdById: 7 });
  });

  it('records a balance check as the difference from what the platform had', async () => {
    db.parkingCardEntry.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(1300) } });
    const res = await postEntry(json('POST', '/api/fleet/parking-cards/3/entries', { kind: 'Balance check', observedBalance: 1250, occurredAt: at }), { params: Promise.resolve({ id: '3' }) });
    expect(res.status).toBe(201);
    expect(db.parkingCardEntry.create.mock.calls[0]![0].data).toMatchObject({ kind: 'Balance check', amount: -50, observedBalance: 1250, vehicleId: null });
    expect((await res.json()).item).toMatchObject({ amount: -50, observedBalance: 1250 });
  });

  it('turns away entries on a retired card', async () => {
    db.parkingCard.findUnique.mockResolvedValue({ active: false, vehicleId: null });
    const res = await postEntry(json('POST', '/api/fleet/parking-cards/3/entries', { kind: 'Top-up', amount: 1000, occurredAt: at }), { params: Promise.resolve({ id: '3' }) });
    expect(res.status).toBe(400);
    expect(db.parkingCardEntry.create).not.toHaveBeenCalled();
  });

  it('won’t edit a balance check: it is deleted and taken again', async () => {
    db.parkingCardEntry.findFirst.mockResolvedValue({ kind: 'Balance check' });
    const res = await patchEntry(json('PATCH', '/api/fleet/parking-cards/3/entries/9', { amount: 10 }), { params: Promise.resolve({ id: '3', entryId: '9' }) });
    expect(res.status).toBe(400);
    expect(db.parkingCardEntry.update).not.toHaveBeenCalled();
  });
});
