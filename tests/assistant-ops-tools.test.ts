import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { lib, db, ResourceConflictError } = vi.hoisted(() => {
  class ResourceConflictError extends Error {}
  const fn = () => vi.fn();
  return {
    ResourceConflictError,
    lib: {
      recordAuditEvent: fn(),
      // task-assignment
      listVehicles: fn(), listDrivers: fn(), listOfficers: fn(), listCurrentAssignments: fn(), searchAssignments: fn(),
      createVehicle: fn(), updateVehicle: fn(), deleteVehicle: fn(),
      createDriver: fn(), updateDriver: fn(), deleteDriver: fn(),
      createOfficer: fn(), updateOfficer: fn(), deleteOfficer: fn(),
      createAssignment: fn(), updateAssignment: fn(), deleteAssignment: fn(),
      // calendar
      listEvents: fn(), createEvent: fn(), updateEvent: fn(), deleteEvent: fn(),
      // workspace
      listNotes: fn(), createNote: fn(), updateNote: fn(), deleteNote: fn(),
      listContacts: fn(), createContact: fn(), updateContact: fn(), deleteContact: fn(),
      listContracts: fn(), createContract: fn(), updateContract: fn(),
      listUpcomingDueDates: fn(),
      listFiles: fn(),
      listHandovers: fn(), getHandover: fn(), createHandover: fn(), acknowledgeHandover: fn(),
      notifyIncomingShift: fn(), settleHandoverNotifications: fn(),
      listPersonnel: fn(), getPersonnelById: fn(),
      // feedback
      listFeedback: fn(), getFeedbackStats: fn(), listComments: fn(), createFeedback: fn(), addComment: fn(), updateFeedbackStatus: fn(),
    },
    db: {
      vehicle: { findUnique: fn() },
      driver: { findUnique: fn() },
      officer: { findUnique: fn() },
      tripAssignment: { findUnique: fn() },
      trip: { findUnique: fn() },
      calendarEvent: { findFirst: fn() },
      personalTodo: { findFirst: fn(), findMany: fn(), count: fn(), create: fn(), updateMany: fn() },
      personalTodoBoard: { findUnique: fn() },
      contact: { findFirst: fn() },
      customer: { findUnique: fn() },
    },
  };
});

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/audit', () => ({ recordAuditEvent: lib.recordAuditEvent }));
vi.mock('../lib/user-groups', () => ({
  todoVisibleTo: (userId: number) => ({ OR: [{ userId }, { shares: { some: { userId } } }] }),
}));
vi.mock('../lib/task-assignment', () => ({
  ...lib,
  ResourceConflictError,
  VEHICLE_TYPES: ['Sedan', 'SUV', 'Van', 'Truck', 'Armoured', 'Motorcycle'],
  VEHICLE_OWNERSHIPS: ['Internal', 'External'],
  RESOURCE_STATUSES: ['Available', 'Assigned', 'Maintenance', 'Off duty'],
  OFFICER_GRADES: ['CPO', 'Team Leader', 'Detail Leader', 'Driver/CPO'],
  ASSIGNMENT_STATUSES: ['Planned', 'Confirmed', 'Active', 'Completed', 'Cancelled'],
}));
vi.mock('../lib/calendar', () => ({ ...lib }));
vi.mock('../lib/notes', () => ({
  ...lib,
  NOTE_CATEGORIES: ['Personal', 'Work', 'Ideas'],
  NOTE_COLORS: ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'],
}));
vi.mock('../lib/contacts', () => ({
  ...lib,
  CONTACT_CATEGORIES: ['Internal', 'Client', 'Vendor', 'Partner'],
  contactVisibleTo: (userId: number) => ({ OR: [{ source: { not: 'google' } }, { createdById: userId }] }),
}));
vi.mock('../lib/contracts', () => ({
  ...lib,
  CONTRACT_TYPES: ['Fixed Term', 'Retainer', 'Project Based'],
  CONTRACT_LIFECYCLE: ['Active', 'In Renewal', 'Renewed', 'Cancelled'],
  CONTRACT_DISPLAY_STATUSES: ['Active', 'Expiring Soon', 'In Renewal', 'Renewed', 'Expired', 'Cancelled'],
  computeStats: (items: unknown[]) => ({ total: items.length }),
}));
vi.mock('../lib/due-dates', () => ({ ...lib }));
vi.mock('../lib/files', () => ({ ...lib }));
vi.mock('../lib/handover', () => ({
  ...lib,
  SHIFT_PERIODS: ['Day', 'Night', 'Morning', 'Afternoon', 'Evening'],
  HANDOVER_STATUSES: ['Normal', 'Attention', 'Urgent'],
}));
vi.mock('../lib/handover-notifications', () => ({ ...lib }));
vi.mock('../lib/personnel', () => ({ ...lib, PERSONNEL_STATUSES: ['Active', 'On Leave', 'Remote', 'Terminated'] }));
vi.mock('../lib/feedback', () => ({
  ...lib,
  FEEDBACK_CATEGORIES: ['Bug Report', 'Feature Idea', 'Improvement', 'Technical Support'],
  FEEDBACK_STATUSES: ['New', 'Under Review', 'Planned', 'Implemented', 'Declined'],
}));

import { executeTool } from '../lib/assistant/execute';
import { calendarTools } from '../lib/assistant/tools/calendar';
import { feedbackTools } from '../lib/assistant/tools/feedback';
import { fleetTools } from '../lib/assistant/tools/fleet';
import { todoTools } from '../lib/assistant/tools/todos';
import {
  contactTools,
  contractTools,
  dueDateTools,
  fileTools,
  handoverTools,
  noteTools,
  personnelTools,
} from '../lib/assistant/tools/workspace';
import type { ToolContext } from '../lib/assistant/types';

const TOOLS = [
  ...fleetTools, ...calendarTools, ...todoTools, ...noteTools, ...contactTools, ...fileTools,
  ...dueDateTools, ...personnelTools, ...contractTools, ...handoverTools, ...feedbackTools,
];

const person = (modules: string[], isAdmin = false) =>
  ({
    userId: 7,
    userName: 'Amina',
    isAdmin,
    user: { id: 7, name: 'Amina', roles: [], modules: modules.map((slug) => ({ slug })) },
    timeZone: 'Africa/Nairobi',
    request: {},
  }) as unknown as ToolContext;

const ctx = person(['personnel']);

const tool = (name: string) => {
  const found = TOOLS.find((t) => t.functionDeclaration.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
};
const run = (name: string, args: Record<string, unknown>, as: ToolContext = ctx) => executeTool(tool(name), args, as);
const errorOf = (action: { result: unknown }) => (action.result as { error?: string }).error ?? '';
const audited = () => lib.recordAuditEvent.mock.calls.map(([event]) => event.action);

beforeEach(() => {
  for (const fn of Object.values(lib)) fn.mockReset();
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
  lib.recordAuditEvent.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Fleet -------------------------------------------------------------------------

const driver = { id: 7, name: 'John Mokoena', phone: '0711 000 111', licenseNumber: null, status: 'Available', notes: null, personnelId: null };
const mirroredDriver = { ...driver, id: 8, name: 'Grace Wanjiru', personnelId: 44 };
const officer = { id: 4, name: 'Sam Otieno', callSign: 'Alpha 2', grade: 'CPO', phone: null, status: 'Available', notes: null, personnelId: 51 };
const vehicle = {
  id: 2, registration: 'KDA 123A', make: 'Toyota', model: 'Prado', type: 'SUV', status: 'Available', capacity: 5, notes: null, ownership: 'Internal',
};
const assignment = {
  id: 9, tripId: 1589, status: 'Planned', notes: null, vehicleId: 2, driverId: 7, officerId: null,
  trip: { reference: 'BRG-ZAF-NOV-2668' },
  vehicle: { registration: 'KDA 123A' },
  driver: { name: 'John Mokoena' },
  officer: null,
};

describe('fleet: enums are enforced, never replaced by a default', () => {
  it('an invalid driver status is refused, never set to Available', async () => {
    db.driver.findUnique.mockResolvedValue(driver);
    const action = await run('update_driver', { driverId: 7, status: 'Off Duty' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('status must be one of: Available, Assigned, Maintenance, Off duty (got "Off Duty")');
    expect(lib.updateDriver).not.toHaveBeenCalled();
  });

  it('a valid status is applied as given, and the result says what changed', async () => {
    db.driver.findUnique.mockResolvedValue(driver);
    lib.updateDriver.mockResolvedValue({ ...driver, status: 'Off duty' });
    const action = await run('update_driver', { driverId: 7, status: 'Off duty' });
    expect(lib.updateDriver).toHaveBeenCalledWith(7, { status: 'Off duty' });
    expect(action.result).toMatchObject({ changed: { status: { from: 'Available', to: 'Off duty' } }, href: '/modules/task-assignment' });
    expect(action.summary).toBe('Updated driver John Mokoena: status');
  });

  it.each([
    ['create_vehicle', { registration: 'KDB 1', type: 'Limousine' }, 'type must be one of: Sedan'],
    ['create_officer', { name: 'X', grade: 'Captain' }, 'grade must be one of: CPO'],
    ['create_assignment', { tripId: 1, driverId: 7, status: 'Done' }, 'status must be one of: Planned'],
    ['update_vehicle', { vehicleId: 2, status: 'In the garage' }, 'status must be one of: Available'],
  ])('%s refuses %j', async (name, args, message) => {
    const action = await run(name, args);
    expect(errorOf(action)).toContain(message);
    for (const write of [lib.createVehicle, lib.createOfficer, lib.createAssignment, lib.updateVehicle]) expect(write).not.toHaveBeenCalled();
  });
});

describe('fleet: vehicles', () => {
  it('a duplicate number plate is refused with a message', async () => {
    db.vehicle.findUnique.mockResolvedValue({ id: 2 });
    const action = await run('create_vehicle', { registration: 'KDA 123A' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toBe('A vehicle with the number plate KDA 123A is already in the fleet (vehicle 2). Number plates are unique.');
    expect(db.vehicle.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { registration: 'KDA 123A' } }));
    expect(lib.createVehicle).not.toHaveBeenCalled();
  });

  it('a plate taken between the check and the save is still a message, not a crash', async () => {
    db.vehicle.findUnique.mockResolvedValue(null);
    lib.createVehicle.mockRejectedValue(Object.assign(new TypeError('Unique constraint failed'), { code: 'P2002' }));
    const action = await run('create_vehicle', { registration: 'KDA 123A' });
    expect(errorOf(action)).toContain('KDA 123A is already in the fleet');
  });

  it('create_vehicle takes a positive whole number of seats, and echoes what was stored', async () => {
    expect(errorOf(await run('create_vehicle', { registration: 'KDB 1', capacity: 0 }))).toContain('capacity cannot be less than 1');
    expect(errorOf(await run('create_vehicle', { registration: 'KDB 1', capacity: 4.5 }))).toContain('capacity must be a whole number');
    expect(lib.createVehicle).not.toHaveBeenCalled();

    db.vehicle.findUnique.mockResolvedValue(null);
    lib.createVehicle.mockResolvedValue({ ...vehicle, id: 3, registration: 'KDB 1', type: 'Van', capacity: 7 });
    const action = await run('create_vehicle', { registration: 'KDB 1', type: 'Van', capacity: 7 });
    expect(lib.createVehicle).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, registration: 'KDB 1', type: 'Van', capacity: 7 }));
    expect(action.result).toMatchObject({ id: 3, type: 'Van', capacity: 7, href: '/modules/vehicles' });
  });

  it('vehicle tools open to the Vehicles module as well as Task Assignment; the rosters only to Task Assignment', () => {
    for (const name of ['list_fleet', 'create_vehicle', 'update_vehicle', 'delete_vehicle']) {
      expect(tool(name).requiredModule).toEqual(['task-assignment', 'vehicles']);
    }
    for (const name of ['create_driver', 'update_officer', 'create_assignment', 'update_assignment', 'delete_assignment']) {
      expect(tool(name).requiredModule).toEqual(['task-assignment']);
    }
  });

  it("delete_vehicle's Confirm says the fuel logs and maintenance history go with it", () => {
    expect(tool('delete_vehicle').destructive).toBe(true);
    const label = tool('delete_vehicle').confirmLabel!({ vehicleId: 2, registration: 'KDA 123A' });
    expect(label).toContain('KDA 123A');
    expect(label).toContain('fuel logs and maintenance history');
    expect(label).toContain('fuel-card balances');
  });
});

describe('fleet: drivers and officers', () => {
  it('create_driver says plainly that it adds to the Task Assignment register only', async () => {
    lib.createDriver.mockResolvedValue({ ...driver, id: 12, name: 'Peter Njoroge' });
    const action = await run('create_driver', { name: 'Peter Njoroge' });
    expect(tool('create_driver').functionDeclaration.description).toContain('register ONLY');
    expect((action.result as { note: string }).note).toContain('Added to the Task Assignment register only');
    expect((action.result as { note: string }).note).toContain('people directory');
  });

  it("a driver who comes from the people directory keeps the name and phone the directory owns", async () => {
    db.driver.findUnique.mockResolvedValue(mirroredDriver);
    const action = await run('update_driver', { driverId: 8, name: 'Grace W.', phone: '0700' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('comes from the people directory (person 44), which owns their name, phone');
    expect(errorOf(action)).toContain('Drivers module');
    expect(lib.updateDriver).not.toHaveBeenCalled();

    // The status is the register's own.
    lib.updateDriver.mockResolvedValue({ ...mirroredDriver, status: 'Maintenance' });
    const status = await run('update_driver', { driverId: 8, status: 'Maintenance' });
    expect(status.ok).toBe(true);
    expect(lib.updateDriver).toHaveBeenCalledWith(8, { status: 'Maintenance' });
  });

  it("an officer who comes from the people directory keeps the call sign and grade the directory owns", async () => {
    db.officer.findUnique.mockResolvedValue(officer);
    const action = await run('update_officer', { officerId: 4, callSign: 'Bravo 1', grade: 'Team Leader' });
    expect(errorOf(action)).toContain('which owns their call sign, grade');
    expect(lib.updateOfficer).not.toHaveBeenCalled();
  });

  it('a people-directory driver or officer cannot be deleted here; a register-only one can', async () => {
    db.driver.findUnique.mockResolvedValue(mirroredDriver);
    const refused = await run('delete_driver', { driverId: 8 });
    expect(errorOf(refused)).toContain('remove their Driver role (or retire the person) in the people directory');
    db.officer.findUnique.mockResolvedValue(officer);
    expect(errorOf(await run('delete_officer', { officerId: 4 }))).toContain('remove their CPO role');
    expect(lib.deleteDriver).not.toHaveBeenCalled();
    expect(lib.deleteOfficer).not.toHaveBeenCalled();

    db.driver.findUnique.mockResolvedValue(driver);
    lib.deleteDriver.mockResolvedValue(true);
    const deleted = await run('delete_driver', { driverId: 7 });
    expect(deleted.ok).toBe(true);
    expect(lib.deleteDriver).toHaveBeenCalledWith(7);
  });
});

describe('fleet: trip-level assignments', () => {
  it('update_assignment clears a resource with null and refuses to clear them all', async () => {
    db.tripAssignment.findUnique.mockResolvedValue(assignment);
    lib.updateAssignment.mockResolvedValue({ ...assignment, driverId: null, driver: null });

    const cleared = await run('update_assignment', { assignmentId: 9, driverId: null });
    expect(lib.updateAssignment).toHaveBeenCalledWith(9, { driverId: null });
    expect(cleared.result).toMatchObject({ changed: { driver: { from: 'John Mokoena', to: null } } });

    lib.updateAssignment.mockClear();
    const emptied = await run('update_assignment', { assignmentId: 9, vehicleId: null, driverId: 0 });
    expect(emptied.ok).toBe(false);
    expect(errorOf(emptied)).toContain('An assignment needs at least one of a car, a driver or an officer');
    expect(errorOf(emptied)).toContain('delete_assignment');
    expect(lib.updateAssignment).not.toHaveBeenCalled();
  });

  it('update_assignment moves the assignment to another trip, and refuses a trip that is not there', async () => {
    db.tripAssignment.findUnique.mockResolvedValue(assignment);
    db.trip.findUnique.mockResolvedValue(null);
    expect(errorOf(await run('update_assignment', { assignmentId: 9, tripId: 4040 }))).toContain('Trip 4040 was not found');
    expect(lib.updateAssignment).not.toHaveBeenCalled();

    db.trip.findUnique.mockResolvedValue({ id: 1600 });
    lib.updateAssignment.mockResolvedValue({ ...assignment, tripId: 1600, trip: { reference: 'BRG-KEN-DEC-2701' } });
    const moved = await run('update_assignment', { assignmentId: 9, tripId: 1600 });
    expect(lib.updateAssignment).toHaveBeenCalledWith(9, { tripId: 1600 });
    expect(moved.result).toMatchObject({ changed: { trip: { from: 'BRG-ZAF-NOV-2668', to: 'BRG-KEN-DEC-2701' } } });
  });

  it('create_assignment reads a 0 id as none, takes a status, and refuses an empty assignment', async () => {
    db.driver.findUnique.mockResolvedValue({ id: 7 });
    lib.createAssignment.mockResolvedValue({ ...assignment, id: 10, status: 'Confirmed', vehicle: null });
    const action = await run('create_assignment', { tripId: 1589, driverId: 7, vehicleId: 0, status: 'Confirmed' });
    expect(lib.createAssignment).toHaveBeenCalledWith({
      userId: 7, tripId: 1589, vehicleId: null, driverId: 7, officerId: null, status: 'Confirmed', notes: null,
    });
    expect(action.summary).toBe('Assigned John Mokoena to trip BRG-ZAF-NOV-2668 (Confirmed)');

    lib.createAssignment.mockClear();
    const empty = await run('create_assignment', { tripId: 1589, vehicleId: 0 });
    expect(errorOf(empty)).toContain('needs at least one of a car, a driver or an officer');
    expect(lib.createAssignment).not.toHaveBeenCalled();
  });

  it('an unknown driver, a booking clash or an unknown trip comes back as a message', async () => {
    db.driver.findUnique.mockResolvedValue(null);
    expect(errorOf(await run('create_assignment', { tripId: 1589, driverId: 99 }))).toContain('Driver 99 is not in the register');

    db.driver.findUnique.mockResolvedValue({ id: 7 });
    lib.createAssignment.mockRejectedValue(new ResourceConflictError('Driver John Mokoena is booked on BRG-KEN-DEC-2701.'));
    expect(errorOf(await run('create_assignment', { tripId: 1589, driverId: 7 }))).toBe('Driver John Mokoena is booked on BRG-KEN-DEC-2701.');

    lib.createAssignment.mockRejectedValue(new Error('Select a valid trip for this assignment'));
    expect(errorOf(await run('create_assignment', { tripId: 5, driverId: 7 }))).toBe('Select a valid trip for this assignment');
  });

  it('keeps pointing itinerary crew at save_trip_event', () => {
    expect(tool('create_assignment').functionDeclaration.description).toContain('save_trip_event (area: trips)');
  });
});

// --- Calendar ----------------------------------------------------------------------

const event = {
  id: 61,
  title: 'Client briefing',
  description: null,
  location: 'HQ',
  tag: null,
  startsAt: new Date('2026-06-20T11:00:00.000Z'),
  endsAt: new Date('2026-06-20T12:00:00.000Z'),
  allDay: false,
  reminderMinutesBefore: 30,
  googleEventId: null,
};
const saved = (changes: Record<string, unknown> = {}) => {
  const row = { ...event, ...changes };
  return {
    ...row,
    startsAt: (row.startsAt as Date).toISOString(),
    endsAt: row.endsAt ? (row.endsAt as Date).toISOString() : null,
    createdAt: '2026-06-01T00:00:00.000Z',
  };
};

describe('calendar', () => {
  it('calendar times are read in ctx.timeZone (14:00 Africa/Nairobi -> 11:00Z)', async () => {
    lib.createEvent.mockResolvedValue(saved());
    const action = await run('create_calendar_event', { title: 'Client briefing', date: '2026-06-20', time: '14:00', endTime: '15:00' });
    const [userId, input] = lib.createEvent.mock.calls[0];
    expect(userId).toBe(7);
    expect(input.startsAt.toISOString()).toBe('2026-06-20T11:00:00.000Z');
    expect(input.endsAt.toISOString()).toBe('2026-06-20T12:00:00.000Z');
    expect(input.allDay).toBe(false);
    expect(action.result).toMatchObject({ starts: '2026-06-20 14:00', ends: '2026-06-20 15:00', timesShownIn: 'Africa/Nairobi' });
    expect(action.summary).toBe('Added "Client briefing" to the calendar at 2026-06-20 14:00');
  });

  it('an unreadable end time is refused rather than clearing the end', async () => {
    db.calendarEvent.findFirst.mockResolvedValue(event);
    const update = await run('update_calendar_event', { eventId: 61, endTime: '5pm' });
    expect(update.ok).toBe(false);
    expect(errorOf(update)).toContain('endTime must be a 24-hour time written HH:MM (got "5pm")');
    expect(lib.updateEvent).not.toHaveBeenCalled();

    const create = await run('create_calendar_event', { title: 'X', date: '2026-06-20', time: '14:00', endTime: 'late' });
    expect(errorOf(create)).toContain('endTime must be a 24-hour time');
    expect(lib.createEvent).not.toHaveBeenCalled();
  });

  it.each([
    [{ reminderMinutesBefore: '1 hour' }, 'reminderMinutesBefore must be a number'],
    [{ reminderMinutesBefore: -5 }, 'reminderMinutesBefore cannot be less than 0'],
    [{ reminderMinutesBefore: 9_999_999 }, 'reminderMinutesBefore cannot be more than 40320'],
    [{ title: '' }, 'title cannot be blank'],
    [{ time: '2pm' }, 'time must be a 24-hour time'],
    [{ date: '20 June' }, 'date must be a real date'],
  ])('update_calendar_event refuses %j, and clears nothing', async (extra, message) => {
    db.calendarEvent.findFirst.mockResolvedValue(event);
    const action = await run('update_calendar_event', { eventId: 61, ...extra });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(message);
    expect(lib.updateEvent).not.toHaveBeenCalled();
  });

  it('an all-day event is stored the way the page stores it: local midnight, no end', async () => {
    lib.createEvent.mockResolvedValue(saved({ title: 'Block Friday', startsAt: new Date('2026-11-26T21:00:00.000Z'), endsAt: null, allDay: true }));
    const action = await run('create_calendar_event', { title: 'Block Friday', date: '2026-11-27', allDay: true });
    const input = lib.createEvent.mock.calls[0][1];
    expect(input.startsAt.toISOString()).toBe('2026-11-26T21:00:00.000Z');
    expect(input).toMatchObject({ allDay: true, endsAt: null });
    expect(action.result).toMatchObject({ allDay: true, starts: '2026-11-27' });

    expect(errorOf(await run('create_calendar_event', { title: 'X', date: '2026-11-27', allDay: true, time: '09:00' }))).toContain('An all-day event has no times');
    expect(errorOf(await run('create_calendar_event', { title: 'X', date: '2026-11-27' }))).toContain('Give the start time');
  });

  it('a new time keeps the date, and a new date carries the end along', async () => {
    db.calendarEvent.findFirst.mockResolvedValue(event);
    lib.updateEvent.mockResolvedValue({ status: 'ok', event: saved({ startsAt: new Date('2026-06-20T11:30:00.000Z') }) });
    const retimed = await run('update_calendar_event', { eventId: 61, time: '14:30' });
    expect(lib.updateEvent.mock.calls[0][2]).toEqual({ startsAt: new Date('2026-06-20T11:30:00.000Z') });
    expect(retimed.result).toMatchObject({ changed: { starts: { from: '2026-06-20 14:00', to: '2026-06-20 14:30' } } });

    lib.updateEvent.mockClear();
    lib.updateEvent.mockResolvedValue({
      status: 'ok',
      event: saved({ startsAt: new Date('2026-06-22T11:00:00.000Z'), endsAt: new Date('2026-06-22T12:00:00.000Z') }),
    });
    await run('update_calendar_event', { eventId: 61, date: '2026-06-22' });
    expect(lib.updateEvent.mock.calls[0][2]).toEqual({
      startsAt: new Date('2026-06-22T11:00:00.000Z'),
      endsAt: new Date('2026-06-22T12:00:00.000Z'),
    });

    // A start pushed past the end is refused, not saved with the end left behind it.
    lib.updateEvent.mockClear();
    expect(errorOf(await run('update_calendar_event', { eventId: 61, time: '16:00' }))).toContain('would end (2026-06-20 15:00) before it starts');
    expect(lib.updateEvent).not.toHaveBeenCalled();
  });

  it('the end and the reminder are removed only by an explicit null', async () => {
    db.calendarEvent.findFirst.mockResolvedValue(event);
    lib.updateEvent.mockResolvedValue({ status: 'ok', event: saved({ endsAt: null, reminderMinutesBefore: null }) });
    const action = await run('update_calendar_event', { eventId: 61, endTime: null, reminderMinutesBefore: null });
    expect(lib.updateEvent.mock.calls[0][2]).toEqual({ endsAt: null, reminderMinutesBefore: null });
    expect(action.result).toMatchObject({
      changed: { ends: { from: '2026-06-20 15:00', to: null }, reminderMinutesBefore: { from: 30, to: null } },
    });
  });

  it('list_upcoming_events takes a date range and shows ends, reminders and all-day events on their own local day', async () => {
    lib.listEvents.mockResolvedValue([
      saved({ id: 1, title: 'Standup', startsAt: new Date('2026-11-25T06:00:00.000Z'), endsAt: new Date('2026-11-25T06:30:00.000Z'), reminderMinutesBefore: 10 }),
      // Friday's local midnight is Thursday 21:00 UTC.
      saved({ id: 2, title: 'Block Friday', location: null, startsAt: new Date('2026-11-26T21:00:00.000Z'), endsAt: null, allDay: true, reminderMinutesBefore: null }),
    ]);
    const action = await run('list_upcoming_events', { from: '2026-11-25', to: '2026-11-27' });
    expect(lib.listEvents).toHaveBeenCalledWith(7, new Date('2026-11-24T21:00:00.000Z'), new Date('2026-11-27T21:00:00.000Z'));
    expect(action.result).toMatchObject({
      from: '2026-11-25',
      to: '2026-11-27',
      total: 2,
      more: false,
      events: [
        { id: 1, title: 'Standup', allDay: false, starts: '2026-11-25 09:00', ends: '2026-11-25 09:30', location: 'HQ', reminderMinutesBefore: 10 },
        { id: 2, title: 'Block Friday', allDay: true, starts: '2026-11-27' },
      ],
    });
  });

  it("delete_calendar_event's Confirm names the event", () => {
    expect(tool('delete_calendar_event').destructive).toBe(true);
    expect(tool('delete_calendar_event').confirmLabel!({ eventId: 61, title: 'Client briefing' })).toBe('Delete the calendar event "Client briefing"');
  });
});

// --- Tasks -------------------------------------------------------------------------

const task = {
  id: 31,
  userId: 7,
  title: 'Renew the licence',
  description: null,
  priority: 'medium',
  status: 'Backlog',
  startDate: null,
  // Local midnight on 28 Nov in Nairobi, as the task page stores a due day.
  dueDate: new Date('2026-11-27T21:00:00.000Z'),
  completed: false,
  deletedAt: null,
};

describe('tasks', () => {
  it('update_todo refuses a status that is not a board column and names the valid ones', async () => {
    db.personalTodo.findFirst.mockResolvedValue(task);
    db.personalTodoBoard.findUnique.mockResolvedValue({ columns: ['Backlog', 'Doing', 'Shipped'] });
    const action = await run('update_todo', { todoId: 31, status: 'Done' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain("status must be one of this user's board columns: Backlog, Doing, Shipped (got \"Done\")");
    expect(errorOf(action)).toContain('set completed: true');
    expect(db.personalTodo.updateMany).not.toHaveBeenCalled();

    // A user who never changed their board has the three it starts with.
    db.personalTodoBoard.findUnique.mockResolvedValue(null);
    expect(errorOf(await run('update_todo', { todoId: 31, status: 'Done' }))).toContain('Backlog, In progress, In review');
  });

  it('update_todo with an unreadable due date is refused and the existing date is untouched', async () => {
    db.personalTodo.findFirst.mockResolvedValue(task);
    const action = await run('update_todo', { todoId: 31, dueDate: 'next Friday' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('dueDate must be a real date written YYYY-MM-DD (got "next Friday")');
    expect(db.personalTodo.updateMany).not.toHaveBeenCalled();
  });

  it('update_todo refuses an invalid priority and a blank title instead of skipping them', async () => {
    db.personalTodo.findFirst.mockResolvedValue(task);
    expect(errorOf(await run('update_todo', { todoId: 31, priority: 'urgent' }))).toContain('priority must be one of: low, medium, high');
    expect(errorOf(await run('update_todo', { todoId: 31, title: '   ' }))).toContain('title cannot be blank');
    expect(errorOf(await run('update_todo', { todoId: 31, title: 'x'.repeat(161) }))).toContain('title is too long');
    expect(db.personalTodo.updateMany).not.toHaveBeenCalled();
  });

  it('update_todo moves a card to a real column, sets the description and a local due day, and reports each', async () => {
    const after = { ...task, status: 'In progress', description: 'Take both forms', dueDate: new Date('2026-11-30T21:00:00.000Z') };
    db.personalTodo.findFirst.mockResolvedValueOnce(task).mockResolvedValueOnce(after);
    db.personalTodoBoard.findUnique.mockResolvedValue(null);
    db.personalTodo.updateMany.mockResolvedValue({ count: 1 });

    const action = await run('update_todo', { todoId: 31, status: 'In progress', description: 'Take both forms', dueDate: '2026-12-01' });

    expect(db.personalTodo.updateMany).toHaveBeenCalledWith({
      where: { id: 31, userId: 7 },
      data: expect.objectContaining({ status: 'In progress', description: 'Take both forms', dueDate: new Date('2026-11-30T21:00:00.000Z') }),
    });
    expect(action.result).toMatchObject({
      changed: {
        status: { from: 'Backlog', to: 'In progress' },
        description: { from: null, to: 'Take both forms' },
        dueDate: { from: '2026-11-28', to: '2026-12-01' },
      },
      href: '/modules/todo-personal?open=31',
    });
  });

  it('create_todo refuses a bad priority, date, column or length, and stores the due day at local midnight', async () => {
    db.personalTodoBoard.findUnique.mockResolvedValue(null);
    expect(errorOf(await run('create_todo', { title: 'X', priority: 'urgent' }))).toContain('priority must be one of');
    expect(errorOf(await run('create_todo', { title: 'X', dueDate: 'tomorrow' }))).toContain('dueDate must be a real date');
    expect(errorOf(await run('create_todo', { title: 'X', status: 'Done' }))).toContain("board columns: Backlog, In progress, In review");
    expect(errorOf(await run('create_todo', { title: 'x'.repeat(161) }))).toContain('title is too long (161 characters; the limit is 160)');
    expect(errorOf(await run('create_todo', { title: 'X', description: 'y'.repeat(1001) }))).toContain('the limit is 1000');
    expect(db.personalTodo.create).not.toHaveBeenCalled();

    db.personalTodo.create.mockResolvedValue({ ...task, id: 32, title: 'Call the garage', priority: 'high', startDate: new Date('2026-11-25T21:00:00.000Z') });
    const action = await run('create_todo', { title: 'Call the garage', priority: 'high', startDate: '2026-11-26', dueDate: '2026-11-28' });
    expect(db.personalTodo.create.mock.calls[0][0].data).toMatchObject({
      userId: 7,
      title: 'Call the garage',
      priority: 'high',
      status: 'Backlog',
      startDate: new Date('2026-11-25T21:00:00.000Z'),
      dueDate: new Date('2026-11-27T21:00:00.000Z'),
      completed: false,
    });
    expect(action.result).toMatchObject({ id: 32, dueDate: '2026-11-28', startDate: '2026-11-26', status: 'Backlog' });
  });

  it('list_todos shows local due dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T09:00:00.000Z') });
    db.personalTodo.count.mockResolvedValue(41);
    db.personalTodo.findMany.mockResolvedValue([
      // 21:00 UTC on the 24th is the 25th in Nairobi: cut from the UTC string it read a day early.
      { ...task, id: 1, title: 'Due on the 25th', dueDate: new Date('2026-11-24T21:00:00.000Z'), description: 'Bring ID' },
      { ...task, id: 2, title: 'Late', dueDate: new Date('2026-11-19T21:00:00.000Z') },
      { ...task, id: 3, title: "Musa's task", userId: 12, dueDate: null },
    ]);
    db.personalTodoBoard.findUnique.mockResolvedValue(null);

    const action = await run('list_todos', { show: 'open', q: 'licence', page: 2 });

    expect(action.result).toMatchObject({
      total: 41,
      page: 2,
      more: true,
      today: '2026-11-24',
      boardColumns: ['Backlog', 'In progress', 'In review'],
      tasks: [
        { id: 1, dueDate: '2026-11-25', description: 'Bring ID' },
        { id: 2, dueDate: '2026-11-20', overdue: true },
        { id: 3, dueDate: null, sharedWithMe: true },
      ],
    });
    // Filtered and paged in the database, over the user's own tasks and those shared with them.
    const query = db.personalTodo.findMany.mock.calls[0][0];
    expect(query).toMatchObject({ skip: 20, take: 20 });
    expect(query.where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ userId: 7 }, { shares: { some: { userId: 7 } } }] },
        { deletedAt: null },
        { completed: false },
        { OR: [{ title: { contains: 'licence', mode: 'insensitive' } }, { description: { contains: 'licence', mode: 'insensitive' } }] },
      ]),
    );
  });

  it('list_todos finds overdue tasks by the start of the local day', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T09:00:00.000Z') });
    db.personalTodo.count.mockResolvedValue(0);
    db.personalTodo.findMany.mockResolvedValue([]);
    db.personalTodoBoard.findUnique.mockResolvedValue(null);
    await run('list_todos', { show: 'overdue' });
    expect(db.personalTodo.findMany.mock.calls[0][0].where.AND).toEqual(
      expect.arrayContaining([{ completed: false, dueDate: { lt: new Date('2026-11-23T21:00:00.000Z') } }]),
    );
  });

  it('delete_todo can be undone: restore_todo brings the task back', async () => {
    expect(tool('delete_todo').destructive).toBe(true);
    expect(tool('delete_todo').confirmLabel!({ todoId: 31, title: 'Renew the licence' })).toContain('can be restored');

    db.personalTodo.findFirst.mockResolvedValue({ ...task, deletedAt: new Date('2026-11-20T10:00:00.000Z') });
    db.personalTodo.updateMany.mockResolvedValue({ count: 1 });
    db.personalTodoBoard.findUnique.mockResolvedValue(null);
    const action = await run('restore_todo', { todoId: 31 });
    expect(db.personalTodo.updateMany).toHaveBeenCalledWith({ where: { id: 31, userId: 7 }, data: { deletedAt: null } });
    expect(action.result).toMatchObject({ restored: true, title: 'Renew the licence' });

    db.personalTodo.findFirst.mockResolvedValue(task);
    expect(errorOf(await run('restore_todo', { todoId: 31 }))).toContain('is not deleted');
  });
});

// --- Contracts ---------------------------------------------------------------------

const contract = (changes: Record<string, unknown> = {}) => ({
  id: 5,
  reference: 'CTR-9901',
  counterpartyName: 'Bridge Corp',
  email: null,
  department: null,
  type: 'Retainer',
  lifecycle: 'Active',
  status: 'Active',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2027-01-01T00:00:00.000Z',
  daysRemaining: 38,
  value: 120000,
  currency: 'USD',
  lastRenewalDate: null,
  notes: null,
  hasDocument: false,
  document: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...changes,
});

describe('contracts', () => {
  it('create_contract is admin-only', () => {
    expect(tool('create_contract').requiredRole).toBe('admin');
    expect(tool('create_contract').requiredModule).toEqual(['contract-renewal']);
    // Reading and editing follow the page: the module is enough.
    expect(tool('list_contracts').requiredRole).toBeUndefined();
    expect(tool('update_contract').requiredRole).toBeUndefined();
  });

  it.each([
    [{ type: 'NDA' }, 'type must be one of: Fixed Term, Retainer, Project Based'],
    [{ status: 'Expired' }, 'status must be one of: Active, In Renewal, Renewed, Cancelled'],
    [{ value: -5 }, 'value cannot be less than 0'],
    [{ value: 1200.5 }, 'value must be a whole number'],
    [{ value: '5k' }, 'value must be a number'],
    [{ endDate: '2025-12-31' }, 'endDate (2025-12-31) is before startDate'],
    [{ startDate: '1 Jan 2026' }, 'startDate must be a real date'],
    [{ currency: 'dollars' }, 'three-letter currency code'],
  ])('create_contract refuses %j', async (extra, message) => {
    const action = await run('create_contract', {
      reference: 'CTR-1', counterpartyName: 'Bridge Corp', startDate: '2026-01-01', endDate: '2026-12-31', ...extra,
    });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(message);
    expect(lib.createContract).not.toHaveBeenCalled();
  });

  it('create_contract stores what was asked and relays a reference that is already taken', async () => {
    lib.createContract.mockResolvedValue(contract({ type: 'Project Based', value: 5000 }));
    const action = await run('create_contract', {
      reference: 'CTR-9901', counterpartyName: 'Bridge Corp', type: 'Project Based', status: 'In Renewal',
      startDate: '2026-01-01', endDate: '2027-01-01', value: 5000, currency: 'kes',
    });
    expect(lib.createContract).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7, type: 'Project Based', status: 'In Renewal', value: 5000, currency: 'KES',
        startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2027-01-01T00:00:00.000Z'),
      }),
    );
    expect(action.result).toMatchObject({ id: 5, type: 'Project Based', endDate: '2027-01-01', href: '/modules/contract-renewal?open=5' });

    lib.createContract.mockRejectedValue(new Error('A contract with reference "CTR-9901" already exists'));
    const again = await run('create_contract', { reference: 'CTR-9901', counterpartyName: 'B', startDate: '2026-01-01', endDate: '2026-02-01' });
    expect(errorOf(again)).toBe('A contract with reference "CTR-9901" already exists');
  });

  it('list_contracts puts running contracts first, soonest to end first, and pages the rest', async () => {
    const ended = Array.from({ length: 45 }, (_, i) =>
      contract({ id: 100 + i, reference: `OLD-${i}`, status: 'Expired', daysRemaining: -400 + i, endDate: '2025-10-01T00:00:00.000Z' }),
    );
    lib.listContracts.mockResolvedValue([
      ...ended,
      contract({ id: 1, reference: 'CTR-SOON', status: 'Expiring Soon', daysRemaining: 12 }),
      contract({ id: 2, reference: 'CTR-LATE', daysRemaining: 300, lifecycle: 'In Renewal', status: 'In Renewal' }),
    ]);
    const first = await run('list_contracts', {});
    const rows = (first.result as { contracts: Array<{ reference: string }> }).contracts;
    expect(rows.slice(0, 3).map((c) => c.reference)).toEqual(['CTR-SOON', 'CTR-LATE', 'OLD-44']);
    expect(first.result).toMatchObject({ total: 47, more: true, contracts: expect.arrayContaining([expect.objectContaining({ reference: 'CTR-LATE', lifecycle: 'In Renewal', startDate: '2026-01-01' })]) });
    expect(rows).toHaveLength(20);

    const found = await run('list_contracts', { q: 'ctr-late', status: 'In Renewal' });
    expect(found.result).toMatchObject({ total: 1, more: false });
  });

  it('update_contract renews through the lib the page uses, and reports what changed', async () => {
    lib.listContracts.mockResolvedValue([contract()]);
    lib.updateContract.mockResolvedValue(contract({ endDate: '2028-01-01T00:00:00.000Z', lastRenewalDate: '2026-11-24T00:00:00.000Z' }));
    const action = await run('update_contract', { contractId: 5, endDate: '2028-01-01', lastRenewalDate: '2026-11-24', status: 'Active' });
    expect(lib.updateContract).toHaveBeenCalledWith(5, {
      endDate: new Date('2028-01-01T00:00:00.000Z'), lastRenewalDate: new Date('2026-11-24T00:00:00.000Z'), status: 'Active',
    });
    expect(action.result).toMatchObject({
      changed: { endDate: { from: '2027-01-01', to: '2028-01-01' }, lastRenewalDate: { from: null, to: '2026-11-24' } },
    });
  });
});

// --- Handovers ---------------------------------------------------------------------

const handover = (changes: Record<string, unknown> = {}) => ({
  id: 14,
  shiftDate: '2026-11-23T00:00:00.000Z',
  shiftPeriod: 'Night',
  post: 'Control Room',
  status: 'Attention',
  summary: 'Quiet night. **Gate B** camera is down.',
  incidents: 'Alarm at 02:10, false.',
  watchItems: 'Generator fuel low.',
  createdAt: '2026-11-23T03:00:00.000Z',
  createdBy: { id: 12, name: 'Musa' },
  acknowledgedBy: null,
  acknowledgedAt: null,
  ...changes,
});

describe('handovers', () => {
  it('acknowledge_handover is destructive, refuses your own / an already acknowledged handover with a message, and settles the notifications', async () => {
    const ack = tool('acknowledge_handover');
    expect(ack.destructive).toBe(true);
    expect(ack.confirmLabel!({ handoverId: 14, shift: 'Night shift of 2026-11-23 (Control Room)' })).toBe(
      'Acknowledge the handover Night shift of 2026-11-23 (Control Room) in your name (it is signed off as received by you)',
    );

    lib.getHandover.mockResolvedValue(handover({ createdBy: { id: 7, name: 'Amina' } }));
    const own = await run('acknowledge_handover', { handoverId: 14 });
    expect(own.ok).toBe(false);
    expect(errorOf(own)).toBe('You cannot acknowledge your own handover');

    lib.getHandover.mockResolvedValue(handover({ acknowledgedBy: { id: 3, name: 'Wanjiru' }, acknowledgedAt: '2026-11-23T04:00:00.000Z' }));
    const twice = await run('acknowledge_handover', { handoverId: 14 });
    expect(errorOf(twice)).toContain('This handover has already been acknowledged (by Wanjiru on 2026-11-23 07:00)');

    lib.getHandover.mockResolvedValue(null);
    expect(errorOf(await run('acknowledge_handover', { handoverId: 99 }))).toBe('Handover not found');
    expect(lib.acknowledgeHandover).not.toHaveBeenCalled();
    expect(lib.settleHandoverNotifications).not.toHaveBeenCalled();

    lib.getHandover.mockResolvedValue(handover());
    lib.acknowledgeHandover.mockResolvedValue(handover({ acknowledgedBy: { id: 7, name: 'Amina' }, acknowledgedAt: '2026-11-24T05:00:00.000Z' }));
    const done = await run('acknowledge_handover', { handoverId: 14 });
    expect(done.ok).toBe(true);
    expect(lib.acknowledgeHandover).toHaveBeenCalledWith(14, 7);
    expect(lib.settleHandoverNotifications).toHaveBeenCalledWith(14);
    expect(done.result).toMatchObject({ acknowledgedBy: 'Amina', acknowledgedAt: '2026-11-24 08:00' });
    expect(done.summary).toBe('Acknowledged the Night shift of 2026-11-23 (Control Room) handover from Musa');
  });

  it("a race the lib catches (someone acknowledged it first) comes back as the page's message, not a crash", async () => {
    lib.getHandover.mockResolvedValue(handover());
    lib.acknowledgeHandover.mockRejectedValue(new Error('This handover has already been acknowledged'));
    const action = await run('acknowledge_handover', { handoverId: 14 });
    expect(errorOf(action)).toBe('This handover has already been acknowledged');
    expect(lib.settleHandoverNotifications).not.toHaveBeenCalled();
  });

  it('list_handovers carries incidents, watch items and the acknowledgement; get_handover gives one in full', async () => {
    const long = 'x'.repeat(900);
    lib.listHandovers.mockResolvedValue([
      handover({ summary: long }),
      handover({ id: 13, acknowledgedBy: { id: 3, name: 'Wanjiru' }, acknowledgedAt: '2026-11-22T04:00:00.000Z' }),
    ]);
    const list = await run('list_handovers', {});
    const rows = (list.result as { handovers: Array<Record<string, unknown>> }).handovers;
    expect(list.result).toMatchObject({ total: 2, awaitingAcknowledgement: 1 });
    expect(rows[0]).toMatchObject({ id: 14, incidents: 'Alarm at 02:10, false.', watchItems: 'Generator fuel low.', awaitingAcknowledgement: true, shiftDate: '2026-11-23' });
    expect((rows[0].summary as string).length).toBe(401);
    expect(rows[1]).toMatchObject({ acknowledgedBy: 'Wanjiru', acknowledgedAt: '2026-11-22 07:00' });

    expect((await run('list_handovers', { awaiting: true })).result).toMatchObject({ total: 1 });

    lib.getHandover.mockResolvedValue(handover({ summary: long }));
    const one = await run('get_handover', { handoverId: 14 });
    expect(one.kind).toBe('read');
    expect((one.result as { summary: string }).summary).toBe(long);
  });

  it('create_handover waits for Confirm, then writes it and notifies the incoming shift as the page does', async () => {
    const write = tool('create_handover');
    expect(write.destructive).toBe(true);
    expect(write.confirmLabel!({ shiftPeriod: 'Night', post: 'Control Room', summary: 'x' })).toBe(
      'Write a Night shift handover for Control Room in your name and notify the incoming shift',
    );
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T22:30:00.000Z') });
    lib.createHandover.mockResolvedValue(handover({ id: 15, shiftDate: '2026-11-25T00:00:00.000Z', createdBy: { id: 7, name: 'Amina' } }));
    lib.notifyIncomingShift.mockResolvedValue({ via: 'shift', shiftName: 'Day', names: ['Musa', 'Wanjiru'] });

    const action = await run('create_handover', { shiftPeriod: 'Night', post: 'Control Room', summary: 'All quiet.', status: 'Attention' });

    // 22:30 UTC is already the 25th in Nairobi.
    expect(lib.createHandover).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, shiftDate: '2026-11-25', shiftPeriod: 'Night', status: 'Attention', summary: 'All quiet.' }),
    );
    expect(lib.notifyIncomingShift).toHaveBeenCalledWith({ handover: expect.objectContaining({ id: 15 }), writer: { id: 7, name: 'Amina' } });
    expect(action.result).toMatchObject({ id: 15, notified: ['Musa', 'Wanjiru'] });

    expect(errorOf(await run('create_handover', { shiftPeriod: 'Graveyard', summary: 'x' }))).toContain('shiftPeriod must be one of: Day, Night');
  });
});

// --- Due dates ---------------------------------------------------------------------

const due = (title: string, date: string, extra: Record<string, unknown> = {}) => ({
  id: title, source: 'invoice', sourceLabel: 'Invoice', title, subtitle: null, date, daysRemaining: 0, amount: null, currency: null, href: '/modules/invoices-review', ...extra,
});

describe('due dates', () => {
  it('list_upcoming_due_dates returns what is coming up, soonest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-24T09:00:00.000Z') });
    // As the lib hands them over: oldest first, a year of overdue items ahead of anything coming up.
    const old = Array.from({ length: 35 }, (_, i) => due(`Invoice OLD-${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), { amount: 100, currency: 'USD' }));
    lib.listUpcomingDueDates.mockResolvedValue([
      ...old,
      due('Invoice INV-RECENT', '2026-11-20T00:00:00.000Z'),
      // 22:30 UTC on the 24th is tomorrow in Nairobi.
      due('Night call', '2026-11-24T22:30:00.000Z', { source: 'calendar', sourceLabel: 'Calendar' }),
      due('J. Mokoena — license', '2026-11-26T00:00:00.000Z', { source: 'license', sourceLabel: 'License' }),
      due('Contract CTR-9901', '2026-11-30T00:00:00.000Z', { source: 'contract', sourceLabel: 'Contract', amount: 120000, currency: 'USD' }),
      due('Review: Evacuation', '2026-12-20T00:00:00.000Z', { source: 'sop', sourceLabel: 'SOP review' }),
      due('Quote QT-1', '2027-02-01T00:00:00.000Z', { source: 'quote', sourceLabel: 'Quote' }),
    ]);

    const action = await run('list_upcoming_due_dates', {});
    const result = action.result as {
      upcoming: Array<Record<string, unknown>>;
      overdue: Array<Record<string, unknown>>;
      counts: Record<string, number>;
    };

    expect(result.upcoming.map((row) => row.title)).toEqual([
      'Night call', 'J. Mokoena — license', 'Contract CTR-9901', 'Review: Evacuation', 'Quote QT-1',
    ]);
    expect(result.upcoming[0]).toMatchObject({ date: '2026-11-25', daysRemaining: 1, source: 'Calendar' });
    expect(result.upcoming[2]).toMatchObject({ date: '2026-11-30', daysRemaining: 6, amount: 120000, currency: 'USD' });
    // Every item the "this week" count stands for is in the list.
    expect(result.counts).toEqual({ overdue: 36, dueThisWeek: 3, dueThisMonth: 1, later: 1 });
    // Overdue is kept apart, the most recent first, and not allowed to crowd out what is coming up.
    expect(result.overdue).toHaveLength(10);
    expect(result.overdue[0]).toMatchObject({ title: 'Invoice INV-RECENT', date: '2026-11-20', daysOverdue: 4 });
    expect(action.result).toMatchObject({ today: '2026-11-24', overdueMore: expect.stringContaining('36 overdue in all') });

    const week = (await run('list_upcoming_due_dates', { window: 'week' })).result as { upcoming: unknown[]; total: number };
    expect(week.total).toBe(3);
    const late = (await run('list_upcoming_due_dates', { window: 'overdue', page: 2 })).result as { overdue: unknown[]; total: number; more: boolean };
    expect(late).toMatchObject({ total: 36, more: false });
    expect(late.overdue).toHaveLength(16);
    const licences = (await run('list_upcoming_due_dates', { source: 'license' })).result as { upcoming: unknown[]; counts: Record<string, number> };
    expect(licences.upcoming).toHaveLength(1);
  });
});

// --- Contacts ----------------------------------------------------------------------

const contact = (changes: Record<string, unknown> = {}) => ({
  id: 5,
  name: 'Grace Mwaura',
  role: 'Travel Manager',
  category: 'Vendor',
  email: 'grace@bridge.example',
  phone: '+254 700 111 222',
  location: null,
  notes: null,
  tags: [],
  hasPhoto: false,
  customer: null,
  private: false,
  createdAt: '2026-11-11T00:00:00.000Z',
  ...changes,
});

describe('contacts', () => {
  it('create_contact refuses an unknown client and echoes the category', async () => {
    db.customer.findUnique.mockResolvedValue(null);
    const refused = await run('create_contact', { name: 'Grace Mwaura', customerId: 404 });
    expect(refused.ok).toBe(false);
    expect(errorOf(refused)).toContain('Client 404 was not found, so nothing was saved');
    expect(lib.createContact).not.toHaveBeenCalled();

    db.customer.findUnique.mockResolvedValue({ id: 3 });
    lib.createContact.mockResolvedValue(contact({ category: 'Internal', customer: { id: 3, name: 'Bridge Corp', company: 'Bridge Holdings' } }));
    const action = await run('create_contact', { name: 'Grace Mwaura', category: 'Internal', customerId: 3, location: 'Nairobi', tags: ['VIP', 'vip', 'Billing'] });
    expect(lib.createContact).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, name: 'Grace Mwaura', category: 'Internal', customerId: 3, location: 'Nairobi', tags: ['VIP', 'Billing'] }),
    );
    expect(action.result).toMatchObject({ id: 5, category: 'Internal', client: 'Bridge Corp', href: '/modules/contact-list?open=5' });
    expect(action.summary).toBe('Added Grace Mwaura to the contacts as Internal, linked to Bridge Corp');

    // With no client asked for, the result says there is none.
    lib.createContact.mockResolvedValue(contact());
    expect((await run('create_contact', { name: 'Grace Mwaura' })).result).toMatchObject({ category: 'Vendor', client: null });
  });

  it('create_contact refuses a category the directory does not have, instead of filing it under Client', async () => {
    const action = await run('create_contact', { name: 'Grace Mwaura', category: 'Supplier' });
    expect(errorOf(action)).toContain('category must be one of: Internal, Client, Vendor, Partner');
    expect(lib.createContact).not.toHaveBeenCalled();
    expect(tool('create_contact').requiredModule).toEqual(['contact-list', 'customers']);
  });

  it("list_contacts matches the client's company, the job title and the phone, and returns them", async () => {
    lib.listContacts.mockResolvedValue([
      contact({ customer: { id: 3, name: 'Bridge Corp', company: 'Bridge Holdings' } }),
      contact({ id: 6, name: 'Otis Kamau', role: 'Fleet Supervisor', phone: '+254 722 999 000', email: null }),
    ]);
    const byCompany = (await run('list_contacts', { q: 'holdings' })).result as { contacts: Array<Record<string, unknown>> };
    expect(byCompany.contacts).toEqual([expect.objectContaining({ id: 5, phone: '+254 700 111 222', role: 'Travel Manager', client: 'Bridge Corp', clientCompany: 'Bridge Holdings' })]);
    expect(((await run('list_contacts', { q: 'supervisor' })).result as { contacts: unknown[] }).contacts).toHaveLength(1);
    expect(((await run('list_contacts', { q: '722 999' })).result as { total: number }).total).toBe(1);
    expect(lib.listContacts).toHaveBeenCalledWith(7);
  });

  it('update_contact changes what was asked through the page\'s own rule for who may see a contact; delete waits for Confirm', async () => {
    db.contact.findFirst.mockResolvedValue(contact());
    lib.updateContact.mockResolvedValue(contact({ phone: null, category: 'Partner' }));
    const action = await run('update_contact', { contactId: 5, phone: null, category: 'Partner' });
    expect(db.contact.findFirst.mock.calls[0][0].where).toEqual({ id: 5, OR: [{ source: { not: 'google' } }, { createdById: 7 }] });
    expect(lib.updateContact).toHaveBeenCalledWith(5, { phone: null, category: 'Partner' }, 7);
    expect(action.result).toMatchObject({
      changed: { phone: { from: '+254 700 111 222', to: null }, category: { from: 'Vendor', to: 'Partner' } },
    });

    // Someone else's synced Google contact is not found, as on the page.
    db.contact.findFirst.mockResolvedValue(null);
    expect(errorOf(await run('update_contact', { contactId: 9, phone: '1' }))).toContain('Contact 9 was not found');
    expect(tool('delete_contact').destructive).toBe(true);
    expect(tool('delete_contact').confirmLabel!({ contactId: 5, name: 'Grace Mwaura' })).toBe('Delete the contact Grace Mwaura from the directory');
  });
});

// --- Personnel ---------------------------------------------------------------------

const staff = (changes: Record<string, unknown> = {}) => ({
  id: 44,
  name: 'Grace Wanjiru',
  email: 'grace@la.example',
  phone: '0711 222 333',
  role: 'Senior Driver',
  department: 'Operations',
  status: 'Active',
  location: 'Nairobi',
  manager: null,
  joinDate: null,
  skills: [],
  roles: ['Driver'],
  engagement: 'Employee',
  supplierName: null,
  callSign: null,
  grade: null,
  licenses: [{ id: 1, licenseNumber: 'DL-778', category: 'BCE', expiryDate: '2027-03-01T00:00:00.000Z', status: 'Valid', daysRemaining: 97, hasDocument: false }],
  hasPhoto: false,
  user: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...changes,
});

describe('personnel', () => {
  it('list_personnel is open to every people module, searches roles, filters by role and returns contact details and licences', async () => {
    expect(tool('list_personnel').requiredModule).toEqual(['personnel', 'drivers', 'cpos', 'airport-greeters', 'security-advisors']);
    lib.listPersonnel.mockResolvedValue([staff(), staff({ id: 45, name: 'Sam Otieno', role: null, roles: ['CPO'], callSign: 'Alpha 2', licenses: [] })]);

    const byRoleWord = (await run('list_personnel', { q: 'cpo' })).result as { people: Array<Record<string, unknown>> };
    expect(byRoleWord.people).toEqual([expect.objectContaining({ personId: 45, roles: ['CPO'], callSign: 'Alpha 2' })]);

    const drivers = await run('list_personnel', { role: 'Driver' });
    expect(lib.listPersonnel).toHaveBeenLastCalledWith({ role: 'Driver' });
    expect((drivers.result as { people: unknown[] }).people[0]).toMatchObject({
      personId: 44, phone: '0711 222 333', email: 'grace@la.example', roles: ['Driver'], jobTitle: 'Senior Driver',
      licences: [{ number: 'DL-778', category: 'BCE', expires: '2027-03-01', status: 'Valid' }],
    });
    expect(errorOf(await run('list_personnel', { role: 'Pilot' }))).toContain('role must be one of: Driver, CPO, Airport Greeter, Security Advisor');
  });

  it('someone who holds only the Drivers module reads drivers, as on their page', async () => {
    const coordinator = person(['drivers']);
    lib.listPersonnel.mockResolvedValue([staff(), staff({ id: 45, name: 'Sam Otieno', roles: ['CPO'] })]);
    const list = (await run('list_personnel', {}, coordinator)).result as { people: Array<{ personId: number }> };
    expect(list.people.map((p) => p.personId)).toEqual([44]);
    expect(errorOf(await run('list_personnel', { role: 'CPO' }, coordinator))).toContain('no access to the CPO directory');

    lib.getPersonnelById.mockResolvedValue({ ...staff({ id: 45, roles: ['CPO'] }), resource: { driverId: null, officerId: 4 }, notes: null });
    expect(errorOf(await run('get_person', { personId: 45 }, coordinator))).toContain('Person 45 was not found');
  });

  it('get_person opens the full record, with the driver and officer ids they are assigned under', async () => {
    lib.getPersonnelById.mockResolvedValue({ ...staff(), resource: { driverId: 8, officerId: null }, notes: 'Speaks French.' });
    const action = await run('get_person', { personId: 44 }, person(['drivers']));
    expect(action.kind).toBe('read');
    expect(action.result).toMatchObject({ personId: 44, driverId: 8, notes: 'Speaks French.', phone: '0711 222 333', href: '/modules/drivers?person=44' });
  });
});

// --- Notes and files -----------------------------------------------------------------

const note = (changes: Record<string, unknown> = {}) => ({
  id: 3, title: 'Gate codes', content: 'Main: 4411', category: 'Work', color: 'yellow', pinned: false,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-20T06:00:00.000Z', ...changes,
});

describe('notes and files', () => {
  it('create_note takes a category and colour, refuses ones the notes do not have, and is audited', async () => {
    expect(errorOf(await run('create_note', { title: 'X', category: 'Secret' }))).toContain('category must be one of: Personal, Work, Ideas');
    expect(errorOf(await run('create_note', { title: 'X', color: 'red' }))).toContain('color must be one of');
    lib.createNote.mockResolvedValue(note({ category: 'Ideas', color: 'blue', pinned: true }));
    const action = await run('create_note', { title: 'Gate codes', content: 'Main: 4411', category: 'Ideas', color: 'blue', pinned: true });
    expect(lib.createNote).toHaveBeenCalledWith({ userId: 7, title: 'Gate codes', content: 'Main: 4411', category: 'Ideas', color: 'blue', pinned: true });
    expect(action.result).toMatchObject({ id: 3, category: 'Ideas', color: 'blue', pinned: true });
    expect(audited()).toEqual(['ai.note.create']);
  });

  it('update_note will not replace the text without being told to, and delete_note waits for Confirm', async () => {
    lib.listNotes.mockResolvedValue([note()]);
    const unsure = await run('update_note', { noteId: 3, content: 'Back: 9920' });
    expect(errorOf(unsure)).toContain('contentMode "append" adds it under what is there');
    expect(lib.updateNote).not.toHaveBeenCalled();

    lib.updateNote.mockResolvedValue(note({ content: 'Main: 4411\n\nBack: 9920' }));
    const action = await run('update_note', { noteId: 3, content: 'Back: 9920', contentMode: 'append' });
    expect(lib.updateNote).toHaveBeenCalledWith(3, 7, { content: 'Main: 4411\n\nBack: 9920' });
    expect(action.summary).toBe('Updated the note "Gate codes": content');

    expect(tool('delete_note').destructive).toBe(true);
    expect(tool('delete_note').confirmLabel!({ noteId: 3, title: 'Gate codes' })).toBe('Delete the note "Gate codes"');
  });

  it('list_notes and list_my_files search and page', async () => {
    lib.listNotes.mockResolvedValue(Array.from({ length: 45 }, (_, i) => note({ id: i + 1, title: i === 44 ? 'Fuel card PIN' : `Note ${i}` })));
    expect((await run('list_notes', { page: 3 })).result).toMatchObject({ total: 45, page: 3, more: false });
    expect((await run('list_notes', { q: 'fuel card' })).result).toMatchObject({ total: 1, notes: [{ id: 45, edited: '2026-11-20 09:00' }] });

    lib.listFiles.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({
        id: i + 1, name: i === 0 ? 'Insurance 2026.pdf' : `scan-${i}.png`, description: null, tags: i === 0 ? ['insurance'] : [], mimeType: 'application/pdf',
        size: 2048, uploadedBy: { id: 12, name: 'Musa' }, isOwner: false, sharedWith: [], createdAt: '2026-11-19T22:00:00.000Z',
      })),
    );
    expect((await run('list_my_files', {})).result).toMatchObject({ total: 25, more: true });
    expect((await run('list_my_files', { q: 'INSURANCE' })).result).toMatchObject({
      total: 1,
      files: [{ id: 1, owner: 'Musa', mine: false, uploaded: '2026-11-20', tags: ['insurance'] }],
    });
  });
});

// --- Feedback ----------------------------------------------------------------------

const feedback = (changes: Record<string, unknown> = {}) => ({
  id: 21, title: 'Trip page freezes', description: 'Opening a long itinerary hangs the tab.', category: 'Bug Report', status: 'New',
  author: { id: 12, name: 'Musa' }, upvotes: 4, commentCount: 2, isUpvoted: false, createdAt: '2026-11-20T06:00:00.000Z', ...changes,
});

describe('feedback', () => {
  it('create_feedback refuses an unknown category', async () => {
    const action = await run('create_feedback', { title: 'Trip page freezes', description: 'It hangs.', category: 'Bug' });
    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain('category must be one of: Bug Report, Feature Idea, Improvement, Technical Support (got "Bug")');
    // Leaving it out is no way round: nothing is filed as an Improvement by default.
    expect(errorOf(await run('create_feedback', { title: 'T', description: 'D' }))).toContain('category is required');
    expect(lib.createFeedback).not.toHaveBeenCalled();
  });

  it('create_feedback files it under the category asked for, and says which', async () => {
    lib.createFeedback.mockResolvedValue(feedback());
    const action = await run('create_feedback', { title: 'Trip page freezes', description: 'It hangs.', category: 'Bug Report' });
    expect(lib.createFeedback).toHaveBeenCalledWith({ userId: 7, title: 'Trip page freezes', description: 'It hangs.', category: 'Bug Report' });
    expect(action.result).toMatchObject({ id: 21, category: 'Bug Report', status: 'New' });
    expect(action.summary).toBe('Submitted the bug report "Trip page freezes"');
  });

  it('list_feedback filters and pages and shows who wrote what; get_feedback adds the comments', async () => {
    lib.getFeedbackStats.mockResolvedValue({ total: 46, implemented: 3, planned: 2, underReview: 1 });
    lib.listFeedback.mockResolvedValue([
      feedback(),
      ...Array.from({ length: 45 }, (_, i) => feedback({ id: 100 + i, title: `Idea ${i}`, category: 'Feature Idea', status: 'Planned', author: { id: 3, name: 'Wanjiru' } })),
    ]);
    const list = await run('list_feedback', { status: 'New' });
    expect(list.result).toMatchObject({
      total: 1,
      counts: { total: 46 },
      items: [{ id: 21, description: 'Opening a long itinerary hangs the tab.', author: 'Musa', comments: 2, upvotes: 4, submitted: '2026-11-20 09:00' }],
    });
    expect((await run('list_feedback', { page: 3 })).result).toMatchObject({ total: 46, page: 3, more: false });
    expect((await run('list_feedback', { q: 'wanjiru', category: 'Feature Idea' })).result).toMatchObject({ total: 45, more: true });

    lib.listComments.mockResolvedValue([{ id: 1, body: 'Same here.', author: { id: 3, name: 'Wanjiru' }, createdAt: '2026-11-21T06:30:00.000Z' }]);
    const one = await run('get_feedback', { feedbackId: 21 });
    expect(lib.listComments).toHaveBeenCalledWith(21);
    expect(one.result).toMatchObject({ id: 21, comments: [{ author: 'Wanjiru', body: 'Same here.', at: '2026-11-21 09:30' }] });
  });

  it('comment_feedback is audited; set_feedback_status stays admin-only', async () => {
    lib.addComment.mockResolvedValue({ id: 9, body: 'Fixed in the next release.', author: { id: 7, name: 'Amina' }, createdAt: '' });
    const action = await run('comment_feedback', { feedbackId: 21, body: 'Fixed in the next release.' });
    expect(lib.addComment).toHaveBeenCalledWith(7, 21, 'Fixed in the next release.');
    expect(action.ok).toBe(true);
    expect(audited()).toEqual(['ai.feedback.comment']);
    expect(errorOf(await run('comment_feedback', { feedbackId: 21, body: '   ' }))).toContain('body cannot be blank');

    expect(tool('set_feedback_status').requiredRole).toBe('admin');
    expect(errorOf(await run('set_feedback_status', { feedbackId: 21, status: 'Fixed' }))).toContain('status must be one of: New, Under Review');
  });
});

// --- What every update tool shares ---------------------------------------------------

describe('across these tools', () => {
  it.each([
    ['update_vehicle', { vehicleId: 2, registration: '  ' }, 'registration cannot be blank'],
    ['update_driver', { driverId: 7, name: '' }, 'name cannot be blank'],
    ['update_calendar_event', { eventId: 61, title: '' }, 'title cannot be blank'],
    ['update_todo', { todoId: 31, title: '' }, 'title cannot be blank'],
    ['update_note', { noteId: 3, title: ' ' }, 'title cannot be blank'],
    ['update_contact', { contactId: 5, name: '' }, 'name cannot be blank'],
    ['update_contract', { contractId: 5, counterpartyName: '' }, 'counterpartyName cannot be blank'],
  ])('a blank title is refused: %s %j', async (name, args, message) => {
    db.vehicle.findUnique.mockResolvedValue(vehicle);
    db.driver.findUnique.mockResolvedValue(driver);
    db.calendarEvent.findFirst.mockResolvedValue(event);
    db.personalTodo.findFirst.mockResolvedValue(task);
    db.contact.findFirst.mockResolvedValue(contact());
    lib.listNotes.mockResolvedValue([note()]);
    lib.listContracts.mockResolvedValue([contract()]);

    const action = await run(name, args);

    expect(action.ok).toBe(false);
    expect(errorOf(action)).toContain(message);
    for (const write of [lib.updateVehicle, lib.updateDriver, lib.updateEvent, lib.updateNote, lib.updateContact, lib.updateContract, db.personalTodo.updateMany]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('a no-op update is refused', async () => {
    db.driver.findUnique.mockResolvedValue(driver);
    lib.updateDriver.mockResolvedValue({ ...driver });
    const same = await run('update_driver', { driverId: 7, status: 'Available' });
    expect(same.ok).toBe(false);
    expect(errorOf(same)).toBe('Nothing to change: driver John Mokoena already has those values.');

    db.personalTodo.findFirst.mockResolvedValue(task);
    db.personalTodo.updateMany.mockResolvedValue({ count: 1 });
    expect(errorOf(await run('update_todo', { todoId: 31, priority: 'medium' }))).toContain('Nothing to change: "Renew the licence"');

    db.calendarEvent.findFirst.mockResolvedValue(event);
    lib.updateEvent.mockResolvedValue({ status: 'ok', event: saved() });
    expect(errorOf(await run('update_calendar_event', { eventId: 61, time: '14:00' }))).toContain('Nothing to change: "Client briefing"');

    db.tripAssignment.findUnique.mockResolvedValue(assignment);
    db.vehicle.findUnique.mockResolvedValue({ id: 2 });
    lib.updateAssignment.mockResolvedValue({ ...assignment });
    expect(errorOf(await run('update_assignment', { assignmentId: 9, vehicleId: 2 }))).toContain('Nothing to change: assignment 9');

    lib.listFeedback.mockResolvedValue([feedback()]);
    expect(errorOf(await run('set_feedback_status', { feedbackId: 21, status: 'New' }))).toContain('Nothing to change');
    expect(lib.updateFeedbackStatus).not.toHaveBeenCalled();

    // Nothing that changed nothing is written to the audit log either.
    expect(lib.recordAuditEvent).not.toHaveBeenCalled();
    // And a call that names nothing to change is told so.
    expect(errorOf(await run('update_driver', { driverId: 7 }))).toBe('Say what to change on the driver.');
  });

  it('an audit failure does not fail a saved write', async () => {
    lib.recordAuditEvent.mockRejectedValue(new Error('audit table is down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    db.vehicle.findUnique.mockResolvedValue(null);
    lib.createVehicle.mockResolvedValue({ ...vehicle });
    db.driver.findUnique.mockResolvedValue({ id: 7 });
    lib.createAssignment.mockResolvedValue({ ...assignment });
    db.tripAssignment.findUnique.mockResolvedValue(assignment);
    lib.updateAssignment.mockResolvedValue({ ...assignment, status: 'Confirmed' });
    db.customer.findUnique.mockResolvedValue({ id: 3 });
    lib.createContact.mockResolvedValue(contact());
    lib.createContract.mockResolvedValue(contract());
    lib.listFeedback.mockResolvedValue([feedback()]);
    lib.updateFeedbackStatus.mockResolvedValue(true);
    lib.getHandover.mockResolvedValue(handover());
    lib.acknowledgeHandover.mockResolvedValue(handover({ acknowledgedBy: { id: 7, name: 'Amina' }, acknowledgedAt: '2026-11-24T05:00:00.000Z' }));
    lib.createEvent.mockResolvedValue(saved());
    db.personalTodoBoard.findUnique.mockResolvedValue(null);
    db.personalTodo.create.mockResolvedValue(task);

    const actions = [
      await run('create_vehicle', { registration: 'KDA 123A' }),
      await run('create_assignment', { tripId: 1589, driverId: 7 }),
      await run('update_assignment', { assignmentId: 9, status: 'Confirmed' }),
      await run('create_contact', { name: 'Grace Mwaura', customerId: 3 }),
      await run('create_contract', { reference: 'CTR-9901', counterpartyName: 'Bridge Corp', startDate: '2026-01-01', endDate: '2027-01-01' }),
      await run('set_feedback_status', { feedbackId: 21, status: 'Planned' }),
      await run('acknowledge_handover', { handoverId: 14 }),
      await run('create_calendar_event', { title: 'Client briefing', date: '2026-06-20', time: '14:00' }),
      await run('create_todo', { title: 'Renew the licence' }),
    ];
    quiet.mockRestore();

    expect(actions.map((action) => [action.tool, action.ok])).toEqual(actions.map((action) => [action.tool, true]));
    expect(lib.recordAuditEvent).toHaveBeenCalledTimes(actions.length);
  });

  it('every write names the record and where it lives; every delete says what it will do', async () => {
    const writes = TOOLS.filter((t) => t.destructive);
    expect(writes.filter((t) => !t.confirmLabel).map((t) => t.functionDeclaration.name)).toEqual([]);
    for (const t of writes) expect(t.confirmLabel!({}).length).toBeGreaterThan(15);
  });
});
