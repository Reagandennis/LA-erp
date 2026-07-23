'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MAX_WORLD_CLOCKS,
  WORLD_CLOCK_REGIONS,
  WORLD_CLOCK_ZONES,
  type WorldClockZone,
} from '@/lib/world-clocks';

/** Seconds each clock takes to cross the bar — keeps speed constant as the list grows. */
const SECONDS_PER_ZONE = 4.2;
/** Minimum chips on the track so short line-ups still tile the full width. */
const MIN_TRACK_CHIPS = 10;

function fmt(date: Date, tz: string) {
  return date.toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function fmtDay(date: Date, tz: string) {
  return date.toLocaleDateString('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

export default function WorldClockTicker({
  initialZones,
}: Readonly<{ initialZones: WorldClockZone[] }>) {
  const [now, setNow] = useState<Date | null>(null);
  const [zones, setZones] = useState(initialZones);
  const [draft, setDraft] = useState(() => initialZones.map((zone) => zone.tz));
  const [isPicking, setIsPicking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Close the picker on outside click / Escape.
  useEffect(() => {
    if (!isPicking) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsPicking(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPicking(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isPicking]);

  const draftSet = useMemo(() => new Set(draft), [draft]);

  const openPicker = useCallback(() => {
    setDraft(zones.map((zone) => zone.tz));
    setError('');
    setIsPicking(true);
  }, [zones]);

  const toggle = useCallback((tz: string) => {
    setError('');
    setDraft((current) => {
      if (current.includes(tz)) {
        return current.filter((entry) => entry !== tz);
      }

      if (current.length >= MAX_WORLD_CLOCKS) {
        setError(`That's the maximum of ${MAX_WORLD_CLOCKS} clocks.`);
        return current;
      }

      return [...current, tz];
    });
  }, []);

  const save = useCallback(async () => {
    setIsSaving(true);
    setError('');

    try {
      const response = await fetch('/api/preferences/world-clocks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ zones: draft }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Could not save your clocks');
        return;
      }

      setZones(data.zones);
      setIsPicking(false);
    } catch (caughtError) {
      console.error(caughtError);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [draft]);

  // Repeat the line-up so even two or three clocks fill the bar, then render the
  // sequence twice so the -50% scroll wraps seamlessly.
  const sequence = useMemo(() => {
    if (zones.length === 0) return [];

    const repeats = Math.max(1, Math.ceil(MIN_TRACK_CHIPS / zones.length));
    return Array.from({ length: repeats }, () => zones).flat();
  }, [zones]);

  const duration = Math.max(20, sequence.length * SECONDS_PER_ZONE);

  if (!now) {
    return <div className="ticker-bar bg-primary" />;
  }

  const chips = sequence.map((zone, index) => (
    <span
      key={`${zone.tz}-${index}`}
      className="flex items-baseline gap-2 shrink-0 px-4"
    >
      <span className="text-sm font-bold tracking-wide opacity-85">{zone.city}</span>
      <span className="text-lg tabular-nums font-bold leading-none">
        {fmt(now, zone.tz)}
      </span>
      <span className="text-[11px] font-semibold opacity-60">{fmtDay(now, zone.tz)}</span>
      <span className="mx-2 opacity-30 select-none">·</span>
    </span>
  ));

  return (
    <div className="ticker-bar world-clock-bar bg-primary text-white font-mono select-none">
      <style>{`
        @keyframes world-clock-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .world-clock-track {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          will-change: transform;
          animation: world-clock-scroll ${duration}s linear infinite;
        }
        .world-clock-bar:hover .world-clock-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .world-clock-track { animation: none; }
        }
      `}</style>

      <div className="flex h-full items-center">
        <div className="flex-1 h-full flex items-center overflow-hidden">
          <div className="world-clock-track">
            {chips}
            {/* duplicate for seamless loop */}
            {chips}
          </div>
        </div>

        <div className="shrink-0 h-full flex items-center pl-6 pr-4 bg-gradient-to-r from-transparent via-primary to-primary">
          <button
            type="button"
            onClick={isPicking ? () => setIsPicking(false) : openPicker}
            aria-label="Choose world clocks"
            aria-expanded={isPicking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 transition-colors text-[11px] font-bold tracking-wide"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            CLOCKS
          </button>
        </div>
      </div>

      {isPicking && (
        <div
          ref={panelRef}
          className="absolute right-3 top-full mt-2 w-[min(30rem,calc(100vw-2rem))] bg-white text-gray-800 rounded-3xl shadow-2xl border border-gray-200 overflow-hidden font-sans"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h3 className="font-bold text-primary">World clocks</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {draft.length} of {MAX_WORLD_CLOCKS} selected
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft([])}
              className="text-xs font-bold text-gray-400 hover:text-rose-500 transition-colors"
            >
              Clear all
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto px-5 py-4 space-y-5">
            {WORLD_CLOCK_REGIONS.map((region) => {
              const regionZones = WORLD_CLOCK_ZONES.filter(
                (zone) => zone.region === region,
              );

              if (regionZones.length === 0) {
                return null;
              }

              return (
                <div key={region}>
                  <h4 className="text-[10px] uppercase font-bold tracking-[0.2em] text-gray-400 mb-2">
                    {region}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {regionZones.map((zone) => {
                      const checked = draftSet.has(zone.tz);

                      return (
                        <button
                          key={zone.tz}
                          type="button"
                          onClick={() => toggle(zone.tz)}
                          aria-pressed={checked}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                            checked
                              ? 'bg-primary text-white border-primary'
                              : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-primary/40 hover:text-primary'
                          }`}
                        >
                          {zone.city}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/60">
            {error && <p className="text-rose-500 text-xs mb-3">{error}</p>}
            {draft.length === 0 && (
              <p className="text-gray-500 text-xs mb-3">
                With nothing selected the ticker falls back to the default line-up.
              </p>
            )}
            <button
              type="button"
              onClick={save}
              disabled={isSaving}
              className="w-full py-2.5 bg-primary text-white rounded-2xl font-bold text-sm hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving…' : 'Save clocks'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
