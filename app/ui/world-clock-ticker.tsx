'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MAX_WORLD_CLOCKS,
  WORLD_CLOCK_REGIONS,
  WORLD_CLOCK_ZONES,
  type WorldClockZone,
} from '@/lib/world-clocks';

import { useNow } from './use-client';

/**
 * The bar is static and shows as many clocks as *its own* width fits (a
 * container query, so the sidebar's width is accounted for). A clock chip is
 * about 15.5rem and the button area about 7.5rem, so chip `n` (0-based)
 * appears once the bar is wider than roughly 15.5·(n+1) + 11rem. Hidden
 * clocks are a tap away in the picker, and a "+N" chip says how many.
 *
 * Class strings are literal so Tailwind can see them.
 */
const CHIP_VISIBILITY = [
  'flex',
  'hidden @min-[42rem]:flex',
  'hidden @min-[58rem]:flex',
  'hidden @min-[74rem]:flex',
  'hidden @min-[90rem]:flex',
  'hidden @min-[105rem]:flex',
  'hidden @min-[121rem]:flex',
  'hidden @min-[137rem]:flex',
] as const;

/** "+N" chips: one per tier, each visible only inside its own width band. */
const MORE_TIERS = [
  { show: 1, cls: 'flex @min-[42rem]:hidden' },
  { show: 2, cls: 'hidden @min-[42rem]:flex @min-[58rem]:hidden' },
  { show: 3, cls: 'hidden @min-[58rem]:flex @min-[74rem]:hidden' },
  { show: 4, cls: 'hidden @min-[74rem]:flex @min-[90rem]:hidden' },
  { show: 5, cls: 'hidden @min-[90rem]:flex @min-[105rem]:hidden' },
  { show: 6, cls: 'hidden @min-[105rem]:flex @min-[121rem]:hidden' },
  { show: 7, cls: 'hidden @min-[121rem]:flex @min-[137rem]:hidden' },
  { show: 8, cls: 'hidden @min-[137rem]:flex' },
] as const;

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
  const nowMs = useNow(1000);
  const [zones, setZones] = useState(initialZones);
  const [draft, setDraft] = useState(() => initialZones.map((zone) => zone.tz));
  const [isPicking, setIsPicking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement | null>(null);

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

  if (nowMs === null) {
    return <div className="ticker-bar bg-primary" />;
  }
  const now = new Date(nowMs);

  const chips = zones.slice(0, CHIP_VISIBILITY.length).map((zone, index) => (
    <span
      key={zone.tz}
      className={`${CHIP_VISIBILITY[index]} items-baseline gap-2 shrink-0 px-3 @min-[42rem]:px-4 ${index > 0 ? 'border-l border-white/15' : ''}`}
    >
      <span className="text-sm font-bold tracking-wide opacity-85">{zone.city}</span>
      <span className="text-lg tabular-nums font-bold leading-none">{fmt(now, zone.tz)}</span>
      <span className="hidden @min-[42rem]:inline text-[11px] font-semibold opacity-60">{fmtDay(now, zone.tz)}</span>
    </span>
  ));

  const hiddenCounts = MORE_TIERS.map((tier) =>
    zones.length > tier.show ? (
      <button
        key={tier.show}
        type="button"
        onClick={openPicker}
        className={`${tier.cls} items-center shrink-0 ml-2 px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-[11px] font-bold hover:bg-white/25 transition-colors`}
        aria-label={`${zones.length - tier.show} more clocks`}
      >
        +{zones.length - tier.show}
      </button>
    ) : null,
  );

  return (
    <div className="ticker-bar world-clock-bar @container bg-primary text-white font-mono select-none">
      <div className="flex h-full items-center">
        <div className="flex-1 h-full flex items-center overflow-hidden whitespace-nowrap">
          {chips}
          {hiddenCounts}
        </div>

        <div className="shrink-0 h-full flex items-center pl-3 pr-3 @min-[42rem]:pl-4 @min-[42rem]:pr-4">
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
            <span className="hidden @min-[42rem]:inline">CLOCKS</span>
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
