'use client';

import { useEffect, useMemo, useState } from 'react';

type PunchType = 'clock-in' | 'clock-out' | 'break-start' | 'break-end';

type PunchEntry = {
  id: string;
  type: PunchType;
  timestamp: string;
  note?: string;
};

type ShiftStatus = 'out' | 'in' | 'break';

const STORAGE_KEY = 'clock-in-out-entries';

const formatTime = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export default function ClockInOutPage() {
  const [now, setNow] = useState(() => new Date());
  const [entries, setEntries] = useState<PunchEntry[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return;
      }
      const parsed = JSON.parse(stored) as PunchEntry[];
      if (Array.isArray(parsed)) {
        setEntries(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (globalThis.window === undefined) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // ignore
    }
  }, [entries]);

  const status = useMemo<ShiftStatus>(() => {
    if (entries.length === 0) {
      return 'out';
    }
    const last = entries[0];
    if (last.type === 'clock-in') return 'in';
    if (last.type === 'break-start') return 'break';
    return 'out';
  }, [entries]);

  const addEntry = (type: PunchType) => {
    const newEntry: PunchEntry = {
      id: `${Date.now()}-${type}`,
      type,
      timestamp: new Date().toISOString(),
      note: note.trim() || undefined,
    };
    setEntries((current) => [newEntry, ...current]);
    setNote('');
  };

  const todaySummary = useMemo(() => {
    const today = new Date();
    const todaysEntries = entries
      .map((entry) => ({ ...entry, date: new Date(entry.timestamp) }))
      .filter((entry) => isSameDay(entry.date, today))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    let workSeconds = 0;
    let breakSeconds = 0;
    let lastWorkStart: Date | null = null;
    let lastBreakStart: Date | null = null;

    for (const entry of todaysEntries) {
      if (entry.type === 'clock-in') {
        lastWorkStart = entry.date;
      }
      if (entry.type === 'clock-out' && lastWorkStart) {
        workSeconds += Math.max(0, (entry.date.getTime() - lastWorkStart.getTime()) / 1000);
        lastWorkStart = null;
      }
      if (entry.type === 'break-start') {
        lastBreakStart = entry.date;
      }
      if (entry.type === 'break-end' && lastBreakStart) {
        breakSeconds += Math.max(0, (entry.date.getTime() - lastBreakStart.getTime()) / 1000);
        lastBreakStart = null;
      }
    }

    if (lastWorkStart) {
      workSeconds += Math.max(0, (now.getTime() - lastWorkStart.getTime()) / 1000);
    }
    if (lastBreakStart) {
      breakSeconds += Math.max(0, (now.getTime() - lastBreakStart.getTime()) / 1000);
    }

    const lastPunch = todaysEntries.at(-1);

    return {
      workSeconds,
      breakSeconds,
      lastPunch,
      totalPunches: todaysEntries.length,
    };
  }, [entries, now]);

  const statusLabel =
    status === 'in' ? 'Clocked in' : status === 'break' ? 'On break' : 'Clocked out';

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="space-y-2">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Time tracking</span>
          <h1 className="text-3xl font-semibold text-gray-900">Clock-in / Clock-out</h1>
          <p className="max-w-2xl text-base text-gray-600">
            Capture attendance, shift start/finish, and break times. Your punches are saved locally for quick access.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-emerald-700">Current time</p>
                <h2 className="text-3xl font-semibold text-gray-900">{formatTime(now)}</h2>
                <p className="text-sm text-gray-500">{formatDate(now)}</p>
              </div>
              <div className="rounded-2xl bg-white px-5 py-4 shadow">
                <p className="text-xs uppercase tracking-widest text-gray-400">Status</p>
                <p className="text-lg font-semibold text-gray-900">{statusLabel}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => addEntry(status === 'out' ? 'clock-in' : 'clock-out')}
                className={`rounded-2xl px-5 py-4 text-left text-sm font-semibold transition-all duration-200 ease-out ${
                  status === 'out'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
                }`}
              >
                {status === 'out' ? 'Clock in' : 'Clock out'}
                <p className="mt-1 text-xs font-normal text-white/80">
                  {status === 'out' ? 'Start your shift' : 'End your shift'}
                </p>
              </button>
              <button
                type="button"
                onClick={() => addEntry(status === 'break' ? 'break-end' : 'break-start')}
                disabled={status === 'out'}
                className={`rounded-2xl px-5 py-4 text-left text-sm font-semibold transition-all duration-200 ease-out ${
                  status === 'out'
                    ? 'bg-gray-200 text-gray-400'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}
              >
                {status === 'break' ? 'End break' : 'Start break'}
                <p className="mt-1 text-xs font-normal text-white/80">Track your pause time</p>
              </button>
            </div>

            <div className="mt-6">
              <label className="text-xs font-semibold text-gray-600" htmlFor="punch-note">
                Optional note
              </label>
              <input
                id="punch-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a short note for this punch"
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-widest text-gray-400">Hours today</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {formatDuration(todaySummary.workSeconds)}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-widest text-gray-400">Break time</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">
                {formatDuration(todaySummary.breakSeconds)}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-widest text-gray-400">Punches today</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{todaySummary.totalPunches}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Punch history</h3>
              <p className="text-sm text-gray-500">Most recent punches appear first.</p>
            </div>
            {todaySummary.lastPunch && (
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-gray-400">Last punch</p>
                <p className="text-sm font-semibold text-gray-900">
                  {todaySummary.lastPunch.type.replace('-', ' ')}
                </p>
              </div>
            )}
          </div>
          <div className="mt-6 divide-y divide-gray-100">
            {entries.length === 0 ? (
              <p className="py-6 text-sm text-gray-500">No punches yet.</p>
            ) : (
              entries.map((entry) => {
                const entryDate = new Date(entry.timestamp);
                return (
                  <div key={entry.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {entry.type.replace('-', ' ')}
                      </p>
                      <p className="text-xs text-gray-500">{formatDate(entryDate)}</p>
                      {entry.note && <p className="text-xs text-gray-400">{entry.note}</p>}
                    </div>
                    <p className="text-sm font-semibold text-gray-700">{formatTime(entryDate)}</p>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
