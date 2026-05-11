import { NextRequest, NextResponse } from 'next/server';

import { getFlightRadarApiToken } from '@/lib/env';
import { requireRequestAuth } from '@/lib/request-auth';


const FR24_SUMMARY_LIGHT_URL = 'https://fr24api.flightradar24.com/api/flight-summary/light';
const MAX_RANGE_DAYS = 14;
const SEARCH_MODES = ['flight-number', 'route', 'airport-date', 'airline'] as const;

type SearchMode = (typeof SEARCH_MODES)[number];

type FlightRecord = {
  id: string;
  flightNumber: string;
  callsign: string | null;
  airline: string | null;
  brandedAs: string | null;
  aircraftType: string | null;
  registration: string | null;
  hex: string | null;
  status: 'Scheduled' | 'Tracking' | 'Airborne' | 'Landed';
  flightEnded: boolean;
  origin: {
    iata: string | null;
    icao: string | null;
  };
  destination: {
    iata: string | null;
    icao: string | null;
    actualIata: string | null;
    actualIcao: string | null;
  };
  times: {
    firstSeen: string | null;
    takeoff: string | null;
    landed: string | null;
    lastSeen: string | null;
  };
  runways: {
    takeoff: string | null;
    landed: string | null;
  };
};

function asSearchMode(value: string | null): SearchMode {
  return SEARCH_MODES.includes(value as SearchMode) ? (value as SearchMode) : 'airport-date';
}

function parseDateTime(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatProviderDateTime(value: Date) {
  return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function parseCode(value: string | null) {
  if (!value) {
    return '';
  }

  return value.trim().toUpperCase();
}

function parseList(value: string | null) {
  return value
    ?.split(',')
    .map((part) => parseCode(part))
    .filter(Boolean) ?? [];
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function getStatus(record: FlightRecord['times']) {
  if (record.landed) {
    return 'Landed';
  }

  if (record.takeoff) {
    return 'Airborne';
  }

  if (record.firstSeen) {
    return 'Tracking';
  }

  return 'Scheduled';
}

function normalizeFlight(record: Record<string, unknown>): FlightRecord {
  const times = {
    firstSeen: getString(record.first_seen),
    takeoff: getString(record.datetime_takeoff),
    landed: getString(record.datetime_landed),
    lastSeen: getString(record.last_seen),
  };

  return {
    id: getString(record.fr24_id) ?? getString(record.flight) ?? crypto.randomUUID(),
    flightNumber: getString(record.flight) ?? 'Unknown flight',
    callsign: getString(record.callsign),
    airline: getString(record.operating_as),
    brandedAs: getString(record.painted_as),
    aircraftType: getString(record.type),
    registration: getString(record.reg),
    hex: getString(record.hex),
    status: getStatus(times),
    flightEnded: Boolean(record.flight_ended),
    origin: {
      iata: getString(record.orig_iata),
      icao: getString(record.orig_icao),
    },
    destination: {
      iata: getString(record.dest_iata),
      icao: getString(record.dest_icao),
      actualIata: getString(record.dest_iata_actual),
      actualIcao: getString(record.dest_icao_actual),
    },
    times,
    runways: {
      takeoff: getString(record.runway_takeoff),
      landed: getString(record.runway_landed),
    },
  };
}

function extractRows(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object') {
    const direct = (payload as { data?: unknown }).data;
    if (Array.isArray(direct)) {
      return direct;
    }

    if (direct && typeof direct === 'object' && Array.isArray((direct as { data?: unknown }).data)) {
      return (direct as { data: unknown[] }).data;
    }

    const results = (payload as { results?: unknown }).results;
    if (Array.isArray(results)) {
      return results;
    }
  }

  return [] as unknown[];
}

function getProviderErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const message = 'message' in payload && typeof (payload as { message?: unknown }).message === 'string'
    ? (payload as { message: string }).message
    : null;
  const details = 'details' in payload && typeof (payload as { details?: unknown }).details === 'string'
    ? (payload as { details: string }).details
    : null;
  const error = 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
    ? (payload as { error: string }).error
    : null;

  if (message && details) {
    return `${message}: ${details}`;
  }

  return message ?? details ?? error;
}

function buildProviderQuery(searchParams: URLSearchParams) {
  const mode = asSearchMode(searchParams.get('searchMode'));
  const dateFrom = parseDateTime(searchParams.get('dateFrom'));
  const dateTo = parseDateTime(searchParams.get('dateTo'));

  if (!dateFrom || !dateTo) {
    return { error: 'Choose a valid start and end date.' } as const;
  }

  if (dateFrom >= dateTo) {
    return { error: 'End date must be after the start date.' } as const;
  }

  const rangeDays = (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > MAX_RANGE_DAYS) {
    return { error: 'Flight summary searches are limited to a 14 day range.' } as const;
  }

  const query = new URLSearchParams({
    flight_datetime_from: formatProviderDateTime(dateFrom),
    flight_datetime_to: formatProviderDateTime(dateTo),
  });

  const filters: Record<string, string | string[] | null> = {
    searchMode: mode,
    flightNumber: null,
    route: null,
    airports: null,
    airline: null,
  };

  if (mode === 'flight-number') {
    const flightNumber = parseCode(searchParams.get('flightNumber')).replaceAll(/\s+/g, '');
    if (!flightNumber) {
      return { error: 'Enter a flight number or callsign to search.' } as const;
    }

    query.set('callsigns', flightNumber);
    filters.flightNumber = flightNumber;
  }

  if (mode === 'route') {
    const departureAirport = parseCode(searchParams.get('departureAirport'));
    const arrivalAirport = parseCode(searchParams.get('arrivalAirport'));
    if (!departureAirport || !arrivalAirport) {
      return { error: 'Enter both a departure and arrival airport.' } as const;
    }

    const route = `${departureAirport}-${arrivalAirport}`;
    query.set('routes', route);
    filters.route = route;
  }

  if (mode === 'airport-date') {
    const airports = parseList(searchParams.get('airportCode'));
    if (airports.length === 0) {
      return { error: 'Enter at least one airport code.' } as const;
    }

    query.set('airports', airports.join(','));
    filters.airports = airports;
  }

  if (mode === 'airline') {
    const airline = parseCode(searchParams.get('airline'));
    if (!airline) {
      return { error: 'Enter an airline code.' } as const;
    }

    query.set('operating_as', airline);
    query.set('painted_as', airline);
    filters.airline = airline;
  }

  return {
    mode,
    query,
    filters,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  } as const;
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const queryResult = buildProviderQuery(request.nextUrl.searchParams);

  if ('error' in queryResult) {
    return NextResponse.json({ error: queryResult.error }, { status: 400 });
  }

  try {
    const providerResponse = await fetch(`${FR24_SUMMARY_LIGHT_URL}?${queryResult.query.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${getFlightRadarApiToken()}`,
        Accept: 'application/json',
        'Accept-Version': 'v1',
      },
      cache: 'no-store',
    });

    const payload = (await providerResponse.json().catch(() => null)) as unknown;

    if (!providerResponse.ok) {
      const providerError = getProviderErrorMessage(payload) ?? 'FlightRadar24 request failed.';

      return NextResponse.json({ error: providerError }, { status: providerResponse.status >= 500 ? 502 : providerResponse.status });
    }

    const flights = extractRows(payload)
      .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
      .map(normalizeFlight)
      .sort((left, right) => {
        const leftTime = left.times.takeoff ?? left.times.firstSeen ?? '';
        const rightTime = right.times.takeoff ?? right.times.firstSeen ?? '';
        return rightTime.localeCompare(leftTime);
      });

    const uniqueAirlines = new Set(flights.map((flight) => flight.airline ?? flight.brandedAs).filter(Boolean));
    const uniqueAirports = new Set(
      flights
        .flatMap((flight) => [flight.origin.iata, flight.destination.iata, flight.destination.actualIata])
        .filter(Boolean),
    );

    return NextResponse.json({
      flights,
      summary: {
        resultCount: flights.length,
        airborneCount: flights.filter((flight) => flight.status === 'Airborne').length,
        landedCount: flights.filter((flight) => flight.status === 'Landed').length,
        uniqueAirlineCount: uniqueAirlines.size,
        uniqueAirportCount: uniqueAirports.size,
      },
      filters: queryResult.filters,
      searchMode: queryResult.mode,
      dateFrom: queryResult.dateFrom,
      dateTo: queryResult.dateTo,
    });
  } catch {
    return NextResponse.json({ error: 'Unable to reach FlightRadar24 right now.' }, { status: 502 });
  }
}
