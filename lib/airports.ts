import 'server-only';

import rows from './airports-data.json';

/**
 * Airports with an IATA code that are large, medium or have scheduled service:
 * [iata, icao, name, city, ISO country, lat, lon]. Built from OurAirports
 * (https://ourairports.com/data/, public domain). Server-only: the table is
 * ~400 KB, so flights are enriched in the API rather than in the browser.
 */
type AirportRow = [string, string, string, string, string, number, number];

export type AirportInfo = {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lon: number;
};

let index: { byIata: Map<string, AirportInfo>; byIcao: Map<string, AirportInfo> } | null = null;

function airportIndex() {
  if (index) return index;
  const byIata = new Map<string, AirportInfo>();
  const byIcao = new Map<string, AirportInfo>();
  for (const [iata, icao, name, city, country, lat, lon] of rows as unknown as AirportRow[]) {
    const airport: AirportInfo = { iata, icao: icao || null, name, city: city || name, country, lat, lon };
    byIata.set(iata, airport);
    if (icao) byIcao.set(icao, airport);
  }
  index = { byIata, byIcao };
  return index;
}

/** ICAO first: it is unique, whereas a few IATA codes are shared by small fields. */
export function findAirport(icao: string | null, iata: string | null): AirportInfo | null {
  const { byIata, byIcao } = airportIndex();
  return (icao && byIcao.get(icao.toUpperCase())) || (iata && byIata.get(iata.toUpperCase())) || null;
}
