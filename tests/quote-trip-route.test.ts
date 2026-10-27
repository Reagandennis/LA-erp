import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireRequestAuth,
  getQuoteForUser,
  createTripFromQuote,
  recordAuditEvent,
  enforceRateLimit,
} = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  getQuoteForUser: vi.fn(),
  createTripFromQuote: vi.fn(),
  recordAuditEvent: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({
  requireRequestAuth,
  // Module access has its own tests (request-auth-module); these cover the route itself.
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));
vi.mock('../lib/quotes', () => ({ getQuoteForUser }));
vi.mock('../lib/trips', () => ({ createTripFromQuote }));
vi.mock('../lib/audit', () => ({ recordAuditEvent }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));
vi.mock('../lib/user', () => ({ userHasRole: () => false }));

import { POST } from '../app/api/quotes/[quoteId]/trip/route';

function makeRequest(body: object = {}) {
  return new NextRequest('http://localhost/api/quotes/42/trip', {
    method: 'POST',
    body: JSON.stringify({ country: 'Kenya', ...body }),
  });
}

const params = Promise.resolve({ quoteId: '42' });

describe('POST /api/quotes/[quoteId]/trip', () => {
  beforeEach(() => {
    requireRequestAuth.mockReset();
    getQuoteForUser.mockReset();
    createTripFromQuote.mockReset();
    recordAuditEvent.mockReset();
    enforceRateLimit.mockReset();
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 30, retryAfterSeconds: 0 });
  });

  it('rejects unauthenticated', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const r = await POST(makeRequest(), { params });
    expect(r.status).toBe(401);
  });

  it('returns 404 if user is not a participant on the quote', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7, roles: [] } },
      response: null,
    });
    getQuoteForUser.mockResolvedValue(null);

    const r = await POST(makeRequest(), { params });
    expect(r.status).toBe(404);
    expect(createTripFromQuote).not.toHaveBeenCalled();
  });

  it('rejects when the quote is not Approved', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7, roles: [] } },
      response: null,
    });
    getQuoteForUser.mockResolvedValue({ id: 42, status: 'Submitted', trip: null });
    createTripFromQuote.mockResolvedValue({
      error: 'Only Approved quotes can spawn a trip (current: Submitted)',
      status: 400,
    });

    const r = await POST(makeRequest(), { params });
    expect(r.status).toBe(400);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('returns 409 on a re-spawn after the trip already exists (concurrency guard)', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7, roles: [] } },
      response: null,
    });
    getQuoteForUser.mockResolvedValue({ id: 42, status: 'Approved', trip: null });
    createTripFromQuote.mockResolvedValue({
      error: 'A trip already exists for this quote',
      status: 409,
    });

    const r = await POST(makeRequest({ ownerId: 7 }), { params });
    expect(r.status).toBe(409);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it('creates a trip from an approved quote and writes the audit event', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7, roles: [] } },
      response: null,
    });
    getQuoteForUser.mockResolvedValueOnce({ id: 42, status: 'Approved', trip: null });
    createTripFromQuote.mockResolvedValue({
      trip: {
        id: 9,
        reference: 'TR-2026-0001',
        trackingCode: 'LA-2026-0001',
        items: [{ id: 1 }, { id: 2 }],
      },
      trackingCode: 'LA-2026-0001',
      quoteCustomerId: 1,
      quoteCurrency: 'USD',
    });
    getQuoteForUser.mockResolvedValueOnce({
      id: 42,
      status: 'Approved',
      trip: { id: 9, reference: 'TR-2026-0001', trackingCode: 'LA-2026-0001', status: 'Planned' },
    });

    const r = await POST(makeRequest({ title: 'Site visit', ownerId: 7 }), { params });
    expect(r.status).toBe(201);
    const payload = await r.json();
    expect(payload.trip.id).toBe(9);
    expect(payload.quote.trip.reference).toBe('TR-2026-0001');
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'quote.trip.created',
        metadata: expect.objectContaining({
          tripId: 9,
          quoteId: 42,
          trackingCode: 'LA-2026-0001',
          itemCount: 2,
        }),
      }),
    );
  });

  it('returns 429 when the create-trip rate limit fires', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7, roles: [] } },
      response: null,
    });
    enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });

    const r = await POST(makeRequest(), { params });
    expect(r.status).toBe(429);
    expect(getQuoteForUser).not.toHaveBeenCalled();
  });
});
