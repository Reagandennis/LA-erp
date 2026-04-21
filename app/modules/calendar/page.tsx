'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type AppTask = {
  id: number;
  title: string;
  priority: string;
  status: string;
  dueDate: string | null;
  completed: boolean;
};

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  colorId?: string;
};

type UnifiedEntry = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  tag: string;
  source: 'app' | 'google';
  priority?: string;
  colorHex?: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const GOOGLE_COLOR_MAP: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
  '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
  '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
};

const PRIORITY_COLORS: Record<string, string> = {
  High: '#ef4444',
  Medium: '#f97316',
  Low: '#3b82f6',
};

const CALENDAR_WEATHER_ICONS: Array<{ codes: number[]; icon: string }> = [
  { codes: [0, 1], icon: '☀️' },
  { codes: [2, 3], icon: '⛅️' },
  { codes: [45, 48], icon: '🌫️' },
  { codes: [51, 53, 55, 56, 57], icon: '🌦️' },
  { codes: [61, 63, 65, 80, 81, 82, 66, 67], icon: '🌧️' },
  { codes: [71, 73, 75, 77, 85, 86], icon: '❄️' },
  { codes: [95, 96, 99], icon: '⛈️' },
];

const formatDateKey = (date: Date) => {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const resolveWeatherIcon = (code?: number | null) => {
  if (code == null) return null;
  for (const e of CALENDAR_WEATHER_ICONS) {
    if (e.codes.includes(code)) return e.icon;
  }
  return null;
};

// ── Google GIS token client type stub ────────────────────────────────────────

type GISTokenClient = { requestAccessToken: () => void };

type GISGoogleObject = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (resp: { access_token?: string; error?: string }) => void;
      }) => GISTokenClient;
    };
  };
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [weatherByDate, setWeatherByDate] = useState<Record<string, number>>({});
  const [appTasks, setAppTasks] = useState<AppTask[]>([]);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [gisReady, setGisReady] = useState(false);
  const tokenClientRef = useRef<{ requestAccessToken: () => void } | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // ── Load GIS script ────────────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById('google-gis-script')) {
      setGisReady(true);
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGisReady(true);
    document.body.appendChild(script);
  }, []);

  // ── Init token client when GIS ready ──────────────────────────────────────
  useEffect(() => {
    const goog = (globalThis as unknown as { google?: GISGoogleObject }).google;
    if (!gisReady || !goog) return;
    tokenClientRef.current = goog.accounts.oauth2.initTokenClient({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          setGoogleError('Google sign-in failed. Please try again.');
          setGoogleLoading(false);
          return;
        }
        setGoogleToken(resp.access_token);
        setGoogleLoading(false);
      },
    });
  }, [gisReady]);

  // ── Sign in handler ────────────────────────────────────────────────────────
  const handleGoogleSignIn = useCallback(() => {
    setGoogleError(null);
    setGoogleLoading(true);
    tokenClientRef.current?.requestAccessToken();
  }, []);

  // ── Disconnect handler ────────────────────────────────────────────────────
  const handleGoogleDisconnect = useCallback(() => {
    setGoogleToken(null);
    setGoogleEvents([]);
  }, []);

  // ── Fetch Google Calendar events ───────────────────────────────────────────
  useEffect(() => {
    if (!googleToken) return;
    let isActive = true;

    const fetchEvents = async () => {
      const timeMin = new Date(year, month, 1).toISOString();
      const timeMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? '';

      try {
        const params = new URLSearchParams({
          key: apiKey,
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100',
        });
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
          { headers: { Authorization: `Bearer ${googleToken}` } }
        );
        if (!res.ok) {
          const body = (await res.json()) as { error?: { message?: string } };
          throw new Error(body.error?.message ?? 'Calendar fetch failed');
        }
        const data = (await res.json()) as { items?: GoogleCalendarEvent[] };
        if (isActive) setGoogleEvents(data.items ?? []);
      } catch (err) {
        if (isActive) setGoogleError(err instanceof Error ? err.message : 'Failed to load Google Calendar');
      }
    };

    void fetchEvents();
    return () => { isActive = false; };
  }, [googleToken, month, year]);

  // ── Fetch app tasks ────────────────────────────────────────────────────────
  useEffect(() => {
    let isActive = true;
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/planning/tasks');
        if (!res.ok) return;
        const data = (await res.json()) as { tasks?: AppTask[] } | AppTask[];
        const tasks = Array.isArray(data) ? data : (data.tasks ?? []);
        if (isActive) setAppTasks(tasks);
      } catch {
        // ignore — user may not be logged in
      }
    };
    void fetchTasks();
    return () => { isActive = false; };
  }, []);

  // ── Weather ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let isActive = true;
    const loadWeather = async () => {
      const startDate = formatDateKey(new Date(year, month, 1));
      const endDate = formatDateKey(new Date(year, month + 1, 0));
      try {
        const params = new URLSearchParams({
          latitude: '-1.286389', longitude: '36.817223',
          daily: 'weather_code', timezone: 'auto',
          start_date: startDate, end_date: endDate,
        });
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
        if (!res.ok || !isActive) return;
        const data = (await res.json()) as { daily?: { time: string[]; weather_code: number[] } };
        if (!isActive || !data.daily) return;
        const next: Record<string, number> = {};
        data.daily.time.forEach((d, i) => {
          const code = data.daily?.weather_code[i];
          if (typeof code === 'number') next[d] = code;
        });
        setWeatherByDate(next);
      } catch { /* ignore */ }
    };
    void loadWeather();
    return () => { isActive = false; };
  }, [month, year]);

  // ── Merge entries ──────────────────────────────────────────────────────────
  const allEntries = useMemo<UnifiedEntry[]>(() => {
    const entries: UnifiedEntry[] = [];

    // App tasks with a due date
    for (const task of appTasks) {
      if (!task.dueDate) continue;
      const dateKey = task.dueDate.slice(0, 10);
      entries.push({
        id: `app-${task.id}`,
        title: task.title,
        date: dateKey,
        tag: task.priority ?? 'Task',
        source: 'app',
        priority: task.priority,
        colorHex: PRIORITY_COLORS[task.priority] ?? '#3b82f6',
      });
    }

    // Google Calendar events
    for (const evt of googleEvents) {
      const rawStart = evt.start.date ?? evt.start.dateTime ?? '';
      const dateKey = rawStart.slice(0, 10);
      const time = evt.start.dateTime
        ? new Date(evt.start.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
        : undefined;
      entries.push({
        id: `gcal-${evt.id}`,
        title: evt.summary ?? '(No title)',
        date: dateKey,
        time,
        tag: 'Google',
        source: 'google',
        colorHex: evt.colorId ? (GOOGLE_COLOR_MAP[evt.colorId] ?? '#039be5') : '#039be5',
      });
    }

    return entries.sort((a, b) => a.date.localeCompare(b.date));
  }, [appTasks, googleEvents]);

  const entriesByDay = useMemo(() => {
    const map: Record<string, UnifiedEntry[]> = {};
    for (const e of allEntries) {
      map[e.date] = [...(map[e.date] ?? []), e];
    }
    return map;
  }, [allEntries]);

  // ── Calendar grid ─────────────────────────────────────────────────────────
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days = useMemo(() => {
    const cells: Array<number | null> = [];
    for (let i = 0; i < startingDayOfWeek; i++) cells.push(null);
    for (let i = 1; i <= daysInMonth; i++) cells.push(i);
    return cells;
  }, [startingDayOfWeek, daysInMonth]);

  const today = new Date();
  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // upcoming: next 30 days across both sources
  const upcomingEntries = useMemo(() => {
    const todayKey = formatDateKey(today);
    const limit = formatDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30));
    return allEntries
      .filter(e => e.date >= todayKey && e.date <= limit)
      .slice(0, 20);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEntries]);

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8">

        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Calendar</span>
            <h1 className="text-3xl font-semibold">Team calendar</h1>
            <p className="max-w-2xl text-sm text-slate-500">
              Your app tasks and Google Calendar events unified in one view.
            </p>
          </div>

          {/* Google Calendar connect / status */}
          <div className="flex flex-col items-end gap-1">
            {googleToken ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs font-semibold text-emerald-700">Google Calendar connected</span>
                  <span className="text-xs text-emerald-500">· {googleEvents.length} events this month</span>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleDisconnect}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleLoading || !gisReady}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {/* Google G icon */}
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {googleLoading ? 'Connecting…' : 'Connect Google Calendar'}
              </button>
            )}
            {googleError && (
              <p className="text-xs text-red-500">{googleError}</p>
            )}
          </div>
        </header>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
          <span className="font-semibold text-slate-700">Legend:</span>
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} />App — High priority</div>
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#f97316' }} />App — Medium</div>
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />App — Low</div>
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#039be5' }} />Google Calendar</div>
        </div>

        {/* Calendar grid */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Month</p>
              <h2 className="text-2xl font-semibold text-slate-900">{monthLabel}</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >Prev</button>
              <button
                type="button"
                onClick={() => setCurrentMonth(new Date())}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >Today</button>
              <button
                type="button"
                onClick={() => setCurrentMonth(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >Next</button>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-7 gap-2">
            {weekDays.map(d => (
              <div key={d} className="text-center text-xs font-semibold uppercase text-slate-500">{d}</div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-7 gap-2">
            {days.map((day, index) => {
              const isToday =
                day !== null &&
                today.getFullYear() === year &&
                today.getMonth() === month &&
                today.getDate() === day;
              const dateKey = day === null ? null : formatDateKey(new Date(year, month, day));
              const dayEntries = dateKey ? (entriesByDay[dateKey] ?? []) : [];
              const weatherIcon = dateKey ? resolveWeatherIcon(weatherByDate[dateKey]) : null;
              const appCount = dayEntries.filter(e => e.source === 'app').length;
              const gcalCount = dayEntries.filter(e => e.source === 'google').length;

              return (
                <div
                  key={day ? `day-${day}` : `empty-${index}`}
                  className={`min-h-24 rounded-xl border p-2 transition-colors ${
                    day === null
                      ? 'border-transparent bg-transparent'
                      : isToday
                        ? 'border-emerald-300 bg-emerald-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  {day !== null && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-semibold ${isToday ? 'text-emerald-700' : 'text-slate-900'}`}>{day}</span>
                        <div className="flex items-center gap-1">
                          {weatherIcon && <span className="text-sm" aria-hidden="true">{weatherIcon}</span>}
                          {appCount > 0 && (
                            <span className="rounded-full bg-blue-100 px-1.5 text-[10px] font-bold text-blue-700" title={`${appCount} task(s)`}>{appCount}</span>
                          )}
                          {gcalCount > 0 && (
                            <span className="rounded-full bg-sky-100 px-1.5 text-[10px] font-bold text-sky-700" title={`${gcalCount} Google event(s)`}>{gcalCount}</span>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 space-y-1">
                        {dayEntries.slice(0, 3).map(entry => (
                          <div
                            key={entry.id}
                            className="flex items-start gap-1 rounded-md px-1.5 py-1 text-[10px]"
                            style={{ backgroundColor: `${entry.colorHex}18`, borderLeft: `2.5px solid ${entry.colorHex}` }}
                          >
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-800">{entry.title}</p>
                              {entry.time && <p className="text-slate-500">{entry.time}</p>}
                            </div>
                          </div>
                        ))}
                        {dayEntries.length > 3 && (
                          <p className="pl-1 text-[10px] text-slate-400">+{dayEntries.length - 3} more</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Upcoming events list */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Upcoming (next 30 days)</h3>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>{appTasks.filter(t => t.dueDate).length} app tasks</span>
              {googleToken && <span>· {googleEvents.length} Google events</span>}
            </div>
          </div>

          {upcomingEntries.length === 0 ? (
            <p className="mt-6 text-center text-sm text-slate-400">No upcoming events or tasks in the next 30 days.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {upcomingEntries.map(entry => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                  style={{ borderLeftWidth: '3px', borderLeftColor: entry.colorHex }}
                >
                  <div className="flex items-center gap-3">
                    {/* source icon */}
                    {entry.source === 'google' ? (
                      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-label="Google Calendar">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                    ) : (
                      <svg className="h-4 w-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="App task">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                      </svg>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {entry.time ? ` · ${entry.time}` : ''}
                      </p>
                    </div>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: entry.colorHex }}
                  >
                    {entry.source === 'google' ? 'Google' : entry.tag}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
