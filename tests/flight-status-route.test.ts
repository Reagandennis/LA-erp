import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRequestAuth, lookupFlightTrack, enforceRateLimit, FlightTrackingError } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  lookupFlightTrack: vi.fn(),
  enforceRateLimit: vi.fn(),
  FlightTrackingError: class FlightTrackingError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

vi.mock('../lib/request-auth', () => ({
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));
vi.mock('../lib/flight-tracking', () => ({ lookupFlightTrack, FlightTrackingError }));
vi.mock('../lib/rate-limit', () => ({ enforceRateLimit }));

import { GET } from '../app/api/flight-radar/status/route';

const get = (query: string) => GET(new NextRequest(`http://localhost/api/flight-radar/status?${query}`));

describe('flight status route', () => {
  beforeEach(() => {
    requireRequestAuth.mockReset();
    lookupFlightTrack.mockReset();
    enforceRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 3, roles: [] } }, response: null });
  });

  it('rejects the unauthenticated', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });
    expect((await get('flight=KQ100&departure=2026-10-18T06:15:00Z')).status).toBe(401);
    expect(lookupFlightTrack).not.toHaveBeenCalled();
  });

  it('needs a real flight number and a time', async () => {
    expect((await get('flight=K&departure=2026-10-18T06:15:00Z')).status).toBe(400);
    expect((await get('flight=KQ100')).status).toBe(400);
    expect(lookupFlightTrack).not.toHaveBeenCalled();
  });

  it('looks up the normalised flight against its schedule', async () => {
    lookupFlightTrack.mockResolvedValue({ found: true, takeoffAt: '2026-10-18T06:32:00Z' });
    const r = await get('flight=kq%20100&departure=2026-10-18T06:15:00Z&arrival=2026-10-18T15:00:00Z');
    expect(r.status).toBe(200);
    expect((await r.json()).track.takeoffAt).toBe('2026-10-18T06:32:00Z');
    expect(lookupFlightTrack).toHaveBeenCalledWith({
      flightNumber: 'KQ100',
      departure: new Date('2026-10-18T06:15:00Z'),
      arrival: new Date('2026-10-18T15:00:00Z'),
    });
  });

  it('passes FlightRadar24 trouble through with its status', async () => {
    lookupFlightTrack.mockRejectedValue(new FlightTrackingError('FlightRadar24 rate limit reached. Try again shortly.', 429));
    const r = await get('flight=KQ100&arrival=2026-10-18T15:00:00Z');
    expect(r.status).toBe(429);
  });
});
