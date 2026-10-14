import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startVisibleInterval } from '../lib/visible-interval';

type Listener = () => void;

function installFakeDocument(initial: 'visible' | 'hidden' = 'visible') {
  const listeners = new Set<Listener>();
  const doc = {
    visibilityState: initial as 'visible' | 'hidden',
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  const setVisibility = (state: 'visible' | 'hidden') => {
    doc.visibilityState = state;
    for (const listener of listeners) listener();
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
  return { setVisibility, listeners };
}

describe('startVisibleInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a no-op outside the browser', () => {
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it('polls on the interval while visible and not before', () => {
    installFakeDocument('visible');
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('pauses while hidden and catches up once when visible again', () => {
    const { setVisibility } = installFakeDocument('visible');
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(1);

    // A full interval has elapsed since the last run, so returning runs once
    // immediately and then resumes the cadence.
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(3);

    stop();
  });

  it('does not run on return if the tab was hidden only briefly', () => {
    const { setVisibility } = installFakeDocument('visible');
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    vi.advanceTimersByTime(200);
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(1);

    stop();
  });

  it('does not start a timer when created in a hidden tab', () => {
    const { setVisibility } = installFakeDocument('hidden');
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000);

    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(1);

    stop();
  });

  it('runs immediately when asked and the tab is visible', () => {
    installFakeDocument('visible');
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000, { immediate: true });

    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    stop();
  });

  it('defers the immediate run until a hidden tab becomes visible', () => {
    const { setVisibility } = installFakeDocument('hidden');
    const fn = vi.fn();
    const stop = startVisibleInterval(fn, 1000, { immediate: true });

    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(1);

    stop();
  });

  it('removes its listener on stop', () => {
    const { listeners } = installFakeDocument('visible');
    const stop = startVisibleInterval(() => {}, 1000);
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
