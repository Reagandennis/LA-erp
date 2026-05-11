'use client';

import { useEffect, useMemo, useState } from 'react';

import { useGoogleAuth } from '@/app/ui/GoogleAuthProvider';

import { ShiftToast } from './ShiftToast';

type AppTask = {
  id: number;
  title: string;
  priority: string;
  status: string;
  dueDate: string | null;
  completed: boolean;
};

type ItineraryEvent = {
  id: string;
  title: string;
  date: string | null;
  time?: string | null;
  type?: string | null;
};

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  colorId?: string;
};

type ShiftRecord = {
  type?: string;
  startTime?: string;
  endTime?: string;
  timeLabel?: string;
  statusLabel?: string;
};

type CurrentUser = {
  id: string | number;
  name?: string | null;
};

type UnifiedEntry = {
  id: string;
  title: string;
  date: string;
  time?: string;
  tag: string;
  source: 'app' | 'google' | 'shift';
  priority?: string;
  colorHex?: string;
};

type CalendarDayCellProps = {
  day: number | null;
  index: number;
  year: number;
  month: number;
  today: Date;
  entriesByDay: Record<string, UnifiedEntry[]>;
  weatherByDate: Record<string, number>;
};

const GOOGLE_COLOR_MAP: Record<string, string> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
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
  { codes: [61, 63, 65, 66, 67, 80, 81, 82], icon: '🌧️' },
  { codes: [71, 73, 75, 77, 85, 86], icon: '❄️' },
  { codes: [95, 96, 99], icon: '⛈️' },
];

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/session');
  if (!response.ok) {
    return null;
  }

  const data = (await response.json().catch(() => null)) as { user?: CurrentUser | null } | null;
  return data?.user ?? null;
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveWeatherIcon(code?: number | null) {
  if (code == null) {
    return null;
  }

  for (const entry of CALENDAR_WEATHER_ICONS) {
    if (entry.codes.includes(code)) {
      return entry.icon;
    }
  }

  return null;
}

function GoogleIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function CalendarDayCell({
  day,
  index,
  year,
  month,
  today,
  entriesByDay,
  weatherByDate,
}: Readonly<CalendarDayCellProps>) {
  if (day === null) {
    return <div key={`empty-${index}`} className="min-h-24 rounded-xl border border-transparent bg-transparent p-2" />;
  }

  const isToday =
    today.getFullYear() === year &&
    today.getMonth() === month &&
    today.getDate() === day;
  const dateKey = formatDateKey(new Date(year, month, day));
  const dayEntries = entriesByDay[dateKey] ?? [];
  const weatherIcon = resolveWeatherIcon(weatherByDate[dateKey]);
  const appCount = dayEntries.filter((entry) => entry.source === 'app').length;
  const googleCount = dayEntries.filter((entry) => entry.source === 'google').length;
  const shiftCount = dayEntries.filter((entry) => entry.source === 'shift').length;

  return (
    <div
      key={`day-${day}`}
      className={`min-h-24 rounded-xl border p-2 transition-colors ${
        isToday
          ? 'border-emerald-300 bg-emerald-50'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${isToday ? 'text-emerald-700' : 'text-slate-900'}`}>{day}</span>
        <div className="flex items-center gap-1">
          {weatherIcon ? <span className="text-sm" aria-hidden="true">{weatherIcon}</span> : null}
          {appCount > 0 ? (
            <span
              className="rounded-full bg-blue-100 px-1.5 text-[10px] font-bold text-blue-700"
              title={`${appCount} app item(s)`}
            >
              {appCount}
            </span>
          ) : null}
          {shiftCount > 0 ? (
            <span
              className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-bold text-indigo-700"
              title={`${shiftCount} shift(s)`}
            >
              {shiftCount}
            </span>
          ) : null}
          {googleCount > 0 ? (
            <span
              className="rounded-full bg-sky-100 px-1.5 text-[10px] font-bold text-sky-700"
              title={`${googleCount} Google event(s)`}
            >
              {googleCount}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-1.5 space-y-1">
        {dayEntries.slice(0, 3).map((entry) => (
          <div
            key={entry.id}
            className="flex items-start gap-1 rounded-md px-1.5 py-1 text-[10px]"
            style={{
              backgroundColor: `${entry.colorHex}18`,
              borderLeft: `2.5px solid ${entry.colorHex}`,
            }}
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-800">{entry.title}</p>
              {entry.time ? <p className="text-slate-500">{entry.time}</p> : null}
            </div>
          </div>
        ))}
        {dayEntries.length > 3 ? <p className="pl-1 text-[10px] text-slate-400">+{dayEntries.length - 3} more</p> : null}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [showShiftToast, setShowShiftToast] = useState(false);
  const [shiftToastMsg, setShiftToastMsg] = useState('');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [weatherByDate, setWeatherByDate] = useState<Record<string, number>>({});
  const [appTasks, setAppTasks] = useState<AppTask[]>([]);
  const [itineraryEvents, setItineraryEvents] = useState<ItineraryEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [roster, setRoster] = useState<Record<string, Record<string, ShiftRecord>>>({});
  const [users, setUsers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const {
    token: googleToken,
    login: handleGoogleSignIn,
    logout: handleGoogleDisconnect,
    loading: googleLoading,
    error: googleAuthError,
    gsiReady,
  } = useGoogleAuth();

  const googleError = googleAuthError || fetchError;
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthLabel = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  useEffect(() => {
    let isActive = true;

    const fetchTasks = async () => {
      try {
        const response = await fetch('/api/planning/tasks');
        if (!response.ok) {
          return;
        }

        const data = (await response.json().catch(() => null)) as { tasks?: AppTask[] } | AppTask[] | null;
        const tasks = Array.isArray(data) ? data : (data?.tasks ?? []);
        if (isActive) {
          setAppTasks(tasks);
        }
      } catch {
        if (isActive) {
          setAppTasks([]);
        }
      }
    };

    void fetchTasks();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const fetchItineraryEvents = async () => {
      try {
        const response = await fetch('/api/planning/itinerary-events');
        if (!response.ok) {
          return;
        }

        const data = (await response.json().catch(() => null)) as ItineraryEvent[] | { events?: ItineraryEvent[] } | null;
        const events = Array.isArray(data) ? data : (data?.events ?? []);
        if (isActive) {
          setItineraryEvents(events);
        }
      } catch {
        if (isActive) {
          setItineraryEvents([]);
        }
      }
    };

    void fetchItineraryEvents();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadWeather = async () => {
      const startDate = formatDateKey(new Date(year, month, 1));
      const endDate = formatDateKey(new Date(year, month + 1, 0));

      try {
        const params = new URLSearchParams({
          latitude: '-1.286389',
          longitude: '36.817223',
          daily: 'weather_code',
          timezone: 'auto',
          start_date: startDate,
          end_date: endDate,
        });
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!response.ok || !isActive) {
          return;
        }

        const data = (await response.json().catch(() => null)) as
          | { daily?: { time: string[]; weather_code: number[] } }
          | null;

        if (!isActive || !data?.daily) {
          return;
        }

        const nextWeather: Record<string, number> = {};
        data.daily.time.forEach((date, index) => {
          const code = data.daily?.weather_code[index];
          if (typeof code === 'number') {
            nextWeather[date] = code;
          }
        });

        setWeatherByDate(nextWeather);
      } catch {
        if (isActive) {
          setWeatherByDate({});
        }
      }
    };

    void loadWeather();

    return () => {
      isActive = false;
    };
  }, [month, year]);

  useEffect(() => {
    let isActive = true;

    const loadScheduleData = async () => {
      try {
        const [scheduleResponse, usersResponse, user] = await Promise.all([
          fetch('/api/schedule'),
          fetch('/api/admin/users'),
          fetchCurrentUser(),
        ]);

        if (!isActive) {
          return;
        }

        if (scheduleResponse.ok) {
          const scheduleData = (await scheduleResponse.json().catch(() => null)) as {
            roster?: Record<string, Record<string, ShiftRecord>>;
          } | null;
          setRoster(scheduleData?.roster ?? {});
        }

        if (usersResponse.ok) {
          const usersData = (await usersResponse.json().catch(() => null)) as {
            users?: Array<{ id: string | number; name?: string | null }>;
          } | null;
          setUsers(
            (usersData?.users ?? []).map((userRecord) => ({
              id: String(userRecord.id),
              name: userRecord.name || 'Unknown user',
            })),
          );
        }

        setCurrentUser(user);
        setSelectedUserId((currentSelected) => currentSelected ?? (user ? String(user.id) : null));
      } catch {
        if (isActive) {
          setRoster({});
          setUsers([]);
          setCurrentUser(null);
          setSelectedUserId(null);
        }
      }
    };

    void loadScheduleData();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!googleToken) {
      setGoogleEvents([]);
      setFetchError(null);
    }
  }, [googleToken]);

  useEffect(() => {
    if (!googleToken) {
      return;
    }

    let isActive = true;

    const fetchEvents = async () => {
      const timeMin = new Date(year, month, 1).toISOString();
      const timeMax = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? '';

      try {
        setFetchError(null);
        const params = new URLSearchParams({
          key: apiKey,
          timeMin,
          timeMax,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '100',
        });
        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
          { headers: { Authorization: `Bearer ${googleToken}` } },
        );

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? 'Calendar fetch failed');
        }

        const data = (await response.json().catch(() => null)) as { items?: GoogleCalendarEvent[] } | null;
        if (isActive) {
          setGoogleEvents(data?.items ?? []);
        }
      } catch (error) {
        if (isActive) {
          setGoogleEvents([]);
          setFetchError(error instanceof Error ? error.message : 'Failed to load Google Calendar');
        }
      }
    };

    void fetchEvents();

    return () => {
      isActive = false;
    };
  }, [googleToken, month, year]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const currentUserId = String(currentUser.id);
    const userRoster = roster[currentUserId];
    if (!userRoster) {
      return;
    }

    const now = new Date();
    const todayKey = formatDateKey(now);
    const shift = userRoster[todayKey];

    if (!shift?.startTime || !shift?.endTime) {
      return;
    }

    const [startHour, startMinute] = shift.startTime.split(':').map(Number);
    const [endHour, endMinute] = shift.endTime.split(':').map(Number);

    if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) {
      return;
    }

    const currentTime = now.getHours() + now.getMinutes() / 60;
    const start = startHour + startMinute / 60;
    let end = endHour + endMinute / 60;
    if (end <= start) {
      end += 24;
    }

    const adjustedCurrentTime = currentTime < start && end > 24 ? currentTime + 24 : currentTime;
    const inShift = adjustedCurrentTime >= start && adjustedCurrentTime <= end;

    if (inShift) {
      const fallbackShiftLabel = `${shift.startTime}-${shift.endTime}`;
      setShiftToastMsg(`You are scheduled to work now (${shift.timeLabel || fallbackShiftLabel})`);
      setShowShiftToast(true);
    } else {
      setShowShiftToast(false);
    }
  }, [currentUser, roster]);

  const allEntries = useMemo<UnifiedEntry[]>(() => {
    const entries: UnifiedEntry[] = [];

    for (const task of appTasks) {
      if (!task.dueDate) {
        continue;
      }

      entries.push({
        id: `app-${task.id}`,
        title: task.title,
        date: task.dueDate.slice(0, 10),
        tag: task.priority || 'Task',
        source: 'app',
        priority: task.priority,
        colorHex: PRIORITY_COLORS[task.priority] ?? '#3b82f6',
      });
    }

    for (const item of itineraryEvents) {
      if (!item.date) {
        continue;
      }

      entries.push({
        id: item.id,
        title: item.title,
        date: item.date.slice(0, 10),
        time: item.time ?? undefined,
        tag: item.type || 'Trip',
        source: 'app',
        colorHex: '#10b981',
      });
    }

    for (const event of googleEvents) {
      const rawStart = event.start.date ?? event.start.dateTime ?? '';
      const dateKey = rawStart.slice(0, 10);
      if (!dateKey) {
        continue;
      }

      entries.push({
        id: `gcal-${event.id}`,
        title: event.summary ?? '(No title)',
        date: dateKey,
        time: event.start.dateTime
          ? new Date(event.start.dateTime).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })
          : undefined,
        tag: 'Google',
        source: 'google',
        colorHex: event.colorId ? (GOOGLE_COLOR_MAP[event.colorId] ?? '#039be5') : '#039be5',
      });
    }

    if (selectedUserId && roster[selectedUserId]) {
      Object.entries(roster[selectedUserId]).forEach(([dateKey, shift]) => {
        if (!shift || shift.type === 'empty') {
          return;
        }

        entries.push({
          id: `shift-${selectedUserId}-${dateKey}`,
          title: shift.timeLabel || shift.statusLabel || 'Shift',
          date: dateKey,
          tag: 'Shift',
          source: 'shift',
          colorHex: '#6366f1',
        });
      });
    }

    return entries.sort((left, right) => {
      const byDate = left.date.localeCompare(right.date);
      if (byDate !== 0) {
        return byDate;
      }

      return left.title.localeCompare(right.title);
    });
  }, [appTasks, googleEvents, itineraryEvents, roster, selectedUserId]);

  const entriesByDay = useMemo(() => {
    const groupedEntries: Record<string, UnifiedEntry[]> = {};
    for (const entry of allEntries) {
      groupedEntries[entry.date] = [...(groupedEntries[entry.date] ?? []), entry];
    }
    return groupedEntries;
  }, [allEntries]);

  const upcomingEntries = useMemo(() => {
    const today = new Date();
    const todayKey = formatDateKey(today);
    const limitKey = formatDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30));

    return allEntries.filter((entry) => entry.date >= todayKey && entry.date <= limitKey).slice(0, 20);
  }, [allEntries]);

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDayOfWeek = firstDay.getDay();
  const days = useMemo(() => {
    const cells: Array<number | null> = [];
    for (let index = 0; index < startingDayOfWeek; index += 1) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(day);
    }
    return cells;
  }, [daysInMonth, startingDayOfWeek]);

  const today = new Date();

  return (
    <>
      {showShiftToast ? <ShiftToast message={shiftToastMsg} onClose={() => setShowShiftToast(false)} /> : null}
      <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="mb-4 flex items-center gap-3">
            <label className="text-sm font-semibold text-slate-700" htmlFor="calendar-user-filter">
              View shifts for:
            </label>
            <select
              id="calendar-user-filter"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm"
              value={selectedUserId || ''}
              onChange={(event) => setSelectedUserId(event.target.value || null)}
            >
              {currentUser ? (
                <option value={String(currentUser.id)}>
                  Me ({currentUser.name || 'Current user'})
                </option>
              ) : null}
              {users
                .filter((user) => !currentUser || user.id !== String(currentUser.id))
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
          </div>

          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Calendar</span>
              <h1 className="text-3xl font-semibold">Team calendar</h1>
              <p className="max-w-2xl text-sm text-slate-500">
                Your app tasks, published trip itinerary items, shifts, and Google Calendar events unified in one view.
              </p>
            </div>

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
                  disabled={googleLoading || !gsiReady}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                >
                  <GoogleIcon className="h-4 w-4" />
                  {googleLoading ? 'Connecting…' : 'Connect Google Calendar'}
                </button>
              )}
              {googleError ? <p className="text-xs text-red-500">{googleError}</p> : null}
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-500">
            <span className="font-semibold text-slate-700">Legend:</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
              App — High priority
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#f97316' }} />
              App — Medium
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />
              App — Low
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#10b981' }} />
              Trip itinerary
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#6366f1' }} />
              Shift
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: '#039be5' }} />
              Google Calendar
            </div>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Month</p>
                <h2 className="text-2xl font-semibold text-slate-900">{monthLabel}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentMonth((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMonth(new Date())}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentMonth((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-7 gap-2">
              {WEEK_DAYS.map((day) => (
                <div key={day} className="text-center text-xs font-semibold uppercase text-slate-500">
                  {day}
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-7 gap-2">
              {days.map((day, index) => (
                <CalendarDayCell
                  key={day === null ? `empty-${index}` : `day-${day}`}
                  day={day}
                  index={index}
                  year={year}
                  month={month}
                  today={today}
                  entriesByDay={entriesByDay}
                  weatherByDate={weatherByDate}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Upcoming (next 30 days)</h3>
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>{appTasks.filter((task) => task.dueDate).length} app tasks</span>
                <span>· {itineraryEvents.filter((event) => event.date).length} itinerary items</span>
                {googleToken ? <span>· {googleEvents.length} Google events</span> : null}
              </div>
            </div>

            {upcomingEntries.length === 0 ? (
              <p className="mt-6 text-center text-sm text-slate-400">No upcoming events or tasks in the next 30 days.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {upcomingEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
                    style={{ borderLeftWidth: '3px', borderLeftColor: entry.colorHex }}
                  >
                    <div className="flex items-center gap-3">
                      {entry.source === 'google' ? (
                        <GoogleIcon className="h-4 w-4 shrink-0" />
                      ) : entry.source === 'shift' ? (
                        <svg className="h-4 w-4 shrink-0 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="Shift">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-label="App task">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                          {entry.time ? ` · ${entry.time}` : ''}
                        </p>
                      </div>
                    </div>
                    <span
                      className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                      style={{ backgroundColor: entry.colorHex }}
                    >
                      {entry.tag}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
