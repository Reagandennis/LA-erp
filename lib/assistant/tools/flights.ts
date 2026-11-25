import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import { classifyQuery, lookupFlights } from '@/lib/flight-lookup';
import type { FlightCandidate, LookupAirport } from '@/lib/flight-status';
import { FlightTrackingError } from '@/lib/flight-tracking';
import { enforceRateLimit } from '@/lib/rate-limit';
import { userHasModule } from '@/lib/user';

import { type ToolDefinition, ToolRefusal } from '../types';
import { localStamp, optDate, optEnum, reqText } from './_shared';

/**
 * Flight lookups, read only. Each one is answered by FlightRadar24, a paid
 * outside service billed per flight returned, so this spends from the very
 * budget the flight form's "Look up" does (app/api/flight-radar/lookup): the
 * same scope and key, so chat and the form cannot each have a full allowance.
 */
const LOOKUP_LIMIT = { scope: 'flight.lookup', limit: 20, windowMs: 60 * 1000 } as const;

const ENDS = ['departure', 'arrival'] as const;
const SHOWN = 8;

const DAY_STATUS: Record<NonNullable<FlightCandidate['dayStatus']>, string> = {
  flown: 'flew that day (actual times)',
  expected: 'expected: it usually flies that weekday (times from recent runs, not a timetable)',
  'not-usual': 'does not usually fly that weekday',
  'no-record': 'no record of it flying that day',
};

const airport = (a: LookupAirport | null) => (a ? { code: a.iata || a.icao, city: a.city, country: a.country, timeZone: a.tz } : null);

const findFlightTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: API_ACCESS.flights,
  functionDeclaration: {
    name: 'find_flight',
    description:
      "Look up a flight by number (KQ100), callsign (KQA100) or tail number (5Y-KZX) on FlightRadar24: route, usual local departure and arrival times, duration, aircraft, and whether it is in the air. With `date`: what it did or is expected to do that day. A paid lookup, limited per user: use it only when the user asks about a flight, and never guess a flight number.",
    parameters: {
      type: 'object',
      properties: {
        flight: { type: 'string', description: 'Flight number, callsign or tail number' },
        date: { type: 'string', description: 'YYYY-MM-DD, local to the airport at `end`' },
        end: { type: 'string', enum: [...ENDS], description: 'Which end the date is at: departure (default) or arrival' },
      },
      required: ['flight'],
    },
  },
  async handler(args, ctx) {
    const raw = reqText(args, 'flight', { max: 20 });
    const date = optDate(args, 'date') ?? null;
    const end = optEnum(args, 'end', ENDS) ?? 'departure';

    // The route's order: the budget first, then the query, then the paid call.
    const budget = await enforceRateLimit({ ...LOOKUP_LIMIT, key: `${ctx.userId}` });
    if (!budget.allowed) {
      throw new ToolRefusal(
        `Too many flight lookups. Try again in ${budget.retryAfterSeconds} seconds. No lookup was made: do not guess the flight's details.`,
      );
    }
    if (!classifyQuery(raw)) throw new ToolRefusal('flight must be a flight number like KQ100 or a tail number like 5Y-KZX.');

    let lookup;
    try {
      lookup = await lookupFlights(raw, Date.now(), date, end);
    } catch (error) {
      // The tracker's own refusals (not configured, out of credit, unknown flight) read as they do on the page.
      if (error instanceof FlightTrackingError) throw new ToolRefusal(error.message);
      throw error;
    }

    const canOpenTracker = ctx.isAdmin || userHasModule(ctx.user, 'flight-tracker');
    return {
      query: lookup.query.value,
      kind: lookup.query.kind,
      ...(lookup.date ? { date: lookup.date, dateIsAt: lookup.end ?? end } : {}),
      total: lookup.candidates.length,
      more: lookup.candidates.length > SHOWN,
      flights: lookup.candidates.slice(0, SHOWN).map((c) => ({
        flight: c.flightNumber,
        airline: c.airline?.name ?? null,
        from: airport(c.origin),
        to: airport(c.destination),
        // Wall-clock times at each airport, not the user's.
        departs: c.departureTime,
        ...(c.departDate ? { departDate: c.departDate } : {}),
        ...(c.departureEstimated ? { departureIsEstimate: true } : {}),
        arrives: c.arrivalTime,
        ...(c.arriveDate ? { arriveDate: c.arriveDate } : {}),
        durationMinutes: c.durationMinutes,
        aircraft: c.aircraft,
        tailNumber: c.registration,
        ...(c.airborne ? { inTheAirNow: true } : {}),
        ...(c.dayStatus ? { onThatDay: DAY_STATUS[c.dayStatus] } : {}),
        ...(c.frequency ? { flies: c.frequency } : {}),
        basedOnRuns: c.runs,
        lastSeen: localStamp(c.lastSeen, ctx.timeZone),
      })),
      ...(lookup.candidates.length === 0
        ? { note: `FlightRadar24 has no recent record of ${lookup.query.value}${lookup.date ? ` around ${lookup.date}` : ''}.` }
        : { note: 'Times are from FlightRadar24\'s record of recent flights, not the airline\'s timetable: check against the ticket.' }),
      checked: localStamp(lookup.checkedAt, ctx.timeZone),
      ...(canOpenTracker ? { href: '/modules/flight-tracker' } : {}),
    };
  },
};

export const flightTools: ToolDefinition[] = [findFlightTool];
