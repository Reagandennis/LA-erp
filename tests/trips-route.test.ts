import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireRequestAuth,
  listTripsForUser,
  createTrip,
  recordAuditEvent,
  enforceRateLimit,
} = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  listTripsForUser: vi.fn(),
  createTrip: vi.fn(),
  recordAuditEvent: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({ requireRequestAuth }));
vi.mock('../lib/trips', () => ({
  listTripsForUser,
  createTrip,
}));
vi.mock('../lib/trip-costs', () => ({
  canSeeTripCosts: () => true,
  tripForViewer: (trip: unknown) => trip,
}));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));
vi.mock('../lib/user', () => ({
  userHasRole: () => false,
}));

import { GET, POST } from '../app/api/trips/route';

describe('trips collection route', () => {
  beforeEach(() => {
    requireRequestAuth.mockReset();
    listTripsForUser.mockReset();
    createTrip.mockReset();
    recordAuditEvent.mockReset();
    enforceRateLimit.mockReset();
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 30, retryAfterSeconds: 0 });
  });

  it('rejects unauthenticated GET', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const r = await GET(new NextRequest('http://localhost/api/trips'));
    expect(r.status).toBe(401);
    expect(listTripsForUser).not.toHaveBeenCalled();
  });

  it('lists trips scoped to the user', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 5, roles: [] } },
      response: null,
    });
    listTripsForUser.mockResolvedValue([{ id: 1, reference: 'TR-2026-0001' }]);

    const r = await GET(new NextRequest('http://localhost/api/trips'));
    expect(r.status).toBe(200);
    const payload = await r.json();
    expect(payload.trips).toHaveLength(1);
    expect(listTripsForUser).toHaveBeenCalledWith({ userId: 5, isAdmin: false });
  });

  it('creates a trip with audit and 201', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 12, roles: [] } },
      response: null,
    });
    createTrip.mockResolvedValue({
      id: 99,
      reference: 'TR-2026-0099',
      trackingCode: 'LA-2026-0099',
      items: [],
    });

    const body = {
      customerId: 1,
      title: 'Site visit',
      startDate: '2026-06-01',
      endDate: '2026-06-05',
      currency: 'USD',
      items: [{ description: 'Hotel', quantity: 1, unitPrice: 200 }],
    };
    const req = new NextRequest('http://localhost/api/trips', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const r = await POST(req);

    expect(r.status).toBe(201);
    expect(createTrip).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 1, createdById: 12, title: 'Site visit' }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'trip.created',
        entityId: '99',
        metadata: expect.objectContaining({ trackingCode: 'LA-2026-0099' }),
      }),
    );
  });

  it('rejects invalid POST payloads with 400', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 1, roles: [] } },
      response: null,
    });

    const req = new NextRequest('http://localhost/api/trips', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const r = await POST(req);
    expect(r.status).toBe(400);
    expect(createTrip).not.toHaveBeenCalled();
  });

  it('returns 429 when rate-limited', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 1, roles: [] } },
      response: null,
    });
    enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });

    const req = new NextRequest('http://localhost/api/trips', {
      method: 'POST',
      body: JSON.stringify({
        customerId: 1,
        title: 'X',
        items: [{ description: 'a', quantity: 1, unitPrice: 0 }],
      }),
    });
    const r = await POST(req);
    expect(r.status).toBe(429);
    expect(createTrip).not.toHaveBeenCalled();
  });
});
