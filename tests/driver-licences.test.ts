import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, syncPersonnelResources } = vi.hoisted(() => ({
  db: {
    driverLicense: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    personnel: { findUnique: vi.fn() },
  },
  syncPersonnelResources: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/personnel-sync', () => ({ syncPersonnelResources }));

import { createDriverLicense, deleteDriverLicense, updateDriverLicense } from '../lib/drivers';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  driverName: 'Peter Driver',
  personnelId: 3,
  licenseNumber: 'DL-001',
  category: 'Class A',
  expiryDate: new Date('2027-01-01T00:00:00.000Z'),
  lastVerified: null,
  notes: null,
  documentName: null,
  documentMime: null,
  documentSize: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  ...overrides,
});

describe('driving licences and the person who holds them', () => {
  beforeEach(() => {
    for (const delegate of Object.values(db)) for (const fn of Object.values(delegate)) fn.mockReset();
    syncPersonnelResources.mockReset();
  });

  it("a new licence on a person updates their Task Assignment driver row", async () => {
    db.driverLicense.create.mockResolvedValue(row());

    await createDriverLicense({
      userId: 1,
      driverName: 'Peter Driver',
      personnelId: 3,
      licenseNumber: 'DL-001',
      category: 'Class A',
      expiryDate: new Date('2027-01-01'),
    });

    expect(syncPersonnelResources).toHaveBeenCalledWith(3);
  });

  it('a licence with no person to sync leaves the mirrors alone', async () => {
    db.driverLicense.create.mockResolvedValue(row({ personnelId: null }));

    await createDriverLicense({ userId: 1, driverName: 'Someone', licenseNumber: 'DL-002', category: 'Class B', expiryDate: new Date('2027-01-01') });

    expect(syncPersonnelResources).not.toHaveBeenCalled();
  });

  it('linking an orphaned licence to a driver takes their name and syncs them', async () => {
    db.driverLicense.findUnique.mockResolvedValue({ id: 5, personnelId: null });
    db.personnel.findUnique.mockResolvedValue({ name: 'Peter Driver' });
    db.driverLicense.update.mockResolvedValue(row());

    const result = await updateDriverLicense(5, { personnelId: 3 });

    expect(db.driverLicense.update.mock.calls[0]![0].data).toEqual({ personnelId: 3, driverName: 'Peter Driver' });
    expect(result?.driverName).toBe('Peter Driver');
    expect(syncPersonnelResources).toHaveBeenCalledTimes(1);
    expect(syncPersonnelResources).toHaveBeenCalledWith(3);
  });

  it('refuses to link to a person who does not exist', async () => {
    db.driverLicense.findUnique.mockResolvedValue({ id: 5, personnelId: null });
    db.personnel.findUnique.mockResolvedValue(null);

    expect(await updateDriverLicense(5, { personnelId: 99 })).toBeNull();
    expect(db.driverLicense.update).not.toHaveBeenCalled();
  });

  it('moving a licence between people syncs both of them', async () => {
    db.driverLicense.findUnique.mockResolvedValue({ id: 5, personnelId: 3 });
    db.personnel.findUnique.mockResolvedValue({ name: 'Amina Driver' });
    db.driverLicense.update.mockResolvedValue(row({ personnelId: 4, driverName: 'Amina Driver' }));

    await updateDriverLicense(5, { personnelId: 4 });

    expect(syncPersonnelResources.mock.calls.map(([id]) => id)).toEqual([3, 4]);
  });

  it('deleting a licence syncs the person who held it', async () => {
    db.driverLicense.findUnique.mockResolvedValue({ id: 5, personnelId: 3 });

    expect(await deleteDriverLicense(5)).toBe(true);
    expect(db.driverLicense.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(syncPersonnelResources).toHaveBeenCalledWith(3);
  });
});
