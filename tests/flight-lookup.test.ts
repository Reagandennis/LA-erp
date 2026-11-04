import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { classifyQuery, lookupFlights } from '../lib/flight-lookup';
import { FlightTrackingError } from '../lib/flight-tracking';

const fetchMock = vi.fn();
const list = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
const object = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NOW = Date.UTC(2026, 9, 30, 12);

/** KQ100 Nairobi → London: wheels up 06:45Z, down 15:20Z. */
const run = (day: number, extra: Record<string, unknown> = {}) => ({
  fr24_id: `id-${day}`,
  flight: 'KQ100',
  callsign: 'KQA100',
  operating_as: 'KQA',
  painted_as: 'KQA',
  type: 'B77W',
  reg: '5Y-KZX',
  orig_icao: 'HKJK',
  orig_iata: 'NBO',
  datetime_takeoff: `2026-10-${day}T06:45:00Z`,
  dest_icao: 'EGLL',
  dest_iata: 'LHR',
  dest_icao_actual: 'EGLL',
  dest_iata_actual: 'LHR',
  datetime_landed: `2026-10-${day}T15:20:00Z`,
  last_seen: `2026-10-${day}T15:30:00Z`,
  flight_ended: true,
  ...extra,
});

describe('classifyQuery', () => {
  it('tells flight numbers, callsigns and tail numbers apart', () => {
    expect(classifyQuery(' kq 100 ')).toEqual({ kind: 'flight', value: 'KQ100' });
    expect(classifyQuery('6E123')).toEqual({ kind: 'flight', value: '6E123' });
    expect(classifyQuery('KQA100')).toEqual({ kind: 'callsign', value: 'KQA100' });
    expect(classifyQuery('5y-kzx')).toEqual({ kind: 'registration', value: '5Y-KZX' });
    expect(classifyQuery('N123AB')).toEqual({ kind: 'registration', value: 'N123AB' });
    expect(classifyQuery('K')).toBeNull();
    expect(classifyQuery('')).toBeNull();
  });
});

describe('lookupFlights', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('FR24_API_TOKEN', 'test-token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('builds the route and typical gate times from the recent runs of a flight number', async () => {
    fetchMock.mockResolvedValueOnce(
      list([
        run(30, { reg: '5Y-KZG', type: 'B788', datetime_landed: null, last_seen: '2026-10-30T07:00:00Z', flight_ended: false }),
        run(29),
        run(28, { datetime_takeoff: '2026-10-28T06:55:00Z' }),
      ]),
    );

    const lookup = await lookupFlights('kq 100', NOW);

    expect(lookup.query).toEqual({ kind: 'flight', value: 'KQ100' });
    expect(lookup.candidates).toHaveLength(1);
    expect(lookup.candidates[0]).toMatchObject({
      flightNumber: 'KQ100',
      airline: { name: 'Kenya Airways', iata: 'KQ', icao: 'KQA' },
      origin: { iata: 'NBO', city: 'Nairobi', tz: 'Africa/Nairobi' },
      destination: { iata: 'LHR', tz: 'Europe/London' },
      // 06:45Z less the taxi out, in Nairobi; 15:20Z plus the taxi in, in London (GMT by then).
      departureTime: '09:30',
      arrivalTime: '15:30',
      // The median of the two runs that landed: 8h35 and 8h25 in the air, plus the taxi either side.
      durationMinutes: 535,
      aircraft: 'B77W',
      registration: '5Y-KZG',
      runs: 3,
      lastSeen: '2026-10-30T07:00:00Z',
      airborne: true,
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/api/flight-summary/full?flights=KQ100');
    expect(url).toContain('flight_datetime_from=2026-10-20T12:00:00Z');
    expect(url).toContain('flight_datetime_to=2026-10-30T12:00:00Z');
    expect(url).toContain('sort=desc');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('lists what a tail number has flown, the flight in the air first', async () => {
    fetchMock.mockResolvedValueOnce(
      list([
        run(29, { flight: 'KQ101', callsign: 'KQA101', orig_icao: 'EGLL', orig_iata: 'LHR', dest_icao: 'HKJK', dest_iata: 'NBO', dest_icao_actual: 'HKJK', dest_iata_actual: 'NBO', datetime_takeoff: '2026-10-29T19:30:00Z', datetime_landed: '2026-10-30T04:10:00Z' }),
        run(28, { flight: 'KQ101', callsign: 'KQA101', orig_icao: 'EGLL', orig_iata: 'LHR', dest_icao: 'HKJK', dest_iata: 'NBO', dest_icao_actual: 'HKJK', dest_iata_actual: 'NBO', datetime_takeoff: '2026-10-28T19:30:00Z', datetime_landed: '2026-10-29T04:10:00Z' }),
        run(30, { datetime_landed: null, last_seen: '2026-10-30T07:00:00Z', flight_ended: false }),
      ]),
    );

    const lookup = await lookupFlights('5Y-KZX', NOW);

    expect(fetchMock.mock.calls[0]![0]).toContain('registrations=5Y-KZX');
    expect(lookup.query.kind).toBe('registration');
    expect(lookup.candidates.map((c) => [c.flightNumber, c.airborne, c.runs])).toEqual([
      ['KQ100', true, 1],
      ['KQ101', false, 2],
    ]);
    expect(lookup.candidates[1]).toMatchObject({ origin: { iata: 'LHR' }, destination: { iata: 'NBO' }, departureTime: '19:15', arrivalTime: '07:20' });
  });

  it('asks FR24 to name an airline the table lacks, once', async () => {
    fetchMock
      .mockResolvedValueOnce(list([run(29, { flight: 'ZX900', callsign: 'ZXZ900', operating_as: 'ZXZ', painted_as: 'ZXZ' })]))
      .mockResolvedValueOnce(object({ name: 'Zed Air', iata: 'ZX', icao: 'ZXZ' }))
      .mockResolvedValueOnce(list([run(29, { flight: 'ZX901', callsign: 'ZXZ901', operating_as: 'ZXZ', painted_as: 'ZXZ' })]));

    expect((await lookupFlights('ZX900', NOW)).candidates[0]?.airline).toEqual({ name: 'Zed Air', iata: 'ZX', icao: 'ZXZ' });
    expect(fetchMock.mock.calls[1]![0]).toContain('/api/static/airlines/ZXZ/light');
    expect((await lookupFlights('ZX901', NOW)).candidates[0]?.airline?.name).toBe('Zed Air');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('answers the same question from memory for a while, and an empty one plainly', async () => {
    fetchMock.mockResolvedValueOnce(list([]));
    const first = await lookupFlights('QQ1234', NOW);
    expect(first.candidates).toEqual([]);
    expect(await lookupFlights('qq 1234', NOW + 60_000)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers for the event's date with the flight as it flew that day, to the minute", async () => {
    // KQ100 on 28 Oct took off 06:55Z: 09:40 Nairobi after the taxi; landed 15:20Z: 15:30 London.
    fetchMock.mockResolvedValueOnce(list([run(28, { datetime_takeoff: '2026-10-28T06:55:00Z' }), run(27)]));

    const lookup = await lookupFlights('KQ100', NOW, '2026-10-28');

    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('flight_datetime_from=2026-10-27T00:00:00Z');
    expect(url).toContain('flight_datetime_to=2026-10-30T00:00:00Z');
    expect(lookup.candidates).toHaveLength(1);
    expect(lookup.candidates[0]).toMatchObject({
      basis: 'date',
      onDate: '2026-10-28',
      runs: 1,
      departureTime: '09:40',
      arrivalTime: '15:30',
      // 8h25 in the air plus the taxi either side.
      durationMinutes: 530,
    });
    // Asked again for a different day, it is a different question.
    fetchMock.mockResolvedValueOnce(list([run(27)]));
    expect((await lookupFlights('KQ100', NOW, '2026-10-27')).candidates[0]?.onDate).toBe('2026-10-27');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to recent runs when nothing flew on the event's date", async () => {
    fetchMock.mockResolvedValueOnce(list([])).mockResolvedValueOnce(list([run(29), run(28)]));

    const lookup = await lookupFlights('KQ100', NOW, '2026-10-26');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toContain('flight_datetime_from=2026-10-20T12:00:00Z');
    expect(lookup.candidates[0]).toMatchObject({ basis: 'recent', onDate: null, runs: 2 });
  });

  it("prefers the runs on the event's weekday for a date still ahead", async () => {
    // Fridays leave later: 23 and 30 Oct 2026 are Fridays, 29 Oct a Thursday.
    fetchMock.mockResolvedValueOnce(
      list([
        run(30, { datetime_takeoff: '2026-10-30T08:45:00Z', datetime_landed: '2026-10-30T17:20:00Z' }),
        run(29),
        run(23, { datetime_takeoff: '2026-10-23T08:45:00Z', datetime_landed: '2026-10-23T17:20:00Z' }),
      ]),
    );

    const lookup = await lookupFlights('KQ100', NOW, '2026-11-06');

    // Only the ten recent days are asked for: a future date has no flights of its own.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('flight_datetime_to=2026-10-30T12:00:00Z');
    // London was still on summer time on the 23rd, so the two landings read 18:30 and 17:30 there.
    expect(lookup.candidates[0]).toMatchObject({ basis: 'weekday', runs: 2, departureTime: '11:30', arrivalTime: '18:00' });

    // A weekday none of the runs fell on: every run counts, as before.
    fetchMock.mockResolvedValueOnce(list([run(30), run(29)]));
    expect((await lookupFlights('KQ100', NOW, '2026-11-01')).candidates[0]).toMatchObject({ basis: 'recent', runs: 2 });
  });

  it('refuses what is neither a flight nor a tail number', async () => {
    await expect(lookupFlights('?', NOW)).rejects.toBeInstanceOf(FlightTrackingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
