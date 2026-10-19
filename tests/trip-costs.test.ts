import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: {} }));

const { requireRequestAuth, recordAuditEvent, enforceRateLimit, createTrip, updateTripItem } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  recordAuditEvent: vi.fn(),
  enforceRateLimit: vi.fn(),
  createTrip: vi.fn(),
  updateTripItem: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({
  requireRequestAuth,
  // Module access has its own tests (request-auth-module); these cover the route itself.
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));
// The real cost rules, with only the database writes stubbed.
vi.mock('../lib/trips', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/trips')>()),
  createTrip,
  updateTripItem,
}));

import { PATCH } from '../app/api/trips/[tripId]/items/[itemId]/route';
import { POST } from '../app/api/trips/route';
import { canSeeTripCosts, tripForViewer } from '../lib/trip-costs';
import type { TripDetail } from '../lib/trips';
import type { AccessUser } from '../lib/user';

function person(opts: { admin?: boolean; modules?: string[] } = {}): AccessUser {
  return {
    id: 12,
    email: 'p@example.test',
    name: 'P',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    sessionVersion: 1,
    roles: opts.admin ? [{ id: 1, name: 'admin', description: '' }] : [{ id: 3, name: 'viewer', description: '' }],
    permissions: [],
    modules: (opts.modules ?? []).map((slug, i) => ({ id: i + 1, slug, name: slug, description: '', category: 'X', sortOrder: i })),
  };
}

const plannerOnly = person({ modules: ['trip-planning'] });
const withQuotes = person({ modules: ['trip-planning', 'quotes'] });

const trip = {
  id: 1,
  reference: 'TR-1',
  trackingCode: 'LA-1',
  items: [
    { id: 2, description: 'Hotel', unitPrice: 250 },
    { id: 3, description: 'Transfer', unitPrice: 40 },
  ],
} as unknown as TripDetail;

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue({ allowed: true });
  createTrip.mockResolvedValue(trip);
  updateTripItem.mockResolvedValue(trip);
});

describe('who sees trip costs', () => {
  it('admins and people with Quotes see costs; trip planners alone do not', () => {
    expect(canSeeTripCosts(person({ admin: true }))).toBe(true);
    expect(canSeeTripCosts(withQuotes)).toBe(true);
    expect(canSeeTripCosts(plannerOnly)).toBe(false);
  });

  it('strips every item cost and says so, leaving the rest of the trip alone', () => {
    const seen = tripForViewer(trip, plannerOnly);
    expect(seen.costsHidden).toBe(true);
    expect(seen.items.map((i) => i.unitPrice)).toEqual([null, null]);
    expect(seen.items.map((i) => i.description)).toEqual(['Hotel', 'Transfer']);
    // The original is untouched, so nothing leaks back into shared state.
    expect(trip.items[0]!.unitPrice).toBe(250);

    expect(tripForViewer(trip, withQuotes).items.map((i) => i.unitPrice)).toEqual([250, 40]);
  });
});

describe('trip routes', () => {
  const patch = (body: unknown) =>
    PATCH(new NextRequest('http://x/api/trips/1/items/2', { method: 'PATCH', body: JSON.stringify(body) }), {
      params: Promise.resolve({ tripId: '1', itemId: '2' }),
    });

  it('never returns costs to a trip planner without Quotes', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: plannerOnly }, response: null });
    const body = await (await patch({ description: 'Hotel' })).json();
    expect(body.trip.items.map((i: { unitPrice: number | null }) => i.unitPrice)).toEqual([null, null]);
    expect(body.trip.costsHidden).toBe(true);
  });

  it('ignores a cost sent by a trip planner without Quotes, so saving never clears it', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: plannerOnly }, response: null });
    await patch({ description: 'Hotel', unitPrice: 1 });
    expect(updateTripItem.mock.calls[0]![0].input.unitPrice).toBeUndefined();

    requireRequestAuth.mockResolvedValue({ auth: { user: withQuotes }, response: null });
    await patch({ description: 'Hotel', unitPrice: 300 });
    expect(updateTripItem.mock.calls[1]![0].input.unitPrice).toBe(300);
  });

  it('creates manual trips without costs for a trip planner without Quotes', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: plannerOnly }, response: null });
    const res = await POST(
      new NextRequest('http://x/api/trips', {
        method: 'POST',
        body: JSON.stringify({ customerId: 1, travelers: [{ travelerId: 4 }], title: 'Visit', currency: 'USD', items: [{ description: 'Hotel', quantity: 1, unitPrice: 200 }] }),
      }),
    );
    expect(res.status).toBe(201);
    expect(createTrip.mock.calls[0]![0].items[0].unitPrice).toBeNull();
  });
});
