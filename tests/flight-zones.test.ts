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
