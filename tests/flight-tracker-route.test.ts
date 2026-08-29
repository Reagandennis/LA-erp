import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRequestAuth } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/request-auth', () => ({ requireRequestAuth }));

import { GET } from '../app/api/flight-tracker/route';

/**
 * /api/flight-tracker proxies OpenSky's states/all for a bounding box.
 * (Live FR24 positions are a separate route, /api/flight-radar.)
 */
const BOUNDS = 'lamin=-1.5&lomin=36.6&lamax=-1.1&lomax=37.1';
const OPENSKY_KEYS = ['OPENSKY_USERNAME', 'OPENSKY_PASSWORD'];

function get(query = '') {
  return new NextRequest(`http://localhost/api/flight-tracker${query ? `?${query}` : ''}`);
}

describe('flight tracker route', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    requireRequestAuth.mockReset();
    for (const k of OPENSKY_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of OPENSKY_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
    vi.restoreAllMocks();
  });

  it('returns the auth response when the request is not authenticated', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const response = await GET(get(BOUNDS));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Not authenticated');
  });

  it('rejects missing or non-numeric bounds without calling OpenSky', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 1 } }, response: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    for (const query of ['', 'lamin=-1.5', `${BOUNDS.replace('lomax=37.1', 'lomax=abc')}`]) {
      const response = await GET(get(query));
      const payload = await response.json();
      expect(response.status).toBe(400);
      expect(payload.error).toBe('Invalid bounds');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies the bounding box to OpenSky and returns the payload verbatim', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 4 } }, response: null });
    const body = { time: 1_700_000_000, states: [['abc123', 'KQA100 ']] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const response = await GET(get(BOUNDS));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(body);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('https://opensky-network.org/api/states/all?');
    expect(url).toContain('lamin=-1.5');
    expect(url).toContain('lomin=36.6');
    expect(url).toContain('lamax=-1.1');
    expect(url).toContain('lomax=37.1');
  });

  it('sends no Authorization header when OpenSky credentials are unset', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 4 } }, response: null });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    await GET(get(BOUNDS));

    const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('uses Basic auth when OpenSky credentials are configured', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 4 } }, response: null });
    process.env.OPENSKY_USERNAME = 'pilot';
    process.env.OPENSKY_PASSWORD = 'secret';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    await GET(get(BOUNDS));

    const init = fetchMock.mock.calls[0]![1] as RequestInit & { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('pilot:secret').toString('base64')}`);
  });

  it('passes an upstream failure status through to the caller', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 4 } }, response: null });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));

    const response = await GET(get(BOUNDS));
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toBe('Unable to load flight data');
  });
});
