'use client';

import { useEffect, useMemo, useState } from 'react';
import { 
  Sun, Cloud, CloudRain, CloudLightning, Snowflake, CloudFog, CloudDrizzle,
  Search, Wind, Droplets, MapPin, Loader2
} from 'lucide-react';

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

const weatherIconMap: Array<{ codes: number[]; icon: React.ElementType; animation: string; color: string }> = [
  { codes: [0, 1], icon: Sun, animation: 'animate-[spin_10s_linear_infinite]', color: 'text-amber-400' },
  { codes: [2, 3], icon: Cloud, animation: 'animate-[pulse_3s_ease-in-out_infinite]', color: 'text-slate-300' },
  { codes: [45, 48], icon: CloudFog, animation: 'animate-[pulse_3s_ease-in-out_infinite]', color: 'text-slate-400' },
  { codes: [51, 53, 55, 56, 57], icon: CloudDrizzle, animation: 'animate-[bounce_2s_infinite]', color: 'text-sky-300' },
  { codes: [61, 63, 65, 80, 81, 82, 66, 67], icon: CloudRain, animation: 'animate-[bounce_2s_infinite]', color: 'text-blue-400' },
  { codes: [71, 73, 75, 77, 85, 86], icon: Snowflake, animation: 'animate-[spin_6s_linear_infinite]', color: 'text-cyan-200' },
  { codes: [95, 96, 99], icon: CloudLightning, animation: 'animate-[pulse_1.5s_ease-in-out_infinite]', color: 'text-violet-400' },
];

const resolveWeatherVisual = (code?: number) => {
  if (code === undefined || code === null) {
    return { icon: Sun, animation: 'animate-pulse', color: 'text-amber-400' };
  }
  for (const item of weatherIconMap) {
    if (item.codes.includes(code)) {
      return { icon: item.icon, animation: item.animation, color: item.color };
    }
  }
  return { icon: Sun, animation: 'animate-pulse', color: 'text-amber-400' };
};

const resolveBackground = (code?: number) => {
  if (code === undefined || code === null) return 'from-slate-900 via-slate-800 to-slate-950';
  if ([0, 1].includes(code)) return 'from-sky-950 via-blue-900/60 to-slate-950'; // Clear
  if ([2, 3, 45, 48].includes(code)) return 'from-slate-900 via-slate-800 to-slate-950'; // Cloudy
  if ([51, 53, 55, 56, 57, 61, 63, 65, 80, 81, 82, 66, 67].includes(code)) return 'from-slate-950 via-indigo-950/80 to-slate-950'; // Rain
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'from-sky-950 via-slate-800 to-slate-950'; // Snow
  if ([95, 96, 99].includes(code)) return 'from-violet-950 via-slate-900 to-black'; // Thunderstorm
  return 'from-slate-900 via-slate-800 to-slate-950';
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
  const [searchFocused, setSearchFocused] = useState(false);
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
        if (!isActive) return;
        
        const locations = data.results ?? [];
        setResults(locations);
        if (locations.length > 0) {
          setSelectedCity(locations[0]);
        } else {
          setError('City not found. Try another search.');
        }
      } catch {
        if (isActive) setError('Unable to load location. Try again.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void fetchGeo();
    return () => { isActive = false; };
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
          current: 'temperature_2m,wind_speed_10m,wind_direction_10m,weather_code,relative_humidity_2m,precipitation',
          daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code',
          hourly: 'temperature_2m,precipitation_probability,wind_speed_10m',
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!response.ok) throw new Error('Unable to load weather');
        
        const data = (await response.json()) as any;
        if (!isActive) return;
        
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
          const entries = data.daily.time.map((date: string, index: number) => ({
            date,
            tempMax: data.daily.temperature_2m_max[index] ?? 0,
            tempMin: data.daily.temperature_2m_min[index] ?? 0,
            sunrise: data.daily.sunrise[index] ?? '',
            sunset: data.daily.sunset[index] ?? '',
            weatherCode: data.daily.weather_code[index] ?? 0,
          }));
          setDaily(entries);
        }
        if (data.hourly) {
          const entries = data.hourly.time.map((time: string, index: number) => ({
            time,
            temperature: data.hourly.temperature_2m[index] ?? 0,
            precipitation: data.hourly.precipitation_probability[index] ?? 0,
            windSpeed: data.hourly.wind_speed_10m[index] ?? 0,
          }));
          setHourly(entries);
        }
      } catch {
        if (isActive) setError('Unable to load weather right now.');
      } finally {
        if (isActive) setLoading(false);
      }
    };

    void fetchWeather();
    return () => { isActive = false; };
  }, [selectedCity]);

  const subtitle = useMemo(() => {
    if (!selectedCity) return '';
    const admin = selectedCity.admin1 ? `, ${selectedCity.admin1}` : '';
    return `${selectedCity.name}${admin} · ${selectedCity.country}`;
  }, [selectedCity]);

  const currentVisual = resolveWeatherVisual(current?.weatherCode);
  const CurrentIcon = currentVisual.icon;
  const bgClass = resolveBackground(current?.weatherCode);

  const hourlySlice = useMemo(() => hourly.slice(0, 12), [hourly]); // Show next 12 hours
  const chartValues = useMemo(() => {
    if (activeTab === 'temperature') return hourlySlice.map((entry) => entry.temperature);
    if (activeTab === 'precipitation') return hourlySlice.map((entry) => entry.precipitation);
    return hourlySlice.map((entry) => entry.windSpeed);
  }, [activeTab, hourlySlice]);
  
  const chartMin = Math.min(...chartValues, 0);
  const chartMax = Math.max(...chartValues, 1);
  
  // Create a smoother curved line for the chart
  const createSmoothPath = (points: number[]) => {
    if (points.length === 0) return '';
    const mapPoint = (val: number, idx: number) => {
      const x = (idx / Math.max(points.length - 1, 1)) * 100;
      const y = 100 - ((val - chartMin) / (chartMax - chartMin || 1)) * 80 - 10; // 10% padding
      return { x, y };
    };

    const pts = points.map(mapPoint);
    let d = `M ${pts[0].x},${pts[0].y}`;
    
    for (let i = 1; i < pts.length - 2; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      d += ` Q ${pts[i].x},${pts[i].y} ${xc},${yc}`;
    }
    
    if (pts.length > 2) {
      d += ` Q ${pts[pts.length - 2].x},${pts[pts.length - 2].y} ${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
    } else if (pts.length === 2) {
      d += ` L ${pts[1].x},${pts[1].y}`;
    }
    return d;
  };

  const chartPath = createSmoothPath(chartValues);
  const chartAreaPath = `${chartPath} L 100,100 L 0,100 Z`;

  return (
    <div className={`min-h-screen bg-gradient-to-br ${bgClass} p-4 sm:p-8 text-slate-100 transition-colors duration-1000`}>
      <div className="mx-auto max-w-6xl space-y-6">
        
        {/* Top Header / Search */}
        <header className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between relative z-50">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/50">Weather</span>
            <h1 className="text-2xl font-light tracking-tight text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-white/70" />
              {subtitle || 'Select Location'}
            </h1>
          </div>
          
          <div className="relative w-full sm:w-96 group">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim() || DEFAULT_CITY);
                setSearchFocused(false);
              }}
              className="relative"
            >
              <div className={`flex items-center w-full rounded-2xl border transition-all duration-300 ${searchFocused ? 'border-white/40 bg-black/40 shadow-2xl backdrop-blur-xl' : 'border-white/10 bg-black/20 backdrop-blur-md'}`}>
                <Search className="w-5 h-5 text-white/50 ml-4" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
                  placeholder="Search city, zip, or place..."
                  className="w-full bg-transparent px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none"
                />
                {loading && <Loader2 className="w-5 h-5 text-white/50 mr-4 animate-spin" />}
              </div>
            </form>
            
            {/* Search Results Dropdown */}
            {searchFocused && results.length > 0 && (
              <div className="absolute top-full mt-2 w-full rounded-2xl border border-white/20 bg-black/60 backdrop-blur-xl p-2 shadow-2xl overflow-hidden">
                {results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onMouseDown={() => {
                      setSelectedCity(result);
                      setSearch(result.name);
                      setSearchFocused(false);
                    }}
                    className="w-full rounded-xl px-4 py-3 text-left transition hover:bg-white/10 flex flex-col"
                  >
                    <span className="font-medium text-white">{result.name}</span>
                    <span className="text-xs text-white/50">
                      {result.admin1 ? `${result.admin1}, ` : ''}{result.country}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 backdrop-blur-md">
            {error}
          </div>
        )}

        {/* Main Current Weather Card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-8 sm:p-12 backdrop-blur-2xl shadow-2xl relative overflow-hidden">
          {/* Subtle glowing orb in background */}
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
          
          <div className="flex flex-col lg:flex-row gap-12 items-center justify-between relative z-10">
            {/* Left: Temp and Status */}
            <div className="flex flex-col items-center lg:items-start text-center lg:text-left gap-4">
              <p className="text-lg text-white/70 font-medium tracking-wide">
                {current ? formatLocalTime(current.time, selectedCity?.timezone) : '—'}
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
                <CurrentIcon className={`w-32 h-32 sm:w-40 sm:h-40 ${currentVisual.color} ${currentVisual.animation} drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]`} />
                <div>
                  <div className="flex items-start">
                    <span className="text-8xl sm:text-[140px] font-extralight tracking-tighter text-white leading-none">
                      {current ? Math.round(current.temperature) : '—'}
                    </span>
                    <span className="text-4xl sm:text-6xl font-light text-white/50 mt-4">°C</span>
                  </div>
                  <p className="text-2xl sm:text-4xl font-light text-white/80 mt-2 capitalize">
                    {current ? weatherDescriptions[current.weatherCode] ?? '—' : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Metrics */}
            <div className="flex w-full lg:w-auto flex-col gap-4">
              <div className="grid grid-cols-3 lg:grid-cols-1 gap-4 w-full">
                <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-md">
                  <Droplets className="w-8 h-8 text-sky-400" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Humidity</p>
                    <p className="text-xl font-medium text-white">{current ? `${Math.round(current.humidity)}%` : '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-md">
                  <Wind className="w-8 h-8 text-teal-400" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Wind</p>
                    <p className="text-xl font-medium text-white">{current ? `${Math.round(current.windSpeed)} km/h` : '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-md">
                  <CloudRain className="w-8 h-8 text-blue-400" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-white/50">Precip.</p>
                    <p className="text-xl font-medium text-white">{current ? `${Math.round(current.precipitation)} mm` : '—'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 8-Day Forecast (Horizontal Scroll) */}
        <div>
          <h3 className="text-lg font-medium text-white/80 mb-4 px-2">8-Day Forecast</h3>
          <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar snap-x">
            {daily.map((entry, idx) => {
              const visual = resolveWeatherVisual(entry.weatherCode);
              const DayIcon = visual.icon;
              const isToday = idx === 0;
              return (
                <div 
                  key={entry.date} 
                  className={`min-w-[140px] snap-start rounded-3xl border border-white/10 p-5 flex flex-col items-center justify-between gap-4 backdrop-blur-xl transition-transform hover:-translate-y-1 hover:bg-white/10 ${isToday ? 'bg-white/10 shadow-lg' : 'bg-black/20'}`}
                >
                  <p className={`text-sm font-medium ${isToday ? 'text-white' : 'text-white/60'}`}>
                    {isToday ? 'Today' : new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(entry.date))}
                  </p>
                  <DayIcon className={`w-10 h-10 ${visual.color}`} />
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-lg font-semibold text-white">{Math.round(entry.tempMax)}°</span>
                    <span className="text-sm font-medium text-white/40">{Math.round(entry.tempMin)}°</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Hourly Chart Section */}
        <section className="rounded-3xl border border-white/10 bg-black/20 p-6 sm:p-8 backdrop-blur-xl">
          <div className="flex items-center gap-6 border-b border-white/10 pb-4">
            {(['temperature', 'precipitation', 'wind'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`text-sm font-semibold transition-colors ${
                  activeTab === tab
                    ? 'text-white'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab === 'temperature' ? 'Temperature' : tab === 'precipitation' ? 'Precipitation' : 'Wind'}
              </button>
            ))}
          </div>

          <div className="mt-8">
            <div className="relative h-48 w-full">
              {/* Data tooltips/labels overlay */}
              <div className="absolute inset-0 flex justify-between px-2 items-end pb-2 z-10 pointer-events-none">
                {hourlySlice.map((entry, idx) => {
                  const val = activeTab === 'temperature' ? entry.temperature : activeTab === 'precipitation' ? entry.precipitation : entry.windSpeed;
                  const unit = activeTab === 'temperature' ? '°' : activeTab === 'precipitation' ? 'mm' : 'km/h';
                  return (
                    <div key={idx} className="flex flex-col items-center justify-end h-full relative group">
                      <span className="text-xs font-bold text-white drop-shadow-md mb-2">{Math.round(val)}{unit}</span>
                      <div className="h-full w-px bg-white/10 absolute bottom-8 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  );
                })}
              </div>

              {/* Chart SVG */}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full absolute inset-0">
                <defs>
                  <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                  </linearGradient>
                </defs>
                <path d={chartAreaPath} fill="url(#chartGlow)" />
                <path
                  d={chartPath}
                  fill="none"
                  stroke="rgba(255,255,255,0.8)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* Data points */}
                {chartValues.map((val, idx) => {
                  const x = (idx / Math.max(chartValues.length - 1, 1)) * 100;
                  const y = 100 - ((val - chartMin) / (chartMax - chartMin || 1)) * 80 - 10;
                  return <circle key={idx} cx={x} cy={y} r="1.5" fill="#fff" />;
                })}
              </svg>
            </div>
            
            {/* X-Axis Labels */}
            <div className="mt-4 flex justify-between px-2 text-[10px] sm:text-xs font-medium text-white/50">
              {hourlySlice.map((entry) => (
                <span key={entry.time}>
                  {new Intl.DateTimeFormat('en-US', {
                    hour: 'numeric',
                    timeZone: selectedCity?.timezone ?? 'auto',
                  }).format(new Date(entry.time))}
                </span>
              ))}
            </div>
          </div>
        </section>
        
      </div>
    </div>
  );
}
