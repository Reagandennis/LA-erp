import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { FlightTrackingError, lookupFlightTrack } from '../lib/flight-tracking';

const fetchMock = vi.fn();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });

const NOW = Date.UTC(2026, 9, 18, 12);
const departure = new Date(Date.UTC(2026, 9, 18, 6, 15));
const arrival = new Date(Date.UTC(2026, 9, 18, 15, 0));

describe('lookupFlightTrack', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FR24_API_TOKEN', 'test-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('takes the run of the flight nearest the schedule, and adds the live ETA while airborne', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json([
          // Yesterday's KQ100 and today's: today's is nearest.
          { fr24_id: 'old', datetime_takeoff: '2026-10-17T06:30:00Z', datetime_landed: '2026-10-17T15:10:00Z', flight_ended: true },
          { fr24_id: 'today', orig_icao: 'HKJK', dest_icao: 'EGLL', datetime_takeoff: '2026-10-18T06:32:00Z', datetime_landed: null, flight_ended: false },
        ]),
      )
      .mockResolvedValueOnce(
        json([
          { fr24_id: 'someone-else', eta: '2026-10-18T20:00:00Z' },
          { fr24_id: 'today', eta: '2026-10-18T15:20:00Z', alt: 38000, gspeed: 480 },
        ]),
      );

    const track = await lookupFlightTrack({ flightNumber: 'KQ100', departure, arrival, now: NOW });

    expect(track).toMatchObject({
      found: true,
      takeoffAt: '2026-10-18T06:32:00Z',
      landedAt: null,
      eta: '2026-10-18T15:20:00Z',
      altFt: 38000,
      origin: 'NBO',
      destination: 'LHR',
    });
    const [summaryUrl, init] = fetchMock.mock.calls[0]!;
    expect(summaryUrl).toContain('/api/flight-summary/light?flights=KQ100');
    expect(summaryUrl).toContain('flight_datetime_from=2026-10-17T18:15:00Z');
    // Never asks about the future.
    expect(summaryUrl).toContain('flight_datetime_to=2026-10-18T12:00:00Z');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(fetchMock.mock.calls[1]![0]).toContain('/api/live/flight-positions/full?flights=KQ100');
  });

  it('skips the live feed once landed, and serves repeats from cache', async () => {
    fetchMock.mockResolvedValueOnce(
      json([{ fr24_id: 'x', datetime_takeoff: '2026-10-11T06:30:00Z', datetime_landed: '2026-10-11T14:50:00Z', flight_ended: true }]),
    );
    const input = {
      flightNumber: 'KQ100',
      departure: new Date(Date.UTC(2026, 9, 11, 6, 15)),
      arrival: new Date(Date.UTC(2026, 9, 11, 15)),
      now: NOW,
    };

    const first = await lookupFlightTrack(input);
    const second = await lookupFlightTrack(input);

    expect(first.landedAt).toBe('2026-10-11T14:50:00Z');
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('spends nothing before the window opens', async () => {
    const track = await lookupFlightTrack({
      flightNumber: 'KQ100',
      departure: new Date(NOW + 3 * 24 * 60 * 60_000),
      arrival: null,
      now: NOW,
    });
    expect(track.found).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a rejected token as a typed error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(
      lookupFlightTrack({ flightNumber: 'BA65', departure, arrival, now: NOW }),
    ).rejects.toEqual(new FlightTrackingError('FlightRadar24 rejected the API token.', 502));
  });
});
