import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { db, requireModuleRequest, notifyNotificationsChanged } = vi.hoisted(() => ({
  db: {
    vehicle: { findUnique: vi.fn() },
    vehicleFuelLog: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    vehicleMaintenance: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    vehicleMaintenanceNotification: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
  requireModuleRequest: vi.fn(),
  notifyNotificationsChanged: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/request-auth', () => ({ requireModuleRequest }));
vi.mock('../lib/notification-events', () => ({ notifyNotificationsChanged }));

import { POST as postFuel } from '../app/api/fleet/fuel/route';
import { DELETE as deleteFuel } from '../app/api/fleet/fuel/[id]/route';
import { POST as postMaintenance } from '../app/api/fleet/maintenance/route';
import { PATCH as patchMaintenance } from '../app/api/fleet/maintenance/[id]/route';
import {
  GET as getReminders,
  PATCH as readReminders,
} from '../app/api/fleet/maintenance/notifications/route';
import { dateKeyToDate, localDateKey } from '../lib/fleet';
import { canUseFleetMaintenance, materializeMaintenanceReminders } from '../lib/fleet-reminders';
import { resolveCompletedAt } from '../lib/fleet-server';
import type { AccessUser } from '../lib/user';

const vehicle = { id: 1, registration: 'KDA 123A', make: 'Toyota', model: 'Prado' };
const createdAt = new Date('2026-10-27T08:00:00Z');

const json = (method: string, url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
  requireModuleRequest.mockReset();
  notifyNotificationsChanged.mockReset();
  db.vehicleFuelLog.groupBy.mockResolvedValue([]);
  db.vehicleMaintenance.groupBy.mockResolvedValue([]);
  db.vehicleMaintenance.findMany.mockResolvedValue([]);
  db.vehicleMaintenanceNotification.createMany.mockResolvedValue({ count: 0 });
  db.vehicleMaintenanceNotification.findMany.mockResolvedValue([]);
  requireModuleRequest.mockResolvedValue({ auth: { user: { id: 7 } }, response: null });
  db.vehicle.findUnique.mockResolvedValue({ id: 1 });
  db.vehicleFuelLog.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...data,
    id: 11,
    litres: new Prisma.Decimal(data.litres as number),
    cost: data.cost == null ? null : new Prisma.Decimal(data.cost as number),
    createdAt,
    vehicle,
    createdBy: { id: 7, name: 'Fleet Manager' },
  }));
  const maintenanceRow = async ({ data }: { data: Record<string, unknown> }) => ({
    id: 21,
    kind: 'Scheduled',
    category: 'Service',
    title: 'Oil change',
    status: 'Planned',
    scheduledFor: null,
    odometerKm: null,
    currency: 'KES',
    provider: null,
    nextDueAt: null,
    nextDueKm: null,
    reminderDays: null,
    notes: null,
    ...data,
    completedAt: data.completedAt ?? null,
    cost: data.cost == null ? null : new Prisma.Decimal(data.cost as number),
    createdAt,
    vehicle,
    createdBy: null,
  });
  db.vehicleMaintenance.create.mockImplementation(maintenanceRow);
  db.vehicleMaintenance.update.mockImplementation(maintenanceRow);
});

describe('fleet routes', () => {
  it('gate each submodule on its own grant', async () => {
    const denied = NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    requireModuleRequest.mockResolvedValueOnce({ auth: null, response: denied });
    expect((await postFuel(json('POST', '/api/fleet/fuel', {}))).status).toBe(403);
    expect(requireModuleRequest.mock.calls[0]!.slice(1)).toEqual(['car-fuel']);

    await postMaintenance(json('POST', '/api/fleet/maintenance', {}));
    expect(requireModuleRequest.mock.calls[1]!.slice(1)).toEqual(['car-maintenance']);
  });

  it('logs a fill-up for the signed-in user', async () => {
    const res = await postFuel(
      json('POST', '/api/fleet/fuel', {
        vehicleId: 1,
        filledAt: '2026-10-27T08:00:00Z',
        litres: 42.5,
        cost: 7650,
        currency: 'kes',
        odometerKm: 10_500,
        station: '   ',
      }),
    );
    expect(res.status).toBe(201);
    const { item } = await res.json();
    expect(item).toMatchObject({ litres: 42.5, cost: 7650, currency: 'KES', station: null, fuelType: 'Petrol', fullTank: true });
    expect(db.vehicleFuelLog.create.mock.calls[0]![0].data.createdById).toBe(7);
  });

  it('turns away a fill-up that fails validation or names no real vehicle', async () => {
    const invalid = await postFuel(json('POST', '/api/fleet/fuel', { vehicleId: 1, filledAt: '2026-10-27', litres: -1 }));
    expect(invalid.status).toBe(400);
    expect(db.vehicleFuelLog.create).not.toHaveBeenCalled();

    db.vehicle.findUnique.mockResolvedValueOnce(null);
    const unknown = await postFuel(json('POST', '/api/fleet/fuel', { vehicleId: 99, filledAt: '2026-10-27', litres: 10 }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe('Vehicle not found');
  });

  it('answers 404 for a fill-up that is already gone', async () => {
    db.vehicleFuelLog.deleteMany.mockResolvedValueOnce({ count: 0 });
    expect((await deleteFuel(json('DELETE', '/api/fleet/fuel/5', null), params('5'))).status).toBe(404);
    expect((await deleteFuel(json('DELETE', '/api/fleet/fuel/abc', null), params('abc'))).status).toBe(400);
  });

  it('stamps completed work with today, and clears the date when it is reopened', async () => {
    db.vehicleMaintenance.findUnique.mockResolvedValueOnce({ status: 'Planned', completedAt: null });
    const done = await patchMaintenance(json('PATCH', '/api/fleet/maintenance/21', { status: 'Completed' }), params('21'));
    expect(done.status).toBe(200);
    expect(db.vehicleMaintenance.update.mock.calls[0]![0].data.completedAt).toEqual(dateKeyToDate(localDateKey()));

    db.vehicleMaintenance.findUnique.mockResolvedValueOnce({ status: 'Completed', completedAt: new Date('2026-10-01T00:00:00Z') });
    await patchMaintenance(json('PATCH', '/api/fleet/maintenance/21', { cost: 120 }), params('21'));
    expect(db.vehicleMaintenance.update.mock.calls[1]![0].data.completedAt).toEqual(new Date('2026-10-01T00:00:00Z'));

    db.vehicleMaintenance.findUnique.mockResolvedValueOnce({ status: 'Completed', completedAt: new Date('2026-10-01T00:00:00Z') });
    await patchMaintenance(json('PATCH', '/api/fleet/maintenance/21', { status: 'Planned' }), params('21'));
    expect(db.vehicleMaintenance.update.mock.calls[2]![0].data.completedAt).toBeNull();
  });

  it('reminds of services and inspections unless told otherwise', async () => {
    await postMaintenance(json('POST', '/api/fleet/maintenance', { vehicleId: 1, title: 'Annual', category: 'Inspection' }));
    await postMaintenance(json('POST', '/api/fleet/maintenance', { vehicleId: 1, title: 'Brakes', category: 'Repair', kind: 'Unscheduled' }));
    await postMaintenance(json('POST', '/api/fleet/maintenance', { vehicleId: 1, title: 'Oil', category: 'Service', reminderDays: null }));
    const created = db.vehicleMaintenance.create.mock.calls.map(([arg]) => arg.data);
    expect(created.map((d) => [d.kind, d.reminderDays])).toEqual([
      ['Scheduled', 7],
      ['Unscheduled', null],
      ['Scheduled', null],
    ]);
  });

  it('answers 404 when the maintenance record is missing', async () => {
    db.vehicleMaintenance.findUnique.mockResolvedValueOnce(null);
    const res = await patchMaintenance(json('PATCH', '/api/fleet/maintenance/9', { title: 'Brakes' }), params('9'));
    expect(res.status).toBe(404);
    expect(db.vehicleMaintenance.update).not.toHaveBeenCalled();
  });
});

describe('maintenance reminders in the bell', () => {
  const person = (opts: { admin?: boolean; modules?: string[] }): AccessUser => ({
    id: 7,
    email: 'm@example.test',
    name: 'M',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    sessionVersion: 1,
    roles: opts.admin ? [{ id: 1, name: 'admin', description: '' }] : [{ id: 3, name: 'viewer', description: '' }],
    permissions: [],
    modules: (opts.modules ?? []).map((slug, i) => ({ id: i + 1, slug, name: slug, description: '', category: 'X', sortOrder: i })),
  });

  it('go to whoever can open Car Maintenance', () => {
    expect(canUseFleetMaintenance(person({ modules: ['car-maintenance'] }))).toBe(true);
    expect(canUseFleetMaintenance(person({ modules: ['vehicles', 'car-fuel'] }))).toBe(false);
    expect(canUseFleetMaintenance(person({ admin: true }))).toBe(true);
  });

  it('writes each live reminder for the user once, with the odometer from fuel and maintenance', async () => {
    db.vehicleMaintenance.findMany.mockResolvedValueOnce([
      {
        id: 31,
        category: 'Service',
        title: '10,000 km service',
        status: 'Completed',
        scheduledFor: null,
        completedAt: new Date('2026-05-01T00:00:00Z'),
        nextDueAt: null,
        nextDueKm: 50_000,
        reminderDays: 7,
        vehicle,
      },
    ]);
    db.vehicleFuelLog.groupBy.mockResolvedValueOnce([{ vehicleId: 1, _max: { odometerKm: 49_200 } }]);
    db.vehicleMaintenance.groupBy.mockResolvedValueOnce([{ vehicleId: 1, _max: { odometerKm: 40_000 } }]);
    db.vehicleMaintenanceNotification.createMany.mockResolvedValueOnce({ count: 1 });

    expect(await materializeMaintenanceReminders(7, '2026-10-27')).toBe(1);
    const { data, skipDuplicates } = db.vehicleMaintenanceNotification.createMany.mock.calls[0]![0];
    expect(skipDuplicates).toBe(true);
    expect(data).toEqual([
      {
        userId: 7,
        maintenanceId: 31,
        reminderKey: 'next-km:31:50000:upcoming',
        type: 'fleet.maintenance.upcoming',
        message: 'Service for KDA 123A is due at 50,000 km (last reading 49,200 km) — 10,000 km service',
      },
    ]);
    // Cancelled work never reminds.
    expect(db.vehicleMaintenance.findMany.mock.calls[0]![0].where).toEqual({ status: { not: 'Cancelled' } });
  });

  it('writes nothing when nothing is due', async () => {
    expect(await materializeMaintenanceReminders(7, '2026-10-27')).toBe(0);
    expect(db.vehicleMaintenanceNotification.createMany).not.toHaveBeenCalled();
  });

  it('serves and marks read only behind the Car Maintenance grant', async () => {
    const res = await getReminders(json('GET', '/api/fleet/maintenance/notifications', undefined));
    expect(res.status).toBe(200);
    expect(requireModuleRequest.mock.calls[0]!.slice(1)).toEqual(['car-maintenance']);

    db.vehicleMaintenanceNotification.updateMany.mockResolvedValueOnce({ count: 1 });
    const read = await readReminders(json('PATCH', '/api/fleet/maintenance/notifications', { ids: [5, 5, 'x'] }));
    expect(await read.json()).toEqual({ updated: 1 });
    expect(db.vehicleMaintenanceNotification.updateMany.mock.calls[0]![0].where).toEqual({
      userId: 7,
      id: { in: [5] },
      readAt: null,
    });
    expect(notifyNotificationsChanged).toHaveBeenCalledWith(7);
  });
});

describe('resolveCompletedAt', () => {
  it('keeps a given date, fills today, and drops it for open work', () => {
    expect(resolveCompletedAt('Completed', '2026-10-01', '2026-10-27')).toBe('2026-10-01');
    expect(resolveCompletedAt('Completed', null, '2026-10-27')).toBe('2026-10-27');
    expect(resolveCompletedAt('In progress', '2026-10-01', '2026-10-27')).toBeNull();
  });
});
