/**
 * The standardized service catalog's vocabulary, from the Standardized Naming
 * Master (prisma/data/standard-services.json). Products & Services keeps the
 * services; Trip Planning picks from them. Client-safe.
 */

export const SERVICE_CATEGORIES = [
  'Airport Services',
  'Transfers',
  'Vehicle Hire',
  'Personnel',
  'Excursion & Safari',
  'Packages',
  'Add-Ons',
  'Surcharges',
  'Escort',
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const SERVICE_COUNTRIES = [
  'Kenya',
  'Ethiopia',
  'Uganda',
  'Tanzania',
  'Nigeria',
  'South Africa',
  'South Sudan',
  'Rwanda',
  'Ghana',
  'Zambia',
] as const;

export type ServiceCountry = (typeof SERVICE_COUNTRIES)[number];

/** The master's three-letter country tokens, which start every service code. */
export const SERVICE_COUNTRY_CODES: Record<ServiceCountry, string> = {
  Kenya: 'KEN',
  Ethiopia: 'ETH',
  Uganda: 'UGA',
  Tanzania: 'TZA',
  Nigeria: 'NGA',
  'South Africa': 'ZAF',
  'South Sudan': 'SSD',
  Rwanda: 'RWA',
  Ghana: 'GHA',
  Zambia: 'ZMB',
};

/** Standard / Executive / Luxury for vehicles; Level 1 (entry) to Level 3 (senior) for personnel. */
export const SERVICE_TIERS = ['Standard', 'Executive', 'Luxury', 'Level 1', 'Level 2', 'Level 3'] as const;

export const UNITS_OF_MEASURE = [
  'Per one-way transfer',
  'Per day',
  'Per person / per day',
  'Per traveler',
  'Per person / per visit',
  'Per arrival',
  'Per movement',
  'Per hour',
  'Per km',
  'Per bundle',
] as const;

/** The master's naming rules, shown beside the fields they govern. */
export const NAMING_RULES = {
  code: {
    rule: 'Country - Category - [Class] - [Tier] - [FD/OT/P2P] - City. Unique, never reused.',
    example: 'KEN-TRF-SUV-EXE-NBO',
  },
  name: { rule: 'Category - Class Tier - Location, general to specific.', example: 'Airport Transfer - SUV Executive - Nairobi (NBO)' },
  quickbooks: {
    rule: 'Category:Sub-Category:Class Tier:Location. Colons build the QuickBooks hierarchy.',
    example: 'Transfers:Airport Transfer:SUV Executive:Nairobi (NBO)',
  },
} as const;

/** A service as Trip Planning's picker offers it. The price is left out for people who can't see costs. */
export interface ServiceOption {
  id: number;
  code: string | null;
  name: string;
  category: string | null;
  subCategory: string | null;
  serviceClass: string | null;
  tier: string | null;
  country: string | null;
  location: string | null;
  unitOfMeasure: string | null;
  defaultUnitPrice?: number;
  currency?: string;
}

/** A transport event's Type: our services first, then other people's. */
export const TRANSPORT_TYPES = [
  'Airport Transfer',
  'Point-to-Point Transfer',
  'Full Day Hire',
  'Out of Town Hire',
  'Excursion & Safari',
  'Escort',
  'Taxi',
  'Train',
  'Bus',
  'Ferry',
  'Other',
] as const;

/** The Type a transport event takes from the service it sells, if it is a movement. */
export function transportTypeForService(service: { category: string | null; subCategory: string | null }): string | null {
  switch (service.category) {
    case 'Transfers':
      if (service.subCategory === 'Airport Transfer') return 'Airport Transfer';
      if (service.subCategory?.startsWith('Point-to-Point')) return 'Point-to-Point Transfer';
      return null;
    case 'Vehicle Hire':
      if (service.subCategory === 'Full Day') return 'Full Day Hire';
      if (service.subCategory === 'Out of Town') return 'Out of Town Hire';
      return null;
    case 'Excursion & Safari':
      return 'Excursion & Safari';
    case 'Escort':
      return 'Escort';
    default:
      return null;
  }
}

/** The catalog category an event of this kind usually sells; the picker opens on it. */
export function defaultServiceCategory(eventCategory: string): ServiceCategory | null {
  switch (eventCategory) {
    case 'flight':
      return 'Airport Services';
    case 'transportation':
      return 'Transfers';
    case 'tour':
      return 'Excursion & Safari';
    default:
      return null;
  }
}

export function serviceMatches(service: ServiceOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [service.name, service.code, service.location, service.country, service.serviceClass]
    .some((value) => value?.toLowerCase().includes(q));
}

// Only the place's name is read (up to the first comma), so "Airport Road" in a
// hotel's address or "Hilton Garden Inn Nairobi Airport" don't count. The 2026
// migration that relabelled "Private transfer" uses the same two patterns.
const AIRPORT_PLACE =
  /(\b(airports?|airort|aiport|airstrip)\b|\bjkia\b|jomo kenyatta|uwanja wa ndege|kotoka|^entebbe\b|julius nyerere|murtala|nnamdi azikiwe|kenneth kaunda|\bo\.? ?r\.? tambo|\bbole (addis|international|internatoional|airport))/;
const NOT_AN_AIRPORT =
  /(hotel|\binn\b|plaza|sheraton|hilton|doubletree|crowne|lodge|suites|resort|\bmall\b|school|bank|\broad\b|street|roundabout|convention|building|apartment|office|university|campus|cent(re|er))/;

export function isAirportPlace(place: string | null | undefined): boolean {
  const name = (place ?? '').split(',')[0].trim().toLowerCase();
  return AIRPORT_PLACE.test(name) && !NOT_AN_AIRPORT.test(name);
}

/** A movement touching an airport is an Airport Transfer; anything else is Point-to-Point. */
export function transportTypeForRoute(places: Array<string | null | undefined>): 'Airport Transfer' | 'Point-to-Point Transfer' {
  return places.some(isAirportPlace) ? 'Airport Transfer' : 'Point-to-Point Transfer';
}

// --- Several services on one event ------------------------------------------

/**
 * An event can sell more than one catalog service (a transfer plus a meet and
 * greet). They live in the event's `service` and `serviceCode` details as
 * plain text, joined with these separators, so every reader of those fields
 * — cards, PDFs, the client's share page, search — shows them unchanged.
 */
export const SERVICE_NAME_JOIN = ' + ';
export const SERVICE_CODE_JOIN = ', ';
export const MAX_SERVICES_PER_EVENT = 8;

export interface PickedService {
  name: string;
  code: string;
}

/**
 * The catalog's own " + ", inside one name: every Vehicle Hire and Excursion
 * service is "<vehicle> + Security Driver …" or "<vehicle> + Driver Guide …".
 * Such a half belongs to the name before it, not to a service of its own.
 */
const NAME_CONTINUES = /^(security driver|driver guide)\b/i;

/**
 * The services an event's details hold, in the order they were picked.
 *
 * Names are split on " + ", which some catalog names contain themselves. The
 * codes are positional, so when there are any they say how many services there
 * really are; halves the split tore apart are put back together to match.
 */
export function splitServices(service: string | null | undefined, serviceCode: string | null | undefined): PickedService[] {
  const parts = (service ?? '').split(SERVICE_NAME_JOIN).map((n) => n.trim()).filter(Boolean);
  const codes = (serviceCode ?? '').split(SERVICE_CODE_JOIN).map((c) => c.trim());
  const expected = (serviceCode ?? '').trim() ? codes.length : null;

  let names = parts;
  if (expected === null || parts.length > expected) {
    let surplus = expected === null ? Infinity : parts.length - expected;
    names = [];
    for (const part of parts) {
      if (names.length > 0 && surplus > 0 && NAME_CONTINUES.test(part)) {
        names[names.length - 1] += SERVICE_NAME_JOIN + part;
        surplus -= 1;
      } else {
        names.push(part);
      }
    }
    // One code means one service, whatever its name looks like.
    if (expected === 1 && names.length > 1) names = [names.join(SERVICE_NAME_JOIN)];
  }
  return names.map((name, i) => ({ name, code: codes[i] ?? '' }));
}

/** Back into the two detail fields. A code is kept positional, so an uncoded service holds its slot. */
export function joinServices(services: PickedService[]): { service: string; serviceCode: string } {
  const kept = services.filter((s) => s.name.trim());
  return {
    service: kept.map((s) => s.name.trim()).join(SERVICE_NAME_JOIN),
    serviceCode: kept.some((s) => s.code) ? kept.map((s) => s.code.trim()).join(SERVICE_CODE_JOIN) : '',
  };
}
