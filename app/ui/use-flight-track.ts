'use client';

import { useEffect, useState } from 'react';

import { SILENT_BANNER_HEADER } from '@/app/ui/banner';
import type { FlightSchedule, FlightTrack } from '@/lib/flight-status';

/** Lookups are paid, and FR24 has nothing to say much before a flight. */
const TRACK_LEAD_MS = 6 * 60 * 60_000;
/** An arrival with no duration: assume it may have left this long before. */
const ARRIVAL_ONLY_LEAD_MS = 20 * 60 * 60_000;
const POLL_AIRBORNE_MS = 3 * 60_000;
const POLL_WAITING_MS = 5 * 60_000;

/** Whether the flight is close enough for a lookup to be worth paying for. */
export function isTrackable(now: number | null, schedule: FlightSchedule): boolean {
  const anchor = schedule.departure ?? schedule.arrival;
  const lead = schedule.departure ? TRACK_LEAD_MS : ARRIVAL_ONLY_LEAD_MS;
  return now !== null && anchor !== null && now >= new Date(anchor).getTime() - lead;
}

/**
 * What FlightRadar24 has seen of this flight (take-off, landing, live ETA),
 * via `/api/flight-radar/status`. Polls while there's still something to
 * learn and stops once it has landed. Shared by the trip's flight cards and
 * the Ops Dashboard.
 */
export function useFlightTrack(flightNumber: string | null, schedule: FlightSchedule, enabled: boolean) {
  // Tagged with what it answers, so a stale result never shows against new times.
  const key = `${flightNumber}|${schedule.departure}|${schedule.arrival}`;
  const [result, setResult] = useState<{ key: string; track: FlightTrack | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!enabled || !flightNumber) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const load = async () => {
      const params = new URLSearchParams({ flight: flightNumber });
      if (schedule.departure) params.set('departure', schedule.departure);
      if (schedule.arrival) params.set('arrival', schedule.arrival);
      let track: FlightTrack | null = null;
      let failed = false;
      try {
        const r = await fetch(`/api/flight-radar/status?${params}`, {
          credentials: 'include',
          signal: controller.signal,
          // A background poll shouldn't toast every hiccup.
          headers: { [SILENT_BANNER_HEADER]: '1' },
        });
        if (!r.ok) throw new Error('lookup failed');
        track = ((await r.json()) as { track?: FlightTrack }).track ?? null;
      } catch {
        if (controller.signal.aborted) return;
        failed = true;
      }
      if (cancelled) return;
      setResult({ key, track, failed });
      if (track?.landedAt || track?.ended) return;
      timer = setTimeout(() => void load(), track?.takeoffAt ? POLL_AIRBORNE_MS : POLL_WAITING_MS);
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, flightNumber, key, schedule.departure, schedule.arrival]);

  const answered = result !== null && result.key === key;
  return {
    track: answered ? result.track : null,
    state: !enabled || !flightNumber ? 'idle' : !answered ? 'loading' : result.failed ? 'failed' : 'ok',
  } as const;
}
