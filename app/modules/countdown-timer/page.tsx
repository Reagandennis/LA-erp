'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useEffect, useMemo, useState } from 'react';

type TimerStatus = 'running' | 'paused' | 'done';

type CountdownTimer = {
  id: string;
  name: string;
  totalSeconds: number;
  remainingSeconds: number;
  status: TimerStatus;
  createdAt: string;
};

const formatSeconds = (value: number) => {
  const total = Math.max(0, value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const toSeconds = (hours: number, minutes: number, seconds: number) =>
  Math.max(0, hours * 3600 + minutes * 60 + seconds);

const tickTimers = (current: CountdownTimer[]): CountdownTimer[] =>
  current.map((timer) => {
    if (timer.status !== 'running') {
      return timer;
    }
    const nextRemaining = timer.remainingSeconds - 1;
    if (nextRemaining <= 0) {
      return {
        ...timer,
        remainingSeconds: 0,
        status: 'done' as TimerStatus,
      };
    }
    return {
      ...timer,
      remainingSeconds: nextRemaining,
    };
  });

export default function CountdownTimerPage() {
  const [name, setName] = useState('');
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(15);
  const [seconds, setSeconds] = useState(0);
  const [timers, setTimers] = useState<CountdownTimer[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimers(tickTimers);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const addTimer = () => {
    const total = toSeconds(hours, minutes, seconds);
    if (total <= 0) {
      return;
    }
    const newTimer: CountdownTimer = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: name.trim() || `Timer ${timers.length + 1}`,
      totalSeconds: total,
      remainingSeconds: total,
      status: 'paused',
      createdAt: new Date().toISOString(),
    };
    setTimers((current) => [newTimer, ...current]);
    setName('');
  };

  const toggleTimer = (id: string) => {
    setTimers((current) =>
      current.map((timer) =>
        timer.id === id
          ? {
              ...timer,
              status: timer.status === 'running' ? 'paused' : timer.status === 'done' ? 'paused' : 'running',
            }
          : timer,
      ),
    );
  };

  const resetTimer = (id: string) => {
    setTimers((current) =>
      current.map((timer) =>
        timer.id === id
          ? {
              ...timer,
              remainingSeconds: timer.totalSeconds,
              status: 'paused',
            }
          : timer,
      ),
    );
  };

  const removeTimer = (id: string) => {
    setTimers((current) => current.filter((timer) => timer.id !== id));
  };

  const runningCount = useMemo(
    () => timers.filter((timer) => timer.status === 'running').length,
    [timers],
  );

  const activeAlertIds = useMemo(
    () => timers.filter((timer) => timer.status === 'done').map((timer) => timer.id),
    [timers],
  );

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8">
        {activeAlertIds.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>
                Timer completed: {activeAlertIds.length} alert{activeAlertIds.length > 1 ? 's' : ''} active.
              </p>
              <span className="text-xs text-amber-800">Restart or remove timers to stop alerts.</span>
            </div>
            <audio autoPlay loop>
              <track kind="captions" />
              <source src="https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg" type="audio/ogg" />
            </audio>
          </div>
        )}
        <header className="space-y-2">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Countdown</span>
          <h1 className="text-3xl font-semibold">Countdown timers</h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Track deadlines, timed workflows, and critical operational windows. Start multiple timers and keep them
            running side-by-side.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Create a timer</h2>
              <p className="text-sm text-slate-500">Set a duration and name.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-semibold text-slate-500">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Daily stand-up"
                  className="mt-1 w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Hours
                <input
                  type="number"
                  min={0}
                  value={hours}
                  onChange={(event) => setHours(Math.max(0, Number(event.target.value)))}
                  className="mt-1 w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Minutes
                <input
                  type="number"
                  min={0}
                  value={minutes}
                  onChange={(event) => setMinutes(Math.max(0, Number(event.target.value)))}
                  className="mt-1 w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Seconds
                <input
                  type="number"
                  min={0}
                  value={seconds}
                  onChange={(event) => setSeconds(Math.max(0, Number(event.target.value)))}
                  className="mt-1 w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <button
                type="button"
                onClick={addTimer}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Add timer
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Active timers</h2>
            <p className="text-sm text-slate-500">Running: {runningCount}</p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {timers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                No timers yet. Create one above to get started.
              </div>
            ) : (
              timers.map((timer) => (
                <div key={timer.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{timer.name}</p>
                      <p className="text-xs text-slate-500">
                        Created {new Date(timer.createdAt).toLocaleString(APP_LOCALE)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        timer.status === 'running'
                          ? 'bg-emerald-100 text-emerald-700'
                          : timer.status === 'done'
                            ? 'bg-rose-100 text-rose-600'
                            : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {timer.status === 'running'
                        ? 'Running'
                        : timer.status === 'done'
                          ? 'Completed'
                          : 'Paused'}
                    </span>
                  </div>
                  {timer.status === 'done' && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-100/60 px-3 py-2 text-xs text-amber-900">
                      Alert active until you restart or remove this timer.
                    </div>
                  )}
                  <p className="mt-4 text-3xl font-semibold text-slate-900">
                    {formatSeconds(timer.remainingSeconds)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleTimer(timer.id)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-300 hover:text-emerald-600"
                    >
                      {timer.status === 'running' ? 'Pause' : timer.status === 'done' ? 'Restart' : 'Start'}
                    </button>
                    <button
                      type="button"
                      onClick={() => resetTimer(timer.id)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-amber-300 hover:text-amber-600"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTimer(timer.id)}
                      className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
