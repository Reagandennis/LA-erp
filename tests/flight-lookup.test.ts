import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { classifyQuery, clearLookupCache, lookupFlights } from '../lib/flight-lookup';
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
    clearLookupCache();
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
    expect(url).toContain('flight_datetime_from=2026-10-16T12:00:00Z');
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

  it("answers for the date asked with the flight as it flew that day, to the minute", async () => {
    // KQ100 on 28 Oct took off 06:55Z: 09:40 Nairobi after the taxi; landed 15:20Z: 15:30 London.
    fetchMock.mockResolvedValueOnce(list([run(28, { datetime_takeoff: '2026-10-28T06:55:00Z' }), run(27)]));

    const lookup = await lookupFlights('KQ100', NOW, '2026-10-28');

    // Inside the two weeks already read: one call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lookup.date).toBe('2026-10-28');
    expect(lookup.candidates).toHaveLength(1);
    expect(lookup.candidates[0]).toMatchObject({
      basis: 'date',
      dayStatus: 'flown',
      onDate: '2026-10-28',
      departDate: '2026-10-28',
      arriveDate: '2026-10-28',
      runs: 1,
      departureTime: '09:40',
      arrivalTime: '15:30',
      // 8h25 in the air plus the taxi either side.
      durationMinutes: 530,
    });
    // Another day reuses the runs already read: flicking through dates costs nothing.
    expect((await lookupFlights('KQ100', NOW, '2026-10-27')).candidates[0]).toMatchObject({ dayStatus: 'flown', onDate: '2026-10-27' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says so when a day inside the last two weeks passed without the flight', async () => {
    fetchMock.mockResolvedValueOnce(list([run(29), run(28)]));
    const lookup = await lookupFlights('KQ100', NOW, '2026-10-26');
    expect(lookup.candidates[0]).toMatchObject({ dayStatus: 'no-record', basis: 'recent', runs: 2, departDate: '2026-10-26' });
  });

  it('reads a day older than the history with a call of its own', async () => {
    fetchMock.mockResolvedValueOnce(list([run(29)])).mockResolvedValueOnce(list([run(10)]));
    const lookup = await lookupFlights('KQ100', NOW, '2026-10-10');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toContain('flight_datetime_from=2026-10-09T00:00:00Z');
    expect(lookup.candidates[0]).toMatchObject({ dayStatus: 'flown', departDate: '2026-10-10' });
  });

  it("gives a date ahead the expected times, from that weekday's runs when there are two or more", async () => {
    // Fridays leave later: 23 and 30 Oct 2026 are Fridays, 29 Oct a Thursday.
    fetchMock.mockResolvedValueOnce(
      list([
        run(30, { datetime_takeoff: '2026-10-30T08:45:00Z', datetime_landed: '2026-10-30T17:20:00Z' }),
        run(29),
        run(23, { datetime_takeoff: '2026-10-23T08:45:00Z', datetime_landed: '2026-10-23T17:20:00Z' }),
      ]),
    );

    const lookup = await lookupFlights('KQ100', NOW, '2026-11-06');

    // A future date has no flights of its own: only the recent runs are read.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // London was still on summer time on the 23rd, so the two landings read 18:30 and 17:30 there.
    expect(lookup.candidates[0]).toMatchObject({
      basis: 'weekday',
      dayStatus: 'expected',
      runs: 2,
      departureTime: '11:30',
      arrivalTime: '18:00',
      departDate: '2026-11-06',
      arriveDate: '2026-11-06',
    });

    // A weekday none of the runs fell on: every run's times (and with only a week's runs, no claim it skips Sundays).
    expect((await lookupFlights('KQ100', NOW, '2026-11-01')).candidates[0]).toMatchObject({ basis: 'recent', runs: 3 });
  });

  it('dates an overnight flight by the end the event is at', async () => {
    // ET552 Addis → Rome: FR24 sees no take-off, first sees it at 01:45 Addis,
    // lands 02:50Z (03:50 Rome). It left on the 22nd (23:20 Addis).
    const et552 = (day: number) => ({
      fr24_id: `et-${day}`,
      flight: 'ET552',
      operating_as: 'ETH',
      orig_icao: 'HAAB',
      orig_iata: 'ADD',
      dest_icao: 'LIRF',
      dest_iata: 'FCO',
      datetime_takeoff: null,
      first_seen: `2026-10-${day}T22:45:00Z`,
      datetime_landed: `2026-10-${day + 1}T02:50:00Z`,
      flight_ended: true,
    });
    fetchMock.mockResolvedValueOnce(list([28, 27, 26, 25, 24, 23, 22].map(et552)));

    const departing = await lookupFlights('ET552', NOW, '2026-10-27', 'departure');
    expect(departing.candidates[0]).toMatchObject({ dayStatus: 'flown', departDate: '2026-10-27', arriveDate: '2026-10-28', departureEstimated: true });
    const arriving = await lookupFlights('ET552', NOW, '2026-10-28', 'arrival');
    // The flight landing on the 28th is the one that left on the 27th.
    expect(arriving.candidates[0]).toMatchObject({ dayStatus: 'flown', departDate: '2026-10-27', arriveDate: '2026-10-28' });
    // Ahead: a daily flight, expected, leaving that evening and landing the next morning.
    expect((await lookupFlights('ET552', NOW, '2026-11-05')).candidates[0]).toMatchObject({
      dayStatus: 'expected',
      frequency: 'Daily',
      departDate: '2026-11-05',
      arriveDate: '2026-11-06',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags a weekday a flight with a week's history skips, but not on too little history", async () => {
    // Mon/Wed/Fri over two weeks: 12–30 Oct 2026.
    fetchMock.mockResolvedValueOnce(list([30, 28, 26, 23, 21, 19].map((day) => run(day))));
    const tuesday = await lookupFlights('KQ100', NOW, '2026-11-03');
    expect(tuesday.candidates[0]).toMatchObject({ dayStatus: 'not-usual', frequency: 'Mon, Wed, Fri' });
    expect((await lookupFlights('KQ100', NOW, '2026-11-04')).candidates[0]).toMatchObject({ dayStatus: 'expected' });

    clearLookupCache();
    fetchMock.mockResolvedValueOnce(list([run(30), run(29)]));
    expect((await lookupFlights('KQ100', NOW, '2026-11-03')).candidates[0]?.dayStatus).toBe('expected');
  });

  it('refuses what is neither a flight nor a tail number', async () => {
    await expect(lookupFlights('?', NOW)).rejects.toBeInstanceOf(FlightTrackingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
