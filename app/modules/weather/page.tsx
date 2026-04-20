'use client';

import { useEffect, useMemo, useState } from 'react';

type GeoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  timezone?: string;
};

type WeatherResult = {
  temperature: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  time: string;
  humidity: number;
  precipitation: number;
};

type DailyResult = {
  date: string;
  tempMax: number;
  tempMin: number;
  sunrise: string;
  sunset: string;
  weatherCode: number;
};

type HourlyResult = {
  time: string;
  temperature: number;
  precipitation: number;
  windSpeed: number;
};

const DEFAULT_CITY = 'Nairobi';

const weatherDescriptions: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

const weatherIconMap: Array<{ codes: number[]; icon: string; animation: string }> = [
  { codes: [0, 1], icon: '☀️', animation: 'animate-pulse' },
  { codes: [2, 3], icon: '⛅️', animation: 'animate-bounce' },
  { codes: [45, 48], icon: '🌫️', animation: 'animate-pulse' },
  { codes: [51, 53, 55, 56, 57], icon: '🌦️', animation: 'animate-pulse' },
  { codes: [61, 63, 65, 80, 81, 82], icon: '🌧️', animation: 'animate-pulse' },
  { codes: [66, 67], icon: '🌧️', animation: 'animate-pulse' },
  { codes: [71, 73, 75, 77, 85, 86], icon: '❄️', animation: 'animate-pulse' },
  { codes: [95, 96, 99], icon: '⛈️', animation: 'animate-bounce' },
];

const resolveWeatherVisual = (code?: number) => {
  if (code === undefined || code === null) {
    return { icon: '🌤️', animation: 'animate-pulse' };
  }
  for (const item of weatherIconMap) {
    if (item.codes.includes(code)) {
      return { icon: item.icon, animation: item.animation };
    }
  }
  return { icon: '🌤️', animation: 'animate-pulse' };
};

const formatLocalTime = (iso: string, timezone?: string) => {
  const date = new Date(iso);
  if (!timezone) {
    return date.toLocaleString();
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export default function WeatherPage() {
  const [search, setSearch] = useState(DEFAULT_CITY);
  const [query, setQuery] = useState(DEFAULT_CITY);
  const [selectedCity, setSelectedCity] = useState<GeoResult | null>(null);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [current, setCurrent] = useState<WeatherResult | null>(null);
  const [daily, setDaily] = useState<DailyResult[]>([]);
  const [hourly, setHourly] = useState<HourlyResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'temperature' | 'precipitation' | 'wind'>('temperature');

  useEffect(() => {
    let isActive = true;
    const fetchGeo = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`,
        );
        if (!response.ok) {
          throw new Error('Unable to search location');
        }
        const data = (await response.json()) as { results?: GeoResult[] };
        if (!isActive) {
          return;
        }
        const locations = data.results ?? [];
        setResults(locations);
        setSelectedCity(locations[0] ?? null);
      } catch {
        if (isActive) {
          setError('Unable to load location. Try again.');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchGeo();
    return () => {
      isActive = false;
    };
  }, [query]);

  useEffect(() => {
    let isActive = true;
    const fetchWeather = async () => {
      if (!selectedCity) {
        setCurrent(null);
        setDaily([]);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          latitude: String(selectedCity.latitude),
          longitude: String(selectedCity.longitude),
          timezone: selectedCity.timezone ?? 'auto',
          current:
            'temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,relative_humidity_2m,precipitation',
          daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code',
          hourly: 'temperature_2m,precipitation_probability,wind_speed_10m',
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!response.ok) {
          throw new Error('Unable to load weather');
        }
        const data = (await response.json()) as {
          current?: {
            temperature_2m: number;
            wind_speed_10m: number;
            wind_direction_10m: number;
            weather_code: number;
            time: string;
            relative_humidity_2m: number;
            precipitation: number;
          };
          daily?: {
            time: string[];
            temperature_2m_max: number[];
            temperature_2m_min: number[];
            sunrise: string[];
            sunset: string[];
            weather_code: number[];
          };
          hourly?: {
            time: string[];
            temperature_2m: number[];
            precipitation_probability: number[];
            wind_speed_10m: number[];
          };
        };
        if (!isActive) {
          return;
        }
        if (data.current) {
          setCurrent({
            temperature: data.current.temperature_2m,
            windSpeed: data.current.wind_speed_10m,
            windDirection: data.current.wind_direction_10m,
            weatherCode: data.current.weather_code,
            time: data.current.time,
            humidity: data.current.relative_humidity_2m,
            precipitation: data.current.precipitation,
          });
        }
        if (data.daily) {
          const entries = data.daily.time.map((date, index) => ({
            date,
            tempMax: data.daily?.temperature_2m_max[index] ?? 0,
            tempMin: data.daily?.temperature_2m_min[index] ?? 0,
            sunrise: data.daily?.sunrise[index] ?? '',
            sunset: data.daily?.sunset[index] ?? '',
            weatherCode: data.daily?.weather_code[index] ?? 0,
          }));
          setDaily(entries);
        }
        if (data.hourly) {
          const entries = data.hourly.time.map((time, index) => ({
            time,
            temperature: data.hourly?.temperature_2m[index] ?? 0,
            precipitation: data.hourly?.precipitation_probability[index] ?? 0,
            windSpeed: data.hourly?.wind_speed_10m[index] ?? 0,
          }));
          setHourly(entries);
        }
      } catch {
        if (isActive) {
          setError('Unable to load weather right now.');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchWeather();
    return () => {
      isActive = false;
    };
  }, [selectedCity]);

  const subtitle = useMemo(() => {
    if (!selectedCity) {
      return '';
    }
    const admin = selectedCity.admin1 ? `, ${selectedCity.admin1}` : '';
    return `${selectedCity.name}${admin} · ${selectedCity.country}`;
  }, [selectedCity]);

  const currentVisual = resolveWeatherVisual(current?.weatherCode);
  const hourlySlice = useMemo(() => hourly.slice(0, 9), [hourly]);
  const chartValues = useMemo(() => {
    if (activeTab === 'temperature') {
      return hourlySlice.map((entry) => entry.temperature);
    }
    if (activeTab === 'precipitation') {
      return hourlySlice.map((entry) => entry.precipitation);
    }
    return hourlySlice.map((entry) => entry.windSpeed);
  }, [activeTab, hourlySlice]);
  const chartMin = Math.min(...chartValues, 0);
  const chartMax = Math.max(...chartValues, 1);
  const chartPoints = chartValues
    .map((value, index) => {
      const x = (index / Math.max(chartValues.length - 1, 1)) * 100;
      const y = 100 - ((value - chartMin) / (chartMax - chartMin || 1)) * 100;
      return `${x},${y}`;
    })
    .join(' ');
  const chartAreaPoints = `0,100 ${chartPoints} 100,100`;

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-col gap-3">
          <span className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-600">Weather</span>
          <h1 className="text-3xl font-semibold">{subtitle || 'Weather'}</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            {selectedCity?.timezone ? `Local time · ${selectedCity.timezone}` : 'Search a city to view conditions.'}
          </p>
        </header>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-6">
              <span className={`text-6xl ${currentVisual.animation}`} aria-hidden="true">
                {currentVisual.icon}
              </span>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-6xl font-semibold">
                    {current ? Math.round(current.temperature) : '—'}
                  </span>
                  <span className="text-lg text-slate-500">°C</span>
                  <span className="text-sm text-slate-400">| °F</span>
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p>Precipitation: {current ? `${Math.round(current.precipitation)} mm` : '—'}</p>
                  <p>Humidity: {current ? `${Math.round(current.humidity)}%` : '—'}</p>
                  <p>Wind: {current ? `${Math.round(current.windSpeed)} km/h` : '—'}</p>
                </div>
              </div>
            </div>

            <div className="text-right">
              <h2 className="text-2xl font-semibold">Weather</h2>
              <p className="text-sm text-slate-500">
                {current ? formatLocalTime(current.time, selectedCity?.timezone) : '—'}
              </p>
              <p className="text-lg text-slate-700">
                {current ? weatherDescriptions[current.weatherCode] ?? '—' : '—'}
              </p>
            </div>
          </div>

          <div className="mt-8 flex items-center gap-8 border-b border-slate-200 pb-3 text-sm font-semibold">
            {(['temperature', 'precipitation', 'wind'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`pb-3 transition ${
                  activeTab === tab
                    ? 'border-b-2 border-amber-500 text-slate-900'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tab === 'temperature' ? 'Temperature' : tab === 'precipitation' ? 'Precipitation' : 'Wind'}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <div className="relative h-36">
              <svg viewBox="0 0 100 100" className="h-full w-full">
                <defs>
                  <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.05" />
                  </linearGradient>
                </defs>
                <polygon points={chartAreaPoints} fill="url(#chartGlow)" />
                <polyline
                  points={chartPoints}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="mt-4 grid grid-cols-9 gap-2 text-center text-xs text-slate-500">
              {hourlySlice.map((entry) => (
                <div key={entry.time}>
                  <p className="text-slate-700">
                    {new Intl.DateTimeFormat('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: selectedCity?.timezone ?? 'auto',
                    }).format(new Date(entry.time))}
                  </p>
                  <p className="mt-1 text-slate-500">
                    {activeTab === 'temperature'
                      ? Math.round(entry.temperature)
                      : activeTab === 'precipitation'
                        ? Math.round(entry.precipitation)
                        : Math.round(entry.windSpeed)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Find a city</h3>
              <p className="text-sm text-slate-500">Search and switch locations.</p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim() || DEFAULT_CITY);
              }}
              className="flex w-full flex-1 gap-3 sm:max-w-xl"
            >
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search city"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
              <button
                type="submit"
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
              >
                Search
              </button>
            </form>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {loading && results.length === 0 ? (
              <p className="text-sm text-slate-500">Searching...</p>
            ) : (
              results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => setSelectedCity(result)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    selectedCity?.id === result.id
                      ? 'border-amber-400 bg-amber-50 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300'
                  }`}
                >
                  <p className="font-semibold text-slate-900">{result.name}</p>
                  <p className="text-xs text-slate-500">
                    {result.admin1 ? `${result.admin1}, ` : ''}{result.country}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 sm:grid-cols-4">
          {daily.slice(0, 8).map((entry) => {
            const visual = resolveWeatherVisual(entry.weatherCode);
            return (
              <div key={entry.date} className="rounded-2xl bg-slate-50 p-4 text-center">
                <p className="text-sm font-semibold">
                  {new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                  }).format(new Date(entry.date))}
                </p>
                <span className={`mt-3 inline-block text-3xl ${visual.animation}`} aria-hidden="true">
                  {visual.icon}
                </span>
                <p className="mt-2 text-sm text-slate-600">
                  {Math.round(entry.tempMax)}° · {Math.round(entry.tempMin)}°
                </p>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
