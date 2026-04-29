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

type LeaveRequest = {
  id: string;
  type: 'Annual' | 'Sick' | 'Compassionate' | 'Unpaid' | 'Study';
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  submittedAt: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'clock-in-out-entries';
const LEAVE_STORAGE_KEY = 'clock-in-out-leaves';

const PUBLIC_HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-01', name: 'Labour Day' },
  { date: '2026-06-01', name: 'Madaraka Day' },
  { date: '2026-10-10', name: 'Huduma Day' },
  { date: '2026-10-20', name: 'Mashujaa Day' },
  { date: '2026-12-12', name: 'Jamhuri Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2026-12-26', name: 'Boxing Day' },
];

const WEEKLY_SCHEDULE: { day: string; start: string; end: string; breakDuration: string }[] = [
  { day: 'Monday',    start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Tuesday',  start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Wednesday',start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Thursday', start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Friday',   start: '08:00', end: '17:00', breakDuration: '1h' },
  { day: 'Saturday', start: '—',     end: '—',     breakDuration: '—' },
  { day: 'Sunday',   start: '—',     end: '—',     breakDuration: '—' },
];

const LEAVE_ALLOWANCES: Record<string, number> = {
  Annual: 21, Sick: 14, Compassionate: 5, Unpaid: 30, Study: 7,
};

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

const daysBetween = (start: string, end: string) => {
  const s = new Date(start);
  const e = new Date(end);
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
};

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

function calcUsedLeave(leaveRequests: LeaveRequest[], type: LeaveRequest['type']) {
  return leaveRequests
    .filter(r => r.type === type && r.status === 'Approved')
    .reduce((s, r) => s + daysBetween(r.startDate, r.endDate), 0);
}

export default function ClockInOutPage() {
  const [now, setNow] = useState(() => new Date());
  const [entries, setEntries] = useState<PunchEntry[]>(() => readLocalStorage<PunchEntry>(STORAGE_KEY));
  const [note, setNote] = useState('');
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(() => readLocalStorage<LeaveRequest>(LEAVE_STORAGE_KEY));
  const [activeTab, setActiveTab] = useState<'punch' | 'schedule' | 'leave' | 'holidays'>('punch');
  const [leaveForm, setLeaveForm] = useState({
    type: 'Annual' as LeaveRequest['type'],
    startDate: '',
    endDate: '',
    reason: '',
  });
  const [leaveFormOpen, setLeaveFormOpen] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { writeLocalStorage(STORAGE_KEY, entries); }, [entries]);
  useEffect(() => { writeLocalStorage(LEAVE_STORAGE_KEY, leaveRequests); }, [leaveRequests]);

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

  const todaySummary = useMemo(() => calcTodaySummary(entries, now), [entries, now]);

  const weeklySummary = useMemo(() => calcWeeklySummary(entries, now), [entries, now]);

  const weeklyTotalSec = weeklySummary.reduce((s, d) => s + d.workSec, 0);

  const submitLeave = () => {
    if (!leaveForm.startDate || !leaveForm.endDate || !leaveForm.reason.trim()) return;
    const req: LeaveRequest = {
      id: `leave-${Date.now()}`,
      type: leaveForm.type,
      startDate: leaveForm.startDate,
      endDate: leaveForm.endDate,
      reason: leaveForm.reason.trim(),
      status: 'Pending',
      submittedAt: new Date().toISOString(),
    };
    setLeaveRequests(cur => [req, ...cur]);
    setLeaveForm({ type: 'Annual', startDate: '', endDate: '', reason: '' });
    setLeaveFormOpen(false);
  };

  const usedLeave = (type: LeaveRequest['type']) => calcUsedLeave(leaveRequests, type);

  const todayKey = toDateKey(now);
  const limitKey = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60));
  const upcomingHolidays = PUBLIC_HOLIDAYS.filter(h => h.date >= todayKey && h.date <= limitKey);

  const upcomingLeave = leaveRequests
    .filter(r => r.endDate >= todayKey && r.status !== 'Rejected')
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, 3);

  const statusLabel = status === 'in' ? 'Clocked in' : status === 'break' ? 'On break' : 'Clocked out';
  const statusColor = status === 'in' ? 'text-emerald-700' : status === 'break' ? 'text-amber-600' : 'text-gray-500';

  const tabs = [
    { id: 'punch',    label: 'Time Clock' },
    { id: 'schedule', label: 'Work Schedule' },
    { id: 'leave',    label: 'Leave' },
    { id: 'holidays', label: 'Holidays' },
  ] as const;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-8">

        <header className="space-y-1">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Attendance</span>
          <h1 className="text-3xl font-semibold text-gray-900">Clock-in / Clock-out</h1>
          <p className="max-w-2xl text-sm text-gray-500">
            Track your shifts, manage leave requests, and view your work schedule and public holidays.
          </p>
        </header>

        {/* Quick KPI bar */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Hours today"     value={formatDuration(todaySummary.workSec)}  sub="active shift"   accent={status === 'in'} />
          <StatCard label="Break today"     value={formatDuration(todaySummary.breakSec)} sub="paused time" />
          <StatCard label="Hours this week" value={formatDuration(weeklyTotalSec)}         sub="last 7 days" />
          <StatCard label="Status"          value={statusLabel}                            sub={formatTime(now)} accent={status === 'in'} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-2xl border border-gray-200 bg-white p-1 shadow-sm w-fit flex-wrap">
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

        {activeTab === 'punch' && (
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
                      const todayName = now.toLocaleDateString('en-US', { weekday: 'long' });
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

        {/* ── TAB: Leave ── */}
        {activeTab === 'leave' && (
          <div className="space-y-6">
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {(Object.keys(LEAVE_ALLOWANCES) as LeaveRequest['type'][]).map(type => {
                const allowed = LEAVE_ALLOWANCES[type];
                const used = usedLeave(type);
                const remaining = Math.max(0, allowed - used);
                const pct = (used / allowed) * 100;
                return (
                  <div key={type} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{type}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">{remaining}<span className="text-sm font-normal text-gray-400">/{allowed}d</span></p>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-1.5 rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] text-gray-400">{used} used</p>
                  </div>
                );
              })}
            </section>

            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Leave Requests</h3>
              <button
                type="button"
                onClick={() => setLeaveFormOpen(v => !v)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                {leaveFormOpen ? 'Cancel' : '+ Request Leave'}
              </button>
            </div>

            {leaveFormOpen && (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm space-y-4">
                <h4 className="font-semibold text-emerald-800">New Leave Request</h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="leave-type" className="text-xs font-semibold text-gray-600">Leave Type</label>
                    <select
                      id="leave-type"
                      value={leaveForm.type}
                      onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value as LeaveRequest['type'] }))}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      {(Object.keys(LEAVE_ALLOWANCES) as LeaveRequest['type'][]).map(t => (
                        <option key={t} value={t}>{t} Leave ({Math.max(0, LEAVE_ALLOWANCES[t] - usedLeave(t))}d remaining)</option>
                      ))}
                    </select>
                  </div>
                  <div />
                  <div>
                    <label htmlFor="leave-start" className="text-xs font-semibold text-gray-600">Start Date</label>
                    <input id="leave-start" type="date" value={leaveForm.startDate} onChange={e => setLeaveForm(f => ({ ...f, startDate: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                  <div>
                    <label htmlFor="leave-end" className="text-xs font-semibold text-gray-600">End Date</label>
                    <input id="leave-end" type="date" value={leaveForm.endDate} onChange={e => setLeaveForm(f => ({ ...f, endDate: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="leave-reason" className="text-xs font-semibold text-gray-600">Reason</label>
                    <textarea id="leave-reason" value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder="Brief reason for leave…" rows={2}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none" />
                  </div>
                </div>
                {leaveForm.startDate && leaveForm.endDate && (
                  <p className="text-xs text-emerald-700 font-medium">Duration: {daysBetween(leaveForm.startDate, leaveForm.endDate)} day(s)</p>
                )}
                <button type="button" onClick={submitLeave}
                  disabled={!leaveForm.startDate || !leaveForm.endDate || !leaveForm.reason.trim()}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  Submit Request
                </button>
              </section>
            )}

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              {leaveRequests.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No leave requests yet.</p>
              ) : (
                <div className="space-y-3">
                  {leaveRequests.map(req => {
                    const statusColors: Record<LeaveRequest['status'], string> = {
                      Pending: 'bg-amber-100 text-amber-700', Approved: 'bg-emerald-100 text-emerald-700', Rejected: 'bg-red-100 text-red-700',
                    };
                    const typeColors: Record<LeaveRequest['type'], string> = {
                      Annual: 'bg-blue-100 text-blue-700', Sick: 'bg-rose-100 text-rose-700',
                      Compassionate: 'bg-purple-100 text-purple-700', Unpaid: 'bg-gray-100 text-gray-600', Study: 'bg-cyan-100 text-cyan-700',
                    };
                    return (
                      <div key={req.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-100 bg-slate-50 px-4 py-3">
                        <div className="flex items-start gap-3">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold mt-0.5 ${typeColors[req.type]}`}>{req.type}</span>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {new Date(req.startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {' — '}
                              {new Date(req.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              <span className="ml-2 text-xs font-normal text-gray-400">({daysBetween(req.startDate, req.endDate)}d)</span>
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">{req.reason}</p>
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold shrink-0 ${statusColors[req.status]}`}>{req.status}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {upcomingLeave.length > 0 && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <h4 className="text-sm font-bold text-amber-800 mb-3">⏳ Upcoming Leave</h4>
                <div className="space-y-2">
                  {upcomingLeave.map(req => (
                    <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-gray-800">{req.type} Leave</span>
                      <span className="text-gray-600">
                        {new Date(req.startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' – '}
                        {new Date(req.endDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${req.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{req.status}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── TAB: Holidays ── */}
        {activeTab === 'holidays' && (
          <div className="space-y-6">
            {upcomingHolidays.length > 0 && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm flex items-center gap-4">
                <span className="text-3xl">🎉</span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-blue-500">Next public holiday</p>
                  <p className="text-lg font-bold text-gray-900 mt-0.5">{upcomingHolidays[0].name}</p>
                  <p className="text-sm text-gray-500">
                    {new Date(upcomingHolidays[0].date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    {' · '}
                    {Math.ceil((new Date(upcomingHolidays[0].date + 'T12:00:00').getTime() - now.getTime()) / 86_400_000)} days away
                  </p>
                </div>
              </div>
            )}

            <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-gray-900">Kenya Public Holidays 2026</h3>
                <span className="text-xs text-gray-400">{PUBLIC_HOLIDAYS.length} holidays</span>
              </div>
              <div className="space-y-3">
                {PUBLIC_HOLIDAYS.map(h => {
                  const hDate = new Date(h.date + 'T12:00:00');
                  const isPast = h.date < todayKey;
                  const isToday2 = h.date === todayKey;
                  return (
                    <div key={h.date} className={`flex items-center justify-between rounded-xl px-4 py-3 ${
                      isToday2 ? 'bg-emerald-50 border border-emerald-200' : isPast ? 'bg-gray-50 border border-gray-100 opacity-50' : 'bg-slate-50 border border-slate-100'
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{isToday2 ? '🎯' : isPast ? '✓' : '📅'}</span>
                        <div>
                          <p className={`text-sm font-semibold ${isPast ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{h.name}</p>
                          <p className="text-xs text-gray-500">{hDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                        </div>
                      </div>
                      {!isPast && !isToday2 && (
                        <span className="text-xs font-semibold text-gray-400">
                          {Math.ceil((hDate.getTime() - now.getTime()) / 86_400_000)}d away
                        </span>
                      )}
                      {isToday2 && <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">Today!</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

      </div>
    </div>
  );
}
