import 'server-only';

import rows from './airlines-data.json';

/**
 * Active airlines with an IATA or ICAO code: [name, iata, icao]. Built from
 * OpenFlights (https://openflights.org/data, ODbL). Names a flight number's
 * carrier without a paid call; FlightRadar24's airline endpoint fills in the
 * few it doesn't know (lib/flight-lookup).
 */
type AirlineRow = [string, string, string];

export interface AirlineInfo {
  name: string;
  iata: string | null;
  icao: string | null;
}

let index: { byIata: Map<string, AirlineInfo>; byIcao: Map<string, AirlineInfo> } | null = null;

function airlineIndex() {
  if (index) return index;
  const byIata = new Map<string, AirlineInfo>();
  const byIcao = new Map<string, AirlineInfo>();
  for (const [name, iata, icao] of rows as unknown as AirlineRow[]) {
    const airline: AirlineInfo = { name, iata: iata || null, icao: icao || null };
    if (iata) byIata.set(iata, airline);
    if (icao) byIcao.set(icao, airline);
  }
  index = { byIata, byIcao };
  return index;
}

/** ICAO first: it is unique, whereas IATA codes get reused. */
export function findAirline(icao: string | null, iata: string | null): AirlineInfo | null {
  const { byIata, byIcao } = airlineIndex();
  return (icao && byIcao.get(icao.toUpperCase())) || (iata && byIata.get(iata.toUpperCase())) || null;
}

/** "KQ100" → "KQ", "6E123" → "6E": the two characters before the digits, as IATA writes flight numbers. */
export function airlineCodeOf(flightNumber: string): string | null {
  const match = /^([A-Z][A-Z0-9]|[0-9][A-Z])(?=[0-9])/.exec(flightNumber.toUpperCase());
  return match?.[1] ?? null;
}
