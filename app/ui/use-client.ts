'use client';

import { useCallback, useSyncExternalStore } from 'react';

const subscribeToNothing = () => () => {};

/**
 * `false` while rendering on the server and during hydration, `true` on every
 * client render after that. Lets a component read browser-only state
 * (localStorage, navigator) without a hydration mismatch and without a
 * mount effect that immediately re-renders.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/**
 * The current time, rounded down to `stepMs`, re-rendering once per step.
 * `null` on the server so the first client render matches the server HTML.
 */
export function useNow(stepMs = 1000): number | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const id = window.setInterval(onChange, stepMs);
      return () => window.clearInterval(id);
    },
    [stepMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / stepMs) * stepMs,
    () => null,
  );
}
