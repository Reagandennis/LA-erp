// Open-Meteo access and formatting for the weather module. Runs in the browser:
// Open-Meteo needs no key, so the page talks to it directly.

export type GeoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  timezone?: string;
};

export type IconKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

export type Forecast = {
  current: {
    /** City-local wall time, e.g. "2026-10-16T12:00" (no offset). */
    time: string;
    temperature: number;
    feelsLike: number;
    isDay: boolean;
    weatherCode: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    uvIndex: number;
    /** Metres. */
    visibility: number;
  };
  daily: Array<{
    /** City-local date, e.g. "2026-10-16". */
    date: string;
    tempMax: number;
    tempMin: number;
    weatherCode: number;
    sunrise: string;
    sunset: string;
  }>;
};

export type CityWeather = {
  city: GeoResult;
  temperature: number;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  isDay: boolean;
};

export const DEFAULT_CITY: GeoResult = {
  id: 184745,
  name: 'Nairobi',
  latitude: -1.28333,
  longitude: 36.81667,
  country: 'Kenya',
  admin1: 'Nairobi County',
  timezone: 'Africa/Nairobi',
};

const WEATHER_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Heavy showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, heavy hail',
};

export function describeWeather(code: number): string {
  return WEATHER_DESCRIPTIONS[code] ?? 'Unknown';
}

export function iconKindFor(code: number): IconKind {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

// --- Formatting -------------------------------------------------------------------

export type TempUnit = 'C' | 'F';

export function toUnit(celsius: number, unit: TempUnit): number {
  return Math.round(unit === 'F' ? (celsius * 9) / 5 + 32 : celsius);
}

/**
 * Open-Meteo returns city-local wall times without an offset, so they are read
 * as UTC and formatted as UTC — the browser's own timezone never shifts them.
 */
function wallClock(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : `${value}:00Z`);
}

export function formatWeekday(value: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat('en-US', { weekday: style, timeZone: 'UTC' }).format(wallClock(value));
}

/** "16 Oct, 2026" */
export function formatDayMonthYear(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(wallClock(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')}, ${get('year')}`;
}

/** "6:14 AM" */
export function formatClock(value: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    wallClock(value),
  );
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Wind direction is where the wind blows *from*. */
export function compassPoint(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

export function humidityLabel(percent: number): string {
  if (percent < 30) return 'Dry air';
  if (percent <= 60) return 'Humidity is good';
  if (percent <= 80) return 'Humid';
  return 'Very humid';
}

export function uvLabel(index: number): string {
  if (index < 3) return 'Low UV';
  if (index < 6) return 'Moderate UV';
  if (index < 8) return 'High UV';
  if (index < 11) return 'Very high UV';
  return 'Extreme UV';
}

export function visibilityLabel(metres: number): string {
  if (metres >= 10_000) return 'Clear view';
  if (metres >= 4_000) return 'Good';
  if (metres >= 1_000) return 'Moderate';
  return 'Poor';
}

export function formatVisibilityKm(metres: number): string {
  const km = metres / 1000;
  return km >= 10 ? String(Math.round(km)) : km.toFixed(1);
}

export function placeLabel(city: GeoResult): string {
  return [city.name, city.country].filter(Boolean).join(', ');
}

// --- Fetching ---------------------------------------------------------------------

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export async function searchPlaces(name: string, count = 6, signal?: AbortSignal): Promise<GeoResult[]> {
  const params = new URLSearchParams({ name, count: String(count), language: 'en', format: 'json' });
  const response = await fetch(`${GEO_URL}?${params}`, { signal });
  if (!response.ok) throw new Error('Location search failed');
  const data = (await response.json()) as { results?: GeoResult[] };
  return data.results ?? [];
}

export async function fetchForecast(city: GeoResult): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    timezone: city.timezone ?? 'auto',
    forecast_days: '10',
    current:
      'temperature_2m,apparent_temperature,is_day,weather_code,relative_humidity_2m,wind_speed_10m,wind_direction_10m,uv_index,visibility',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset',
  });
  const response = await fetch(`${FORECAST_URL}?${params}`);
  if (!response.ok) throw new Error('Forecast request failed');
  const data = (await response.json()) as {
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      is_day: number;
      weather_code: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
      uv_index: number;
      visibility: number;
    };
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      weather_code: number[];
      sunrise: string[];
      sunset: string[];
    };
  };
  const { current, daily } = data;
  return {
    current: {
      time: current.time,
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      isDay: current.is_day === 1,
      weatherCode: current.weather_code,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      windDirection: current.wind_direction_10m,
      uvIndex: current.uv_index ?? 0,
      visibility: current.visibility ?? 0,
    },
    daily: daily.time.map((date, i) => ({
      date,
      tempMax: daily.temperature_2m_max[i],
      tempMin: daily.temperature_2m_min[i],
      weatherCode: daily.weather_code[i],
      sunrise: daily.sunrise[i],
      sunset: daily.sunset[i],
    })),
  };
}

const GEO_CACHE_KEY = 'weather:places:v1';

function readGeoCache(): Record<string, GeoResult> {
  try {
    return JSON.parse(window.localStorage.getItem(GEO_CACHE_KEY) ?? '{}') as Record<string, GeoResult>;
  } catch {
    return {};
  }
}

/**
 * Coordinates for the user's world-clock cities. The clock catalogue only has a
 * name and timezone, so each city is geocoded once (the result whose timezone
 * matches wins) and cached in this browser.
 */
export async function resolveWorldCities(zones: Array<{ city: string; tz: string }>): Promise<GeoResult[]> {
  const cache = readGeoCache();
  const resolved = await Promise.all(
    zones.map(async (zone) => {
      if (cache[zone.tz]) return cache[zone.tz];
      try {
        const results = await searchPlaces(zone.city, 5);
        const match = results.find((r) => r.timezone === zone.tz) ?? results[0];
        if (match) cache[zone.tz] = match;
        return match ?? null;
      } catch {
        return null;
      }
    }),
  );
  try {
    window.localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A cache only.
  }
  return resolved.filter((city): city is GeoResult => city !== null);
}

/** Current conditions and today's range for several cities in one request. */
export async function fetchCitiesWeather(cities: GeoResult[]): Promise<CityWeather[]> {
  if (cities.length === 0) return [];
  const params = new URLSearchParams({
    latitude: cities.map((c) => c.latitude).join(','),
    longitude: cities.map((c) => c.longitude).join(','),
    timezone: 'auto',
    forecast_days: '1',
    current: 'temperature_2m,weather_code,is_day',
    daily: 'temperature_2m_max,temperature_2m_min',
  });
  const response = await fetch(`${FORECAST_URL}?${params}`);
  if (!response.ok) throw new Error('Forecast request failed');
  type Row = {
    current: { temperature_2m: number; weather_code: number; is_day: number };
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
  };
  const data = (await response.json()) as Row | Row[];
  const rows = Array.isArray(data) ? data : [data];
  return rows.map((row, i) => ({
    city: cities[i],
    temperature: row.current.temperature_2m,
    tempMax: row.daily.temperature_2m_max[0],
    tempMin: row.daily.temperature_2m_min[0],
    weatherCode: row.current.weather_code,
    isDay: row.current.is_day === 1,
  }));
}
