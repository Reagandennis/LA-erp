/**
 * Which clock each end of a flight reads in. Client-safe.
 *
 * A flight leaves at the departure airport's local time and lands at the
 * arrival airport's, so NBO → LHR is "23:40 EAT → 05:50 GMT", never both in
 * one zone. The event's own end keeps the zone its time was typed in (the
 * form's timezone picker); the airport table (server-side, see
 * `lib/airports.ts`) supplies the rest. Every time is also given in Kenya
 * time, the office's clock.
 */

import { isValidTimeZone, utcToZoned } from './zoned-time';

/** The office's clock: every flight time is also shown in it. */
export const OFFICE_ZONE = 'Africa/Nairobi';
export const OFFICE_ZONE_LABEL = 'Kenya';

/** The airports' zones as the server resolved them from their IATA codes. */
export interface FlightAirportZones {
  depart: string | null;
  arrive: string | null;
}

const valid = (zone: string | null | undefined): string | null => (zone && isValidTimeZone(zone) ? zone : null);

/**
 * Each end's zone: the airport's own, else (for the end the event is at) the
 * zone the time was entered in. Null when nothing is known about that end.
 */
export function flightEndZones(input: {
  arrival: boolean;
  /** The zone the event's own time was entered in (`details.timezone`). */
  enteredZone: string | null | undefined;
  airports?: FlightAirportZones | null;
}): FlightAirportZones {
  const entered = valid(input.enteredZone);
  return {
    depart: valid(input.airports?.depart) ?? (input.arrival ? null : entered),
    arrive: valid(input.airports?.arrive) ?? (input.arrival ? entered : null),
  };
}

/** The zone's short name at `iso`: "GMT+3", "GMT", "GMT+2". */
export function zoneAbbreviation(iso: string, timeZone: string, locale = 'en-US'): string {
  return (
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(iso))
      .find((part) => part.type === 'timeZoneName')?.value ?? ''
  );
}

/** Whole days `iso` falls after `reference` on each zone's own calendar: 0, 1, -1. */
export function dayShift(iso: string, zone: string, referenceZone: string): number {
  const a = utcToZoned(iso, zone).date;
  const b = utcToZoned(iso, referenceZone).date;
  if (!a || !b) return 0;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}
