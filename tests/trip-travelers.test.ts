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
    tripDay: { createMany: vi.fn() },
  };
  // The running reference number is reserved with raw SQL.
  const $queryRaw = vi.fn();
  return { tx, $queryRaw, transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn({ ...tx, $queryRaw } as typeof tx)) };
});

const { syncCrewGapNotifications } = vi.hoisted(() => ({ syncCrewGapNotifications: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../lib/trip-notifications', () => ({ syncCrewGapNotifications }));
vi.mock('../lib/prisma', () => {
  // Every driver, CPO and vehicle picked is on the Task Assignment register.
  const registered = { count: async (args: { where: { id: { in: number[] } } }) => args.where.id.in.length };
  return {
    // Outside a transaction the trip is read through the same mock.
    prisma: {
      $transaction: transaction,
      trip: { findUnique: (...args: unknown[]) => tx.trip.findUnique(...args) },
      driver: registered,
      officer: registered,
      vehicle: registered,
    },
  };
});

import {
  TripTravelerError,
  addTripItems,
  createTrip,
  tripDatesWithoutDay,
  tripDayKeys,
  updateTrip,
  updateTripItem,
} from '../lib/trips';

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

describe('createTrip itinerary days', () => {
  beforeEach(() => {
    for (const delegate of Object.values(tx)) {
      for (const fn of Object.values(delegate)) fn.mockReset();
    }
    numbersFrom(2660, 2661);
    tx.trackingSequence.upsert.mockResolvedValue({ year: 2026, lastNumber: 1 });
    tx.trip.create.mockResolvedValue(tripRecord);
    tx.trip.findUnique.mockResolvedValue(tripRecord);
  });

  it('opens the itinerary with one day per date from the start to the end', async () => {
    await createTrip({ ...baseInput(), clientCode: 'ACME', startDate: '2026-11-29', endDate: '2026-12-02' });

    expect(tx.tripDay.createMany).toHaveBeenCalledWith({
      data: [
        { tripId: 7, dateKey: '2026-11-29', dayNumber: 1 },
        { tripId: 7, dateKey: '2026-11-30', dayNumber: 2 },
        { tripId: 7, dateKey: '2026-12-01', dayNumber: 3 },
        { tripId: 7, dateKey: '2026-12-02', dayNumber: 4 },
      ],
    });
  });

  it('adds no days while the dates are still TBD', async () => {
    await createTrip({ ...baseInput(), clientCode: 'ACME', startDate: '2026-11-29', endDate: null });

    expect(tx.tripDay.createMany).not.toHaveBeenCalled();
  });

  it('lists the dates of a trip in UTC, like the trip dates themselves, and never past the cap', () => {
    expect(tripDayKeys('2026-11-03', '2026-11-03')).toEqual(['2026-11-03']);
    expect(tripDayKeys(new Date('2026-02-27T00:00:00.000Z'), new Date('2026-03-01T00:00:00.000Z'))).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
    expect(tripDayKeys('2026-11-05', '2026-11-03')).toEqual([]);
    expect(tripDayKeys(null, '2026-11-03')).toEqual([]);
    expect(tripDayKeys('not a date', '2026-11-03')).toEqual([]);
    expect(tripDayKeys('2026-01-01', '2026-12-31')).toHaveLength(60);
  });
});

describe('trip dates after a day is deleted', () => {
  const trip = { startDate: new Date('2026-11-10T00:00:00.000Z'), endDate: new Date('2026-11-13T00:00:00.000Z') };
  const day = (dateKey: string | null) => ({ dateKey });

  it('pulls the start in when the first day goes', () => {
    expect(tripDatesWithoutDay(trip, day('2026-11-10'), [day('2026-11-11'), day('2026-11-12'), day('2026-11-13')])).toEqual({
      startDate: new Date('2026-11-11T00:00:00.000Z'),
    });
  });

  it('pulls the end in when the last day goes, even past a gap', () => {
    expect(tripDatesWithoutDay(trip, day('2026-11-13'), [day('2026-11-10'), day('2026-11-11')])).toEqual({
      endDate: new Date('2026-11-11T00:00:00.000Z'),
    });
  });

  it('changes nothing for a middle day, an undated day, or the only dated day left', () => {
    expect(tripDatesWithoutDay(trip, day('2026-11-11'), [day('2026-11-10'), day('2026-11-13')])).toBeNull();
    expect(tripDatesWithoutDay(trip, day(null), [day('2026-11-11')])).toBeNull();
    expect(tripDatesWithoutDay(trip, day('2026-11-10'), [])).toBeNull();
    expect(tripDatesWithoutDay(trip, day('2026-11-10'), [day(null)])).toBeNull();
  });

  it('keeps the start when another day still has that date', () => {
    expect(tripDatesWithoutDay(trip, day('2026-11-10'), [day('2026-11-10'), day('2026-11-13')])).toBeNull();
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

  it('saves a movement without its crew and tells the desk what is missing', async () => {
    syncCrewGapNotifications.mockClear();
    const result = await addTripItems({
      tripId: 7,
      userId: 1,
      isAdmin: false,
      items: [{ description: 'Airport pick-up', quantity: 1, category: 'transportation', driverId: 1 }],
    });

    expect(result).not.toHaveProperty('error');
    expect(syncCrewGapNotifications).toHaveBeenCalledWith({
      trip: onTrip,
      item: { id: 900, description: 'Airport pick-up' },
      gaps: ['vehicle', 'CPO'],
    });

    syncCrewGapNotifications.mockClear();
    await addTripItems({ tripId: 7, userId: 1, isAdmin: false, items: [{ description: 'Dinner', quantity: 1, category: 'activity' }] });
    expect(syncCrewGapNotifications).not.toHaveBeenCalled();
  });

  it('follows the crew through an edit, withdrawing the note once it is complete', async () => {
    const pickup = { ...dinner, id: 6, category: 'transportation', description: 'Airport pick-up', driverId: 1, details: null };
    tx.trip.findUnique.mockResolvedValue({ ...onTrip, items: [dinner, pickup] });
    syncCrewGapNotifications.mockClear();

    await updateTripItem({ tripId: 7, itemId: 6, userId: 1, isAdmin: false, input: { vehicleId: 30, officerId: 7 } });

    expect(syncCrewGapNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ item: { id: 6, description: 'Airport pick-up' }, gaps: [], before: ['vehicle', 'CPO'] }),
    );
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
