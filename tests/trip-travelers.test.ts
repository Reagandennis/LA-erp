import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, transaction } = vi.hoisted(() => {
  const tx = {
    traveler: { count: vi.fn(), create: vi.fn() },
    tripTraveler: { createMany: vi.fn() },
    tripSequence: { upsert: vi.fn() },
    trackingSequence: { upsert: vi.fn() },
    trip: { create: vi.fn(), findUnique: vi.fn() },
    tripItineraryItem: { createMany: vi.fn() },
  };
  return { tx, transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
});

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: { $transaction: transaction } }));

import { TripTravelerError, createTrip } from '../lib/trips';

const tripRecord = {
  id: 7,
  reference: 'TR-2026-0001',
  trackingCode: 'LA-2026-0001',
  customerId: 3,
  sourceQuoteId: null,
  createdById: 1,
  ownerId: null,
  title: 'Site visit',
  description: null,
  status: 'Draft',
  startDate: null,
  endDate: null,
  currency: 'USD',
  notes: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  customer: { id: 3, name: 'Acme', company: null, email: null },
  travelers: [],
  createdBy: { id: 1, name: 'Admin', email: 'admin@example.com' },
  owner: null,
  sourceQuote: null,
  items: [],
  days: [],
};

function baseInput() {
  return {
    customerId: 3,
    ownerId: null,
    title: 'Site visit',
    description: null,
    startDate: null,
    endDate: null,
    currency: 'USD',
    notes: null,
    items: [],
    createdById: 1,
  };
}

describe('createTrip travellers', () => {
  beforeEach(() => {
    for (const delegate of Object.values(tx)) {
      for (const fn of Object.values(delegate)) fn.mockReset();
    }
    tx.tripSequence.upsert.mockResolvedValue({ year: 2026, lastNumber: 1 });
    tx.trackingSequence.upsert.mockResolvedValue({ year: 2026, lastNumber: 1 });
    tx.trip.create.mockResolvedValue(tripRecord);
    tx.trip.findUnique.mockResolvedValue(tripRecord);
  });

  it('links existing travellers and creates new ones for the client, lead first', async () => {
    tx.traveler.count.mockResolvedValue(2);
    tx.traveler.create.mockResolvedValue({ id: 50 });

    await createTrip({
      ...baseInput(),
      travelers: [
        { travelerId: 11 },
        { name: 'New Guest' },
        { travelerId: 12 },
        { travelerId: 11 },
        { name: 'new guest' },
      ],
    });

    expect(tx.traveler.count).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] }, customerId: 3 },
    });
    // The repeated name (any case) is created once.
    expect(tx.traveler.create).toHaveBeenCalledTimes(1);
    expect(tx.traveler.create).toHaveBeenCalledWith({
      data: { name: 'New Guest', customerId: 3, createdById: 1 },
      select: { id: true },
    });
    expect(tx.tripTraveler.createMany).toHaveBeenCalledWith({
      data: [
        { tripId: 7, travelerId: 11, isPrimary: true },
        { tripId: 7, travelerId: 50, isPrimary: false },
        { tripId: 7, travelerId: 12, isPrimary: false },
      ],
    });
  });

  it("rejects a traveller who isn't the client's before reserving a reference", async () => {
    tx.traveler.count.mockResolvedValue(1);

    await expect(
      createTrip({ ...baseInput(), travelers: [{ travelerId: 11 }, { travelerId: 99 }] }),
    ).rejects.toBeInstanceOf(TripTravelerError);

    expect(tx.tripSequence.upsert).not.toHaveBeenCalled();
    expect(tx.trip.create).not.toHaveBeenCalled();
    expect(tx.tripTraveler.createMany).not.toHaveBeenCalled();
  });

  it('creates no links when no travellers are given', async () => {
    await createTrip(baseInput());

    expect(tx.traveler.count).not.toHaveBeenCalled();
    expect(tx.tripTraveler.createMany).not.toHaveBeenCalled();
    expect(tx.trip.create).toHaveBeenCalled();
  });
});
