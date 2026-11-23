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

/** Past this, a flight that hasn't been seen landing is no longer polled (it is still looked up once). */
const POLL_AFTER_LANDING_MS = 12 * 60 * 60_000;
const ASSUMED_FLIGHT_MS = 18 * 60 * 60_000;

function pollUntil(schedule: FlightSchedule): number {
  const landing = schedule.arrival
    ? new Date(schedule.arrival).getTime()
    : schedule.departure
      ? new Date(schedule.departure).getTime() + ASSUMED_FLIGHT_MS
      : 0;
  return landing + POLL_AFTER_LANDING_MS;
}

/**
 * What FlightRadar24 has seen of this flight (take-off, landing, live ETA),
 * via `/api/flight-radar/status`. Polls while there's still something to
 * learn and stops once it has landed. Shared by the trip's flight cards and
 * the Ops Dashboard.
 */
export function useFlightTrack(
  flightNumber: string | null,
  schedule: FlightSchedule,
  enabled: boolean,
  /** The itinerary's airports, so the right leg of a multi-leg number is tracked. */
  route: { from?: string | null; to?: string | null } = {},
) {
  const from = route.from?.trim().toUpperCase() || '';
  const to = route.to?.trim().toUpperCase() || '';
  // Tagged with what it answers, so a stale result never shows against new times.
  const key = `${flightNumber}|${schedule.departure}|${schedule.arrival}|${from}|${to}`;
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
      if (from) params.set('from', from);
      if (to) params.set('to', to);
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
      // Long past and still unseen: asking again won't change the answer, and every ask is paid.
      if (Date.now() > pollUntil({ departure: schedule.departure, arrival: schedule.arrival })) return;
      timer = setTimeout(() => void load(), track?.takeoffAt || track?.seenAt ? POLL_AIRBORNE_MS : POLL_WAITING_MS);
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, flightNumber, key, schedule.departure, schedule.arrival, from, to]);

  const answered = result !== null && result.key === key;
  return {
    track: answered ? result.track : null,
    state: !enabled || !flightNumber ? 'idle' : !answered ? 'loading' : result.failed ? 'failed' : 'ok',
  } as const;
}
