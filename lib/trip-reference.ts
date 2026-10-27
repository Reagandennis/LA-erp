/**
 * Trip references: "MCF-KEN-OCT-2661". The client's code, the country's
 * three-letter token from the Standardized Naming Master, the month the trip
 * starts, and one running number shared by every trip, carried on from
 * FileMaker's numbering. Built on the server when a trip is created; the trip
 * form shows the same thing as a preview. Client-safe.
 */
import { SERVICE_COUNTRIES, SERVICE_COUNTRY_CODES, type ServiceCountry } from './service-catalog';

export const REFERENCE_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** Codes older references used before the master settled them. */
const LEGACY_COUNTRY_CODES: Record<string, ServiceCountry> = {
  UG: 'Uganda',
  TZ: 'Tanzania',
  SA: 'South Africa',
  NIG: 'Nigeria',
  NGR: 'Nigeria',
};

// "MCF-KEN-OCT-2656", and Mastercard Foundation's "MCF-X-KEN-JAN-1600".
const REFERENCE_SHAPE = /^([A-Z0-9]+)-(?:X-)?([A-Z]{2,3})-/;

// Words that don't earn a letter in a suggested client code.
const FILLER = new Set(['of', 'the', 'and', '&', 'for', 'ltd', 'limited', 'llc', 'inc', 'plc', 'co', 's.c.']);

export function isServiceCountry(value: unknown): value is ServiceCountry {
  return typeof value === 'string' && (SERVICE_COUNTRIES as readonly string[]).includes(value);
}

export function countryForCode(code: string): ServiceCountry | null {
  const upper = code.toUpperCase();
  const current = SERVICE_COUNTRIES.find((country) => SERVICE_COUNTRY_CODES[country] === upper);
  return current ?? LEGACY_COUNTRY_CODES[upper] ?? null;
}

/** Letters and digits only, upper case: what a reference's first part can hold. */
export function normalizeClientCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

/** A first code for a client with no trips yet: "Mastercard Foundation" → "MF". */
export function suggestClientCode(name: string): string {
  const words = name.split(/[\s,-]+/).filter((word) => word && !FILLER.has(word.toLowerCase()));
  const initials = normalizeClientCode(words.map((word) => word[0]).join('')).slice(0, 5);
  return initials.length >= 2 ? initials : normalizeClientCode(name).slice(0, 4) || 'CLIENT';
}

/** The month the trip starts, from "YYYY-MM-DD"; today's when it has no date yet. */
export function referenceMonth(startDate: string | null | undefined, today: string): string {
  const month = Number((/^\d{4}-(\d{2})/.exec(startDate ?? '') ?? /^\d{4}-(\d{2})/.exec(today))?.[1]);
  return REFERENCE_MONTHS[month - 1] ?? REFERENCE_MONTHS[0];
}

/** Four digits at least, like FileMaker's. */
export function referenceNumber(n: number): string {
  return String(n).padStart(4, '0');
}

export function buildTripReference(parts: {
  clientCode: string;
  country: ServiceCountry;
  month: string;
  number: number;
}): string {
  return [parts.clientCode, SERVICE_COUNTRY_CODES[parts.country], parts.month, referenceNumber(parts.number)].join('-');
}

/** The client code and country an existing reference was written with. */
export function parseTripReference(reference: string): { clientCode: string; country: ServiceCountry | null } | null {
  const match = REFERENCE_SHAPE.exec(reference.trim().toUpperCase());
  return match ? { clientCode: match[1]!, country: countryForCode(match[2]!) } : null;
}

/**
 * Each client's usual code and country, from their trips' references: the
 * most common, and the most recent of equals. `rows` come newest first.
 */
export function referenceDefaults(
  rows: Array<{ customerId: number; reference: string }>,
): Map<number, { clientCode: string; country: ServiceCountry | null }> {
  const tallies = new Map<number, { codes: Map<string, number>; countries: Map<ServiceCountry, number> }>();
  for (const row of rows) {
    const parsed = parseTripReference(row.reference);
    if (!parsed) continue;
    const tally = tallies.get(row.customerId) ?? { codes: new Map(), countries: new Map() };
    tally.codes.set(parsed.clientCode, (tally.codes.get(parsed.clientCode) ?? 0) + 1);
    if (parsed.country) tally.countries.set(parsed.country, (tally.countries.get(parsed.country) ?? 0) + 1);
    tallies.set(row.customerId, tally);
  }
  // Maps keep insertion order, so the first of equals is the most recent.
  const top = <K>(counts: Map<K, number>): K | null =>
    [...counts].reduce<[K, number] | null>((best, entry) => (!best || entry[1] > best[1] ? entry : best), null)?.[0] ?? null;
  return new Map(
    [...tallies].map(([customerId, tally]) => [customerId, { clientCode: top(tally.codes)!, country: top(tally.countries) }]),
  );
}
