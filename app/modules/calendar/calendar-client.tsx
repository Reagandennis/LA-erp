'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { GoogleAuthProvider, useGoogleAuth } from '@/app/ui/google-auth-provider';

// --- Types ---
type CalendarEvent = {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  tag: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  reminderMinutesBefore: number | null;
  googleEventId: string | null;
  createdAt: string;
};

type GoogleEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
};

type DisplayEvent = {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  tag: string | null;
  source: 'local' | 'google' | 'extra';
  local?: CalendarEvent;
};

// Read-only events injected by a host page (e.g. personal tasks shown by due date).
export type CalendarExtraEvent = {
  key: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  tag?: string | null;
};

type CalendarView = 'month' | 'week' | 'day';

type Props = {
  initialEvents: CalendarEvent[];
  extraEvents?: CalendarExtraEvent[];
};

const REMINDER_OPTIONS: Array<{ label: string; value: number | '' }> = [
  { label: 'No reminder', value: '' },
  { label: 'At start time', value: 0 },
  { label: '5 minutes before', value: 5 },
  { label: '10 minutes before', value: 10 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '1 day before', value: 1440 },
];

type WeatherCategory = 'clear' | 'partly' | 'fog' | 'rain' | 'snow' | 'thunder';

function weatherCategory(code?: number | null): WeatherCategory | null {
  if (code == null) return null;
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'partly';
  if (code === 45 || code === 48) return 'fog';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunder';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  return null;
}

// Keyframes for the animated weather icons (injected once per page).
function WeatherStyles() {
  return (
    <style>{`
      @keyframes cwx-spin { to { transform: rotate(360deg); } }
      @keyframes cwx-drift { 0%,100%{transform:translateX(0)} 50%{transform:translateX(1px)} }
      @keyframes cwx-fall { 0%{transform:translateY(-1px);opacity:0} 25%{opacity:1} 100%{transform:translateY(7px);opacity:0} }
      @keyframes cwx-flash { 0%,82%,100%{opacity:.2} 88%,95%{opacity:1} }
      .cwx-spin{animation:cwx-spin 14s linear infinite}
      .cwx-drift{animation:cwx-drift 4s ease-in-out infinite}
      .cwx-drop{animation:cwx-fall 1.3s linear infinite}
      .cwx-bolt{animation:cwx-flash 2.4s ease-in-out infinite}
      @media (prefers-reduced-motion: reduce){
        .cwx-spin,.cwx-drift,.cwx-drop,.cwx-bolt{animation:none}
      }
    `}</style>
  );
}

function Cloud({ color }: { color: string }) {
  return (
    <g fill={color}>
      <circle cx="8.5" cy="15" r="3.2" />
      <circle cx="12.5" cy="13.3" r="4.2" />
      <circle cx="16" cy="15.3" r="2.9" />
      <rect x="7.5" y="14.4" width="9.5" height="4.3" rx="2.1" />
    </g>
  );
}

function sunRays(cx: number, cy: number, r: number) {
  return (
    <>
      <g className="cwx-spin" style={{ transformOrigin: `${cx}px ${cy}px` }} stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round">
        <line x1={cx} y1={cy - r - 3} x2={cx} y2={cy - r - 1} />
        <line x1={cx} y1={cy + r + 1} x2={cx} y2={cy + r + 3} />
        <line x1={cx - r - 3} y1={cy} x2={cx - r - 1} y2={cy} />
        <line x1={cx + r + 1} y1={cy} x2={cx + r + 3} y2={cy} />
        <line x1={cx - r - 2} y1={cy - r - 2} x2={cx - r} y2={cy - r} />
        <line x1={cx + r} y1={cy + r} x2={cx + r + 2} y2={cy + r + 2} />
        <line x1={cx + r} y1={cy - r} x2={cx + r + 2} y2={cy - r - 2} />
        <line x1={cx - r - 2} y1={cy + r + 2} x2={cx - r} y2={cy + r} />
      </g>
      <circle cx={cx} cy={cy} r={r} fill="#fbbf24" />
    </>
  );
}

function AnimatedWeatherIcon({ code, size = 20 }: { code?: number | null; size?: number }) {
  const cat = weatherCategory(code);
  if (!cat) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label={cat}>
      {cat === 'clear' && sunRays(12, 12, 4.5)}
      {cat === 'partly' && (
        <>
          {sunRays(8.5, 8.5, 3)}
          <g className="cwx-drift">
            <Cloud color="#cbd5e1" />
          </g>
        </>
      )}
      {cat === 'fog' && (
        <>
          <g className="cwx-drift">
            <Cloud color="#cbd5e1" />
          </g>
          <g stroke="#94a3b8" strokeWidth="1.4" strokeLinecap="round" className="cwx-drift">
            <line x1="6" y1="20.5" x2="14" y2="20.5" />
            <line x1="9" y1="22.5" x2="17" y2="22.5" />
          </g>
        </>
      )}
      {cat === 'rain' && (
        <>
          <Cloud color="#94a3b8" />
          <g fill="#38bdf8">
            <circle className="cwx-drop" style={{ animationDelay: '0s' }} cx="9.5" cy="20" r="1" />
            <circle className="cwx-drop" style={{ animationDelay: '.45s' }} cx="12.5" cy="20" r="1" />
            <circle className="cwx-drop" style={{ animationDelay: '.9s' }} cx="15.5" cy="20" r="1" />
          </g>
        </>
      )}
      {cat === 'snow' && (
        <>
          <Cloud color="#cbd5e1" />
          <g fill="#e2e8f0">
            <circle className="cwx-drop" style={{ animationDelay: '0s' }} cx="9.5" cy="20" r="1.1" />
            <circle className="cwx-drop" style={{ animationDelay: '.5s' }} cx="12.5" cy="20" r="1.1" />
            <circle className="cwx-drop" style={{ animationDelay: '1s' }} cx="15.5" cy="20" r="1.1" />
          </g>
        </>
      )}
      {cat === 'thunder' && (
        <>
          <Cloud color="#64748b" />
          <path className="cwx-bolt" d="M12.4 18 l-2.4 3.8 h1.7 l-.8 2.2 2.8-3.9 h-1.7 l1.2-2.1 z" fill="#facc15" />
        </>
      )}
    </svg>
  );
}

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timeLabel(iso: string, allDay: boolean) {
  if (allDay) return 'All day';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Soft chip styling (month cells, all-day strips) per event source.
function chipClasses(source: DisplayEvent['source']) {
  if (source === 'google') return 'bg-blue-50 text-blue-700';
  if (source === 'extra') return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
}
// Solid block styling (time-grid timed events) per event source.
function blockClasses(source: DisplayEvent['source']) {
  if (source === 'google') return 'bg-blue-100 text-blue-800';
  if (source === 'extra') return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200';
}

// Vertical time-grid used by the week (7 columns) and day (1 column) views.
function TimeGrid({
  days,
  eventsByDay,
  weatherByDate,
  onEventClick,
  onCreate,
}: {
  days: Date[];
  eventsByDay: Record<string, DisplayEvent[]>;
  weatherByDate: Record<string, number>;
  onEventClick: (ev: DisplayEvent) => void;
  onCreate: (dateKey: string) => void;
}) {
  const today = new Date();
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="mt-6 overflow-x-auto">
      <div style={{ minWidth: days.length > 1 ? 680 : 320 }}>
        {/* Day headers */}
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div />
          {days.map((d) => {
            const isToday = sameDay(d, today);
            const weatherCode = weatherByDate[formatDateKey(d)];
            return (
              <button
                key={d.toISOString()}
                onClick={() => onCreate(formatDateKey(d))}
                className={`border-b border-slate-200 py-2 text-center transition-colors hover:bg-slate-50 ${isToday ? 'bg-emerald-50' : ''}`}
              >
                <p className="text-[11px] font-semibold uppercase text-slate-500">{d.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                <div className="flex items-center justify-center gap-1.5">
                  <p className={`text-lg font-semibold ${isToday ? 'text-emerald-700' : 'text-slate-900'}`}>{d.getDate()}</p>
                  {weatherCode != null && <AnimatedWeatherIcon code={weatherCode} size={18} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* All-day strip */}
        <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: cols }}>
          <div className="flex items-center justify-end py-1 pr-2 text-[10px] font-semibold uppercase text-slate-400">All day</div>
          {days.map((d) => {
            const key = formatDateKey(d);
            const allDayEvents = (eventsByDay[key] ?? []).filter((e) => e.allDay);
            return (
              <div key={key} className="min-h-8 space-y-1 border-l border-slate-100 p-1">
                {allDayEvents.map((ev) => (
                  <button
                    key={ev.key}
                    onClick={() => onEventClick(ev)}
                    className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-semibold ${chipClasses(ev.source)}`}
                  >
                    {ev.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {/* Time body */}
        <div className="relative max-h-[34rem] overflow-y-auto">
          <div className="grid" style={{ gridTemplateColumns: cols }}>
            {/* Hour gutter */}
            <div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
              {HOURS.map((h) => (
                <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] font-medium text-slate-400" style={{ top: h * HOUR_HEIGHT }}>
                  {h === 0 ? '' : `${(h % 12) || 12}${h < 12 ? 'am' : 'pm'}`}
                </div>
              ))}
            </div>
            {/* Day columns */}
            {days.map((d) => {
              const key = formatDateKey(d);
              const timed = (eventsByDay[key] ?? []).filter((e) => !e.allDay);
              return (
                <div
                  key={key}
                  className="relative border-l border-slate-100"
                  style={{ height: 24 * HOUR_HEIGHT }}
                  onClick={() => onCreate(key)}
                >
                  {HOURS.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-slate-50" style={{ top: h * HOUR_HEIGHT }} />
                  ))}
                  {timed.map((ev) => {
                    const s = new Date(ev.startsAt);
                    const startMin = s.getHours() * 60 + s.getMinutes();
                    const e = ev.endsAt ? new Date(ev.endsAt) : null;
                    let endMin = e ? e.getHours() * 60 + e.getMinutes() : startMin + 60;
                    if (e && (!sameDay(e, s) || endMin <= startMin)) endMin = 24 * 60;
                    const top = (startMin / 60) * HOUR_HEIGHT;
                    const height = Math.max(((endMin - startMin) / 60) * HOUR_HEIGHT, 20);
                    return (
                      <button
                        key={ev.key}
                        onClick={(evt) => {
                          evt.stopPropagation();
                          onEventClick(ev);
                        }}
                        className={`absolute left-1 right-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[10px] ${blockClasses(ev.source)}`}
                        style={{ top, height }}
                      >
                        <p className="truncate font-semibold">{ev.title}</p>
                        <p className="truncate opacity-80">{timeLabel(ev.startsAt, false)}</p>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarInner({ initialEvents, extraEvents = [] }: Props) {
  const { token, login, logout, loading, error, gsiReady } = useGoogleAuth();

  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [view, setView] = useState<CalendarView>('month');
  const [localEvents, setLocalEvents] = useState<CalendarEvent[]>(initialEvents);
  const [googleEvents, setGoogleEvents] = useState<GoogleEvent[]>([]);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [weatherByDate, setWeatherByDate] = useState<Record<string, number>>({});

  // Editor modal
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    date: formatDateKey(new Date()),
    allDay: false,
    startTime: '09:00',
    endTime: '',
    tag: '',
    location: '',
    description: '',
    reminder: '' as number | '',
    addToGoogle: false,
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Data range covers whatever the active view shows.
  const rangeStart = useMemo(() => {
    if (view === 'day') return startOfDay(currentMonth);
    if (view === 'week') return startOfWeek(currentMonth);
    return new Date(year, month, 1);
  }, [view, currentMonth, year, month]);
  const rangeEnd = useMemo(() => {
    if (view === 'day') return addDays(startOfDay(currentMonth), 1);
    if (view === 'week') return addDays(startOfWeek(currentMonth), 7);
    return new Date(year, month + 1, 1);
  }, [view, currentMonth, year, month]);

  // --- Load our events for the visible range ---
  const loadLocal = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/calendar/events?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { events?: CalendarEvent[] };
      setLocalEvents(data.events ?? []);
    } catch {
      // ignore
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  // --- Load Google events for the visible month when connected ---
  const loadGoogle = useCallback(async () => {
    if (!token) {
      setGoogleEvents([]);
      return;
    }
    try {
      const params = new URLSearchParams({
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status === 401) {
        setGoogleError('Google session expired — reconnect to sync.');
        setGoogleEvents([]);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          summary?: string;
          start?: { date?: string; dateTime?: string };
          end?: { date?: string; dateTime?: string };
        }>;
      };
      const mapped: GoogleEvent[] = (data.items ?? [])
        .map((it) => {
          const allDay = Boolean(it.start?.date);
          const start = it.start?.dateTime ?? (it.start?.date ? `${it.start.date}T00:00:00` : null);
          if (!start) return null;
          const end = it.end?.dateTime ?? (it.end?.date ? `${it.end.date}T00:00:00` : null);
          return {
            id: it.id,
            title: it.summary ?? '(no title)',
            startsAt: new Date(start).toISOString(),
            endsAt: end ? new Date(end).toISOString() : null,
            allDay,
          } as GoogleEvent;
        })
        .filter((e): e is GoogleEvent => e !== null);
      setGoogleError(null);
      setGoogleEvents(mapped);
    } catch {
      // ignore network errors
    }
  }, [token, rangeStart, rangeEnd]);

  useEffect(() => {
    void loadGoogle();
  }, [loadGoogle]);

  // --- Weather ---
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          latitude: '-1.286389',
          longitude: '36.817223',
          daily: 'weather_code',
          timezone: 'auto',
          start_date: formatDateKey(rangeStart),
          end_date: formatDateKey(addDays(rangeEnd, -1)),
        });
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { daily?: { time: string[]; weather_code: number[] } };
        if (!active || !data.daily) return;
        const next: Record<string, number> = {};
        data.daily.time.forEach((d, i) => {
          const code = data.daily?.weather_code[i];
          if (typeof code === 'number') next[d] = code;
        });
        setWeatherByDate(next);
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [rangeStart, rangeEnd]);

  // --- Merge events for display ---
  const displayEvents = useMemo<DisplayEvent[]>(() => {
    const linkedGoogleIds = new Set(localEvents.map((e) => e.googleEventId).filter(Boolean) as string[]);
    const local: DisplayEvent[] = localEvents.map((e) => ({
      key: `l-${e.id}`,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      allDay: e.allDay,
      tag: e.tag,
      source: 'local',
      local: e,
    }));
    const google: DisplayEvent[] = googleEvents
      .filter((g) => !linkedGoogleIds.has(g.id))
      .map((g) => ({ key: `g-${g.id}`, title: g.title, startsAt: g.startsAt, endsAt: g.endsAt, allDay: g.allDay, tag: 'Google', source: 'google' }));
    const extra: DisplayEvent[] = extraEvents.map((x) => ({
      key: `x-${x.key}`,
      title: x.title,
      startsAt: x.startsAt,
      endsAt: x.endsAt ?? null,
      allDay: x.allDay ?? true,
      tag: x.tag ?? null,
      source: 'extra',
    }));
    return [...local, ...google, ...extra];
  }, [localEvents, googleEvents, extraEvents]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, DisplayEvent[]> = {};
    for (const ev of displayEvents) {
      const key = formatDateKey(new Date(ev.startsAt));
      (map[key] ??= []).push(ev);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [displayEvents]);

  const upcoming = useMemo(() => {
    const cutoff = Date.now() - 12 * 3600_000;
    return [...displayEvents]
      .filter((e) => new Date(e.startsAt).getTime() >= cutoff)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 8);
  }, [displayEvents]);

  // --- Calendar grid ---
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDayOfWeek = firstDay.getDay();
  const cells = useMemo(() => {
    const arr: Array<number | null> = [];
    for (let i = 0; i < startingDayOfWeek; i += 1) arr.push(null);
    for (let i = 1; i <= daysInMonth; i += 1) arr.push(i);
    return arr;
  }, [startingDayOfWeek, daysInMonth]);

  const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  const viewDays = useMemo(() => {
    if (view === 'day') return [startOfDay(currentMonth)];
    if (view === 'week') {
      const s = startOfWeek(currentMonth);
      return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    }
    return [];
  }, [view, currentMonth]);

  const headerLabel = useMemo(() => {
    if (view === 'day') {
      return currentMonth.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    }
    if (view === 'week') {
      const s = startOfWeek(currentMonth);
      const e = addDays(s, 6);
      const sameMonth = s.getMonth() === e.getMonth();
      return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString('en-US', { month: sameMonth ? undefined : 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return monthLabel;
  }, [view, currentMonth, monthLabel]);

  const navigate = (dir: -1 | 1) => {
    setCurrentMonth((prev) => {
      if (view === 'day') return addDays(prev, dir);
      if (view === 'week') return addDays(prev, dir * 7);
      return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
    });
  };

  // --- Editor helpers ---
  const openCreate = (dateKey?: string) => {
    setEditingId(null);
    setFormError(null);
    setForm({
      title: '',
      date: dateKey ?? formatDateKey(new Date()),
      allDay: false,
      startTime: '09:00',
      endTime: '',
      tag: '',
      location: '',
      description: '',
      reminder: '',
      addToGoogle: false,
    });
    setIsEditorOpen(true);
  };

  const openEdit = (ev: CalendarEvent) => {
    setEditingId(ev.id);
    setFormError(null);
    const start = new Date(ev.startsAt);
    setForm({
      title: ev.title,
      date: formatDateKey(start),
      allDay: ev.allDay,
      startTime: ev.allDay ? '09:00' : start.toTimeString().slice(0, 5),
      endTime: ev.endsAt ? new Date(ev.endsAt).toTimeString().slice(0, 5) : '',
      tag: ev.tag ?? '',
      location: ev.location ?? '',
      description: ev.description ?? '',
      reminder: ev.reminderMinutesBefore ?? '',
      addToGoogle: false,
    });
    setIsEditorOpen(true);
  };

  const buildStartsAt = () => {
    const time = form.allDay ? '00:00' : form.startTime || '09:00';
    return new Date(`${form.date}T${time}`);
  };
  const buildEndsAt = () => {
    if (form.allDay || !form.endTime) return null;
    return new Date(`${form.date}T${form.endTime}`);
  };

  const pushToGoogle = async (startsAt: Date, endsAt: Date | null): Promise<string | null> => {
    if (!token) return null;
    try {
      const payload = {
        summary: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        start: form.allDay ? { date: form.date } : { dateTime: startsAt.toISOString() },
        end: form.allDay
          ? { date: form.date }
          : { dateTime: (endsAt ?? new Date(startsAt.getTime() + 3600_000)).toISOString() },
      };
      const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { id?: string };
      return data.id ?? null;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    if (saving) return;
    if (!form.title.trim()) {
      setFormError('Please enter a title.');
      return;
    }
    const startsAt = buildStartsAt();
    if (Number.isNaN(startsAt.getTime())) {
      setFormError('Please pick a valid date and time.');
      return;
    }
    const endsAt = buildEndsAt();
    setSaving(true);
    setFormError(null);
    try {
      const reminder = form.reminder === '' ? null : Number(form.reminder);
      if (editingId == null) {
        let googleEventId: string | null = null;
        if (form.addToGoogle && token) {
          googleEventId = await pushToGoogle(startsAt, endsAt);
        }
        const res = await fetch('/api/calendar/events', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title,
            description: form.description,
            location: form.location,
            tag: form.tag,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt ? endsAt.toISOString() : null,
            allDay: form.allDay,
            reminderMinutesBefore: reminder,
            googleEventId,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setFormError(data?.error ?? 'Could not save event.');
          return;
        }
      } else {
        const res = await fetch(`/api/calendar/events/${editingId}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title,
            description: form.description,
            location: form.location,
            tag: form.tag,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt ? endsAt.toISOString() : null,
            allDay: form.allDay,
            reminderMinutesBefore: reminder,
          }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setFormError(data?.error ?? 'Could not save event.');
          return;
        }
      }
      setIsEditorOpen(false);
      await loadLocal();
      if (form.addToGoogle) await loadGoogle();
    } catch {
      setFormError('Could not save event.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (editingId == null || saving) return;
    if (!window.confirm('Delete this event?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/calendar/events/${editingId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setIsEditorOpen(false);
        await loadLocal();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <WeatherStyles />
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Calendar</span>
            <h1 className="text-3xl font-semibold">Team calendar</h1>
            <p className="max-w-2xl text-sm text-slate-500">
              Schedule events with reminders, and sync your Google Calendar to see everything in one place.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {token ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Google synced
                </span>
                <button onClick={logout} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={login}
                disabled={!gsiReady || loading}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                </svg>
                {loading ? 'Connecting…' : 'Connect Google Calendar'}
              </button>
            )}
            <button
              onClick={() => openCreate()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New event
            </button>
          </div>
        </header>

        {(error || googleError) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {googleError || error}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm capitalize text-slate-500">{view} view</p>
              <h2 className="text-2xl font-semibold text-slate-900">{headerLabel}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-slate-100 p-1">
                {(['month', 'week', 'day'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                      view === v ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => navigate(-1)}
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
                onClick={() => navigate(1)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>

          {view === 'month' ? (
            <>
              <div className="mt-6 grid grid-cols-7 gap-2">
                {weekDays.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold uppercase text-slate-500">{d}</div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-7 gap-2">
                {cells.map((day, index) => {
                  const isToday =
                    day !== null && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
                  const dateKey = day === null ? null : formatDateKey(new Date(year, month, day));
                  const dayEvents = dateKey ? eventsByDay[dateKey] ?? [] : [];
                  const weatherCode = dateKey ? weatherByDate[dateKey] : undefined;

                  return (
                    <div
                      key={day ? `day-${day}` : `empty-${index}`}
                      onClick={() => dateKey && openCreate(dateKey)}
                      className={`min-h-24 rounded-lg border p-2 transition-colors ${
                        day === null
                          ? 'border-transparent bg-transparent'
                          : isToday
                            ? 'cursor-pointer border-emerald-300 bg-emerald-50'
                            : 'cursor-pointer border-slate-200 bg-white hover:border-emerald-300'
                      }`}
                    >
                      {day !== null && (
                        <>
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-semibold ${isToday ? 'text-emerald-700' : 'text-slate-900'}`}>{day}</span>
                            <div className="flex items-center gap-2">
                              {weatherCode != null && <AnimatedWeatherIcon code={weatherCode} size={20} />}
                              {dayEvents.length > 0 && (
                                <span className="rounded-full bg-emerald-100 px-2 text-xs font-semibold text-emerald-700">{dayEvents.length}</span>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 space-y-1">
                            {dayEvents.slice(0, 3).map((ev) => (
                              <button
                                key={ev.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (ev.local) openEdit(ev.local);
                                }}
                                className={`block w-full rounded px-2 py-1 text-left text-[11px] ${
                                  ev.source === 'google'
                                    ? 'bg-blue-50 text-blue-700'
                                    : ev.source === 'extra'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                <p className="truncate font-semibold text-slate-800">{ev.title}</p>
                                <p className="truncate">
                                  {timeLabel(ev.startsAt, ev.allDay)}
                                  {ev.source === 'google' ? ' · Google' : ev.tag ? ` · ${ev.tag}` : ''}
                                </p>
                              </button>
                            ))}
                            {dayEvents.length > 3 && <p className="text-[11px] text-slate-400">+{dayEvents.length - 3} more</p>}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <TimeGrid
              days={viewDays}
              eventsByDay={eventsByDay}
              weatherByDate={weatherByDate}
              onEventClick={(ev) => ev.local && openEdit(ev.local)}
              onCreate={(dateKey) => openCreate(dateKey)}
            />
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Upcoming events</h3>
            <span className="text-sm text-slate-500">{upcoming.length} upcoming</span>
          </div>
          <div className="mt-4 space-y-3">
            {upcoming.length === 0 ? (
              <p className="text-sm text-slate-400">No upcoming events. Click a day or “New event” to add one.</p>
            ) : (
              upcoming.map((ev) => (
                <button
                  key={ev.key}
                  onClick={() => ev.local && openEdit(ev.local)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-left hover:border-slate-200"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{ev.title}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(ev.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {timeLabel(ev.startsAt, ev.allDay)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ev.source === 'google' ? 'bg-blue-100 text-blue-700' : ev.source === 'extra' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {ev.source === 'google' ? 'Google' : ev.tag || (ev.source === 'extra' ? 'Task' : 'Event')}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Event editor modal */}
      {isEditorOpen && (
        <>
          <button type="button" className="fixed inset-0 z-[300] bg-slate-900/30 backdrop-blur-sm" onClick={() => setIsEditorOpen(false)} aria-label="Close" />
          <div className="fixed left-1/2 top-1/2 z-[310] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 p-6">
              <h2 className="text-lg font-semibold text-slate-900">{editingId == null ? 'New event' : 'Edit event'}</h2>
              <button onClick={() => setIsEditorOpen(false)} className="rounded-lg bg-slate-50 p-2 text-slate-400 hover:bg-slate-100">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Event title"
                  className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Reminder</label>
                  <select
                    value={form.reminder}
                    onChange={(e) => setForm({ ...form, reminder: e.target.value === '' ? '' : Number(e.target.value) })}
                    className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                  >
                    {REMINDER_OPTIONS.map((o) => (
                      <option key={o.label} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="h-4 w-4 rounded" />
                All-day event
              </label>
              {!form.allDay && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Start time</label>
                    <input
                      type="time"
                      value={form.startTime}
                      onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                      className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">End time (optional)</label>
                    <input
                      type="time"
                      value={form.endTime}
                      onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                      className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Tag</label>
                  <input
                    type="text"
                    value={form.tag}
                    onChange={(e) => setForm({ ...form, tag: e.target.value })}
                    placeholder="e.g. Team"
                    className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Location</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="Optional"
                    className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="Optional details"
                  className="w-full resize-none rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              {editingId == null && token && (
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <input type="checkbox" checked={form.addToGoogle} onChange={(e) => setForm({ ...form, addToGoogle: e.target.checked })} className="h-4 w-4 rounded" />
                  Also add to my Google Calendar
                </label>
              )}
              {formError && <p className="text-xs font-semibold text-rose-500">{formError}</p>}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : editingId == null ? 'Create event' : 'Save changes'}
                </button>
                {editingId != null && (
                  <button onClick={handleDelete} disabled={saving} className="rounded-xl px-4 py-3 text-sm font-semibold text-rose-500 hover:text-rose-700 disabled:opacity-60">
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function CalendarClient(props: Props) {
  return (
    <GoogleAuthProvider>
      <CalendarInner {...props} />
    </GoogleAuthProvider>
  );
}
