'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { useNow } from '@/app/ui/use-client';
import type { WorldClockZone } from '@/lib/world-clocks';

import {
  compassPoint,
  DEFAULT_CITY,
  describeWeather,
  fetchCitiesWeather,
  fetchForecast,
  formatClock,
  formatDayMonthYear,
  formatVisibilityKm,
  formatWeekday,
  humidityLabel,
  iconKindFor,
  placeLabel,
  resolveWorldCities,
  searchPlaces,
  toUnit,
  uvLabel,
  visibilityLabel,
  type CityWeather,
  type Forecast,
  type GeoResult,
  type TempUnit,
} from './weather-data';
import {
  ChevronIcon,
  DropletIcon,
  EyeIcon,
  MoonIcon,
  PinIcon,
  SearchIcon,
  SunHorizonIcon,
  SunIcon,
  WeatherDefs,
  WeatherIcon,
  WindIcon,
} from './weather-icons';

type Theme = 'dark' | 'light';

// The page's palette as CSS variables: every card reads the same tokens, so the
// light/dark switch is one style swap on the root.
const PALETTES: Record<Theme, CSSProperties> = {
  dark: {
    '--wx-page': '#0e0e10',
    '--wx-card': '#18181b',
    '--wx-tile': '#232327',
    '--wx-tile-hover': '#2b2b30',
    '--wx-raised': '#3a3a41',
    '--wx-text': '#f4f4f5',
    '--wx-muted': '#a1a1aa',
    '--wx-faint': '#71717a',
    '--wx-line': 'rgba(255, 255, 255, 0.07)',
    '--wx-accent': '#fbbf24',
  } as CSSProperties,
  light: {
    '--wx-page': '#f1f3f6',
    '--wx-card': '#ffffff',
    '--wx-tile': '#f4f5f8',
    '--wx-tile-hover': '#eceef2',
    '--wx-raised': '#ffffff',
    '--wx-text': '#111827',
    '--wx-muted': '#6b7280',
    '--wx-faint': '#9ca3af',
    '--wx-line': 'rgba(17, 24, 39, 0.08)',
    '--wx-accent': '#d97706',
  } as CSSProperties,
};

const cardClass = 'rounded-3xl bg-(--wx-card) p-5 ring-1 ring-(--wx-line) sm:p-6';
const tileClass = 'rounded-2xl bg-(--wx-tile)';
const skeletonClass = 'animate-pulse rounded-2xl bg-(--wx-tile)';

const OTHER_CITIES_COLLAPSED = 3;

// --- Per-browser preferences --------------------------------------------------------
// Theme, unit and the last city are conveniences: kept in localStorage, with an
// in-memory copy so the page still works where storage is blocked.

const memory = new Map<string, string>();
const storeListeners = new Set<() => void>();

function readStored(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribeStored(listener: () => void) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

function useStored(key: string): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(subscribeStored, () => readStored(key), () => null);
  const set = useCallback(
    (next: string) => {
      memory.set(key, next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Kept in memory for this visit.
      }
      storeListeners.forEach((listener) => listener());
    },
    [key],
  );
  return [value, set];
}

function parseCity(raw: string | null): GeoResult | null {
  if (!raw) return null;
  try {
    const city = JSON.parse(raw) as GeoResult;
    return Number.isFinite(city.latitude) && Number.isFinite(city.longitude) && city.name ? city : null;
  } catch {
    return null;
  }
}

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// --- Page ---------------------------------------------------------------------------

export default function WeatherClient({
  firstName,
  worldClocks,
}: {
  firstName: string | null;
  worldClocks: WorldClockZone[];
}) {
  const [storedTheme, setTheme] = useStored('weather:theme');
  const theme: Theme = storedTheme === 'light' ? 'light' : 'dark';
  const [storedUnit, setUnit] = useStored('weather:unit');
  const unit: TempUnit = storedUnit === 'F' ? 'F' : 'C';
  const [storedCity, setStoredCity] = useStored('weather:city');
  const city = useMemo(() => parseCity(storedCity) ?? DEFAULT_CITY, [storedCity]);
  const selectCity = useCallback((next: GeoResult) => setStoredCity(JSON.stringify(next)), [setStoredCity]);

  const now = useNow(60_000);
  const greeting = now === null ? null : greetingFor(new Date(now).getHours());

  // Main forecast. `loading` is derived — a result belongs to one request key —
  // so the effect never has to flip state synchronously.
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${city.latitude},${city.longitude}#${attempt}`;
  const [result, setResult] = useState<{ key: string; forecast: Forecast | null } | null>(null);
  useEffect(() => {
    let active = true;
    fetchForecast(city)
      .then((forecast) => {
        if (active) setResult({ key: requestKey, forecast });
      })
      .catch(() => {
        if (active) setResult({ key: requestKey, forecast: null });
      });
    return () => {
      active = false;
    };
  }, [city, requestKey]);
  const loading = result?.key !== requestKey;
  const forecast = result?.forecast ?? null;
  const failed = !loading && forecast === null;

  const [others, setOthers] = useState<CityWeather[] | null>(null);
  useEffect(() => {
    let active = true;
    resolveWorldCities(worldClocks)
      .then(fetchCitiesWeather)
      .then((rows) => {
        if (active) setOthers(rows);
      })
      .catch(() => {
        if (active) setOthers([]);
      });
    return () => {
      active = false;
    };
  }, [worldClocks]);
  const otherRows = useMemo(
    () => others?.filter((row) => row.city.name.toLowerCase() !== city.name.toLowerCase()) ?? null,
    [others, city.name],
  );

  const t = (celsius: number) => toUnit(celsius, unit);

  return (
    <div className="@container flex-1 bg-(--wx-page) text-(--wx-text) transition-colors" style={PALETTES[theme]}>
      <WeatherDefs theme={theme} />
      <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-4 @3xl:flex-row @3xl:items-center @3xl:justify-between">
          <div>
            <p className="text-sm text-(--wx-muted)">Hi, {firstName ?? 'there'}</p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight sm:text-3xl">{greeting ?? ' '}</h1>
          </div>
          <div className="flex items-center gap-3">
            <PlaceSearch onSelect={selectCity} />
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </header>

        <div className="grid grid-cols-1 gap-5 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Current conditions */}
          <section
            aria-busy={loading}
            className={`${cardClass} flex flex-col transition-opacity ${loading && forecast ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-(--wx-tile) px-3.5 py-2 text-sm">
                <PinIcon className="h-4 w-4 shrink-0 text-(--wx-muted)" />
                <span className="truncate">{placeLabel(city)}</span>
              </span>
              <Segmented
                label="Temperature unit"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'C', label: '°C' },
                  { value: 'F', label: '°F' },
                ]}
              />
            </div>

            {forecast ? (
              <div className="mt-5 grid flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-4">
                <div className="flex flex-col">
                  <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    {formatWeekday(forecast.current.time)}
                  </h2>
                  <p className="mt-1 text-sm text-(--wx-muted)">
                    {formatDayMonthYear(forecast.current.time)} · {formatClock(forecast.current.time)}
                  </p>
                  <div className="flex flex-1 items-center justify-center py-4">
                    <WeatherIcon
                      kind={iconKindFor(forecast.current.weatherCode)}
                      isDay={forecast.current.isDay}
                      className="h-36 w-36 sm:h-48 sm:w-48"
                    />
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between gap-6 text-right">
                  <div>
                    <p className="text-5xl font-semibold tracking-tight sm:text-6xl">
                      {t(forecast.current.temperature)}°{unit}
                    </p>
                    {forecast.daily[0] && (
                      <p className="mt-1 text-lg text-(--wx-muted)">
                        H {t(forecast.daily[0].tempMax)}° · L {t(forecast.daily[0].tempMin)}°
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{describeWeather(forecast.current.weatherCode)}</p>
                    <p className="text-sm text-(--wx-muted)">Feels like {t(forecast.current.feelsLike)}°</p>
                  </div>
                </div>
              </div>
            ) : failed ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
                <p className="text-sm text-(--wx-muted)">Couldn&apos;t load the weather for {city.name}.</p>
                <button
                  type="button"
                  onClick={() => setAttempt((n) => n + 1)}
                  className="rounded-full bg-(--wx-tile) px-4 py-2 text-sm font-semibold transition-colors hover:bg-(--wx-tile-hover)"
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="mt-5 grid flex-1 grid-cols-[minmax(0,1fr)_auto] gap-4">
                <div className="space-y-2">
                  <div className={`${skeletonClass} h-9 w-36`} />
                  <div className={`${skeletonClass} h-4 w-28`} />
                  <div className={`${skeletonClass} mx-auto mt-6 h-32 w-32 rounded-full`} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className={`${skeletonClass} h-14 w-32`} />
                  <div className={`${skeletonClass} h-5 w-24`} />
                </div>
              </div>
            )}
          </section>

          {/* Today's highlights */}
          <section
            className={`${cardClass} @container flex flex-col transition-opacity ${loading && forecast ? 'opacity-60' : ''}`}
          >
            <h2 className="text-lg font-semibold">Today&apos;s highlights</h2>
            {forecast ? (
              <div className="mt-4 grid flex-1 gap-3 @lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile
                    icon={WindIcon}
                    label="Wind status"
                    value={forecast.current.windSpeed.toFixed(1)}
                    unit="km/h"
                    note={`From the ${compassPoint(forecast.current.windDirection)}`}
                  />
                  <MetricTile
                    icon={DropletIcon}
                    label="Humidity"
                    value={String(Math.round(forecast.current.humidity))}
                    unit="%"
                    note={humidityLabel(forecast.current.humidity)}
                  />
                  <MetricTile
                    icon={SunIcon}
                    label="UV index"
                    value={String(Math.round(forecast.current.uvIndex))}
                    unit="UV"
                    note={uvLabel(forecast.current.uvIndex)}
                  />
                  <MetricTile
                    icon={EyeIcon}
                    label="Visibility"
                    value={formatVisibilityKm(forecast.current.visibility)}
                    unit="km"
                    note={visibilityLabel(forecast.current.visibility)}
                  />
                </div>
                {forecast.daily[0] && (
                  <div className="grid grid-cols-2 gap-3 @lg:grid-cols-1">
                    <SunTile direction="up" label="Sunrise" time={formatClock(forecast.daily[0].sunrise)} />
                    <SunTile direction="down" label="Sunset" time={formatClock(forecast.daily[0].sunset)} />
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 grid gap-3 @lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div className="grid grid-cols-2 gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className={`${skeletonClass} h-32`} />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 @lg:grid-cols-1">
                  <div className={`${skeletonClass} h-24 @lg:h-auto`} />
                  <div className={`${skeletonClass} h-24 @lg:h-auto`} />
                </div>
              </div>
            )}
          </section>

          {/* Other cities */}
          <OtherCities rows={otherRows} unit={unit} onSelect={selectCity} />

          {/* 10-day forecast */}
          <section className={`${cardClass} order-3 flex flex-col @4xl:order-none`}>
            <h2 className="text-lg font-semibold">10-day forecast</h2>
            <div className="custom-scrollbar -mx-1 mt-4 flex flex-1 snap-x gap-3 overflow-x-auto px-1 pb-2">
              {forecast
                ? forecast.daily.map((day, index) => (
                    <div
                      key={day.date}
                      className={`${tileClass} flex min-h-44 w-[5.5rem] shrink-0 snap-start flex-col items-center px-2 py-4 text-center`}
                    >
                      <p className="text-sm font-medium">{index === 0 ? 'Today' : formatWeekday(day.date, 'short')}</p>
                      <span className="mt-2 h-px w-8 bg-(--wx-line)" />
                      <WeatherIcon kind={iconKindFor(day.weatherCode)} className="my-auto h-16 w-16" />
                      <p className="text-base font-semibold">{t(day.tempMax)}°</p>
                      <p className="text-xs text-(--wx-faint)">{t(day.tempMin)}°</p>
                    </div>
                  ))
                : Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className={`${skeletonClass} min-h-44 w-[5.5rem] shrink-0`} />
                  ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// --- Pieces -------------------------------------------------------------------------

function MetricTile({
  icon: Icon,
  label,
  value,
  unit,
  note,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  unit: string;
  note: string;
}) {
  return (
    <div className={`${tileClass} flex flex-col p-4`}>
      <p className="flex items-center gap-2 text-sm text-(--wx-muted)">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight">
        {value}
        <span className="ml-1 text-sm font-medium text-(--wx-muted)">{unit}</span>
      </p>
      <p className="mt-auto truncate pt-2 text-xs text-(--wx-faint)">{note}</p>
    </div>
  );
}

function SunTile({ direction, label, time }: { direction: 'up' | 'down'; label: string; time: string }) {
  return (
    <div className={`${tileClass} flex items-center gap-3 p-4`}>
      <SunHorizonIcon direction={direction} className="h-16 w-16 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm text-(--wx-muted)">{label}</p>
        <p className="mt-0.5 whitespace-nowrap text-xl font-semibold tracking-tight">{time}</p>
      </div>
    </div>
  );
}

function OtherCities({
  rows,
  unit,
  onSelect,
}: {
  rows: CityWeather[] | null;
  unit: TempUnit;
  onSelect: (city: GeoResult) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = rows ? (expanded ? rows : rows.slice(0, OTHER_CITIES_COLLAPSED)) : null;

  return (
    <section className={`${cardClass} order-4 flex flex-col @4xl:order-none`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Other cities</h2>
          <p className="text-xs text-(--wx-faint)">From your world clocks</p>
        </div>
        {rows && rows.length > OTHER_CITIES_COLLAPSED && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-(--wx-muted) transition-colors hover:text-(--wx-text)"
          >
            {expanded ? 'Show less' : 'See all'}
            <ChevronIcon className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {shown === null ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: OTHER_CITIES_COLLAPSED }, (_, i) => (
            <div key={i} className={`${skeletonClass} h-[5.25rem]`} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-(--wx-tile) px-4 py-6 text-center text-sm text-(--wx-muted)">
          Pin cities with the Clocks button in the top bar to compare them here.
        </p>
      ) : (
        <ul className={`mt-4 space-y-3 ${expanded ? 'custom-scrollbar max-h-[22rem] overflow-y-auto pr-1' : ''}`}>
          {shown.map((row) => (
            <li key={`${row.city.id}-${row.city.timezone}`}>
              <button
                type="button"
                onClick={() => onSelect(row.city)}
                title={`Show the forecast for ${row.city.name}`}
                className={`${tileClass} grid w-full grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-(--wx-tile-hover)`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs text-(--wx-faint)">{row.city.country}</span>
                  <span className="block truncate text-lg font-semibold leading-snug">{row.city.name}</span>
                  <span className="block truncate text-xs text-(--wx-muted)">{describeWeather(row.weatherCode)}</span>
                </span>
                <WeatherIcon kind={iconKindFor(row.weatherCode)} isDay={row.isDay} className="h-14 w-14" />
                <span className="text-right">
                  <span className="block text-2xl font-semibold tracking-tight">{toUnit(row.temperature, unit)}°</span>
                  <span className="block text-xs text-(--wx-faint)">
                    H {toUnit(row.tempMax, unit)}° · L {toUnit(row.tempMin, unit)}°
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-full bg-(--wx-tile) p-1 text-sm font-semibold">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 transition-colors ${
            value === option.value
              ? 'bg-(--wx-raised) text-(--wx-text) shadow-sm'
              : 'text-(--wx-muted) hover:text-(--wx-text)'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  return (
    <Segmented
      label="Colour theme"
      value={theme}
      onChange={onChange}
      options={[
        { value: 'light', label: <SunIcon className="h-5 w-5" />, title: 'Light' },
        { value: 'dark', label: <MoonIcon className="h-5 w-5" />, title: 'Dark' },
      ]}
    />
  );
}

/** Location search with a suggestion list (combobox pattern, keyboard friendly). */
function PlaceSearch({ onSelect }: { onSelect: (city: GeoResult) => void }) {
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [found, setFound] = useState<{ term: string; places: GeoResult[] | null } | null>(null);
  const term = text.trim();

  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(term, 6, controller.signal)
        .then((places) => setFound({ term, places }))
        .catch((error: unknown) => {
          if ((error as Error).name !== 'AbortError') setFound({ term, places: null });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const ready = found?.term === term;
  const places = ready ? (found.places ?? []) : [];
  const showPanel = open && term.length >= 2;
  const active = places.length > 0 ? Math.min(highlight, places.length - 1) : -1;

  const choose = (place: GeoResult) => {
    onSelect(place);
    setText('');
    setOpen(false);
  };

  return (
    <div className="relative min-w-0 flex-1 @3xl:w-96 @3xl:flex-none">
      <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-(--wx-faint)" />
      <input
        type="text"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="Search your location"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && places.length > 0) {
            event.preventDefault();
            setHighlight((active + 1) % places.length);
          } else if (event.key === 'ArrowUp' && places.length > 0) {
            event.preventDefault();
            setHighlight((active - 1 + places.length) % places.length);
          } else if (event.key === 'Enter' && active >= 0) {
            event.preventDefault();
            choose(places[active]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded-full bg-(--wx-card) py-3 pl-12 pr-4 text-sm text-(--wx-text) ring-1 ring-(--wx-line) transition placeholder:text-(--wx-faint) focus:outline-none focus:ring-2 focus:ring-(--wx-accent)/50"
      />
      {showPanel && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching places"
          className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl bg-(--wx-card) py-1.5 shadow-2xl ring-1 ring-(--wx-line)"
        >
          {!ready && <li className="px-4 py-3 text-sm text-(--wx-muted)">Searching…</li>}
          {ready && found.places === null && (
            <li className="px-4 py-3 text-sm text-(--wx-muted)">Search is unavailable right now.</li>
          )}
          {ready && found.places?.length === 0 && (
            <li className="px-4 py-3 text-sm text-(--wx-muted)">No places match “{term}”.</li>
          )}
          {places.map((place, index) => (
            <li
              key={place.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(place)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${index === active ? 'bg-(--wx-tile)' : ''}`}
            >
              <PinIcon className="h-4 w-4 shrink-0 text-(--wx-faint)" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{place.name}</span>
                <span className="block truncate text-xs text-(--wx-muted)">
                  {[place.admin1, place.country].filter(Boolean).join(', ')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
