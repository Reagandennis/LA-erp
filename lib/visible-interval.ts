/**
 * Browser-only polling helper for client components.
 *
 * Runs `fn` every `intervalMs` while the tab is visible, stops entirely while
 * the tab is hidden, and catches up once when the tab becomes visible again if
 * at least one full interval has elapsed. Background tabs therefore cost the
 * server nothing, and a returning user sees fresh data straight away.
 *
 * By default it does not call `fn` immediately; pass `{ immediate: true }` to
 * also run once up front. Returns a function that stops the polling and
 * removes the listener.
 */
export interface VisibleIntervalOptions {
  /** Also run `fn` straight away (as soon as the tab is visible) rather than waiting a full interval. */
  immediate?: boolean;
}

export function startVisibleInterval(
  fn: () => void,
  intervalMs: number,
  { immediate = false }: VisibleIntervalOptions = {},
): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return () => {};
  }

  let timer: number | null = null;
  let lastRun = Date.now();
  let runImmediately = immediate;

  const run = () => {
    lastRun = Date.now();
    runImmediately = false;
    fn();
  };
  const start = () => {
    if (timer === null) {
      timer = window.setInterval(run, intervalMs);
    }
  };
  const stop = () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      stop();
      return;
    }
    if (runImmediately || Date.now() - lastRun >= intervalMs) {
      run();
    }
    start();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  if (document.visibilityState !== 'hidden') {
    if (runImmediately) run();
    start();
  }

  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
