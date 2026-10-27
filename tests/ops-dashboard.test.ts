import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { db, $queryRaw, requireModuleRequest } = vi.hoisted(() => ({
  db: {
    trip: { findMany: vi.fn(), groupBy: vi.fn() },
    tripItineraryItem: { findMany: vi.fn() },
    tripLogEntry: { findMany: vi.fn() },
    messagingAccount: { findMany: vi.fn() },
    messagingChat: { findMany: vi.fn(), count: vi.fn() },
    handoverEntry: { findMany: vi.fn(), count: vi.fn() },
    personalTodo: { findMany: vi.fn(), count: vi.fn() },
    vehicle: { findMany: vi.fn() },
    vehicleFuelLog: { findMany: vi.fn(), groupBy: vi.fn() },
    vehicleMaintenance: { findMany: vi.fn(), groupBy: vi.fn() },
  },
  // Kept off `db`: the reset loop walks each table's functions.
  $queryRaw: vi.fn(),
  requireModuleRequest: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: { ...db, $queryRaw } }));
vi.mock('../lib/request-auth', () => ({ requireModuleRequest }));
vi.mock('../lib/organization', () => ({ getOrganizationSettings: vi.fn(async () => ({ defaultCurrency: 'KES' })) }));

import { GET } from '../app/api/dashboard/ops/route';
import { DEFAULT_LAYOUT, parseLayout } from '../app/modules/ops-dashboard/board-stores';
import {
  buildAttention,
  byCountry,
  clampHeight,
  compareTrips,
  countriesIn,
  dragColumns,
  movementState,
  overdueLabel,
  tripHealth,
} from '../app/modules/ops-dashboard/ops-model';
import { describeMutation } from '../app/ui/banner';
import type { FleetVehicleRef, MaintenanceDto } from '../lib/fleet';
import {
  type OpsMovement,
  type OpsSections,
  type OpsTrip,
  loadOpsDashboard,
  loadOpsReference,
  summarizeMaintenance,
} from '../lib/ops-dashboard';
import { parsePanels } from '../lib/ops-panels';
import type { AccessUser } from '../lib/user';

const person = (modules: string[], opts: { admin?: boolean; id?: number } = {}): AccessUser => ({
  id: opts.id ?? 7,
  email: 'ops@example.test',
  name: 'Ops',
  status: 'active',
  createdAt: '',
  updatedAt: '',
  sessionVersion: 1,
  roles: opts.admin ? [{ id: 1, name: 'admin', description: '' }] : [{ id: 3, name: 'viewer', description: '' }],
  permissions: [],
  modules: modules.map((slug, i) => ({ id: i + 1, slug, name: slug, description: '', category: 'X', sortOrder: i })),
});

const own = { OR: [{ createdById: 7 }, { ownerId: 7 }] };

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
  $queryRaw.mockReset();
  requireModuleRequest.mockReset();
  db.trip.findMany.mockResolvedValue([]);
  db.trip.groupBy.mockResolvedValue([]);
  db.tripItineraryItem.findMany.mockResolvedValue([]);
  db.tripLogEntry.findMany.mockResolvedValue([]);
  db.messagingAccount.findMany.mockResolvedValue([]);
  db.handoverEntry.findMany.mockResolvedValue([]);
  db.handoverEntry.count.mockResolvedValue(0);
  db.personalTodo.findMany.mockResolvedValue([]);
  db.personalTodo.count.mockResolvedValue(0);
  db.vehicle.findMany.mockResolvedValue([]);
  db.vehicleFuelLog.findMany.mockResolvedValue([]);
  db.vehicleFuelLog.groupBy.mockResolvedValue([]);
  db.vehicleMaintenance.findMany.mockResolvedValue([]);
  db.vehicleMaintenance.groupBy.mockResolvedValue([]);
});

// --- Maintenance -------------------------------------------------------------

const CAR: FleetVehicleRef = { id: 1, registration: 'KDA 123A', make: 'Toyota', model: 'Prado' };
let nextId = 1;
function job(overrides: Partial<MaintenanceDto>): MaintenanceDto {
  return {
    id: nextId++,
    vehicle: CAR,
    kind: 'Scheduled',
    category: 'Service',
    title: 'Service',
    status: 'Planned',
    scheduledFor: null,
    completedAt: null,
    odometerKm: null,
    cost: null,
    currency: 'KES',
    provider: null,
    nextDueAt: null,
    nextDueKm: null,
    reminderDays: null,
    notes: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('summarizeMaintenance', () => {
  const today = '2026-10-27';

  it('puts overdue work first, then work under way, then what is due soon', () => {
    const later = job({ title: 'Later', scheduledFor: '2026-12-20' });
    const soon = job({ title: 'Soon', scheduledFor: '2026-10-30' });
    const underWay = job({ title: 'Under way', status: 'In progress', kind: 'Unscheduled', category: 'Repair' });
    const late = job({ title: 'Late', scheduledFor: '2026-10-20' });
    const done = job({ title: 'Done', status: 'Completed', completedAt: '2026-10-01' });
    const cancelled = job({ title: 'Cancelled', status: 'Cancelled', scheduledFor: '2026-10-01' });

    const summary = summarizeMaintenance([later, soon, underWay, late, done, cancelled], {}, today);

    expect(summary.jobs.map((j) => [j.title, j.display])).toEqual([
      ['Late', 'Overdue'],
      ['Under way', 'In progress'],
      ['Soon', 'Due soon'],
      ['Later', 'Planned'],
    ]);
    expect(summary).toMatchObject({ overdue: 1, dueSoon: 1, inProgress: 1 });
  });

  it('lists the next services falling due on finished work, not planned jobs a second time', () => {
    const serviced = job({ title: 'Full service', status: 'Completed', completedAt: '2026-04-27', nextDueAt: '2026-10-30', reminderDays: 7 });
    const inspection = job({ category: 'Inspection', title: 'Inspection', scheduledFor: '2026-10-29', reminderDays: 7 });

    const summary = summarizeMaintenance([serviced, inspection], {}, today);

    expect(summary.comingDue).toHaveLength(1);
    expect(summary.comingDue[0]).toMatchObject({ maintenanceId: serviced.id, overdue: false });
    expect(summary.comingDue[0]!.message).toContain('Service for KDA 123A is due');
    expect(summary.jobs.map((j) => j.title)).toEqual(['Inspection']);
  });
});

// --- The board ---------------------------------------------------------------

describe('loadOpsDashboard', () => {
  it('loads only the panels the viewer holds modules for', async () => {
    const board = await loadOpsDashboard(person(['ops-dashboard', 'todo-personal', 'handover']));

    expect(board.allowed).toEqual(['handover', 'tasks']);
    expect(Object.keys(board.sections).sort()).toEqual(['handover', 'tasks']);
    expect(board.canOpenFlightTracker).toBe(false);
    expect(db.trip.findMany).not.toHaveBeenCalled();
    expect(db.messagingAccount.findMany).not.toHaveBeenCalled();
    expect(db.vehicleFuelLog.findMany).not.toHaveBeenCalled();
  });

  it('loads just the panels asked for, and never one the viewer may not see', async () => {
    const board = await loadOpsDashboard(person(['ops-dashboard', 'todo-personal', 'trip-planning']), ['tasks', 'fuel']);

    expect(Object.keys(board.sections)).toEqual(['tasks']);
    expect(board.allowed).toEqual(['trips', 'movements', 'flights', 'tasks']);
    expect(db.trip.findMany).not.toHaveBeenCalled();
    expect(db.tripItineraryItem.findMany).not.toHaveBeenCalled();
  });

  it("follows the viewer's own trips, with their events, controller, latest log and escalations", async () => {
    const at = (h: number) => {
      const d = new Date();
      d.setHours(h, 0, 0, 0);
      return d;
    };
    db.trip.findMany.mockResolvedValue([
      {
        id: 11,
        reference: 'MCF-KEN-OCT-2661',
        title: 'Nairobi visit',
        status: 'Active',
        country: 'Kenya',
        startDate: at(0),
        endDate: null,
        createdById: 7,
        ownerId: 12,
        customer: { name: 'Mastercard Foundation' },
        owner: { name: 'Duty Controller' },
        createdBy: { name: 'Ops' },
        assignments: [{ vehicle: { registration: 'KDA 123A' }, driver: { name: 'Peter' }, officer: { name: 'Jane', callSign: 'Alpha 1' } }],
        items: [
          {
            id: 1,
            category: 'flight',
            description: 'Arrival',
            timeLabel: 'ARRIVAL',
            scheduledAt: at(7),
            placeName: null,
            details: { flightNumber: 'KQ 101' },
            completedAt: at(7),
            vehicle: null,
            driver: null,
            officer: null,
          },
          {
            id: 2,
            category: 'transportation',
            description: 'Meeting run',
            timeLabel: null,
            scheduledAt: at(10),
            placeName: 'UN Gigiri',
            details: null,
            completedAt: null,
            vehicle: { registration: 'KDA 123A' },
            driver: { name: 'Peter' },
            officer: null,
          },
        ],
        logEntries: [{ loggedAt: at(8), detail: 'Principal at hotel', escalated: false, dutyController: 'Ops' }],
      },
    ]);
    db.trip.groupBy.mockResolvedValue([{ status: 'Active', _count: { _all: 1 } }]);
    db.tripLogEntry.findMany.mockResolvedValue([
      { id: 4, detail: 'Road closed', loggedAt: at(9), dutyController: 'Ops', trip: { id: 11, reference: 'MCF-KEN-OCT-2661', country: 'Kenya' } },
    ]);

    const board = await loadOpsDashboard(person(['ops-dashboard', 'trip-planning']), ['trips']);

    const where = db.trip.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual(own);
    // A Planned trip with something on the itinerary in the next day is on the board whatever its dates.
    expect(where.AND[1].OR[2]).toMatchObject({ status: 'Planned', items: { some: { scheduledAt: expect.any(Object) } } });
    expect(db.tripLogEntry.findMany.mock.calls[0]![0].where).toMatchObject({ escalated: true, trip: { AND: [own, { status: { in: ['Planned', 'Active'] } }] } });
    expect(board.sections.trips!.trips[0]).toMatchObject({
      crew: 'KDA 123A · Peter · Jane (Alpha 1)',
      canEdit: true,
      controller: 'Duty Controller',
      mine: true,
      events: [
        { id: 1, flightNumber: 'KQ 101', completed: true, crew: null },
        { id: 2, description: 'Meeting run', placeName: 'UN Gigiri', crew: 'KDA 123A · Peter', completed: false },
      ],
      lastLog: { detail: 'Principal at hotel', escalated: false, by: 'Ops' },
    });
    expect(board.sections.trips!.escalations).toEqual([
      { id: 4, tripId: 11, reference: 'MCF-KEN-OCT-2661', country: 'Kenya', detail: 'Road closed', at: at(9).toISOString(), by: 'Ops' },
    ]);
  });

  it("lists movements and flights from the viewer's live trips, with the crew on each event", async () => {
    const now = new Date();
    const trip = { id: 11, reference: 'MCF-KEN-OCT-2661', title: 'Nairobi visit', country: 'Kenya', status: 'Active', createdById: 99, ownerId: null, customer: { name: 'MCF' } };
    db.tripItineraryItem.findMany.mockImplementation(async (args: { where: { category?: string } }) =>
      args.where.category === 'flight'
        ? [
            {
              id: 9,
              timeLabel: 'ARRIVAL',
              scheduledAt: now,
              endsAt: null,
              durationMinutes: 480,
              providerName: 'Kenya Airways',
              details: { flightNumber: 'KQ 101', departAirport: 'LHR', arriveAirport: 'NBO', timezone: 'Africa/Nairobi' },
              completedAt: null,
              trip,
            },
          ]
        : [
            {
              id: 5,
              category: 'transportation',
              description: 'Airport pickup',
              timeLabel: 'PICK-UP',
              scheduledAt: now,
              placeName: 'JKIA',
              details: null,
              completedAt: null,
              vehicle: { registration: 'KDA 123A' },
              driver: { name: 'Peter' },
              officer: null,
              trip,
            },
          ],
    );

    const board = await loadOpsDashboard(person(['ops-dashboard', 'trip-planning', 'flight-tracker']), ['movements', 'flights']);

    for (const call of db.tripItineraryItem.findMany.mock.calls) {
      expect(call[0].where.trip).toEqual({ AND: [own, { status: { in: ['Planned', 'Active'] } }] });
    }
    expect(board.sections.movements).toEqual([
      expect.objectContaining({ id: 5, tripId: 11, country: 'Kenya', crew: 'KDA 123A · Peter', flightNumber: null, canEdit: false }),
    ]);
    expect(board.sections.flights![0]).toMatchObject({ flightNumber: 'KQ 101', from: 'LHR', to: 'NBO', country: 'Kenya', canEdit: false });
    expect(board.canOpenFlightTracker).toBe(true);
  });

  it("shows the viewer's own WhatsApp chats, with each one's latest message from one query", async () => {
    db.messagingAccount.findMany.mockResolvedValue([{ id: 3, userId: 7, provider: 'whatsapp', handle: 'h', label: null, session: null }]);
    db.messagingChat.findMany.mockResolvedValue([
      { accountId: 3, chatId: 'a@s.whatsapp.net', kind: 'dm', name: 'Driver Peter', lastMessageAt: new Date('2026-10-27T08:00:00Z'), unreadCount: 2 },
      { accountId: 3, chatId: 'b@g.us', kind: 'group', name: 'Ops group', lastMessageAt: new Date('2026-10-27T07:00:00Z'), unreadCount: 0 },
    ]);
    db.messagingChat.count.mockResolvedValue(1);
    $queryRaw.mockResolvedValue([{ accountId: 3, chatId: 'a@s.whatsapp.net', text: 'At the gate', fromMe: false, senderName: 'Peter', mediaKind: null }]);

    const board = await loadOpsDashboard(person(['ops-dashboard', 'whatsapp']));

    expect(db.messagingAccount.findMany).toHaveBeenCalledWith({ where: { userId: 7, provider: 'whatsapp' }, orderBy: { id: 'asc' } });
    expect(db.messagingChat.findMany.mock.calls[0]![0].where).toEqual({ accountId: { in: [3] } });
    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(board.sections.whatsapp).toMatchObject({
      linked: true,
      unreadChats: 1,
      chats: [
        { chatId: 'a@s.whatsapp.net', unread: 2, preview: { text: 'At the gate', fromMe: false, senderName: 'Peter', mediaKind: null } },
        { chatId: 'b@g.us', kind: 'group', preview: null },
      ],
    });
  });

  it('puts urgent handovers first, and knows which are the viewer’s own', async () => {
    const row = (id: number, status: string, createdById: number) => ({
      id,
      shiftDate: new Date('2026-10-27T06:00:00Z'),
      shiftPeriod: 'Night',
      post: null,
      status,
      summary: `Shift ${id}`,
      watchItems: null,
      createdAt: new Date('2026-10-27T06:00:00Z'),
      createdById,
      createdBy: { name: createdById === 7 ? 'Ops' : 'Night lead' },
    });
    db.handoverEntry.findMany.mockResolvedValue([row(1, 'Normal', 8), row(2, 'Urgent', 8), row(3, 'Attention', 7)]);
    db.handoverEntry.count.mockResolvedValue(3);

    const board = await loadOpsDashboard(person(['ops-dashboard', 'handover']));

    expect(db.handoverEntry.findMany.mock.calls[0]![0].where.acknowledgedAt).toBeNull();
    expect(board.sections.handover!.awaiting).toBe(3);
    expect(board.sections.handover!.items.map((h) => [h.id, h.mine])).toEqual([
      [2, false],
      [3, true],
      [1, false],
    ]);
  });

  it('keeps the board up when one panel fails', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.trip.findMany.mockRejectedValue(new Error('db down'));

    const board = await loadOpsDashboard(person([], { admin: true }), ['trips', 'tasks']);

    expect(board.sections.trips).toEqual({ active: 0, startingSoon: 0, trips: [], escalations: [] });
    expect(board.sections.tasks).toEqual({ open: 0, overdue: 0, tasks: [] });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('sends the vehicle list for the fleet forms only to someone with a fleet panel', async () => {
    db.vehicle.findMany.mockResolvedValue([CAR]);

    expect(await loadOpsReference(person(['ops-dashboard', 'todo-personal']))).toBeNull();
    expect(await loadOpsReference(person(['ops-dashboard', 'car-fuel']))).toEqual({ vehicles: [CAR], defaultCurrency: 'KES' });
  });
});

describe('GET /api/dashboard/ops', () => {
  it('needs the Ops Dashboard module', async () => {
    requireModuleRequest.mockResolvedValue({ auth: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

    const response = await GET(new NextRequest('http://localhost/api/dashboard/ops'));

    expect(response.status).toBe(403);
    expect(requireModuleRequest.mock.calls[0]!.slice(1)).toEqual(['ops-dashboard']);
  });

  it('loads only the panels named in ?panels=', async () => {
    requireModuleRequest.mockResolvedValue({ auth: { user: person(['ops-dashboard', 'todo-personal', 'trip-planning']) }, response: null });

    const body = await (await GET(new NextRequest('http://localhost/api/dashboard/ops?panels=tasks,nonsense'))).json();

    expect(Object.keys(body.dashboard.sections)).toEqual(['tasks']);
    expect(db.trip.findMany).not.toHaveBeenCalled();
  });

  it('reads the panel list it is given', () => {
    expect(parsePanels(null)).toBeNull();
    expect(parsePanels('fuel, trips,bogus')).toEqual(['trips', 'fuel']);
    expect(parsePanels('')).toEqual([]);
  });
});

// --- The board's rules (client side) ------------------------------------------

const NOW = new Date('2026-10-27T10:00:00Z').getTime();
const minutes = (n: number) => new Date(NOW + n * 60_000).toISOString();

function movement(overrides: Partial<OpsMovement>): OpsMovement {
  return {
    id: nextId++,
    tripId: 11,
    reference: 'MCF-KEN-OCT-2661',
    customer: 'MCF',
    country: 'Kenya',
    category: 'transportation',
    description: 'Transfer',
    timeLabel: null,
    scheduledAt: minutes(0),
    placeName: null,
    crew: null,
    flightNumber: null,
    completed: false,
    canEdit: true,
    ...overrides,
  };
}

describe('movementState', () => {
  it('is late a quarter of an hour after its time, unless done or just a note', () => {
    expect(movementState(movement({ scheduledAt: minutes(-16) }), NOW)).toBe('late');
    expect(movementState(movement({ scheduledAt: minutes(-14) }), NOW)).toBe('now');
    expect(movementState(movement({ scheduledAt: minutes(10) }), NOW)).toBe('now');
    expect(movementState(movement({ scheduledAt: minutes(60) }), NOW)).toBe('upcoming');
    expect(movementState(movement({ scheduledAt: minutes(-90), completed: true }), NOW)).toBe('done');
    expect(movementState(movement({ scheduledAt: minutes(-90), category: 'information' }), NOW)).toBe('done');
  });
});

describe('overdueLabel', () => {
  it('reads like a person would say it', () => {
    expect(overdueLabel(25 * 60_000)).toBe('25 min');
    expect(overdueLabel(60 * 60_000)).toBe('1h');
    expect(overdueLabel(157 * 60_000)).toBe('2h 37m');
    expect(overdueLabel(-25 * 60_000, true)).toBe('25m');
  });
});

describe('buildAttention', () => {
  it('puts escalations, delays and late movements before overdue work and unread chats', () => {
    const late = movement({ id: 501, description: 'Airport pickup', scheduledAt: minutes(-40) });
    const sections: Partial<OpsSections> = {
      movements: [late, movement({ scheduledAt: minutes(30) })],
      tasks: { open: 4, overdue: 2, tasks: [] },
      whatsapp: { linked: true, unreadChats: 3, chats: [] },
      trips: {
        active: 1,
        startingSoon: 1,
        escalations: [{ id: 4, tripId: 11, reference: 'MCF-KEN-OCT-2661', country: 'Kenya', detail: 'Road closed', at: minutes(-5), by: 'Ops' }],
        trips: [
          {
            id: 12,
            reference: 'TKGM-ETH-OCT-2650',
            title: 'Site visit',
            customer: 'Tulu Kapi',
            status: 'Planned',
            country: 'Ethiopia',
            startDate: '2026-10-25T00:00:00.000Z',
            endDate: null,
            crew: null,
            controller: 'Ops',
            mine: true,
            canEdit: true,
            events: [],
            lastLog: null,
          },
        ],
      },
      flights: [
        {
          id: 9,
          tripId: 11,
          tripReference: 'MCF-KEN-OCT-2661',
          tripTitle: 'Nairobi visit',
          customer: 'MCF',
          country: 'Kenya',
          timeLabel: 'ARRIVAL',
          scheduledAt: minutes(60),
          endsAt: null,
          durationMinutes: null,
          airline: null,
          flightNumber: 'KQ 101',
          from: 'LHR',
          to: 'NBO',
          timezone: null,
          completed: false,
          canEdit: true,
        },
      ],
    };

    const items = buildAttention(sections, NOW, [{ id: 9, label: 'Delayed 45m' }], () => '09:20');

    expect(items.map((i) => [i.tone, i.title])).toEqual([
      ['danger', 'Escalated · MCF-KEN-OCT-2661'],
      ['danger', 'KQ 101 · Delayed 45m'],
      ['danger', 'Not done: 09:20 Airport pickup'],
      ['warn', 'TKGM-ETH-OCT-2650 should have started'],
      ['warn', '2 overdue tasks'],
      ['info', '3 unread WhatsApp chats'],
    ]);
    expect(items[2]!.detail).toBe('40 min overdue · MCF-KEN-OCT-2661');
  });

  it('has nothing to say about a quiet board', () => {
    expect(buildAttention({ tasks: { open: 1, overdue: 0, tasks: [] }, movements: [movement({ scheduledAt: minutes(30) })] }, NOW)).toEqual([]);
  });
});

describe('the country filter', () => {
  it('narrows the trip panels to one country and leaves the rest of the board alone', () => {
    const sections: Partial<OpsSections> = {
      movements: [movement({ country: 'Kenya' }), movement({ country: 'Ethiopia' }), movement({ country: null })],
      tasks: { open: 1, overdue: 0, tasks: [] },
    };

    expect(countriesIn(sections)).toEqual(['Kenya', 'Ethiopia']);
    const kenya = byCountry(sections, 'Kenya');
    expect(kenya.movements!.map((m) => m.country)).toEqual(['Kenya']);
    expect(kenya.tasks).toBe(sections.tasks);
    expect(byCountry(sections, '')).toBe(sections);
  });
});

describe('save banners', () => {
  it('name trip log entries, fill-ups and maintenance rather than "Trip created"', () => {
    expect(describeMutation('POST', '/api/trips/11/log')).toEqual({ title: 'Log entry created' });
    expect(describeMutation('POST', '/api/fleet/fuel')).toEqual({ title: 'Fill-up created' });
    expect(describeMutation('PATCH', '/api/fleet/maintenance/3')).toEqual({ title: 'Maintenance saved' });
  });
});

describe('resizing panels', () => {
  // A three-column grid of 400px tracks with 20px gaps.
  const grid = { columns: 3, track: 400, gap: 20 };

  it('snaps a drag to whole columns', () => {
    expect(dragColumns({ ...grid, cols: 1, startWidth: 400, dx: 230 })).toBe(2);
    expect(dragColumns({ ...grid, cols: 1, startWidth: 400, dx: 180 })).toBe(1);
    expect(dragColumns({ ...grid, cols: 2, startWidth: 820, dx: 900 })).toBe(3);
    expect(dragColumns({ ...grid, cols: 3, startWidth: 1240, dx: -700 })).toBe(1);
  });

  it('keeps the chosen span when the drag didn’t change what is on screen', () => {
    // Three columns wide, shown two wide on a two-column screen: a height drag leaves it three.
    expect(dragColumns({ columns: 2, track: 500, gap: 20, cols: 3, startWidth: 1020, dx: 10 })).toBe(3);
    // One column on a phone: width can't change.
    expect(dragColumns({ columns: 1, track: 360, gap: 0, cols: 2, startWidth: 360, dx: 300 })).toBe(2);
  });

  it('keeps heights within reason', () => {
    expect(clampHeight(40)).toBe(160);
    expect(clampHeight(9999)).toBe(1600);
    expect(clampHeight(420.4)).toBe(420);
  });

  it('remembers sizes in the browser, and drops ones that make no sense', () => {
    const layout = parseLayout(
      JSON.stringify({
        order: ['fuel', 'trips'],
        sizes: { trips: { cols: 3, height: 500 }, fuel: { cols: 9 }, tasks: { height: 'tall' }, bogus: { cols: 2 } },
      }),
    );
    expect(layout.sizes).toEqual({ trips: { cols: 3, height: 500 }, fuel: { cols: 3 } });
    expect(layout.order.slice(0, 2)).toEqual(['fuel', 'trips']);
    expect(layout.order).toHaveLength(8);
    expect(parseLayout('not json')).toBe(DEFAULT_LAYOUT);
  });
});

describe('trip health on the board', () => {
  function trip(overrides: Partial<OpsTrip>): OpsTrip {
    return {
      id: nextId++,
      reference: `REF-${nextId}`,
      title: 'Visit',
      customer: 'MCF',
      status: 'Active',
      country: 'Kenya',
      startDate: '2026-10-27T00:00:00.000Z',
      endDate: '2026-10-30T00:00:00.000Z',
      crew: null,
      controller: 'Ops',
      mine: true,
      canEdit: true,
      events: [],
      lastLog: null,
      ...overrides,
    };
  }
  const event = (at: string, completed = false) => ({
    id: nextId++,
    category: 'transportation',
    description: 'Transfer',
    timeLabel: null,
    scheduledAt: at,
    placeName: null,
    crew: null,
    flightNumber: null,
    completed,
  });

  it('names the most serious thing about each trip', () => {
    const late = trip({ events: [event(minutes(-40)), event(minutes(60))] });
    expect(tripHealth(late, NOW)).toMatchObject({ level: 'danger', reason: 'late', late: 1, done: 0, total: 2 });
    expect(tripHealth(late, NOW).next?.scheduledAt).toBe(minutes(60));
    // An escalation outranks late events; a delayed flight carries its chip text.
    expect(tripHealth(late, NOW, { escalated: true }).reason).toBe('escalated');
    expect(tripHealth(trip({}), NOW, { delayedFlight: 'KQ 101 · Delayed 45m' })).toMatchObject({ reason: 'delayed', detail: 'KQ 101 · Delayed 45m' });

    expect(tripHealth(trip({ events: [event(minutes(5))] }), NOW).reason).toBe('in-progress');
    expect(tripHealth(trip({ events: [event(minutes(-90), true), event(minutes(120))] }), NOW)).toMatchObject({ level: 'ok', reason: 'upcoming' });
    expect(tripHealth(trip({ events: [event(minutes(-90), true)] }), NOW).reason).toBe('done');
    expect(tripHealth(trip({}), NOW)).toMatchObject({ level: 'idle', reason: 'quiet' });
  });

  it('flags a trip still Planned after its start day, or still Active a day after its end', () => {
    expect(tripHealth(trip({ status: 'Planned', startDate: '2026-10-25T00:00:00.000Z' }), NOW).reason).toBe('not-started');
    expect(tripHealth(trip({ status: 'Planned', startDate: '2026-10-27T00:00:00.000Z' }), NOW).reason).toBe('quiet');
    expect(tripHealth(trip({ endDate: '2026-10-05T00:00:00.000Z' }), NOW).reason).toBe('overrun');
    // Ended yesterday: a day's grace to close it.
    expect(tripHealth(trip({ endDate: '2026-10-26T12:00:00.000Z' }), NOW).reason).toBe('quiet');
  });

  it('sorts problems first, then by what comes next', () => {
    const rows = [
      trip({ reference: 'QUIET' }),
      trip({ reference: 'LATER', events: [event(minutes(300))] }),
      trip({ reference: 'LATE', events: [event(minutes(-60))] }),
      trip({ reference: 'SOONER', events: [event(minutes(120))] }),
    ].map((t) => ({ trip: t, health: tripHealth(t, NOW) }));

    expect(rows.sort(compareTrips).map((r) => r.trip.reference)).toEqual(['LATE', 'SOONER', 'LATER', 'QUIET']);
  });

  it('asks for trips that ended but are still Active to be closed, in one line', () => {
    const ended = [trip({ endDate: '2026-10-05T00:00:00.000Z' }), trip({ endDate: '2026-10-04T00:00:00.000Z' })];
    const items = buildAttention({ trips: { active: 2, startingSoon: 0, trips: ended, escalations: [] } }, NOW);
    expect(items.map((i) => i.title)).toEqual(['2 trips have ended but are still Active']);
  });
});
