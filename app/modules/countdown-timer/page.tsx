'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/* ─── Types ──────────────────────────────────────────────────────────────── */

type TimerStatus = 'running' | 'paused' | 'done';
type TimerColor  = 'emerald' | 'blue' | 'violet' | 'rose' | 'amber' | 'cyan';

type CountdownTimer = {
  id: string;
  name: string;
  totalSeconds: number;
  remainingSeconds: number;
  status: TimerStatus;
  createdAt: string;
  muted: boolean;
  color: TimerColor;
};

/* ─── Constants ──────────────────────────────────────────────────────────── */

const STORAGE_KEY   = 'la-erp:countdown-timers';
const TIMER_COLORS: TimerColor[] = ['emerald', 'blue', 'violet', 'rose', 'amber', 'cyan'];
const COLOR_MAP: Record<TimerColor, { ring: string; badge: string; bg: string }> = {
  emerald: { ring: '#10b981', badge: 'bg-emerald-100 text-emerald-700', bg: 'from-emerald-50 via-white to-white' },
  blue:    { ring: '#3b82f6', badge: 'bg-blue-100 text-blue-700',       bg: 'from-blue-50 via-white to-white'    },
  violet:  { ring: '#8b5cf6', badge: 'bg-violet-100 text-violet-700',   bg: 'from-violet-50 via-white to-white'  },
  rose:    { ring: '#f43f5e', badge: 'bg-rose-100 text-rose-700',       bg: 'from-rose-50 via-white to-white'    },
  amber:   { ring: '#f59e0b', badge: 'bg-amber-100 text-amber-700',     bg: 'from-amber-50 via-white to-white'   },
  cyan:    { ring: '#06b6d4', badge: 'bg-cyan-100 text-cyan-700',       bg: 'from-cyan-50 via-white to-white'    },
};
const PRESETS = [
  { label: '1 min',  s: 60   },
  { label: '5 min',  s: 300  },
  { label: '15 min', s: 900  },
  { label: '30 min', s: 1800 },
  { label: '1 hr',   s: 3600 },
  { label: '2 hr',   s: 7200 },
];

/* ─── localStorage helpers ───────────────────────────────────────────────── */

function readStorage(): CountdownTimer[] {
  if (globalThis.window === undefined) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CountdownTimer[]) : [];
  } catch { return []; }
}
function writeStorage(timers: CountdownTimer[]) {
  if (globalThis.window === undefined) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(timers)); } catch { /* quota */ }
}

/* ─── Pure helpers ───────────────────────────────────────────────────────── */

const formatSeconds = (value: number) => {
  const total = Math.max(0, value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const toSeconds = (h: number, m: number, s: number) => Math.max(0, h * 3600 + m * 60 + s);

const tickTimers = (current: CountdownTimer[]): CountdownTimer[] =>
  current.map(t => {
    if (t.status !== 'running') return t;
    const next = t.remainingSeconds - 1;
    return next <= 0
      ? { ...t, remainingSeconds: 0, status: 'done' as TimerStatus }
      : { ...t, remainingSeconds: next };
  });

let colorCursor = 0;
const nextColor = (): TimerColor => {
  const c = TIMER_COLORS[colorCursor % TIMER_COLORS.length];
  colorCursor++;
  return c;
};

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function StatCard({ label, value, sub }: Readonly<{ label: string; value: number; sub?: string }>) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const RING_R    = 52;
const RING_CIRC = 2 * Math.PI * RING_R;

function ProgressRing({ pct, color, done }: Readonly<{ pct: number; color: TimerColor; done: boolean }>) {
  const offset = RING_CIRC * (1 - Math.min(1, Math.max(0, pct)));
  const stroke = done ? '#f43f5e' : COLOR_MAP[color].ring;
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" className="-rotate-90">
      <circle cx="64" cy="64" r={RING_R} fill="none" stroke="#e2e8f0" strokeWidth="10" />
      <circle
        cx="64" cy="64" r={RING_R} fill="none"
        stroke={stroke} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={RING_CIRC} strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
      />
    </svg>
  );
}

type TimerCardActionsProps = Readonly<{
  status: TimerStatus;
  muted: boolean;
  ringColor: string;
  onToggle: () => void;
  onReset: () => void;
  onRemove: () => void;
  onMute: () => void;
}>;

function TimerCardActions({ status, muted, ringColor, onToggle, onReset, onRemove, onMute }: TimerCardActionsProps) {
  const isDone    = status === 'done';
  const isRunning = status === 'running';
  const toggleBg  = isDone ? '#f43f5e' : isRunning ? '#1e293b' : ringColor;
  const toggleLabel = isRunning ? 'Pause' : isDone ? 'Restart' : 'Start';
  const muteCls = muted
    ? 'border-slate-200 bg-white text-slate-300'
    : 'border-slate-200 bg-white text-slate-600 hover:text-amber-600';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onToggle}
        className="flex-1 rounded-xl py-2 text-xs font-semibold text-white transition-all"
        style={{ backgroundColor: toggleBg }}>
        {toggleLabel}
      </button>
      <button type="button" onClick={onReset}
        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-amber-300 hover:text-amber-600">
        Reset
      </button>
      <button type="button" onClick={onMute} title={muted ? 'Unmute' : 'Mute alert'}
        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${muteCls}`}>
        {muted ? 'Muted' : 'Alert on'}
      </button>
      <button type="button" onClick={onRemove}
        className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-50">
        Remove
      </button>
    </div>
  );
}

type TimerCardProps = Readonly<{
  timer: CountdownTimer;
  onToggle: () => void;
  onReset: () => void;
  onRemove: () => void;
  onMute: () => void;
}>;

function TimerCard({ timer, onToggle, onReset, onRemove, onMute }: TimerCardProps) {
  const pct       = timer.totalSeconds > 0 ? timer.remainingSeconds / timer.totalSeconds : 0;
  const c         = COLOR_MAP[timer.color];
  const isDone    = timer.status === 'done';
  const isRunning = timer.status === 'running';

  const statusBadge = isDone ? 'bg-rose-100 text-rose-600' : isRunning ? c.badge : 'bg-slate-100 text-slate-500';
  const statusLabel = isDone ? 'Completed' : isRunning ? 'Running' : 'Paused';
  const cardBorder  = isDone ? 'ring-2 ring-rose-300 border-rose-200' : 'border-slate-200';
  const timeColor   = isDone ? 'text-rose-500' : 'text-slate-900';

  return (
    <div className={`flex flex-col gap-4 rounded-3xl border bg-linear-to-br ${c.bg} p-5 shadow-md transition-shadow ${cardBorder}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{timer.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{new Date(timer.createdAt).toLocaleString()}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge}`}>{statusLabel}</span>
      </div>

      <div className="flex flex-col items-center gap-1 py-1">
        <div className="relative flex items-center justify-center">
          <ProgressRing pct={pct} color={timer.color} done={isDone} />
          <div className="absolute flex flex-col items-center">
            <span className={`text-xl font-bold tabular-nums ${timeColor}`}>
              {formatSeconds(timer.remainingSeconds)}
            </span>
            <span className="mt-0.5 text-[10px] text-slate-400">of {formatSeconds(timer.totalSeconds)}</span>
          </div>
        </div>
        {isDone && <p className="animate-pulse text-xs font-semibold text-rose-500">Time&apos;s up!</p>}
      </div>

      <TimerCardActions
        status={timer.status} muted={timer.muted} ringColor={c.ring}
        onToggle={onToggle} onReset={onReset} onRemove={onRemove} onMute={onMute}
      />
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function CountdownTimerPage() {
  const [name, setName] = useState('');
  const [hours, setHours] = useState(0);
  const [mins, setMins] = useState(15);
  const [secs, setSecs] = useState(0);
  const [timers, setTimers] = useState<CountdownTimer[]>(() => readStorage());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { writeStorage(timers); }, [timers]);

  useEffect(() => {
    const id = setInterval(() => setTimers(tickTimers), 1000);
    return () => clearInterval(id);
  }, []);

  const hasUnmutedAlert = useMemo(() => timers.some(t => t.status === 'done' && !t.muted), [timers]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (hasUnmutedAlert) { audio.play().catch(() => { /* autoplay policy */ }); }
    else { audio.pause(); audio.currentTime = 0; }
  }, [hasUnmutedAlert]);

  const runningCount = useMemo(() => timers.filter(t => t.status === 'running').length, [timers]);
  const doneCount    = useMemo(() => timers.filter(t => t.status === 'done').length,    [timers]);

  const addTimer = (overrideSecs?: number) => {
    const total = overrideSecs ?? toSeconds(hours, mins, secs);
    if (total <= 0) return;
    const timer: CountdownTimer = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: name.trim() || `Timer ${timers.length + 1}`,
      totalSeconds: total,
      remainingSeconds: total,
      status: 'paused',
      createdAt: new Date().toISOString(),
      muted: false,
      color: nextColor(),
    };
    setTimers(cur => [timer, ...cur]);
    setName('');
  };

  const toggleTimer = (id: string) =>
    setTimers(cur => cur.map(t =>
      t.id === id ? { ...t, status: t.status === 'running' ? 'paused' : t.status === 'done' ? 'paused' : 'running' } : t,
    ));

  const resetTimer  = (id: string) =>
    setTimers(cur => cur.map(t => t.id === id ? { ...t, remainingSeconds: t.totalSeconds, status: 'paused' } : t));

  const removeTimer = (id: string) => setTimers(cur => cur.filter(t => t.id !== id));
  const muteTimer   = (id: string) => setTimers(cur => cur.map(t => t.id === id ? { ...t, muted: !t.muted } : t));

  const applyPreset = (s: number) => {
    setHours(Math.floor(s / 3600));
    setMins(Math.floor((s % 3600) / 60));
    setSecs(s % 60);
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <audio ref={audioRef} loop preload="auto">
        <track kind="captions" />
        <source src="https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg" type="audio/ogg" />
      </audio>

      <div className="mx-auto max-w-6xl space-y-8">

        {doneCount > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-rose-900">
                {doneCount} timer{doneCount > 1 ? 's' : ''} completed.
              </p>
              <button type="button"
                onClick={() => setTimers(cur => cur.map(t => t.status === 'done' ? { ...t, muted: true } : t))}
                className="rounded-lg bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200">
                Mute all alerts
              </button>
            </div>
          </div>
        )}

        <header className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Countdown</span>
          <h1 className="text-3xl font-semibold">Countdown timers</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Track deadlines, timed workflows, and critical operational windows.
            Run multiple timers side-by-side with animated progress rings and sound alerts.
          </p>
        </header>

        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total"     value={timers.length} sub="across all states" />
          <StatCard label="Running"   value={runningCount}  sub="currently active"  />
          <StatCard label="Completed" value={doneCount}     sub="awaiting review"   />
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">New timer</h2>
          <p className="mb-5 text-sm text-slate-500">Choose a preset or set a custom duration.</p>

          <div className="mb-5 flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.label} type="button" onClick={() => applyPreset(p.s)}
                className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-emerald-400 hover:text-emerald-700">
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500" htmlFor="timer-name">Name</label>
              <input id="timer-name" value={name} onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTimer()} placeholder="Daily stand-up"
                className="w-52 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500" htmlFor="timer-hours">Hours</label>
              <input id="timer-hours" type="number" min={0} value={hours}
                onChange={e => setHours(Math.max(0, Number(e.target.value)))}
                className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500" htmlFor="timer-minutes">Minutes</label>
              <input id="timer-minutes" type="number" min={0} max={59} value={mins}
                onChange={e => setMins(Math.max(0, Number(e.target.value)))}
                className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-500" htmlFor="timer-seconds">Seconds</label>
              <input id="timer-seconds" type="number" min={0} max={59} value={secs}
                onChange={e => setSecs(Math.max(0, Number(e.target.value)))}
                className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <button type="button" onClick={() => addTimer()}
              className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700">
              Add timer
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Active timers</h2>
              <p className="text-sm text-slate-500">{runningCount} running &middot; {timers.length} total</p>
            </div>
            {timers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button"
                  onClick={() => setTimers(cur => cur.map(t => t.status === 'done' ? t : { ...t, status: 'running' as TimerStatus }))}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                  Start all
                </button>
                <button type="button"
                  onClick={() => setTimers(cur => cur.map(t => t.status === 'running' ? { ...t, status: 'paused' as TimerStatus } : t))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-amber-300 hover:text-amber-600">
                  Pause all
                </button>
                <button type="button" onClick={() => setTimers([])}
                  className="rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-500 hover:bg-rose-50">
                  Clear all
                </button>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {timers.length === 0 ? (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-14 text-center text-sm text-slate-400">
                No timers yet. Create one above or pick a preset.
              </div>
            ) : (
              timers.map(t => (
                <TimerCard key={t.id} timer={t}
                  onToggle={() => toggleTimer(t.id)} onReset={() => resetTimer(t.id)}
                  onRemove={() => removeTimer(t.id)} onMute={() => muteTimer(t.id)} />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}


