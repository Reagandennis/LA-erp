import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { airportTimeZone } from '../lib/airports';
import { typicalTime } from '../lib/flight-lookup';
import { nearestRun } from '../lib/flight-tracking';
import { dayShift, flightEndZones } from '../lib/flight-zones';
import { buildClientItinerary } from '../app/modules/trip-planning/[tripId]/client-itinerary';

describe('airportTimeZone', () => {
  it('reads an airport zone from its IATA or ICAO code', () => {
    expect(airportTimeZone('NBO')).toBe('Africa/Nairobi');
    expect(airportTimeZone('lhr')).toBe('Europe/London');
    expect(airportTimeZone('FACT')).toBe('Africa/Johannesburg');
    expect(airportTimeZone('')).toBeNull();
    expect(airportTimeZone('Nairobi')).toBeNull();
  });
});

describe('flightEndZones', () => {
  it("reads each end in its own airport's zone", () => {
    expect(
      flightEndZones({ arrival: false, enteredZone: 'Africa/Nairobi', airports: { depart: 'Africa/Nairobi', arrive: 'Europe/London' } }),
    ).toEqual({ depart: 'Africa/Nairobi', arrive: 'Europe/London' });
  });

  it("falls back to the entered zone only for the event's own end", () => {
    expect(flightEndZones({ arrival: false, enteredZone: 'Africa/Nairobi', airports: { depart: null, arrive: null } })).toEqual({
      depart: 'Africa/Nairobi',
      arrive: null,
    });
    expect(flightEndZones({ arrival: true, enteredZone: 'Africa/Addis_Ababa' })).toEqual({ depart: null, arrive: 'Africa/Addis_Ababa' });
  });

  it('counts the calendar days between two zones', () => {
    // 22:30 UTC is 01:30 the next day in Nairobi.
    expect(dayShift('2026-11-18T22:30:00Z', 'Africa/Nairobi', 'Europe/London')).toBe(1);
    expect(dayShift('2026-11-18T12:00:00Z', 'Africa/Nairobi', 'Europe/London')).toBe(0);
  });
});

describe('nearestRun', () => {
  const run = (takeoff: string) => ({ datetime_takeoff: takeoff });

  it('with a departure, takes the run that took off nearest it', () => {
    const rows = [run('2026-11-17T20:50:00Z'), run('2026-11-18T20:52:00Z')];
    expect(nearestRun(rows, new Date('2026-11-18T20:40:00Z'), null)).toBe(rows[1]);
  });

  it("with only an arrival, takes the run before it, not the next day's that is nearer", () => {
    // A 14-hour flight due at 06:00: the right run left at 16:00 the day before;
    // the next day's left at 16:00 again, 10 hours after the arrival.
    const rows = [run('2026-11-17T16:00:00Z'), run('2026-11-18T16:00:00Z')];
    expect(nearestRun(rows, null, new Date('2026-11-18T06:00:00Z'))).toBe(rows[0]);
  });
});

describe('typicalTime', () => {
  it('keeps a flight around midnight around midnight', () => {
    // 23:50, 23:55, 00:05 and 00:10 in Nairobi (UTC+3).
    const runs = ['2026-11-10T20:50:00Z', '2026-11-11T20:55:00Z', '2026-11-12T21:05:00Z', '2026-11-13T21:10:00Z'].map(Date.parse);
    expect(typicalTime(runs, 'Africa/Nairobi')).toBe('00:00');
  });
});

describe('client itinerary flight times', () => {
  it('gives the landing in the arrival airport clock', () => {
    const trip = {
      id: 1,
      reference: 'X-KEN-NOV-1',
      title: 'T',
      status: 'Planned',
      startDate: '2026-11-18',
      endDate: '2026-11-19',
      days: [],
      customer: { name: 'C', company: null },
      travelers: [],
      items: [
        {
          id: 1,
          dayId: null,
          position: 0,
          itemType: 'flight',
          category: 'flight',
          body: null,
          timeLabel: 'DEPARTURE',
          providerName: 'British Airways',
          bookingUrl: null,
          phone: null,
          placeName: null,
          address: null,
          details: { flightNumber: 'BA64', departAirport: 'NBO', arriveAirport: 'LHR', timezone: 'Africa/Nairobi' },
          airportZones: { depart: 'Africa/Nairobi', arrive: 'Europe/London' },
          description: 'Departure · BA64',
          subtitle: null,
          quantity: 1,
          unitPrice: null,
          completedAt: null,
          sourceQuoteItemId: null,
          // 23:40 in Nairobi → 05:50 in London.
          scheduledAt: '2026-11-18T20:40:00.000Z',
          endsAt: '2026-11-19T05:50:00.000Z',
          durationMinutes: 550,
          reminderMinutesBefore: null,
          reminderAt: null,
          imageUrl: null,
          confirmationCode: null,
          attachments: [],
          driver: null,
          officer: null,
          vehicle: null,
          travelers: [],
          resourceIds: [],
        },
      ],
    };
    const text = JSON.stringify(buildClientItinerary(trip as never, { includeCrew: false } as never));
    expect(text).toContain('11:40 PM GMT+3 – 5:50 AM GMT');
  });
});

describe('ET552 and other multi-leg, thinly covered flights', () => {
  it('tracks the leg on the itinerary route, not another leg with the same number', async () => {
    const { onRoute } = await import('../lib/flight-tracking');
    const rows = [
      { orig_icao: 'LIRF', dest_icao: 'CYYZ', datetime_takeoff: '2026-11-22T04:15:01Z' },
      { orig_icao: 'HAAB', dest_icao: 'LIRF', first_seen: '2026-11-21T22:42:29Z' },
    ];
    expect(onRoute(rows, 'ADD', 'FCO')).toEqual([rows[1]]);
    expect(onRoute(rows, 'FCO', null)).toEqual([rows[0]]);
    // No route given, or none matching: every run stays in play.
    expect(onRoute(rows, null, null)).toEqual(rows);
    expect(onRoute(rows, 'NBO', 'DXB')).toEqual(rows);
  });

  it('reads a flight FR24 saw in the air without a take-off as departed, not delayed', async () => {
    const { flightProgress } = await import('../lib/flight-status');
    const schedule = { departure: '2026-11-22T21:00:00Z', arrival: '2026-11-23T03:00:00Z' };
    const base = { found: true, takeoffAt: null, landedAt: null, ended: false, eta: null, altFt: null, gspeedKt: null, origin: 'ADD', destination: 'FCO', checkedAt: '' };
    const now = Date.parse('2026-11-23T00:00:00Z');
    expect(flightProgress(now, schedule, { ...base, seenAt: '2026-11-22T22:45:00Z' })).toMatchObject({ phase: 'airborne', label: 'Departed' });
    // Before: no take-off on record read as "Delayed 2h 45m · Not departed yet".
    expect(flightProgress(now, schedule, { ...base, seenAt: '2026-11-22T22:45:00Z' }).status).not.toBe('late');
    expect(
      flightProgress(now, schedule, { ...base, seenAt: '2026-11-22T22:45:00Z', eta: '2026-11-23T03:30:00Z' }),
    ).toMatchObject({ status: 'late', label: 'Delayed 40m' });
    // Entered at 09:00 Addis when it flies around midnight: flagged, not "Landed".
    const entered = { departure: '2026-11-23T06:00:00Z', arrival: null };
    expect(
      flightProgress(Date.parse('2026-11-23T08:00:00Z'), entered, { ...base, ended: true, seenAt: '2026-11-22T22:45:00Z', landedAt: '2026-11-23T02:46:00Z' }).label,
    ).toBe('Check time');
  });

  it('estimates the block time of a route FR24 never saw take off', async () => {
    const { estimatedBlockMinutes } = await import('../lib/flight-lookup');
    // ADD → FCO: OAG publishes ET552 at 6h30 (23:20 → 03:50).
    const block = estimatedBlockMinutes({ lat: 8.98, lon: 38.8 }, { lat: 41.8, lon: 12.25 })!;
    expect(Math.abs(block - 390)).toBeLessThanOrEqual(10);
    // A short hop is not padded like a long-haul: NBO → MBA is about an hour.
    expect(estimatedBlockMinutes({ lat: -1.32, lon: 36.93 }, { lat: -4.03, lon: 39.59 })).toBe(60);
  });

  it('works the departure back from the landings when no take-off was recorded', async () => {
    const { candidatesFrom } = await import('../lib/flight-lookup');
    const [candidate] = await candidatesFrom([
      { flight: 'ET552', orig_icao: 'HAAB', orig_iata: 'ADD', dest_icao: 'LIRF', dest_iata: 'FCO', first_seen: '2026-11-21T22:42:29Z', datetime_landed: '2026-11-22T02:53:27Z', operating_as: 'ETH' },
    ]);
    expect(candidate).toMatchObject({ departureEstimated: true, durationMinutes: 395, arrivalTime: '04:03' });
    // Landed 02:53Z + 10m taxi = 03:03Z; minus 6h35 = 20:28Z = 23:28 in Addis
    // (published: 23:20).
    expect(candidate!.departureTime).toBe('23:28');
  });

  it('offers the leg from the event airport first', async () => {
    const { rankCandidates } = await import('../app/modules/trip-planning/[tripId]/_components/flight-lookup');
    const leg = (o: string, d: string) => ({ origin: { iata: o }, destination: { iata: d } }) as never;
    const ranked = rankCandidates([leg('FCO', 'YYZ'), leg('ADD', 'FCO')], 'ADD', false);
    expect((ranked[0] as { origin: { iata: string } }).origin.iata).toBe('ADD');
    expect((rankCandidates([leg('FCO', 'YYZ'), leg('ADD', 'FCO')], 'YYZ', true)[0] as { destination: { iata: string } }).destination.iata).toBe('YYZ');
  });
});

describe('contentDisposition', () => {
  it('survives a macOS screenshot name, whose space before PM is U+202F', async () => {
    const { contentDisposition, fileResponse } = await import('../lib/file-response');
    const name = 'Photo 11.20.36 PM.png';
    const header = contentDisposition('inline', name);
    expect(header).toBe(`inline; filename="Photo 11.20.36 PM.png"; filename*=UTF-8''Photo%2011.20.36%E2%80%AFPM.png`);
    // Before the fix this threw "Cannot convert argument to a ByteString".
    expect(() => fileResponse({ content: new Uint8Array([1]), mime: 'image/png', name })).not.toThrow();
    expect(contentDisposition('attachment', 'plain.pdf')).toBe('attachment; filename="plain.pdf"');
    expect(contentDisposition('attachment', 'a"b.pdf')).toContain('filename="ab.pdf"');
  });
});
