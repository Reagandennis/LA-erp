'use client';

import { useEffect, useRef } from 'react';

import { touches } from '@/lib/live-sources';
import { startVisibleInterval } from '@/lib/visible-interval';

import { changedRecently, subscribeChanges } from './live-store';
import { subscribeServerEvents } from './messaging-alerts-store';

/**
 * For a component that fetches its own data: calls `refresh` shortly after the
 * server announces a change to any of `sources` (model name prefixes, as in
 * lib/live-sources.ts), so a change made by someone else, or in another tab,
 * shows up at once. Events arriving together are folded into one refresh.
 *
 * Pages that simply render what the server gave them need none of this: the
 * app shell (`live-sync.tsx`) already re-renders them.
 *
 * Safety nets for a stream that dropped: a refresh when it reconnects, and a
 * slow poll that runs only while the tab is visible and catches up when you
 * return to it. Pass `fallbackMs = 0` to go without the poll.
 */
export function useLiveRefresh(sources: readonly string[], refresh: () => void, fallbackMs = 60_000): void {
  // The newest `refresh` without resubscribing each render.
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });

  const key = sources.join('|');
  useEffect(() => {
    const watched = key.split('|').filter(Boolean);
    const mountedAt = Date.now();
    let pending: number | null = null;
    let missedWhileHidden = false;

    const soon = () => {
      if (document.hidden) {
        missedWhileHidden = true;
        return;
      }
      if (pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        latest.current();
      }, 400);
    };

    const stopChanges = subscribeChanges((models) => {
      if (touches(models, watched)) soon();
    });
    // `ready` also fires when this page opens the stream; only a later one is a reconnect.
    const stopReady = subscribeServerEvents('ready', () => {
      if (Date.now() - mountedAt > 5_000) soon();
    });
    const onVisibility = () => {
      if (!document.hidden && missedWhileHidden) {
        missedWhileHidden = false;
        soon();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const stopPolling = fallbackMs > 0 ? startVisibleInterval(() => latest.current(), fallbackMs) : () => {};

    // Mounted from a page the router had cached: it may predate a recent change.
    if (changedRecently(watched)) soon();

    return () => {
      stopChanges();
      stopReady();
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
      if (pending !== null) window.clearTimeout(pending);
    };
  }, [key, fallbackMs]);
}
