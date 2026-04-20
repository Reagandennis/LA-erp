'use client';

import { useEffect, useMemo, useState } from 'react';

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  time?: string;
  tag: string;
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

const resolveCalendarWeatherIcon = (code?: number | null) => {
  if (code === null || code === undefined) {
    return null;
  }
  for (const entry of CALENDAR_WEATHER_ICONS) {
    if (entry.codes.includes(code)) {
      return entry.icon;
    }
  }
  return null;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const seedEvents: CalendarEvent[] = [
  { id: 'evt-1', title: 'Ops standup', date: '2026-04-09', time: '09:00', tag: 'Team' },
  { id: 'evt-2', title: 'Vendor review', date: '2026-04-14', time: '14:30', tag: 'Procurement' },
  { id: 'evt-3', title: 'Compliance check', date: '2026-04-20', time: '11:00', tag: 'Compliance' },
  { id: 'evt-4', title: 'Fleet dispatch', date: '2026-04-24', time: '07:00', tag: 'Fleet' },
  { id: 'evt-5', title: 'Monthly recap', date: '2026-04-30', time: '16:00', tag: 'Leadership' },
];

export default function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [events] = useState<CalendarEvent[]>(seedEvents);
  const [weatherByDate, setWeatherByDate] = useState<Record<string, number>>({});

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days = useMemo(() => {
    const cells: Array<number | null> = [];
    for (let i = 0; i < startingDayOfWeek; i += 1) {
      cells.push(null);
    }
    for (let i = 1; i <= daysInMonth; i += 1) {
      cells.push(i);
    }
    return cells;
  }, [startingDayOfWeek, daysInMonth]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((event) => {
      map[event.date] = [...(map[event.date] ?? []), event];
    });
    return map;
  }, [events]);

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
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { daily?: { time: string[]; weather_code: number[] } };
        if (!isActive || !data.daily) {
          return;
        }
        const next: Record<string, number> = {};
        data.daily.time.forEach((date, index) => {
          const code = data.daily?.weather_code[index];
          if (typeof code === 'number') {
            next[date] = code;
          }
        });
        setWeatherByDate(next);
      } catch {
        // ignore
      }
    };

    void loadWeather();
    return () => {
      isActive = false;
    };
  }, [month, year]);

  const monthLabel = currentMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-2">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Calendar</span>
          <h1 className="text-3xl font-semibold">Team calendar</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Track schedules and milestones with a clean monthly view, similar to the personal to-do calendar.
          </p>
        </header>

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
            {weekDays.map((day) => (
              <div key={day} className="text-center text-xs font-semibold uppercase text-slate-500">
                {day}
              </div>
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
              const dayEvents = dateKey ? eventsByDay[dateKey] ?? [] : [];
              const weatherIcon = dateKey ? resolveCalendarWeatherIcon(weatherByDate[dateKey]) : null;

              return (
                <div
                  key={day ? `day-${day}` : `empty-${index}`}
                  className={`min-h-24 rounded-lg border p-2 ${
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
                        <span className={`text-sm font-semibold ${isToday ? 'text-emerald-700' : 'text-slate-900'}`}>
                          {day}
                        </span>
                        <div className="flex items-center gap-2">
                          {weatherIcon && <span className="text-base" aria-hidden="true">{weatherIcon}</span>}
                          {dayEvents.length > 0 && (
                            <span className="rounded-full bg-emerald-100 px-2 text-xs font-semibold text-emerald-700">
                              {dayEvents.length}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 space-y-1">
                        {dayEvents.slice(0, 2).map((event) => (
                          <div
                            key={event.id}
                            className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600"
                          >
                            <p className="font-semibold text-slate-800">{event.title}</p>
                            <p>
                              {event.time ?? 'All day'} · {event.tag}
                            </p>
                          </div>
                        ))}
                        {dayEvents.length > 2 && (
                          <p className="text-[11px] text-slate-400">+{dayEvents.length - 2} more</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Upcoming events</h3>
            <span className="text-sm text-slate-500">{events.length} scheduled</span>
          </div>
          <div className="mt-4 space-y-3">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {event.time ? ` · ${event.time}` : ''}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {event.tag}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
