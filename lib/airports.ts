import 'server-only';

import rows from './airports-data.json';

/**
 * Airports with an IATA code that are large, medium or have scheduled service:
 * [iata, icao, name, city, ISO country, lat, lon, tz]. Built from OurAirports
 * (https://ourairports.com/data/, public domain), with the IANA time zone
 * from OpenFlights (https://openflights.org/data, ODbL) where it has one.
 * Server-only: the table is ~500 KB, so flights are enriched and airports
 * searched in the API rather than in the browser.
 */
type AirportRow = [string, string, string, string, string, number, number, string];

export type AirportInfo = {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lon: number;
  /** IANA zone, e.g. Africa/Nairobi; null for the few small fields without one. */
  tz: string | null;
};

let index: { all: AirportInfo[]; byIata: Map<string, AirportInfo>; byIcao: Map<string, AirportInfo> } | null = null;

function airportIndex() {
  if (index) return index;
  const all: AirportInfo[] = [];
  const byIata = new Map<string, AirportInfo>();
  const byIcao = new Map<string, AirportInfo>();
  for (const [iata, icao, name, city, country, lat, lon, tz] of rows as unknown as AirportRow[]) {
    const airport: AirportInfo = { iata, icao: icao || null, name, city: city || name, country, lat, lon, tz: tz || null };
    all.push(airport);
    byIata.set(iata, airport);
    if (icao) byIcao.set(icao, airport);
  }
  index = { all, byIata, byIcao };
  return index;
}

/** ICAO first: it is unique, whereas a few IATA codes are shared by small fields. */
export function findAirport(icao: string | null, iata: string | null): AirportInfo | null {
  const { byIata, byIcao } = airportIndex();
  return (icao && byIcao.get(icao.toUpperCase())) || (iata && byIata.get(iata.toUpperCase())) || null;
}

/**
 * Autocomplete over the table: an exact code first, then codes, cities and
 * names that start with what was typed, then names that contain it. Served
 * from here rather than FlightRadar24, which has no search endpoint.
 */
export function searchAirports(query: string, limit = 8): AirportInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact: AirportInfo[] = [];
  const prefix: AirportInfo[] = [];
  const contains: AirportInfo[] = [];
  for (const airport of airportIndex().all) {
    const iata = airport.iata.toLowerCase();
    const icao = airport.icao?.toLowerCase() ?? '';
    const city = airport.city.toLowerCase();
    const name = airport.name.toLowerCase();
    if (iata === q || icao === q) exact.push(airport);
    else if (iata.startsWith(q) || icao.startsWith(q) || city.startsWith(q) || name.startsWith(q)) prefix.push(airport);
    else if (q.length >= 3 && (city.includes(q) || name.includes(q))) contains.push(airport);
    if (exact.length >= limit) break;
  }
  return [...exact, ...prefix, ...contains].slice(0, limit);
}
