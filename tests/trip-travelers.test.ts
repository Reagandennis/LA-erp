import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, $queryRaw, transaction } = vi.hoisted(() => {
  const tx = {
    traveler: { count: vi.fn(), create: vi.fn() },
    tripTraveler: { createMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    trackingSequence: { upsert: vi.fn() },
    trip: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    customer: { findUnique: vi.fn() },
    tripItineraryItem: { createMany: vi.fn(), createManyAndReturn: vi.fn(), update: vi.fn() },
    tripItemTraveler: { createMany: vi.fn(), deleteMany: vi.fn() },
  };
  // The running reference number is reserved with raw SQL.
  const $queryRaw = vi.fn();
  return { tx, $queryRaw, transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn({ ...tx, $queryRaw } as typeof tx)) };
});

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({
  // Outside a transaction the trip is read through the same mock.
  prisma: { $transaction: transaction, trip: { findUnique: (...args: unknown[]) => tx.trip.findUnique(...args) } },
}));

import { TripTravelerError, addTripItems, createTrip, updateTrip, updateTripItem } from '../lib/trips';

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
    country: 'Kenya' as const,
    items: [],
    createdById: 1,
  };
}

/** The highest number on a reference so far, then the one the sequence hands out. */
function numbersFrom(highest: number, next: number) {
  $queryRaw.mockReset();
  $queryRaw.mockResolvedValueOnce([{ n: highest }]).mockResolvedValueOnce([{ lastNumber: next }]);
}

describe('createTrip travellers', () => {
  beforeEach(() => {
    for (const delegate of Object.values(tx)) {
      for (const fn of Object.values(delegate)) fn.mockReset();
    }
    numbersFrom(2660, 2661);
    tx.trip.findMany.mockResolvedValue([]);
    tx.customer.findUnique.mockResolvedValue({ name: 'Acme Logistics' });
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

    expect($queryRaw).not.toHaveBeenCalled();
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

describe('createTrip references', () => {
  beforeEach(() => {
    for (const delegate of Object.values(tx)) {
      for (const fn of Object.values(delegate)) fn.mockReset();
    }
    numbersFrom(2660, 2661);
    tx.trackingSequence.upsert.mockResolvedValue({ year: 2026, lastNumber: 1 });
    tx.trip.create.mockResolvedValue(tripRecord);
    tx.trip.findUnique.mockResolvedValue(tripRecord);
  });

  const created = () => tx.trip.create.mock.calls[0]![0].data as { reference: string; country: string };

  it("uses the client's usual code, the country, the start month and the next number", async () => {
    tx.trip.findMany.mockResolvedValue([
      { customerId: 3, reference: 'MCF-ETH-SEP-2650' },
      { customerId: 3, reference: 'MCF-KEN-AUG-2600' },
      { customerId: 3, reference: 'MCF-KEN-JUL-2500' },
    ]);

    await createTrip({ ...baseInput(), country: 'Ethiopia', startDate: '2026-11-03' });

    expect(created()).toMatchObject({ reference: 'MCF-ETH-NOV-2661', country: 'Ethiopia' });
    expect(tx.trip.findMany.mock.calls[0]![0].where).toEqual({ customerId: 3 });
  });

  it('takes the client code the planner gave', async () => {
    await createTrip({ ...baseInput(), clientCode: 'tkgm', startDate: '2026-02-10' });

    expect(created().reference).toBe('TKGM-KEN-FEB-2661');
    expect(tx.trip.findMany).not.toHaveBeenCalled();
  });

  it("starts a new client's code from their initials", async () => {
    tx.trip.findMany.mockResolvedValue([]);
    tx.customer.findUnique.mockResolvedValue({ name: 'Mastercard Foundation' });

    await createTrip({ ...baseInput(), country: 'Uganda', startDate: '2026-12-01' });

    expect(created().reference).toBe('MF-UGA-DEC-2661');
  });

  it('never hands out a number below one already on a reference', async () => {
    numbersFrom(2660, 2661);
    tx.trip.findMany.mockResolvedValue([{ customerId: 3, reference: 'ACME-KEN-OCT-2001' }]);

    await createTrip({ ...baseInput(), startDate: '2026-10-27' });

    // INSERT … VALUES (row 0, highest + 1) ON CONFLICT … GREATEST(lastNumber, highest) + 1
    expect($queryRaw.mock.calls[1]!.slice(1)).toEqual([0, 2661, 2660]);
  });
});

describe('event travellers', () => {
  // Lead Person (traveller 11) is on the trip through link 100.
  const dinner = {
    id: 5,
    tripId: 7,
    dayId: null,
    position: 0,
    itemType: 'activity',
    category: 'activity',
    description: 'Dinner',
    quantity: 1,
    scheduledAt: null,
    reminderMinutesBefore: null,
    driverId: null,
    officerId: null,
    vehicleId: null,
  };
  const onTrip = {
    ...tripRecord,
    travelers: [{ id: 100, isPrimary: true, traveler: { id: 11, name: 'Lead Person' } }],
    items: [dinner],
  };

  beforeEach(() => {
    for (const delegate of Object.values(tx)) {
      for (const fn of Object.values(delegate)) fn.mockReset();
    }
    tx.trip.findUnique.mockResolvedValue(onTrip);
    tx.tripItineraryItem.createManyAndReturn.mockResolvedValue([{ id: 900, position: 1 }]);
  });

  it('puts a trip traveller, another of the client’s and a new name on a new event', async () => {
    tx.traveler.count.mockResolvedValue(1);
    tx.traveler.create.mockResolvedValue({ id: 50 });
    tx.tripTraveler.create.mockResolvedValueOnce({ id: 201 }).mockResolvedValueOnce({ id: 202 });

    const result = await addTripItems({
      tripId: 7,
      userId: 1,
      isAdmin: false,
      items: [
        {
          description: 'Site visit',
          quantity: 1,
          travelers: [{ travelerId: 11 }, { travelerId: 12 }, { name: 'New Guest' }],
        },
      ],
    });

    expect(result).not.toHaveProperty('error');
    // Only the one not on the trip yet has to be the client's.
    expect(tx.traveler.count).toHaveBeenCalledWith({ where: { id: { in: [12] }, customerId: 3 } });
    expect(tx.tripTraveler.create.mock.calls.map(([args]) => args.data)).toEqual([
      { tripId: 7, travelerId: 12, isPrimary: false },
      { tripId: 7, travelerId: 50, isPrimary: false },
    ]);
    expect(tx.tripItemTraveler.createMany).toHaveBeenCalledWith({
      data: [
        { itemId: 900, tripTravelerId: 100 },
        { itemId: 900, tripTravelerId: 201 },
        { itemId: 900, tripTravelerId: 202 },
      ],
    });
  });

  it('adds an event for the whole party without touching the travellers', async () => {
    await addTripItems({ tripId: 7, userId: 1, isAdmin: false, items: [{ description: 'Briefing', quantity: 1 }] });

    expect(tx.tripItineraryItem.createManyAndReturn).toHaveBeenCalled();
    expect(tx.tripTraveler.create).not.toHaveBeenCalled();
    expect(tx.tripItemTraveler.createMany).not.toHaveBeenCalled();
  });

  it("turns away another client's traveller", async () => {
    tx.traveler.count.mockResolvedValue(0);

    const result = await addTripItems({
      tripId: 7,
      userId: 1,
      isAdmin: false,
      items: [{ description: 'Site visit', quantity: 1, travelers: [{ travelerId: 99 }] }],
    });

    expect(result).toEqual({ error: "Every traveller must belong to the trip's client", status: 400 });
    expect(tx.tripItemTraveler.createMany).not.toHaveBeenCalled();
  });

  it('replaces an edited event’s travellers, and leaves them be when not sent', async () => {
    await updateTripItem({ tripId: 7, itemId: 5, userId: 1, isAdmin: false, input: { travelers: [{ travelerId: 11 }] } });

    expect(tx.tripItemTraveler.deleteMany).toHaveBeenCalledWith({ where: { itemId: 5 } });
    expect(tx.tripItemTraveler.createMany).toHaveBeenCalledWith({ data: [{ itemId: 5, tripTravelerId: 100 }] });
    expect(tx.traveler.count).not.toHaveBeenCalled();

    tx.tripItemTraveler.deleteMany.mockClear();
    await updateTripItem({ tripId: 7, itemId: 5, userId: 1, isAdmin: false, input: { completed: true } });
    expect(tx.tripItemTraveler.deleteMany).not.toHaveBeenCalled();
  });
});

describe('editing who is on a trip', () => {
  // Lead Person (11) leads through link 100; Second Guest (12) is on it through link 101.
  const twoAboard = {
    ...tripRecord,
    travelers: [
      { id: 100, isPrimary: true, traveler: { id: 11, name: 'Lead Person' } },
      { id: 101, isPrimary: false, traveler: { id: 12, name: 'Second Guest' } },
    ],
  };
  const edit = (input: Parameters<typeof updateTrip>[0]['input']) =>
    updateTrip({ id: 7, userId: 1, isAdmin: false, input });

  beforeEach(() => {
    for (const delegate of Object.values(tx)) {
      for (const fn of Object.values(delegate)) fn.mockReset();
    }
    tx.trip.findUnique.mockResolvedValue(twoAboard);
  });

  it('adds, removes and changes the lead in one go', async () => {
    tx.traveler.count.mockResolvedValue(1);
    tx.traveler.create.mockResolvedValue({ id: 50 });

    const result = await edit({ travelers: [{ travelerId: 13 }, { travelerId: 11 }, { name: 'New Guest' }] });

    expect(result).not.toHaveProperty('error');
    // Only the newcomer has to be the client's.
    expect(tx.traveler.count).toHaveBeenCalledWith({ where: { id: { in: [13] }, customerId: 3 } });
    // Taking Second Guest off the trip; their events go with the link.
    expect(tx.tripTraveler.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [101] } } });
    expect(tx.tripTraveler.create.mock.calls.map(([args]) => args.data)).toEqual([
      { tripId: 7, travelerId: 13, isPrimary: true },
      { tripId: 7, travelerId: 50, isPrimary: false },
    ]);
    expect(tx.tripTraveler.update).toHaveBeenCalledWith({ where: { id: 100 }, data: { isPrimary: false } });
  });

  it("checks newcomers against the client it's moving to", async () => {
    tx.traveler.count.mockResolvedValue(1);

    await edit({ customerId: 4, travelers: [{ travelerId: 20 }] });

    expect(tx.trip.update.mock.calls[0]![0].data.customerId).toBe(4);
    expect(tx.traveler.count).toHaveBeenCalledWith({ where: { id: { in: [20] }, customerId: 4 } });
    expect(tx.tripTraveler.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [100, 101] } } });
  });

  it("turns away another client's traveller", async () => {
    tx.traveler.count.mockResolvedValue(0);

    const result = await edit({ travelers: [{ travelerId: 11 }, { travelerId: 99 }] });

    expect(result).toEqual({ error: "Every traveller must belong to the trip's client", status: 400 });
    expect(tx.tripTraveler.deleteMany).not.toHaveBeenCalled();
  });

  it('leaves the travellers alone when the edit is only details', async () => {
    await edit({ title: 'Renamed', startDate: '' });

    expect(tx.trip.update.mock.calls[0]![0].data).toMatchObject({ title: 'Renamed', startDate: null });
    expect(tx.traveler.count).not.toHaveBeenCalled();
    expect(tx.tripTraveler.deleteMany).not.toHaveBeenCalled();
    expect(tx.tripTraveler.create).not.toHaveBeenCalled();
  });
});
