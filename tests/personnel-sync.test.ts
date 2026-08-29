import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  personnelFindUnique,
  driverCreate,
  driverUpdate,
  officerCreate,
  officerUpdate,
  licenceUpdateMany,
  transaction,
} = vi.hoisted(() => ({
  personnelFindUnique: vi.fn(),
  driverCreate: vi.fn(),
  driverUpdate: vi.fn(),
  officerCreate: vi.fn(),
  officerUpdate: vi.fn(),
  licenceUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    personnel: { findUnique: personnelFindUnique },
    driver: { create: driverCreate, update: driverUpdate, findMany: vi.fn() },
    officer: { create: officerCreate, update: officerUpdate, findMany: vi.fn() },
    driverLicense: { updateMany: licenceUpdateMany, findMany: vi.fn() },
    $transaction: transaction,
  },
}));

import { syncPersonnelResources } from '../lib/personnel-sync';

type PersonOverrides = Partial<{
  roles: string[];
  status: string;
  name: string;
  phone: string | null;
  callSign: string | null;
  grade: string | null;
  driverProfile: { id: number; status: string; licenseNumber: string | null } | null;
  officerProfile: { id: number; status: string } | null;
  licenses: { licenseNumber: string }[];
}>;

function person(overrides: PersonOverrides = {}) {
  return {
    id: 1,
    name: 'Jane Doe',
    phone: '+254700000000',
    roles: [],
    status: 'Active',
    callSign: null,
    grade: null,
    createdById: 9,
    driverProfile: null,
    officerProfile: null,
    licenses: [],
    ...overrides,
  };
}

/** The args passed to a mocked delegate call, which the transaction receives. */
function callArgs(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls[0]?.[0];
}

describe('syncPersonnelResources', () => {
  beforeEach(() => {
    [
      personnelFindUnique, driverCreate, driverUpdate,
      officerCreate, officerUpdate, licenceUpdateMany, transaction,
    ].forEach((m) => m.mockReset());
    transaction.mockResolvedValue([]);
    // The delegates return placeholder promises; we assert on the args.
    [driverCreate, driverUpdate, officerCreate, officerUpdate, licenceUpdateMany]
      .forEach((m) => m.mockReturnValue(Promise.resolve()));
  });

  it('does nothing when the person no longer exists', async () => {
    personnelFindUnique.mockResolvedValue(null);
    await syncPersonnelResources(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('creates a driver mirror when the person gains the Driver role', async () => {
    personnelFindUnique.mockResolvedValue(person({ roles: ['Driver'] }));
    await syncPersonnelResources(1);

    expect(driverCreate).toHaveBeenCalledTimes(1);
    expect(callArgs(driverCreate).data).toMatchObject({
      name: 'Jane Doe',
      personnelId: 1,
      status: 'Available',
      createdById: 9,
    });
    expect(officerCreate).not.toHaveBeenCalled();
  });

  it('creates both mirrors for a person who is a CPO and a Driver, using the compound grade', async () => {
    personnelFindUnique.mockResolvedValue(person({ roles: ['CPO', 'Driver'], grade: 'CPO' }));
    await syncPersonnelResources(1);

    expect(driverCreate).toHaveBeenCalledTimes(1);
    expect(officerCreate).toHaveBeenCalledTimes(1);
    // The legacy task-assignment UI reads `grade`; 'Driver/CPO' is exactly what
    // that compound value was invented to mean.
    expect(callArgs(officerCreate).data.grade).toBe('Driver/CPO');
  });

  it('retires rather than deletes a mirror when the role is removed', async () => {
    personnelFindUnique.mockResolvedValue(
      person({ roles: [], driverProfile: { id: 5, status: 'Available', licenseNumber: null } }),
    );
    await syncPersonnelResources(1);

    // Deleting would strand TripAssignment.driverId, which is onDelete: SetNull.
    expect(driverUpdate).toHaveBeenCalledTimes(1);
    expect(callArgs(driverUpdate).where).toEqual({ id: 5 });
    expect(callArgs(driverUpdate).data.status).toBe('Off duty');
    expect(callArgs(driverUpdate).data.retiredAt).toBeInstanceOf(Date);
  });

  it('never touches a mirror the assignment engine has committed to a trip', async () => {
    personnelFindUnique.mockResolvedValue(
      person({ roles: [], driverProfile: { id: 5, status: 'Assigned', licenseNumber: null } }),
    );
    await syncPersonnelResources(1);

    expect(driverUpdate).not.toHaveBeenCalled();
  });

  it('does not clobber an Assigned status when the person is edited', async () => {
    personnelFindUnique.mockResolvedValue(
      person({ roles: ['Driver'], driverProfile: { id: 5, status: 'Assigned', licenseNumber: 'AB123' } }),
    );
    await syncPersonnelResources(1);

    expect(driverUpdate).toHaveBeenCalledTimes(1);
    expect(callArgs(driverUpdate).data).not.toHaveProperty('status');
    expect(callArgs(driverUpdate).data.retiredAt).toBeNull();
  });

  it('maps On Leave and Terminated to Off duty', async () => {
    personnelFindUnique.mockResolvedValue(person({ roles: ['Driver'], status: 'On Leave' }));
    await syncPersonnelResources(1);
    expect(callArgs(driverCreate).data.status).toBe('Off duty');
  });

  it('fills a blank licence number but never overwrites an existing one', async () => {
    personnelFindUnique.mockResolvedValue(
      person({
        roles: ['Driver'],
        driverProfile: { id: 5, status: 'Available', licenseNumber: null },
        licenses: [{ licenseNumber: 'DL-001' }],
      }),
    );
    await syncPersonnelResources(1);
    expect(callArgs(driverUpdate).data.licenseNumber).toBe('DL-001');

    driverUpdate.mockClear();
    personnelFindUnique.mockResolvedValue(
      person({
        roles: ['Driver'],
        // Set independently from the task-assignment module or the AI fleet tools.
        driverProfile: { id: 5, status: 'Available', licenseNumber: 'MANUAL-9' },
        licenses: [{ licenseNumber: 'DL-001' }],
      }),
    );
    await syncPersonnelResources(1);
    expect(callArgs(driverUpdate).data).not.toHaveProperty('licenseNumber');
  });

  it('keeps the denormalised licence holder name in step with the person', async () => {
    personnelFindUnique.mockResolvedValue(person({ roles: ['Driver'], name: 'Jane Roe' }));
    await syncPersonnelResources(1);

    expect(licenceUpdateMany).toHaveBeenCalledWith({
      where: { personnelId: 1, driverName: { not: 'Jane Roe' } },
      data: { driverName: 'Jane Roe' },
    });
  });
});
