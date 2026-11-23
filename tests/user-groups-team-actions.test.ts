import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tripFindUnique, tripDelete, logFindUnique, logDelete, handoverFindUnique } = vi.hoisted(() => ({
  tripFindUnique: vi.fn(),
  tripDelete: vi.fn(),
  logFindUnique: vi.fn(),
  logDelete: vi.fn(),
  handoverFindUnique: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    trip: { findUnique: tripFindUnique, delete: tripDelete },
    tripLogEntry: { findUnique: logFindUnique, delete: logDelete },
    handoverEntry: { findUnique: handoverFindUnique },
  },
}));
vi.mock('../lib/attachment-types', () => ({ isPreviewableImage: () => false }));
// Users 5 and 8 share a group; 9 is in none.
vi.mock('../lib/user-groups', () => ({
  groupPeerIds: async (userId: number) => new Set(userId === 5 || userId === 8 ? [5, 8] : [userId]),
  inGroupWith: () => ({}),
}));

import { canManageHandover } from '../lib/handover';
import { deleteTripLogEntry } from '../lib/trip-log';
import { deleteTrip } from '../lib/trips';

beforeEach(() => vi.clearAllMocks());

describe('what group-mates may do with each other’s records', () => {
  it('lets a group-mate of the creator delete a draft trip, and nobody else', async () => {
    tripFindUnique.mockResolvedValue({ id: 1, status: 'Draft', createdById: 8, ownerId: null });
    expect(await deleteTrip({ id: 1, userId: 5, isAdmin: false })).toBe(true);
    expect(tripDelete).toHaveBeenCalledTimes(1);
    expect(await deleteTrip({ id: 1, userId: 9, isAdmin: false })).toMatchObject({ status: 403 });
    expect(await deleteTrip({ id: 1, userId: 9, isAdmin: true })).toBe(true);
  });

  it('still refuses to delete a trip that is under way', async () => {
    tripFindUnique.mockResolvedValue({ id: 1, status: 'Active', createdById: 8, ownerId: null });
    expect(await deleteTrip({ id: 1, userId: 5, isAdmin: false })).toMatchObject({ status: 400 });
    expect(tripDelete).not.toHaveBeenCalled();
  });

  it('lets a group-mate remove a trip log entry, but not an imported one', async () => {
    tripFindUnique.mockResolvedValue({ createdById: 8, ownerId: null });
    logFindUnique.mockResolvedValue({ tripId: 1, createdById: 8 });
    expect(await deleteTripLogEntry({ tripId: 1, entryId: 3, userId: 5, isAdmin: false })).toBe('deleted');
    logFindUnique.mockResolvedValue({ tripId: 1, createdById: 9 });
    expect(await deleteTripLogEntry({ tripId: 1, entryId: 3, userId: 5, isAdmin: false })).toBe('forbidden');
    logFindUnique.mockResolvedValue({ tripId: 1, createdById: null });
    expect(await deleteTripLogEntry({ tripId: 1, entryId: 3, userId: 5, isAdmin: false })).toBe('forbidden');
    expect(await deleteTripLogEntry({ tripId: 1, entryId: 3, userId: 9, isAdmin: true })).toBe('deleted');
  });

  it('lets the author and their group-mates manage a handover', async () => {
    handoverFindUnique.mockResolvedValue({ createdById: 8 });
    expect(await canManageHandover(1, 8)).toBe(true);
    expect(await canManageHandover(1, 5)).toBe(true);
    expect(await canManageHandover(1, 9)).toBe(false);
    handoverFindUnique.mockResolvedValue(null);
    expect(await canManageHandover(1, 5)).toBeNull();
  });
});
