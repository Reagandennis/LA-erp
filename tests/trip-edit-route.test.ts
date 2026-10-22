import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: {} }));

const { requireRequestAuth, recordAuditEvent, getTripForUser, updateTrip } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  recordAuditEvent: vi.fn(),
  getTripForUser: vi.fn(),
  updateTrip: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({
  requireRequestAuth,
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/trips', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/trips')>()),
  getTripForUser,
  updateTrip,
}));

import { PATCH } from '../app/api/trips/[tripId]/route';
import type { TripDetail } from '../lib/trips';
import type { AccessUser } from '../lib/user';

const planner: AccessUser = {
  id: 12,
  email: 'p@example.test',
  name: 'P',
  status: 'active',
  createdAt: '',
  updatedAt: '',
  sessionVersion: 1,
  roles: [{ id: 3, name: 'viewer', description: '' }],
  permissions: [],
  modules: [{ id: 1, slug: 'trip-planning', name: 'Trip planning', description: '', category: 'X', sortOrder: 0 }],
};

const trip = (status: string) =>
  ({
    id: 1,
    reference: 'TR-1',
    trackingCode: 'LA-1',
    status,
    items: [],
    travelers: [
      { id: 11, name: 'Lead Person', isPrimary: true },
      { id: 13, name: 'New Guest', isPrimary: false },
    ],
  }) as unknown as TripDetail;

const patch = (body: unknown) =>
  PATCH(new NextRequest('http://x/api/trips/1', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ tripId: '1' }),
  });

const actions = () => recordAuditEvent.mock.calls.map(([event]) => event.action);

beforeEach(() => {
  vi.clearAllMocks();
  requireRequestAuth.mockResolvedValue({ auth: { user: planner }, response: null });
  getTripForUser.mockResolvedValue(trip('Draft'));
});

describe('editing a trip', () => {
  it('passes a new traveller list through and logs who is on the trip by id', async () => {
    updateTrip.mockResolvedValue(trip('Draft'));
    const travelers = [{ travelerId: 11 }, { name: 'New Guest' }];

    const response = await patch({ title: 'Renamed', travelers });

    expect(response.status).toBe(200);
    expect(updateTrip.mock.calls[0]![0].input).toMatchObject({ title: 'Renamed', travelers });
    expect(actions()).toEqual(['trip.updated']);
    const metadata = recordAuditEvent.mock.calls[0]![0].metadata;
    expect(metadata.travelerIds).toEqual([11, 13]);
    expect(JSON.stringify(metadata)).not.toContain('Lead Person');
  });

  it('logs a status change and the other edits made with it', async () => {
    updateTrip.mockResolvedValue(trip('Planned'));

    await patch({ status: 'Planned', title: 'Renamed' });

    expect(actions()).toEqual(['trip.status.changed', 'trip.updated']);
  });

  it('logs a status change on its own as just that', async () => {
    updateTrip.mockResolvedValue(trip('Planned'));

    await patch({ status: 'Planned' });

    expect(actions()).toEqual(['trip.status.changed']);
  });

  it('refuses to empty the trip of travellers', async () => {
    const response = await patch({ travelers: [] });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('Keep at least one traveller');
    expect(updateTrip).not.toHaveBeenCalled();
  });
});
