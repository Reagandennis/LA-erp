'use client';

import { CHANGED_EVENT, type ChangedPayload, touches } from '@/lib/live-sources';

import { subscribeServerEvents } from './messaging-alerts-store';

/**
 * The browser's view of "what just changed on the server": one subscription to
 * the live stream, shared by the app shell (`live-sync.tsx`) and by any
 * component that refetches for itself (`use-live-refresh.ts`).
 *
 * Also remembers the last half minute of changes. The router keeps a visited
 * page for 30 seconds (next.config.ts `staleTimes`), so a page opened from
 * that cache can ask whether anything it shows changed in the meantime.
 */

const REMEMBER_MS = 35_000;

type Listener = (models: string[]) => void;

const listeners = new Set<Listener>();
let recent: ChangedPayload[] = [];
let unsubscribe: (() => void) | null = null;

function onChanged(event: MessageEvent): void {
  let payload: ChangedPayload;
  try {
    payload = JSON.parse(String(event.data)) as ChangedPayload;
  } catch {
    return;
  }
  if (!Array.isArray(payload.models)) return;
  const now = Date.now();
  recent = [...recent.filter((entry) => now - entry.at < REMEMBER_MS), { models: payload.models, at: now }];
  for (const listener of [...listeners]) listener(payload.models);
}

/** Calls `listener` with the model names of every change the server announces. */
export function subscribeChanges(listener: Listener): () => void {
  listeners.add(listener);
  unsubscribe ??= subscribeServerEvents(CHANGED_EVENT, onChanged);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

/** True when something among `sources` changed in the last half minute. */
export function changedRecently(sources: readonly string[] | null): boolean {
  const now = Date.now();
  return recent.some((entry) => now - entry.at < REMEMBER_MS && touches(entry.models, sources));
}
