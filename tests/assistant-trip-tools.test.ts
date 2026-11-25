import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const lib = vi.hoisted(() => ({
  getTripForUser: vi.fn(),
  searchTrips: vi.fn(),
  createTrip: vi.fn(),
  updateTrip: vi.fn(),
  deleteTrip: vi.fn(),
  addTripItems: vi.fn(),
  updateTripItem: vi.fn(),
  deleteTripItem: vi.fn(),
  createTripDay: vi.fn(),
  updateTripDay: vi.fn(),
  deleteTripDay: vi.fn(),
  recordAuditEvent: vi.fn(),
  canSeeTripCosts: vi.fn(),
  listCrewOptions: vi.fn(),
}));

vi.mock('../lib/trips', () => ({
  ...lib,
  TRIP_STATUSES: ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'],
  TRIP_SORTS: ['updated', 'start-asc', 'start-desc'],
}));
vi.mock('../lib/audit', () => ({ recordAuditEvent: lib.recordAuditEvent }));
vi.mock('../lib/trip-crew', () => ({ listCrewOptions: lib.listCrewOptions }));
vi.mock('../lib/trip-costs', () => ({
  canSeeTripCosts: lib.canSeeTripCosts,
  tripForViewer: (trip: unknown) => trip,
}));

import { executeTool } from '../lib/assistant/execute';
import { tripTools } from '../lib/assistant/tools/trips';
import type { ToolContext } from '../lib/assistant/types';

const ctx = {
  userId: 7,
  userName: 'Amina',
  isAdmin: false,
  user: { id: 7, name: 'Amina', roles: [], modules: [] },
  timeZone: 'Africa/Nairobi',
  request: {},
} as unknown as ToolContext;

const tool = (name: string) => tripTools.find((t) => t.functionDeclaration.name === name)!;
const run = (name: string, args: Record<string, unknown>) => executeTool(tool(name), args, ctx);
const errorOf = (action: { result: unknown }) => (action.result as { error?: string }).error ?? '';

const pickup = {
  id: 501,
  dayId: 11,
  position: 0,
  itemType: 'car',
  category: 'transportation',
  body: null,
  timeLabel: 'PICK-UP',
  providerName: null,
  bookingUrl: null,
  phone: null,
  placeName: null,
  address: null,
  details: { pickupLocation: 'OR Tambo', dropoffLocation: 'Sandton' },
  description: 'Airport pickup',
  subtitle: null,
  quantity: 1,
  unitPrice: null,
  completedAt: null,
  sourceQuoteItemId: null,
  scheduledAt: '2026-11-25T06:00:00.000Z',
  endsAt: null,
  durationMinutes: null,
  reminderMinutesBefore: null,
  reminderAt: null,
  imageUrl: null,
  confirmationCode: null,
  attachments: [],
  driver: null,
  officer: null,
  vehicle: null,
  travelers: [],
  resourceIds: [],
};

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: 1589,
    reference: 'BRG-ZAF-NOV-2668',
    trackingCode: 'LA-2026-1074',
    title: 'TASK-4471',
    description: 'VIP arrival. **Armoured** vehicle requested.',
    status: 'Active',
    country: 'South Africa',
    currency: 'USD',
    startDate: '2026-11-24T00:00:00.000Z',
    endDate: '2026-11-26T00:00:00.000Z',
    notes: null,
    customer: { id: 3, name: 'Bridge Corp', company: null, email: null },
    travelers: [{ id: 40, name: 'J. Doe', isPrimary: true }],
    createdBy: { id: 7, name: 'Amina', email: 'a@x' },
    owner: { id: 7, name: 'Amina', email: 'a@x' },
    sourceQuote: null,
    itemCount: 1,
    assignmentCount: 0,
    logCount: 0,
    items: [pickup],
    days: [
      { id: 10, dateKey: '2026-11-24', dayNumber: 1, title: null, summary: null },
      { id: 11, dateKey: '2026-11-25', dayNumber: 2, title: null, summary: null },
    ],
    resources: [],
    dayLogs: [],
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(lib)) fn.mockReset();
  lib.getTripForUser.mockResolvedValue(trip());
  lib.canSeeTripCosts.mockReturnValue(false);
  lib.recordAuditEvent.mockResolvedValue(undefined);
});

describe('the reported bug: a pickup asked for on a trip', () => {
  it('goes onto the itinerary as an event, on that date and at that local time', async () => {
    const added = { ...pickup, id: 777, description: 'Airport pickup · OR Tambo to Sandton' };
    lib.addTripItems.mockResolvedValue(trip({ items: [pickup, added] }));

    const action = await run('save_trip_event', {
      tripId: 1589,
      category: 'transportation',
      title: 'Airport pickup · OR Tambo to Sandton',
      timeLabel: 'PICK-UP',
      date: '2026-11-25',
      time: '09:00',
      details: { pickupLocation: 'OR Tambo', dropoffLocation: 'Sandton' },
      driverId: 14,
    });

    expect(action.ok).toBe(true);
    expect(lib.updateTrip).not.toHaveBeenCalled();
    const sent = lib.addTripItems.mock.calls[0][0];
    expect(sent).toMatchObject({ tripId: 1589, userId: 7, isAdmin: false });
    expect(sent.items[0]).toMatchObject({
      category: 'transportation',
      itemType: 'car',
      description: 'Airport pickup · OR Tambo to Sandton',
      timeLabel: 'PICK-UP',
      dayId: 11,
      // 09:00 in Nairobi.
      scheduledAt: '2026-11-25T06:00:00.000Z',
      details: { pickupLocation: 'OR Tambo', dropoffLocation: 'Sandton' },
      driverId: 14,
      quantity: 1,
    });
    expect(action.result).toMatchObject({ reference: 'BRG-ZAF-NOV-2668', added: { eventId: 777, when: '2026-11-25 09:00' } });
    expect(action.summary).toBe('Added "Airport pickup · OR Tambo to Sandton" to BRG-ZAF-NOV-2668 on 2026-11-25 09:00');
    expect(action.href).toBe('/modules/trip-planning/1589');
    expect(lib.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'trip.itinerary.item.added', metadata: expect.objectContaining({ via: 'assistant' }) }),
    );
  });

  it('adds the day in date order when the itinerary has none for that date', async () => {
    lib.createTripDay.mockResolvedValue(
      trip({ days: [...trip().days, { id: 12, dateKey: '2026-11-27', dayNumber: 3, title: null, summary: null }] }),
    );
    lib.addTripItems.mockResolvedValue(trip({ items: [pickup, { ...pickup, id: 778, dayId: 12 }] }));

    const action = await run('save_trip_event', { tripId: 1589, category: 'activity', title: 'Debrief', date: '2026-11-27', time: '10:30' });

    expect(lib.createTripDay).toHaveBeenCalledWith(expect.objectContaining({ tripId: 1589, dateKey: '2026-11-27', afterDayId: 11 }));
    expect(lib.addTripItems.mock.calls[0][0].items[0]).toMatchObject({ dayId: 12, scheduledAt: '2026-11-27T07:30:00.000Z' });
    expect(action.result).toMatchObject({ dayAdded: '2026-11-27', note: expect.stringContaining('outside the trip\'s dates') });
  });

  it("reads a flight's time at its airport, not where the user is", async () => {
    lib.addTripItems.mockImplementation(async ({ items }: { items: Array<Record<string, unknown>> }) =>
      trip({ items: [pickup, { ...pickup, id: 779, category: 'flight', ...items[0], description: items[0].description }] }),
    );
    await run('save_trip_event', {
      tripId: 1589,
      category: 'flight',
      title: 'JNB to NBO',
      timeLabel: 'DEPARTURE',
      date: '2026-11-25',
      time: '09:00',
      details: { flightNumber: 'KQ 761', departAirport: 'JNB', arriveAirport: 'NBO' },
    });
    // 09:00 in Johannesburg (UTC+2), and the zone is kept with the event.
    expect(lib.addTripItems.mock.calls[0][0].items[0]).toMatchObject({
      scheduledAt: '2026-11-25T07:00:00.000Z',
      details: expect.objectContaining({ timezone: 'Africa/Johannesburg', flightNumber: 'KQ 761' }),
    });
  });

  it("refuses a detail that belongs to another kind of event, and saves nothing", async () => {
    const action = await run('save_trip_event', { tripId: 1589, category: 'transportation', title: 'Transfer', details: { gate: 'B4' } });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('"gate" is not a field of a transportation event');
    expect(lib.addTripItems).not.toHaveBeenCalled();
  });

  it.each([
    [{ date: '25 Nov 2026' }, 'date must be a real date written YYYY-MM-DD'],
    [{ date: '2026-02-30' }, 'date must be a real date'],
    [{ date: '2026-11-25', time: '9am' }, 'time must be a 24-hour time written HH:MM'],
    [{ time: '09:00' }, 'A time needs a date'],
    [{ cost: 120 }, 'cannot see or set costs'],
  ])('refuses %j', async (extra, message) => {
    const action = await run('save_trip_event', { tripId: 1589, category: 'activity', title: 'X', ...extra });
    expect(errorOf(action)).toContain(message);
    expect(lib.addTripItems).not.toHaveBeenCalled();
  });

  it('says so when the trip is not there or not theirs', async () => {
    lib.getTripForUser.mockResolvedValue(null);
    const action = await run('save_trip_event', { tripId: 9, category: 'activity', title: 'X' });
    expect(errorOf(action)).toContain('Trip 9 was not found');
  });
});

describe('changing an event', () => {
  it('assigns crew and reports exactly what changed', async () => {
    const crewed = { ...pickup, driver: { id: 14, name: 'John Mokoena', phone: null } };
    lib.updateTripItem.mockResolvedValue(trip({ items: [crewed] }));

    const action = await run('save_trip_event', { tripId: 1589, eventId: 501, driverId: 14 });

    expect(lib.updateTripItem).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 1589, itemId: 501, userId: 7, input: { driverId: 14 } }),
    );
    expect(action.result).toMatchObject({
      changed: { driver: { from: null, to: 'John Mokoena' } },
      crewMissing: 'No vehicle or CPO assigned',
    });
    expect(action.summary).toBe('Updated "Airport pickup" on BRG-ZAF-NOV-2668: driver');
  });

  it('moves the time and keeps the date it was on', async () => {
    lib.updateTripItem.mockResolvedValue(trip({ items: [{ ...pickup, scheduledAt: '2026-11-25T07:30:00.000Z' }] }));
    const action = await run('save_trip_event', { tripId: 1589, eventId: 501, time: '10:30' });
    expect(lib.updateTripItem.mock.calls[0][0].input).toEqual({ scheduledAt: '2026-11-25T07:30:00.000Z' });
    expect(action.result).toMatchObject({ changed: { when: { from: '2026-11-25 09:00', to: '2026-11-25 10:30' } } });
  });

  it('changes one detail and leaves the others as they were', async () => {
    lib.updateTripItem.mockResolvedValue(
      trip({ items: [{ ...pickup, details: { pickupLocation: 'OR Tambo', dropoffLocation: 'Rosebank' } }] }),
    );
    await run('save_trip_event', { tripId: 1589, eventId: 501, details: { dropoffLocation: 'Rosebank' } });
    expect(lib.updateTripItem.mock.calls[0][0].input).toEqual({
      details: { pickupLocation: 'OR Tambo', dropoffLocation: 'Rosebank' },
    });
  });

  it('takes someone off with null, and marks an event done', async () => {
    lib.getTripForUser.mockResolvedValue(trip({ items: [{ ...pickup, driver: { id: 14, name: 'John', phone: null } }] }));
    lib.updateTripItem.mockResolvedValue(trip({ items: [{ ...pickup, completedAt: '2026-11-25T08:00:00.000Z' }] }));
    const action = await run('save_trip_event', { tripId: 1589, eventId: 501, driverId: null, done: true });
    expect(lib.updateTripItem.mock.calls[0][0].input).toEqual({ driverId: null, completed: true });
    expect(action.result).toMatchObject({ changed: { driver: { from: 'John', to: null }, done: { from: false, to: true } } });
    expect(lib.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'trip.itinerary.item.completed' }));
  });

  it('refuses when the change leaves the event exactly as it was', async () => {
    lib.updateTripItem.mockResolvedValue(trip());
    const action = await run('save_trip_event', { tripId: 1589, eventId: 501, title: 'Airport pickup' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('Nothing to change');
    expect(lib.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses an event that is not on the trip, and relays the page\'s own refusals', async () => {
    expect(errorOf(await run('save_trip_event', { tripId: 1589, eventId: 1, title: 'X' }))).toContain('Event 1 is not on trip BRG-ZAF-NOV-2668');
    lib.updateTripItem.mockResolvedValue({ error: 'John Mokoena is already assigned to another movement at that time', status: 400 });
    const clash = await run('save_trip_event', { tripId: 1589, eventId: 501, driverId: 14 });
    expect(errorOf(clash)).toBe('John Mokoena is already assigned to another movement at that time');
  });
});

describe("the trip's own details", () => {
  it('will not take new description text without being told to add or replace', async () => {
    const action = await run('update_trip', { tripId: 1589, description: 'Airport pickup tomorrow at 09:00.' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toMatch(/descriptionMode "append" adds it under the existing text, "replace" discards what is there \(44 characters now\)/);
    expect(lib.updateTrip).not.toHaveBeenCalled();
  });

  it('appends under what is already there', async () => {
    const text = 'VIP arrival. **Armoured** vehicle requested.\n\nClient confirmed two bags.';
    lib.updateTrip.mockResolvedValue(trip({ description: text }));
    const action = await run('update_trip', { tripId: 1589, description: 'Client confirmed two bags.', descriptionMode: 'append' });
    expect(lib.updateTrip.mock.calls[0][0].input).toEqual({ description: text });
    expect(action.ok).toBe(true);
  });

  it('changes currency and notes together, and says which fields moved', async () => {
    lib.updateTrip.mockResolvedValue(trip({ currency: 'ZAR', notes: 'Client wants an armoured vehicle.' }));
    const action = await run('update_trip', {
      tripId: 1589,
      currency: 'zar',
      notes: 'Client wants an armoured vehicle.',
      notesMode: 'append',
    });
    expect(lib.updateTrip.mock.calls[0][0].input).toEqual({ currency: 'ZAR', notes: 'Client wants an armoured vehicle.' });
    expect(action.result).toMatchObject({
      changed: { currency: { from: 'USD', to: 'ZAR' }, notes: { from: null, to: 'Client wants an armoured vehicle.' } },
    });
    expect(lib.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'trip.updated' }));
  });

  it('logs a status change the way the trip page does', async () => {
    lib.updateTrip.mockResolvedValue(trip({ status: 'Completed' }));
    await run('update_trip', { tripId: 1589, status: 'Completed' });
    const actions = lib.recordAuditEvent.mock.calls.map(([event]) => event.action);
    expect(actions).toEqual(['trip.status.changed']);
    expect(lib.recordAuditEvent.mock.calls[0][0].metadata).toMatchObject({ from: 'Active', to: 'Completed', via: 'assistant' });
  });

  it.each([
    [{ status: 'completed' }, 'status must be one of'],
    [{ title: '  ' }, 'title cannot be blank'],
    [{ startDate: '24 Nov 2026' }, 'startDate must be a real date'],
    [{ currency: 'Kenyan shillings' }, 'three-letter currency code'],
    [{ endDate: '2026-11-01' }, 'would be before the start date'],
    [{ itinerary: 'add a pickup' }, 'itinerary is not something this tool can set'],
    [{}, 'Say what to change'],
  ])('refuses %j and changes nothing', async (extra, message) => {
    const action = await run('update_trip', { tripId: 1589, ...extra });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(message);
    expect(lib.updateTrip).not.toHaveBeenCalled();
  });

  it('refuses when nothing ends up different', async () => {
    lib.updateTrip.mockResolvedValue(trip());
    const action = await run('update_trip', { tripId: 1589, status: 'Active' });
    expect(errorOf(action)).toContain('Nothing to change: trip BRG-ZAF-NOV-2668 already has those values');
  });

  it('a failed audit entry does not turn a saved change into a failure', async () => {
    lib.updateTrip.mockResolvedValue(trip({ currency: 'ZAR' }));
    lib.recordAuditEvent.mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = await run('update_trip', { tripId: 1589, currency: 'ZAR' });
    quiet.mockRestore();
    expect(action.ok).toBe(true);
  });
});

describe('reading and removing', () => {
  it('opens a trip with every event, its ids and local times', async () => {
    const action = await run('get_trip', { tripId: 1589 });
    expect(action.kind).toBe('read');
    expect(action.result).toMatchObject({
      reference: 'BRG-ZAF-NOV-2668',
      taskNumber: 'TASK-4471',
      days: [
        { dayId: 10, day: 1, date: '2026-11-24', events: 0 },
        { dayId: 11, day: 2, date: '2026-11-25', events: 1 },
      ],
      events: [
        {
          eventId: 501,
          dayId: 11,
          category: 'transportation',
          title: 'Airport pickup',
          when: '2026-11-25 09:00',
          crewMissing: 'No driver, vehicle or CPO assigned',
        },
      ],
      travellers: [{ travelerId: 40, name: 'J. Doe', lead: true }],
      href: '/modules/trip-planning/1589',
    });
  });

  it("finds crew by name from the trip page's own registers, with who is already on the trip", async () => {
    const person = (id: number, label: string, extra = {}) => ({ id, label, hint: null, status: 'Available', onTrip: false, busyOn: null, vendorId: null, ...extra });
    lib.listCrewOptions.mockResolvedValue({
      drivers: [person(4, 'Eric Mochama Momanyi', { hint: '+254 700 000000', busyOn: 'MCF-KEN-NOV-2667' }), person(14, 'John Mokoena', { onTrip: true })],
      officers: [person(9, 'Eric Otieno', { hint: 'CPO · Falcon 2' })],
      vehicles: [person(55, 'KDA 111A', { hint: 'Toyota Prado', onTrip: true })],
    });

    const named = await run('find_trip_crew', { tripId: 1589, q: 'eric' });
    expect(lib.listCrewOptions).toHaveBeenCalledWith(1589);
    expect(named.result).toMatchObject({
      drivers: [{ driverId: 4, name: 'Eric Mochama Momanyi', busyOn: 'MCF-KEN-NOV-2667' }],
      officers: [{ officerId: 9, name: 'Eric Otieno' }],
      vehicles: [],
    });

    // With nothing to search for: who is allocated to this trip.
    const allocated = await run('find_trip_crew', { tripId: 1589 });
    expect(allocated.result).toMatchObject({
      drivers: [{ driverId: 14, allocatedToThisTrip: true }],
      officers: [],
      vehicles: [{ vehicleId: 55, name: 'KDA 111A' }],
    });

    const none = await run('find_trip_crew', { tripId: 1589, q: 'zzz' });
    expect(none.result).toMatchObject({ note: expect.stringContaining('matches "zzz"') });
  });

  it('searches trips by what the user typed', async () => {
    lib.searchTrips.mockResolvedValue({ trips: [trip()], total: 41, page: 1, pageSize: 20 });
    const action = await run('find_trips', { q: 'BRG-ZAF', status: 'Active' });
    expect(lib.searchTrips).toHaveBeenCalledWith(expect.objectContaining({ q: 'BRG-ZAF', status: 'Active', userId: 7, pageSize: 20 }));
    expect(action.result).toMatchObject({ total: 41, more: true, trips: [{ id: 1589, reference: 'BRG-ZAF-NOV-2668', start: '2026-11-24' }] });
  });

  it('removing an event or a day waits for Confirm, and says what will go', () => {
    expect(tool('delete_trip_event').destructive).toBe(true);
    expect(tool('delete_trip_event').confirmLabel!({ tripId: 1589, eventId: 501, title: 'Airport pickup', reference: 'BRG-ZAF-NOV-2668' })).toBe(
      'Delete the event "Airport pickup" from trip BRG-ZAF-NOV-2668',
    );
    expect(tool('delete_trip_day').confirmLabel!({ tripId: 1589, dayId: 11, events: 'delete' })).toContain('its events are deleted too');
    expect(tool('delete_trip').destructive).toBe(true);
  });

  it('has no tool left that can only change the header while claiming to update a trip', () => {
    const names = tripTools.map((t) => t.functionDeclaration.name);
    expect(names).toEqual(expect.arrayContaining(['get_trip', 'save_trip_event', 'delete_trip_event', 'add_trip_day']));
    expect(tool('update_trip').functionDeclaration.description).toContain('NOT for the itinerary');
  });
});
