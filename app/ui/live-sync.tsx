'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { sourcesForPath, touches, touchesAccess } from '@/lib/live-sources';

import { changedRecently, subscribeChanges } from './live-store';
import { subscribeServerEvents } from './messaging-alerts-store';

/**
 * Keeps whatever screen is open in step with the server, with no reload.
 *
 * Mounted once in the app shell. When the server announces a change to
 * something this screen shows (lib/live-sources.ts), it asks the router to
 * re-render the page on the server. Client state, scroll position and open
 * forms are untouched; components holding server data in state pick up the new
 * props through `useSyncedState`.
 *
 * - A background tab does nothing until you return to it.
 * - Opening a page the router had cached refreshes it if it changed meanwhile.
 * - A dropped connection is covered by a refresh when the stream reconnects.
 */

/** Folds a burst of events into one refresh. */
const SETTLE_MS = 350;
/** Never more often than this, however busy the server is. */
const MIN_GAP_MS = 1_500;
/** More refreshes than this in the window means something is feeding itself: stand down for a while. */
const BURST_LIMIT = 12;
const BURST_WINDOW_MS = 30_000;

export default function LiveSync() {
  const router = useRouter();
  const pathname = usePathname();

  // The newest values, readable from long-lived listeners without resubscribing.
  const live = useRef({ pathname, router });
  useEffect(() => {
    live.current = { pathname, router };
  });

  const state = useRef({ timer: null as number | null, lastAt: 0, history: [] as number[], whileHidden: false, hiddenAt: 0 });

  useEffect(() => {
    const s = state.current;
    const mountedAt = Date.now();

    const refresh = () => {
      s.timer = null;
      if (document.hidden) {
        s.whileHidden = true;
        return;
      }
      const now = Date.now();
      s.history = s.history.filter((at) => now - at < BURST_WINDOW_MS);
      if (s.history.length >= BURST_LIMIT) return;
      s.history.push(now);
      s.lastAt = now;
      live.current.router.refresh();
    };

    const schedule = () => {
      if (s.timer !== null) return;
      const sinceLast = Date.now() - s.lastAt;
      s.timer = window.setTimeout(refresh, Math.max(SETTLE_MS, MIN_GAP_MS - sinceLast));
    };

    const stopChanges = subscribeChanges((models) => {
      if (touchesAccess(models) || touches(models, sourcesForPath(live.current.pathname))) schedule();
    });

    // `ready` also fires when this tab first opens the stream; only a later one is a reconnect.
    const stopReady = subscribeServerEvents('ready', () => {
      if (Date.now() - mountedAt > 5_000) schedule();
    });

    const onVisibility = () => {
      if (document.hidden) {
        s.hiddenAt = Date.now();
        return;
      }
      // Back from the background: catch up on what was missed, or on a long absence.
      if (s.whileHidden || (s.hiddenAt && Date.now() - s.hiddenAt > 60_000)) {
        s.whileHidden = false;
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopChanges();
      stopReady();
      document.removeEventListener('visibilitychange', onVisibility);
      if (s.timer !== null) window.clearTimeout(s.timer);
      s.timer = null;
    };
  }, []);

  // A page opened from the router's cache may predate a change made since.
  useEffect(() => {
    if (!changedRecently(sourcesForPath(pathname))) return;
    const id = window.setTimeout(() => live.current.router.refresh(), SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return null;
}
