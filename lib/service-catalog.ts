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
