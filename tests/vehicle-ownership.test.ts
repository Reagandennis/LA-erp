import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx, transaction } = vi.hoisted(() => {
  const tx = {
    vehicle: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    vendor: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    personnel: { findMany: vi.fn() },
  };
  return { tx, transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)) };
});

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: { $transaction: transaction, ...tx } }));

import { createVehicle, updateVehicle } from '../lib/task-assignment';
import { changeVendorVehicles, updateVendor } from '../lib/vendors';

const row = (extra: Record<string, unknown> = {}) => ({
  id: 30,
  registration: 'UAB 123X',
  make: 'Toyota',
  model: 'Land Cruiser',
  type: 'SUV',
  status: 'Available',
  capacity: null,
  notes: null,
  ownership: null,
  vendor: null,
  photoName: null,
  createdAt: new Date('2026-11-11T00:00:00Z'),
  ...extra,
});

beforeEach(() => {
  for (const delegate of Object.values(tx)) {
    for (const fn of Object.values(delegate)) fn.mockReset();
  }
  tx.vendor.findMany.mockResolvedValue([]);
  tx.vehicle.findMany.mockResolvedValue([]);
  tx.personnel.findMany.mockResolvedValue([]);
});

describe('a vehicle is internal or external', () => {
  it('saves the kind picked when the vehicle is added, and nothing else', async () => {
    tx.vehicle.create.mockImplementation(async ({ data }) => row({ ownership: data.ownership }));

    expect((await createVehicle({ userId: 1, registration: 'UAB 123X', ownership: 'External' })).ownership).toBe('External');
    expect((await createVehicle({ userId: 1, registration: 'UAB 123X', ownership: 'Internal' })).ownership).toBe('Internal');
    // Left out, or anything else, leaves it unclassified rather than guessing.
    expect((await createVehicle({ userId: 1, registration: 'UAB 123X' })).ownership).toBeNull();
    expect((await createVehicle({ userId: 1, registration: 'UAB 123X', ownership: 'Leased' })).ownership).toBeNull();
  });

  it('reads an unexpected stored value as unclassified', async () => {
    tx.vehicle.create.mockResolvedValue(row({ ownership: 'internal ' }));
    expect((await createVehicle({ userId: 1, registration: 'UAB 123X' })).ownership).toBeNull();
  });

  it('takes a vehicle off its vendor when it is saved as the other kind', async () => {
    tx.vehicle.update.mockResolvedValue(row());

    tx.vehicle.findUnique.mockResolvedValue({ id: 30, vendor: { internal: false } });
    await updateVehicle(30, { ownership: 'Internal' });
    expect(tx.vehicle.update.mock.calls[0]![0].data).toEqual({ ownership: 'Internal', vendorId: null });

    // The same kind as its vendor, or no vendor at all, changes only the kind.
    await updateVehicle(30, { ownership: 'External' });
    expect(tx.vehicle.update.mock.calls[1]![0].data).toEqual({ ownership: 'External' });
    tx.vehicle.findUnique.mockResolvedValue({ id: 30, vendor: null });
    await updateVehicle(30, { ownership: 'Internal' });
    expect(tx.vehicle.update.mock.calls[2]![0].data).toEqual({ ownership: 'Internal' });

    // An edit that doesn't mention the kind leaves it, and the vendor, alone.
    await updateVehicle(30, { notes: 'New tyres' });
    expect(tx.vehicle.update.mock.calls[3]![0].data).toEqual({ notes: 'New tyres' });
  });
});

describe('a vendor makes its vehicles its own kind', () => {
  it('marks vehicles tagged to it, and leaves the ones it lets go as they were', async () => {
    tx.vendor.findUnique.mockResolvedValue({ id: 4, internal: true });
    await changeVendorVehicles(4, { add: [30, 31], remove: [32] });

    expect(tx.vehicle.updateMany).toHaveBeenCalledWith({ where: { id: { in: [32] }, vendorId: 4 }, data: { vendorId: null } });
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith({ where: { id: { in: [30, 31] } }, data: { vendorId: 4, ownership: 'Internal' } });
  });

  it('re-marks its vehicles when the vendor itself changes kind', async () => {
    tx.vendor.findUnique.mockResolvedValue({ id: 4, internal: true });

    await updateVendor(4, { internal: false });
    expect(tx.vehicle.updateMany).toHaveBeenCalledWith({ where: { vendorId: 4 }, data: { ownership: 'External' } });

    tx.vehicle.updateMany.mockClear();
    await updateVendor(4, { internal: true, phone: '+256 700 000 000' });
    await updateVendor(4, { status: 'Approved' });
    expect(tx.vehicle.updateMany).not.toHaveBeenCalled();
  });
});
