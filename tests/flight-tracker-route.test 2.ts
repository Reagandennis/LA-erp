import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRequestAuth, getFlightRadarApiToken } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  getFlightRadarApiToken: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({
  requireRequestAuth,
}));

vi.mock('../lib/env', () => ({
  getFlightRadarApiToken,
}));

import { GET } from '../app/api/flight-tracker/route';

describe('flight tracker route', () => {
  beforeEach(() => {
    requireRequestAuth.mockReset();
    getFlightRadarApiToken.mockReset();
    vi.restoreAllMocks();
  });

  it('returns the auth response when the request is not authenticated', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const response = await GET(new NextRequest('http://localhost/api/flight-tracker'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Not authenticated');
  });

  it('rejects searches outside the 14 day provider window', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 1 } }, response: null });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/flight-tracker?searchMode=airport-date&airportCode=NBO&dateFrom=2026-04-01T00:00:00.000Z&dateTo=2026-04-20T00:00:00.000Z',
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('14 day');
  });

  it('proxies the FR24 summary light endpoint and normalizes results', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 4 } }, response: null });
    getFlightRadarApiToken.mockReturnValue('token-123');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              fr24_id: 'fr24_1',
              flight: 'KQ203',
              callsign: 'KQA203',
              operating_as: 'KQ',
              painted_as: 'KQ',
              type: 'B738',
              reg: '5Y-KZA',
              hex: '006778',
              orig_iata: 'NBO',
              orig_icao: 'HKJK',
              dest_iata: 'DXB',
              dest_icao: 'OMDB',
              datetime_takeoff: '2026-04-28T08:15:00.000Z',
              datetime_landed: null,
              first_seen: '2026-04-28T07:45:00.000Z',
              last_seen: '2026-04-28T10:30:00.000Z',
              flight_ended: false,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/flight-tracker?searchMode=airline&airline=KQ&dateFrom=2026-04-28T00:00:00.000Z&dateTo=2026-04-29T00:00:00.000Z',
      ),
    );
    const payload = (await response.json()) as {
      flights: Array<{ flightNumber: string; status: string }>;
      summary: { resultCount: number; airborneCount: number };
    };

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('operating_as=KQ'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Accept-Version': 'v1',
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain('flight_datetime_from=2026-04-28T00%3A00%3A00Z');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('.000');
    expect(payload.flights[0]?.flightNumber).toBe('KQ203');
    expect(payload.flights[0]?.status).toBe('Airborne');
    expect(payload.summary.resultCount).toBe(1);
    expect(payload.summary.airborneCount).toBe(1);
  });

  it('returns FR24 validation details when the provider rejects a request', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 4 } }, response: null });
    getFlightRadarApiToken.mockReturnValue('token-123');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Validation failed',
          details: "The 'flight_datetime_from' field must be a valid datetime in the format 'YYYY-MM-DDTHH:MM:SS'.",
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/flight-tracker?searchMode=airline&airline=KQ&dateFrom=2026-04-28T00:00:00.000Z&dateTo=2026-04-29T00:00:00.000Z',
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Validation failed');
    expect(payload.error).toContain('YYYY-MM-DDTHH:MM:SS');
  });
});
