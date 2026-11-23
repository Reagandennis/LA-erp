import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: {} }));
vi.mock('../lib/attachment-types', () => ({ isPreviewableImage: () => false }));

import { buildAccessFilter, canEditTrip, isTeamTrip } from '../lib/trips';

const trip = (createdById: number, ownerId: number | null, status = 'Planned') => ({ createdById, ownerId, status });

describe('trips and groups', () => {
  it('lets an admin see everything, and others their own or a group-mate’s trips', () => {
    expect(buildAccessFilter(5, true)).toEqual({});
    const team = { groupMemberships: { some: { group: { members: { some: { userId: 5 } } } } } };
    expect(buildAccessFilter(5, false)).toEqual({ OR: [{ createdById: 5 }, { ownerId: 5 }, { createdBy: team }, { owner: team }] });
  });

  it('counts a trip created or owned by a group-mate as the team’s', () => {
    const peers = new Set([5, 8]);
    expect(isTeamTrip(trip(8, null), 5, peers)).toBe(true);
    expect(isTeamTrip(trip(9, 8), 5, peers)).toBe(true);
    expect(isTeamTrip(trip(9, 10), 5, peers)).toBe(false);
    // Without group information only the person's own trips count.
    expect(isTeamTrip(trip(8, null), 5)).toBe(false);
    expect(isTeamTrip(trip(5, null), 5)).toBe(true);
  });

  it('lets a group-mate edit a live trip, but not a completed or cancelled one', () => {
    const peers = new Set([5, 8]);
    expect(canEditTrip(trip(8, null, 'Planned'), 5, false, peers)).toBe(true);
    expect(canEditTrip(trip(8, null, 'Active'), 5, false, peers)).toBe(true);
    expect(canEditTrip(trip(8, 8, 'Completed'), 5, false, peers)).toBe(false);
    expect(canEditTrip(trip(8, 5, 'Completed'), 5, false, peers)).toBe(true);
    expect(canEditTrip(trip(8, null, 'Cancelled'), 5, false, peers)).toBe(false);
    expect(canEditTrip(trip(9, null, 'Planned'), 5, false, peers)).toBe(false);
  });
});
