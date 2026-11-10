'use client';

import { type Dispatch, type SetStateAction, useState } from 'react';

function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * `useState` for data that came from the server as a prop.
 *
 * Works exactly like `useState(fromServer)`, with one addition: when the page
 * is re-rendered on the server and hands down *different* data (someone else
 * saved, or you did in another tab; see `live-sync.tsx`), the state takes the
 * new value. Plain `useState` would keep showing the first value it was given
 * until the page is reloaded.
 *
 * Use it for what a screen displays: lists, records, counts. Do NOT use it for
 * something the person is typing into, such as a form draft seeded from a
 * record, or a live update would overwrite their unsaved work.
 */
export function useSyncedState<T>(fromServer: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState(fromServer);
  const [seen, setSeen] = useState(fromServer);
  // A fresh render of the page passes a new object even when nothing changed,
  // so compare by content: only a real difference replaces what is on screen.
  if (fromServer !== seen) {
    setSeen(fromServer);
    if (!sameData(fromServer, seen)) setState(fromServer);
  }
  return [state, setState];
}
