// Types, lookups and maths for the flight tracker. Client-safe: the live data
// comes from `/api/flight-radar`, which proxies FlightRadar24 and attaches the
// origin and destination airports.

import type { AirportInfo } from '@/lib/airports';
import { APP_LOCALE } from '@/lib/locale';

export type Airport = AirportInfo;

export type FlightRecord = {
  id: string;
  flight: string | null;
  callsign: string | null;
  hex: string | null;
  lat: number | null;
  lon: number | null;
  track: number | null;
  altFt: number | null;
  gspeedKt: number | null;
  vspeedFpm: number | null;
  type: string | null;
  reg: string | null;
  /** ICAO operator code, e.g. "KQA". */
  airline: string | null;
  origIata: string | null;
  origIcao: string | null;
  destIata: string | null;
  destIcao: string | null;
  eta: string | null;
  origin: Airport | null;
  destination: Airport | null;
};

export type Bounds = { lamin: number; lomin: number; lamax: number; lomax: number };

/** East Africa, centred on Nairobi. */
export const DEFAULT_BOUNDS: Bounds = { lamin: -4.9, lomin: 33.9, lamax: 5.2, lomax: 41.9 };

/**
 * Every area search is a paid FR24 call billed by the flights it returns, so a
 * zoomed-out map is not searched as a whole — flight, airline and airport
 * searches cover the world instead.
 */
export const MAX_AREA_SPAN_DEG = 30;

export type SearchField = 'flight' | 'callsign' | 'airline' | 'airport' | 'registration';
export const SEARCH_PARAM: Record<SearchField, string> = {
  flight: 'flights',
  callsign: 'callsigns',
  airline: 'airline',
  airport: 'airport',
  registration: 'registrations',
};
export const SEARCH_META: Record<SearchField, { label: string; placeholder: string }> = {
  flight: { label: 'Flight', placeholder: 'Flight number, e.g. KQ100' },
  callsign: { label: 'Callsign', placeholder: 'Callsign, e.g. KQA100' },
  airline: { label: 'Airline', placeholder: 'ICAO code, e.g. KQA, QTR' },
  airport: { label: 'Airport', placeholder: 'Code, e.g. NBO, DXB' },
  registration: { label: 'Reg.', placeholder: 'Registration, e.g. 5Y-KZA' },
};

// --- Identity -----------------------------------------------------------------------

export function flightLabel(f: FlightRecord): string {
  return f.flight || f.callsign || f.hex?.toUpperCase() || '—';
}

type AirlineInfo = { name: string; iata: string; color: string; ink?: string };

/** Common operators over East Africa and the main hubs. Colours approximate each livery. */
const AIRLINES: Record<string, AirlineInfo> = {
  KQA: { name: 'Kenya Airways', iata: 'KQ', color: '#B5121B' },
  QTR: { name: 'Qatar Airways', iata: 'QR', color: '#5C0632' },
  UAE: { name: 'Emirates', iata: 'EK', color: '#D71921' },
  ETH: { name: 'Ethiopian Airlines', iata: 'ET', color: '#078930' },
  THY: { name: 'Turkish Airlines', iata: 'TK', color: '#C70A0C' },
  ETD: { name: 'Etihad Airways', iata: 'EY', color: '#A5803A' },
  FDB: { name: 'flydubai', iata: 'FZ', color: '#F26B21' },
  ABY: { name: 'Air Arabia', iata: 'G9', color: '#E31B23' },
  SVA: { name: 'Saudia', iata: 'SV', color: '#006C35' },
  OMA: { name: 'Oman Air', iata: 'WY', color: '#007A87' },
  GFA: { name: 'Gulf Air', iata: 'GF', color: '#9B7A3C' },
  KAC: { name: 'Kuwait Airways', iata: 'KU', color: '#1D3C78' },
  MSR: { name: 'EgyptAir', iata: 'MS', color: '#00265D' },
  RWD: { name: 'RwandAir', iata: 'WB', color: '#1E4D9B' },
  ATC: { name: 'Air Tanzania', iata: 'TC', color: '#1C75BC' },
  PRF: { name: 'Precision Air', iata: 'PW', color: '#0E8A43' },
  SAA: { name: 'South African Airways', iata: 'SA', color: '#00205B' },
  RAM: { name: 'Royal Air Maroc', iata: 'AT', color: '#C1272D' },
  SEY: { name: 'Air Seychelles', iata: 'HM', color: '#D2232A' },
  MAU: { name: 'Air Mauritius', iata: 'MK', color: '#C8102E' },
  BAW: { name: 'British Airways', iata: 'BA', color: '#075AAA' },
  KLM: { name: 'KLM', iata: 'KL', color: '#00A1DE' },
  AFR: { name: 'Air France', iata: 'AF', color: '#002157' },
  DLH: { name: 'Lufthansa', iata: 'LH', color: '#05164D' },
  SWR: { name: 'Swiss', iata: 'LX', color: '#E3000F' },
  AUA: { name: 'Austrian', iata: 'OS', color: '#E20613' },
  BEL: { name: 'Brussels Airlines', iata: 'SN', color: '#002A5C' },
  IBE: { name: 'Iberia', iata: 'IB', color: '#D7192D' },
  TAP: { name: 'TAP Air Portugal', iata: 'TP', color: '#E61E2A' },
  FIN: { name: 'Finnair', iata: 'AY', color: '#0B1560' },
  VIR: { name: 'Virgin Atlantic', iata: 'VS', color: '#DA0530' },
  RYR: { name: 'Ryanair', iata: 'FR', color: '#073590' },
  EZY: { name: 'easyJet', iata: 'U2', color: '#FF6600' },
  WZZ: { name: 'Wizz Air', iata: 'W6', color: '#C6007E' },
  AIC: { name: 'Air India', iata: 'AI', color: '#C8102E' },
  IGO: { name: 'IndiGo', iata: '6E', color: '#001B94' },
  SIA: { name: 'Singapore Airlines', iata: 'SQ', color: '#1D2E5D' },
  CPA: { name: 'Cathay Pacific', iata: 'CX', color: '#006564' },
  CCA: { name: 'Air China', iata: 'CA', color: '#E60012' },
  CSN: { name: 'China Southern', iata: 'CZ', color: '#0B7BC1' },
  CES: { name: 'China Eastern', iata: 'MU', color: '#1A2F6E' },
  ANA: { name: 'All Nippon Airways', iata: 'NH', color: '#13448F' },
  JAL: { name: 'Japan Airlines', iata: 'JL', color: '#CC0000' },
  AAL: { name: 'American Airlines', iata: 'AA', color: '#0078D2' },
  UAL: { name: 'United Airlines', iata: 'UA', color: '#002244' },
  DAL: { name: 'Delta Air Lines', iata: 'DL', color: '#003366' },
  ACA: { name: 'Air Canada', iata: 'AC', color: '#D22630' },
  QFA: { name: 'Qantas', iata: 'QF', color: '#E0001B' },
  FDX: { name: 'FedEx', iata: 'FX', color: '#4D148C' },
  UPS: { name: 'UPS Airlines', iata: '5X', color: '#351C15' },
  CLX: { name: 'Cargolux', iata: 'CV', color: '#C8102E' },
  BCS: { name: 'DHL', iata: 'QY', color: '#FFCC00', ink: '#D40511' },
  DHK: { name: 'DHL', iata: 'D0', color: '#FFCC00', ink: '#D40511' },
};

const FALLBACK_COLORS = ['#3E5C76', '#5B4B8A', '#2F6F62', '#7A4E3A', '#4A6B8A', '#6B4F6B', '#356A84', '#5E6B3A'];

/** `badge` is the two-letter airline code, or null when there is none to show. */
export type Operator = { name: string; badge: string | null; color: string; ink: string };

export function operatorFor(f: FlightRecord): Operator {
  const known = f.airline ? AIRLINES[f.airline] : undefined;
  const prefix = f.flight?.match(/^([A-Z0-9]{2})\d/)?.[1];
  const seed = f.airline ?? prefix ?? f.callsign ?? '';
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return {
    name: known?.name ?? (f.airline ? `Operator ${f.airline}` : 'Unknown operator'),
    badge: known?.iata ?? prefix ?? f.airline?.slice(0, 2) ?? null,
    color: known?.color ?? FALLBACK_COLORS[hash % FALLBACK_COLORS.length],
    ink: known?.ink ?? '#FFFFFF',
  };
}

const AIRCRAFT_NAMES: Record<string, string> = {
  A19N: 'Airbus A319neo', A20N: 'Airbus A320neo', A21N: 'Airbus A321neo',
  A306: 'Airbus A300-600', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A338: 'Airbus A330-800', A339: 'Airbus A330-900',
  A343: 'Airbus A340-300', A359: 'Airbus A350-900', A35K: 'Airbus A350-1000', A388: 'Airbus A380-800',
  BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300',
  B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900',
  B37M: 'Boeing 737 MAX 7', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', B752: 'Boeing 757-200',
  B762: 'Boeing 767-200', B763: 'Boeing 767-300', B764: 'Boeing 767-400',
  B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B773: 'Boeing 777-300', B77W: 'Boeing 777-300ER',
  B788: 'Boeing 787-8', B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  E170: 'Embraer E170', E175: 'Embraer E175', E190: 'Embraer E190', E195: 'Embraer E195',
  E290: 'Embraer E190-E2', E295: 'Embraer E195-E2', E55P: 'Embraer Phenom 300',
  AT43: 'ATR 42-300', AT45: 'ATR 42-500', AT72: 'ATR 72', AT75: 'ATR 72-500', AT76: 'ATR 72-600',
  DH8A: 'Dash 8-100', DH8B: 'Dash 8-200', DH8C: 'Dash 8-300', DH8D: 'Dash 8 Q400',
  DHC6: 'DHC-6 Twin Otter', CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900',
  C208: 'Cessna 208 Caravan', B350: 'King Air 350', PC12: 'Pilatus PC-12', L410: 'Let L-410',
  F50: 'Fokker 50', MD11: 'MD-11', GLF6: 'Gulfstream G650', GLEX: 'Bombardier Global Express',
  CL60: 'Bombardier Challenger 600', C68A: 'Cessna Citation Latitude',
};

export const aircraftName = (code: string | null) => (code ? (AIRCRAFT_NAMES[code] ?? code) : 'Unknown aircraft');

/** Registration prefix → ISO country. Hyphenated prefixes keep their hyphen. */
const REGISTRATION_PREFIXES: Array<[string, string]> = [
  ['5Y-', 'KE'], ['5H-', 'TZ'], ['5X-', 'UG'], ['9XR-', 'RW'], ['9X-', 'RW'], ['ET-', 'ET'], ['6O-', 'SO'],
  ['J2-', 'DJ'], ['E3-', 'ER'], ['ST-', 'SD'], ['SU-', 'EG'], ['5A-', 'LY'], ['TS-', 'TN'], ['7T-', 'DZ'],
  ['CN-', 'MA'], ['5N-', 'NG'], ['9G-', 'GH'], ['TU-', 'CI'], ['6V-', 'SN'], ['D4-', 'CV'], ['TJ-', 'CM'],
  ['TN-', 'CG'], ['9Q-', 'CD'], ['D2-', 'AO'], ['9J-', 'ZM'], ['Z-', 'ZW'], ['7Q-', 'MW'], ['C9-', 'MZ'],
  ['A2-', 'BW'], ['V5-', 'NA'], ['ZS-', 'ZA'], ['5R-', 'MG'], ['3B-', 'MU'], ['S7-', 'SC'],
  ['A7-', 'QA'], ['A6-', 'AE'], ['A4O-', 'OM'], ['A9C-', 'BH'], ['9K-', 'KW'], ['HZ-', 'SA'], ['JY-', 'JO'],
  ['OD-', 'LB'], ['4X-', 'IL'], ['YI-', 'IQ'], ['EP-', 'IR'], ['YK-', 'SY'], ['7O-', 'YE'],
  ['TC-', 'TR'], ['AP-', 'PK'], ['VT-', 'IN'], ['4R-', 'LK'], ['S2-', 'BD'], ['9N-', 'NP'],
  ['9V-', 'SG'], ['9M-', 'MY'], ['HS-', 'TH'], ['PK-', 'ID'], ['RP-', 'PH'], ['B-H', 'HK'], ['B-M', 'MO'],
  ['B-', 'CN'], ['VH-', 'AU'], ['ZK-', 'NZ'],
  ['G-', 'GB'], ['EI-', 'IE'], ['F-', 'FR'], ['D-', 'DE'], ['PH-', 'NL'], ['OO-', 'BE'], ['LX-', 'LU'],
  ['HB-', 'CH'], ['OE-', 'AT'], ['I-', 'IT'], ['EC-', 'ES'], ['CS-', 'PT'], ['SE-', 'SE'], ['LN-', 'NO'],
  ['OY-', 'DK'], ['OH-', 'FI'], ['TF-', 'IS'], ['SP-', 'PL'], ['OK-', 'CZ'], ['OM-', 'SK'], ['HA-', 'HU'],
  ['YR-', 'RO'], ['LZ-', 'BG'], ['SX-', 'GR'], ['5B-', 'CY'], ['9H-', 'MT'], ['9A-', 'HR'], ['S5-', 'SI'],
  ['YU-', 'RS'], ['ES-', 'EE'], ['YL-', 'LV'], ['LY-', 'LT'], ['UR-', 'UA'], ['EW-', 'BY'], ['ER-', 'MD'],
  ['RA-', 'RU'], ['4L-', 'GE'], ['EK-', 'AM'], ['4K-', 'AZ'], ['UP-', 'KZ'], ['UK-', 'UZ'], ['EX-', 'KG'],
  ['T7-', 'SM'], ['M-', 'IM'], ['2-', 'GG'], ['VP-B', 'BM'], ['VQ-B', 'BM'], ['VP-C', 'KY'], ['P4-', 'AW'],
  ['C-', 'CA'], ['XA-', 'MX'], ['PR-', 'BR'], ['PP-', 'BR'], ['PT-', 'BR'], ['PS-', 'BR'], ['LV-', 'AR'],
  ['CC-', 'CL'], ['OB-', 'PE'], ['HK-', 'CO'], ['YV-', 'VE'],
].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;

export function registrationCountry(reg: string | null): string | null {
  if (!reg) return null;
  const r = reg.toUpperCase();
  if (/^N\d/.test(r)) return 'US';
  if (/^JA\d/.test(r)) return 'JP';
  if (/^HL\d/.test(r)) return 'KR';
  return REGISTRATION_PREFIXES.find(([prefix]) => r.startsWith(prefix))?.[1] ?? null;
}

let regionNames: Intl.DisplayNames | null = null;
export function countryName(iso: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/** Regional-indicator flag; Windows shows the two letters instead, which still reads. */
export function flagEmoji(iso: string): string {
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

// --- Motion and progress --------------------------------------------------------------

export const isOnGround = (f: FlightRecord) => (f.altFt ?? 99999) < 150 && (f.gspeedKt ?? 0) < 50;

export function phaseLabel(f: FlightRecord): string {
  if (isOnGround(f)) return 'On ground';
  const rate = f.vspeedFpm ?? 0;
  if (rate > 120) return 'Climbing';
  if (rate < -120) return 'Descending';
  return 'Cruising';
}

type LatLon = { lat: number; lon: number };
const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Points along the great circle from a to b. Longitudes are unwrapped so a
 * route over the antimeridian draws as one line rather than across the map.
 */
export function greatCircle(a: LatLon, b: LatLon, steps = 48): Array<[number, number]> {
  const lat1 = rad(a.lat), lon1 = rad(a.lon), lat2 = rad(b.lat), lon2 = rad(b.lon);
  const d = distanceKm(a, b) / EARTH_KM;
  if (d < 1e-6) return [[a.lat, a.lon], [b.lat, b.lon]];
  const points: Array<[number, number]> = [];
  let previous = a.lon;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    let lon = deg(Math.atan2(y, x));
    while (lon - previous > 180) lon -= 360;
    while (lon - previous < -180) lon += 360;
    previous = lon;
    points.push([deg(Math.atan2(z, Math.hypot(x, y))), lon]);
  }
  return points;
}

export type Progress = { flownKm: number; remainingKm: number; fraction: number };

/** Straight-line (great-circle) progress; null when either airport or the position is unknown. */
export function routeProgress(f: FlightRecord): Progress | null {
  if (!f.origin || !f.destination || f.lat === null || f.lon === null) return null;
  const here = { lat: f.lat, lon: f.lon };
  const flownKm = distanceKm(f.origin, here);
  const remainingKm = distanceKm(here, f.destination);
  const total = flownKm + remainingKm;
  return { flownKm, remainingKm, fraction: total > 0 ? flownKm / total : 0 };
}

// --- Formatting -------------------------------------------------------------------

export const formatNumber = (n: number | null) => (n === null ? '—' : Math.round(n).toLocaleString(APP_LOCALE));
export const ktToKmh = (kt: number) => kt * 1.852;
export const ftToM = (ft: number) => ft * 0.3048;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compassPoint = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

export function etaInfo(iso: string | null, now: number): { minutes: number | null; time: string } {
  if (!iso) return { minutes: null, time: '—' };
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return { minutes: null, time: '—' };
  return {
    minutes: Math.round((at - now) / 60_000),
    time: new Date(at).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' }),
  };
}

// --- Aircraft photos ------------------------------------------------------------------

export type AircraftPhoto = { src: string; width: number; height: number; link: string; photographer: string };

/**
 * Planespotters.net's free photo API. Its terms ask for the photographer's name
 * and a link back to the photo page wherever a photo is shown.
 */
const PHOTO_API = 'https://api.planespotters.net/pub/photos';
const photoCache = new Map<string, Promise<AircraftPhoto | null>>();

async function photoFrom(path: string): Promise<AircraftPhoto | null> {
  const response = await fetch(`${PHOTO_API}/${path}`);
  if (!response.ok) return null;
  const data = (await response.json()) as {
    photos?: Array<{
      thumbnail_large?: { src: string; size: { width: number; height: number } };
      link: string;
      photographer: string;
    }>;
  };
  const photo = data.photos?.find((p) => p.thumbnail_large);
  if (!photo?.thumbnail_large) return null;
  return {
    src: photo.thumbnail_large.src,
    width: photo.thumbnail_large.size.width,
    height: photo.thumbnail_large.size.height,
    link: photo.link,
    photographer: photo.photographer,
  };
}

export function aircraftPhoto(hex: string | null, reg: string | null): Promise<AircraftPhoto | null> {
  const key = `${hex ?? ''}|${reg ?? ''}`;
  let pending = photoCache.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        // The transponder code identifies today's airframe; the registration is the fallback.
        return (
          (hex ? await photoFrom(`hex/${encodeURIComponent(hex)}`) : null) ??
          (reg ? await photoFrom(`reg/${encodeURIComponent(reg)}`) : null)
        );
      } catch {
        return null;
      }
    })();
    photoCache.set(key, pending);
  }
  return pending;
}

export function flightradarLink(f: FlightRecord): string | null {
  if (f.flight) return `https://www.flightradar24.com/data/flights/${f.flight.toLowerCase()}`;
  if (f.reg) return `https://www.flightradar24.com/data/aircraft/${f.reg.toLowerCase()}`;
  return null;
}
