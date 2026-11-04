import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, syncPersonnelResources } = vi.hoisted(() => ({
  db: { personnel: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() } },
  syncPersonnelResources: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/personnel-sync', () => ({ syncPersonnelResources }));

import { createPersonnel, updatePersonnel } from '../lib/personnel';

/** A saved row, complete enough to serialise. */
const saved = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Peter Driver',
  email: null,
  phone: null,
  role: null,
  department: 'Operations',
  status: 'Active',
  location: null,
  manager: null,
  joinDate: null,
  skills: [],
  roles: ['Driver'],
  engagement: 'Employee',
  supplierName: null,
  callSign: null,
  grade: null,
  licenses: [],
  photoName: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  user: null,
  driverProfile: null,
  officerProfile: null,
  notes: null,
  ...overrides,
});

describe('drivers belong to Operations', () => {
  beforeEach(() => {
    for (const fn of Object.values(db.personnel)) fn.mockReset();
    db.personnel.create.mockResolvedValue(saved());
    db.personnel.update.mockResolvedValue(saved());
    // Re-read after the write: whatever was saved.
    db.personnel.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select && 'roles' in args.select && Object.keys(args.select).length === 2 ? { id: 1, roles: ['Driver'] } : saved(),
    );
  });

  it('puts a new driver in Operations whatever department was sent', async () => {
    await createPersonnel({ createdById: 9, name: 'Peter Driver', roles: ['Driver'], department: 'Finance' });
    expect(db.personnel.create.mock.calls[0]![0].data).toMatchObject({ roles: ['Driver'], department: 'Operations' });
  });

  it('leaves everyone else their department', async () => {
    await createPersonnel({ createdById: 9, name: 'Faith Finance', roles: ['CPO'], department: 'Finance' });
    expect(db.personnel.create.mock.calls[0]![0].data).toMatchObject({ roles: ['CPO'], department: 'Finance' });
  });

  it('keeps a driver in Operations when their department is edited', async () => {
    await updatePersonnel(1, { department: 'Sales' });
    expect(db.personnel.update.mock.calls[0]![0].data).toMatchObject({ department: 'Operations' });
  });

  it('moves someone to Operations when the Driver role is added', async () => {
    db.personnel.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select && 'roles' in args.select && Object.keys(args.select).length === 2 ? { id: 1, roles: [] } : saved(),
    );
    await updatePersonnel(1, { roles: ['Driver', 'CPO'] });
    expect(db.personnel.update.mock.calls[0]![0].data).toMatchObject({ roles: ['Driver', 'CPO'], department: 'Operations' });
  });

  it('does not touch the department of a non-driver edit that leaves it alone', async () => {
    db.personnel.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) =>
      args.select && 'roles' in args.select && Object.keys(args.select).length === 2 ? { id: 1, roles: ['CPO'] } : saved({ roles: ['CPO'], department: 'Security' }),
    );
    await updatePersonnel(1, { phone: '0700' });
    expect(db.personnel.update.mock.calls[0]![0].data).not.toHaveProperty('department');
  });
});
