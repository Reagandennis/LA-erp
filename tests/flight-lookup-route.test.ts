import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRequestAuth, lookupFlights, enforceRateLimit } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  lookupFlights: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/request-auth', () => ({
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));
vi.mock('../lib/flight-lookup', async (importOriginal) => ({ ...(await importOriginal<object>()), lookupFlights }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));

import { GET } from '../app/api/flight-radar/lookup/route';
import { FlightTrackingError } from '../lib/flight-tracking';

const get = (query: string) => GET(new NextRequest(`http://localhost/api/flight-radar/lookup?${query}`));

describe('flight lookup route', () => {
  beforeEach(() => {
    requireRequestAuth.mockReset();
    lookupFlights.mockReset();
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 });
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 3, roles: [] } }, response: null });
  });

  it('rejects the unauthenticated', async () => {
    requireRequestAuth.mockResolvedValue({ auth: null, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) });
    expect((await get('q=KQ100')).status).toBe(401);
    expect(lookupFlights).not.toHaveBeenCalled();
  });

  it('needs something that could be a flight or a tail number', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('q=K')).status).toBe(400);
    expect(lookupFlights).not.toHaveBeenCalled();
  });

  it('answers with what FR24 has flown', async () => {
    lookupFlights.mockResolvedValue({ query: { kind: 'flight', value: 'KQ100' }, candidates: [{ flightNumber: 'KQ100' }], checkedAt: 'now' });
    const r = await get('q=kq%20100');
    expect(r.status).toBe(200);
    expect((await r.json()).lookup.candidates[0].flightNumber).toBe('KQ100');
    expect(lookupFlights).toHaveBeenCalledWith('kq 100');
  });

  it('passes FR24 trouble on with its status, and holds back a busy user', async () => {
    lookupFlights.mockRejectedValue(new FlightTrackingError('FlightRadar24 rate limit reached. Try again shortly.', 429));
    expect((await get('q=KQ100')).status).toBe(429);

    enforceRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    lookupFlights.mockReset();
    expect((await get('q=KQ100')).status).toBe(429);
    expect(lookupFlights).not.toHaveBeenCalled();
  });
});
