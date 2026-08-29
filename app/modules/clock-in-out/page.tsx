
'use client';
import { useEffect, useMemo, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type PunchType = 'clock-in' | 'clock-out' | 'break-start' | 'break-end';

type PunchEntry = {
  id: string;
  type: PunchType;
  timestamp: string;
  note?: string;
};

type ShiftStatus = 'out' | 'in' | 'break';

const STORAGE_KEY = 'clock-in-out-entries';

const WEEKLY_SCHEDULE: { day: string; start: string; end: string; breakDuration: string }[] = [
  { day: 'Monday',    start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Tuesday',  start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Wednesday',start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Thursday', start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Friday',   start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Saturday', start: '—',     end: '—',     breakDuration: '—' },
  { day: 'Sunday',   start: '—',     end: '—',     breakDuration: '—' },
];



// ── Helpers ────────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

const formatTime = (date: Date) =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

const formatDate = (date: Date) =>
  date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const formatShortDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${pad2(m)}m`;
};

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const isSameDay = (a: Date, b: Date) => toDateKey(a) === toDateKey(b);

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = false }: Readonly<{ label: string; value: string; sub?: string; accent?: boolean }>) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${accent ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function calcTodaySummary(entries: PunchEntry[], now: Date) {
  const todaysEntries = entries
    .map(e => ({ ...e, date: new Date(e.timestamp) }))
    .filter(e => isSameDay(e.date, now))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  let workSec = 0, breakSec = 0;
  let lastWork: Date | null = null, lastBreak: Date | null = null;

  for (const e of todaysEntries) {
    if (e.type === 'clock-in') lastWork = e.date;
    if (e.type === 'clock-out' && lastWork) { workSec += (e.date.getTime() - lastWork.getTime()) / 1000; lastWork = null; }
    if (e.type === 'break-start') lastBreak = e.date;
    if (e.type === 'break-end' && lastBreak) { breakSec += (e.date.getTime() - lastBreak.getTime()) / 1000; lastBreak = null; }
  }
  if (lastWork) workSec += (now.getTime() - lastWork.getTime()) / 1000;
  if (lastBreak) breakSec += (now.getTime() - lastBreak.getTime()) / 1000;
  return { workSec, breakSec, totalPunches: todaysEntries.length };
}

function calcWeeklySummary(entries: PunchEntry[], now: Date) {
  const days: { dateKey: string; workSec: number }[] = [];
  const nowKey = toDateKey(now);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    const dayEntries = entries
      .map(e => ({ ...e, date: new Date(e.timestamp) }))
      .filter(e => toDateKey(e.date) === key)
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    let workSec = 0; let lastWork: Date | null = null;
    for (const e of dayEntries) {
      if (e.type === 'clock-in') lastWork = e.date;
      if (e.type === 'clock-out' && lastWork) { workSec += (e.date.getTime() - lastWork.getTime()) / 1000; lastWork = null; }
    }
    if (lastWork && key === nowKey) workSec += (now.getTime() - lastWork.getTime()) / 1000;
    days.push({ dateKey: key, workSec });
  }
  return days;
}

function readLocalStorage<T>(key: string): T[] {
  if (globalThis.window === undefined) return [];
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeLocalStorage(key: string, value: unknown) {
  if (globalThis.window === undefined) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

type PunchTabProps = Readonly<{
  now: Date;
  status: ShiftStatus;
  statusLabel: string;
  statusColor: string;
  todaySummary: { workSec: number; breakSec: number };
  weeklySummary: { dateKey: string; workSec: number }[];
  todayKey: string;
  entries: PunchEntry[];
  note: string;
  onNote: (v: string) => void;
  onPunch: (type: PunchType) => void;
}>;

function PunchTab({ now, status, statusLabel, statusColor, todaySummary, weeklySummary, todayKey, entries, note, onNote, onPunch }: PunchTabProps) {
  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl border border-emerald-100 bg-linear-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Current time</p>
              <h2 className="text-4xl font-bold tabular-nums text-gray-900">{formatTime(now)}</h2>
              <p className="text-sm text-gray-500">{formatDate(now)}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-white px-6 py-4 shadow text-center">
              <p className="text-xs uppercase tracking-widest text-gray-400">Status</p>
              <p className={`text-lg font-bold mt-1 ${statusColor}`}>{statusLabel}</p>
              {status !== 'out' && todaySummary.workSec > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">{formatDuration(todaySummary.workSec)} worked</p>
              )}
            </div>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <button type="button" onClick={() => onPunch(status === 'out' ? 'clock-in' : 'clock-out')}
              className={`rounded-2xl px-5 py-4 text-left text-sm font-semibold transition-all ${
                status === 'out' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}>
              {status === 'out' ? '▶ Clock in' : '■ Clock out'}
              <p className="mt-1 text-xs font-normal text-white/70">{status === 'out' ? 'Start your shift' : 'End your shift'}</p>
            </button>
            <button type="button" onClick={() => onPunch(status === 'break' ? 'break-end' : 'break-start')} disabled={status === 'out'}
              className={`rounded-2xl px-5 py-4 text-left text-sm font-semibold transition-all ${
                status === 'out' ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}>
              {status === 'break' ? '▶ End break' : '⏸ Start break'}
              <p className="mt-1 text-xs font-normal text-white/70">Track your pause time</p>
            </button>
          </div>
          <div className="mt-5">
            <label className="text-xs font-semibold text-gray-500" htmlFor="punch-note">Optional note</label>
            <input id="punch-note" value={note} onChange={e => onNote(e.target.value)} placeholder="Add a short note…"
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Last 7 days</h3>
          <div className="flex items-end gap-2 h-28">
            {weeklySummary.map(day => {
              const hrs = day.workSec / 3600;
              const pct = Math.min(100, (hrs / 9) * 100);
              const isToday2 = day.dateKey === todayKey;
              const d = new Date(day.dateKey + 'T12:00:00');
              return (
                <div key={day.dateKey} className="flex flex-col items-center gap-1 flex-1">
                  <div className="w-full rounded-t-md bg-gray-100 relative" style={{ height: '80px' }}>
                    <div className={`absolute bottom-0 w-full rounded-t-md transition-all duration-500 ${isToday2 ? 'bg-emerald-500' : 'bg-emerald-200'}`}
                      style={{ height: `${pct}%` }} />
                  </div>
                  <span className={`text-[10px] font-semibold ${isToday2 ? 'text-emerald-700' : 'text-gray-400'}`}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">Bar height = proportion of 9h target</p>
        </div>
      </section>
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Punch history</h3>
        <p className="text-sm text-gray-500 mb-5">All punches — most recent first.</p>
        <div className="divide-y divide-gray-100">
          {entries.length === 0 ? (
            <p className="py-6 text-sm text-gray-400 text-center">No punches yet.</p>
          ) : (
            entries.slice(0, 30).map(entry => {
              const d = new Date(entry.timestamp);
              const typeColors: Record<PunchType, string> = {
                'clock-in': 'bg-emerald-100 text-emerald-700', 'clock-out': 'bg-gray-100 text-gray-600',
                'break-start': 'bg-amber-100 text-amber-700', 'break-end': 'bg-blue-100 text-blue-700',
              };
              return (
                <div key={entry.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeColors[entry.type]}`}>{entry.type.replace('-', ' ')}</span>
                    <div>
                      <p className="text-xs text-gray-500">{formatShortDate(d)} · {formatDate(d).split(',')[0]}</p>
                      {entry.note && <p className="text-xs text-gray-400 italic">{entry.note}</p>}
                    </div>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-gray-700">{formatTime(d)}</p>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

function deriveStatus(entries: PunchEntry[]): ShiftStatus {
  if (entries.length === 0) return 'out';
  const last = entries[0];
  if (last.type === 'clock-in') return 'in';
  if (last.type === 'break-start') return 'break';
  return 'out';
}



export default function ClockInOutPage() {
  // Auth state for user role
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(data => {
        if (data?.user) {
          setCurrentUser(data.user);
          }
      });
  }, []);
  // Use null as sentinel so we know we haven't hydrated yet
  const [now, setNow] = useState<Date | null>(null);
  const [entries, setEntries] = useState<PunchEntry[]>([]);
  const [note, setNote] = useState('');
  const [activeTab, setActiveTab] = useState<'punch' | 'schedule'>('punch');

  // Hydrate from localStorage and start the clock only after mount
  // so the first server-rendered HTML and first client render match.
  useEffect(() => {
    setNow(new Date());
    setEntries(readLocalStorage<PunchEntry>(STORAGE_KEY));

    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { writeLocalStorage(STORAGE_KEY, entries); }, [entries]);

  const status = useMemo<ShiftStatus>(() => deriveStatus(entries), [entries]);

  const addEntry = (type: PunchType) => {
    setEntries(cur => [{
      id: `${Date.now()}-${type}`,
      type,
      timestamp: new Date().toISOString(),
      note: note.trim() || undefined,
    }, ...cur]);
    setNote('');
  };

  const todaySummary = useMemo(() => now ? calcTodaySummary(entries, now) : { workSec: 0, breakSec: 0, totalPunches: 0 }, [entries, now]);

  const weeklySummary = useMemo(() => now ? calcWeeklySummary(entries, now) : [], [entries, now]);

  const weeklyTotalSec = weeklySummary.reduce((s, d) => s + d.workSec, 0);

  const todayKey = now ? toDateKey(now) : '';

  const statusLabel = status === 'in' ? 'Clocked in' : status === 'break' ? 'On break' : 'Clocked out';
  const statusColor = status === 'in' ? 'text-emerald-700' : status === 'break' ? 'text-amber-600' : 'text-gray-500';

  // Planning others — the board, leave approvals, shift patterns and holidays —
  // moved to the Shift Planning module. What stays here is the time clock and a
  // read-only look at your own week.
  const tabs = [
    { id: 'punch',    label: 'Time Clock' },
    { id: 'schedule', label: 'My Week' },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-8">

        <header className="space-y-1 print:hidden">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Attendance</span>
          <h1 className="text-3xl font-semibold text-gray-900">Clock-in / Clock-out</h1>
          <p className="max-w-2xl text-sm text-gray-500">
            Track your shifts, manage leave requests, and view your work schedule and public holidays.
          </p>
        </header>

        {/* Quick KPI bar */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 print:hidden">
          <StatCard label="Hours today"     value={now ? formatDuration(todaySummary.workSec)  : '—'} sub="active shift"   accent={status === 'in'} />
          <StatCard label="Break today"     value={now ? formatDuration(todaySummary.breakSec) : '—'} sub="paused time" />
          <StatCard label="Hours this week" value={now ? formatDuration(weeklyTotalSec)         : '—'} sub="last 7 days" />
          <StatCard label="Status"          value={statusLabel}                            sub={now ? formatTime(now) : '—'} accent={status === 'in'} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm w-fit flex-wrap print:hidden">
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab.id ? 'bg-emerald-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'punch' && now && (
          <PunchTab
            now={now} status={status} statusLabel={statusLabel} statusColor={statusColor}
            todaySummary={todaySummary} weeklySummary={weeklySummary} todayKey={todayKey}
            entries={entries} note={note} onNote={setNote} onPunch={addEntry}
          />
        )}

        {/* ── TAB: Work Schedule ── */}
        {activeTab === 'schedule' && (
          <div className="space-y-6">
            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Weekly Work Schedule</h3>
                  <p className="text-sm text-gray-500">Standard office hours — Mon to Fri</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">8h / day · 40h / week</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Day', 'Start', 'End', 'Break', 'Net Hours'].map(h => (
                        <th key={h} className="pb-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {WEEKLY_SCHEDULE.map(row => {
                      const isWorkday = row.start !== '—';
                      const todayName = now?.toLocaleDateString('en-US', { weekday: 'long' }) ?? '';
                      const isToday2 = row.day === todayName;
                      return (
                        <tr key={row.day} className={isToday2 ? 'bg-emerald-50' : ''}>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <span className={`font-semibold ${isToday2 ? 'text-emerald-700' : isWorkday ? 'text-gray-900' : 'text-gray-400'}`}>{row.day}</span>
                              {isToday2 && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Today</span>}
                            </div>
                          </td>
                          <td className={`py-3 pr-4 font-mono ${isWorkday ? 'text-gray-700' : 'text-gray-300'}`}>{row.start}</td>
                          <td className={`py-3 pr-4 font-mono ${isWorkday ? 'text-gray-700' : 'text-gray-300'}`}>{row.end}</td>
                          <td className={`py-3 pr-4 ${isWorkday ? 'text-gray-700' : 'text-gray-300'}`}>{row.breakDuration}</td>
                          <td className={`py-3 font-semibold ${isWorkday ? 'text-emerald-700' : 'text-gray-300'}`}>{isWorkday ? '8h 00m' : 'Off'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">This Week&apos;s Progress</h3>
              <div className="flex items-end gap-3 h-32">
                {weeklySummary.map(day => {
                  const hrs = day.workSec / 3600;
                  const pct = Math.min(100, (hrs / 8) * 100);
                  const isToday2 = day.dateKey === todayKey;
                  const d = new Date(day.dateKey + 'T12:00:00');
                  return (
                    <div key={day.dateKey} className="flex flex-col items-center gap-1.5 flex-1">
                      <span className="text-xs font-bold text-gray-500">{hrs > 0 ? `${hrs.toFixed(1)}h` : ''}</span>
                      <div className="w-full rounded-t-lg bg-gray-100 relative" style={{ height: '80px' }}>
                        <div
                          className={`absolute bottom-0 w-full rounded-t-lg transition-all duration-700 ${
                            pct >= 100 ? 'bg-emerald-500' : pct > 50 ? 'bg-blue-400' : 'bg-gray-300'
                          } ${isToday2 ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}`}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold ${isToday2 ? 'text-emerald-700' : 'text-gray-400'}`}>
                        {d.toLocaleDateString('en-US', { weekday: 'short' })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-500">Week total: <strong className="text-gray-900">{formatDuration(weeklyTotalSec)}</strong></p>
                <p className="text-sm text-gray-500">Target: <strong className="text-gray-900">40h 00m</strong></p>
                <p className={`text-sm font-semibold ${weeklyTotalSec >= 144000 ? 'text-emerald-600' : 'text-orange-500'}`}>
                  {weeklyTotalSec >= 144000 ? '✓ On track' : `${formatDuration(Math.max(0, 144000 - weeklyTotalSec))} remaining`}
                </p>
              </div>
            </section>
          </div>
        )}

        {/* ── TAB: Schedule View ── */}
      </div>
    </div>
  );
}
