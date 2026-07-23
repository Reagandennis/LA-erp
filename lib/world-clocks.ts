// Shared by the server (layout preload, API validation) and the client ticker,
// so this module deliberately avoids `server-only`.

export interface WorldClockZone {
  /** IANA timezone identifier — also the stable storage key. */
  tz: string;
  city: string;
  region: string;
}

/** Upper bound on how many clocks one user may pin to the ticker. */
export const MAX_WORLD_CLOCKS = 16;

export const WORLD_CLOCK_ZONES: WorldClockZone[] = [
  { city: 'Nairobi', tz: 'Africa/Nairobi', region: 'Africa' },
  { city: 'Kampala', tz: 'Africa/Kampala', region: 'Africa' },
  { city: 'Dar es Salaam', tz: 'Africa/Dar_es_Salaam', region: 'Africa' },
  { city: 'Addis Ababa', tz: 'Africa/Addis_Ababa', region: 'Africa' },
  { city: 'Lagos', tz: 'Africa/Lagos', region: 'Africa' },
  { city: 'Accra', tz: 'Africa/Accra', region: 'Africa' },
  { city: 'Cairo', tz: 'Africa/Cairo', region: 'Africa' },
  { city: 'Casablanca', tz: 'Africa/Casablanca', region: 'Africa' },
  { city: 'Johannesburg', tz: 'Africa/Johannesburg', region: 'Africa' },
  { city: 'Kinshasa', tz: 'Africa/Kinshasa', region: 'Africa' },

  { city: 'London', tz: 'Europe/London', region: 'Europe' },
  { city: 'Dublin', tz: 'Europe/Dublin', region: 'Europe' },
  { city: 'Lisbon', tz: 'Europe/Lisbon', region: 'Europe' },
  { city: 'Paris', tz: 'Europe/Paris', region: 'Europe' },
  { city: 'Berlin', tz: 'Europe/Berlin', region: 'Europe' },
  { city: 'Madrid', tz: 'Europe/Madrid', region: 'Europe' },
  { city: 'Rome', tz: 'Europe/Rome', region: 'Europe' },
  { city: 'Amsterdam', tz: 'Europe/Amsterdam', region: 'Europe' },
  { city: 'Zurich', tz: 'Europe/Zurich', region: 'Europe' },
  { city: 'Stockholm', tz: 'Europe/Stockholm', region: 'Europe' },
  { city: 'Athens', tz: 'Europe/Athens', region: 'Europe' },
  { city: 'Kyiv', tz: 'Europe/Kyiv', region: 'Europe' },
  { city: 'Istanbul', tz: 'Europe/Istanbul', region: 'Europe' },
  { city: 'Moscow', tz: 'Europe/Moscow', region: 'Europe' },

  { city: 'Tel Aviv', tz: 'Asia/Tel_Aviv', region: 'Middle East' },
  { city: 'Riyadh', tz: 'Asia/Riyadh', region: 'Middle East' },
  { city: 'Doha', tz: 'Asia/Qatar', region: 'Middle East' },
  { city: 'Dubai', tz: 'Asia/Dubai', region: 'Middle East' },

  { city: 'Karachi', tz: 'Asia/Karachi', region: 'Asia' },
  { city: 'Mumbai', tz: 'Asia/Kolkata', region: 'Asia' },
  { city: 'Dhaka', tz: 'Asia/Dhaka', region: 'Asia' },
  { city: 'Bangkok', tz: 'Asia/Bangkok', region: 'Asia' },
  { city: 'Jakarta', tz: 'Asia/Jakarta', region: 'Asia' },
  { city: 'Kuala Lumpur', tz: 'Asia/Kuala_Lumpur', region: 'Asia' },
  { city: 'Singapore', tz: 'Asia/Singapore', region: 'Asia' },
  { city: 'Hong Kong', tz: 'Asia/Hong_Kong', region: 'Asia' },
  { city: 'Shanghai', tz: 'Asia/Shanghai', region: 'Asia' },
  { city: 'Manila', tz: 'Asia/Manila', region: 'Asia' },
  { city: 'Seoul', tz: 'Asia/Seoul', region: 'Asia' },
  { city: 'Tokyo', tz: 'Asia/Tokyo', region: 'Asia' },

  { city: 'Perth', tz: 'Australia/Perth', region: 'Oceania' },
  { city: 'Brisbane', tz: 'Australia/Brisbane', region: 'Oceania' },
  { city: 'Sydney', tz: 'Australia/Sydney', region: 'Oceania' },
  { city: 'Auckland', tz: 'Pacific/Auckland', region: 'Oceania' },

  { city: 'Vancouver', tz: 'America/Vancouver', region: 'Americas' },
  { city: 'Los Angeles', tz: 'America/Los_Angeles', region: 'Americas' },
  { city: 'Denver', tz: 'America/Denver', region: 'Americas' },
  { city: 'Mexico City', tz: 'America/Mexico_City', region: 'Americas' },
  { city: 'Chicago', tz: 'America/Chicago', region: 'Americas' },
  { city: 'Toronto', tz: 'America/Toronto', region: 'Americas' },
  { city: 'New York', tz: 'America/New_York', region: 'Americas' },
  { city: 'Bogotá', tz: 'America/Bogota', region: 'Americas' },
  { city: 'Lima', tz: 'America/Lima', region: 'Americas' },
  { city: 'Santiago', tz: 'America/Santiago', region: 'Americas' },
  { city: 'Buenos Aires', tz: 'America/Argentina/Buenos_Aires', region: 'Americas' },
  { city: 'São Paulo', tz: 'America/Sao_Paulo', region: 'Americas' },
];

/** The line-up the ticker has always shown — used until a user picks their own. */
export const DEFAULT_WORLD_CLOCK_TZS = [
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'America/New_York',
  'America/Los_Angeles',
  'America/Sao_Paulo',
];

export const WORLD_CLOCK_REGIONS = [
  'Africa',
  'Europe',
  'Middle East',
  'Asia',
  'Oceania',
  'Americas',
];

const ZONES_BY_TZ = new Map(WORLD_CLOCK_ZONES.map((zone) => [zone.tz, zone]));

export function findWorldClockZone(tz: string) {
  return ZONES_BY_TZ.get(tz) ?? null;
}

/**
 * Turns a stored list of timezone ids into renderable zones: unknown entries are
 * dropped (the catalogue may change between releases), duplicates collapse, the
 * list is capped, and an empty result falls back to the default line-up.
 */
export function resolveWorldClockZones(stored: string[]): WorldClockZone[] {
  const seen = new Set<string>();
  const zones: WorldClockZone[] = [];

  for (const tz of stored) {
    const zone = ZONES_BY_TZ.get(tz);

    if (zone && !seen.has(tz)) {
      seen.add(tz);
      zones.push(zone);
    }

    if (zones.length >= MAX_WORLD_CLOCKS) {
      break;
    }
  }

  if (zones.length > 0) {
    return zones;
  }

  return DEFAULT_WORLD_CLOCK_TZS.map((tz) => ZONES_BY_TZ.get(tz)).filter(
    (zone): zone is WorldClockZone => Boolean(zone),
  );
}
