'use client';

import { useSyncExternalStore } from 'react';

/**
 * Browser-side state shared by everything that tells you a message arrived:
 * the app-wide listener (`messaging-alerts.tsx`) writes it, and the sidebar,
 * tab title and the messaging console read it. Module-level, so every client
 * component on the page sees the same copy.
 */

export type MessagingService = 'whatsapp' | 'telegram' | 'signal';

export type UnreadByService = Record<MessagingService, number>;

const NO_UNREAD: UnreadByService = { whatsapp: 0, telegram: 0, signal: 0 };

// --- Unread chats per service ----------------------------------------------

let unread: UnreadByService = NO_UNREAD;
const unreadListeners = new Set<() => void>();

export function setUnread(next: UnreadByService): void {
  const same = (Object.keys(NO_UNREAD) as MessagingService[]).every((k) => unread[k] === next[k]);
  if (same) return;
  unread = { ...NO_UNREAD, ...next };
  for (const listener of unreadListeners) listener();
}

function subscribeUnread(listener: () => void) {
  unreadListeners.add(listener);
  return () => unreadListeners.delete(listener);
}

/** Chats with unread messages, per service. Zero until the first load. */
export function useMessagingUnread(): UnreadByService {
  return useSyncExternalStore(subscribeUnread, () => unread, () => NO_UNREAD);
}

// --- The chat on screen ----------------------------------------------------

export interface ViewingChat {
  accountId: number;
  chatId: string;
}

let viewing: ViewingChat | null = null;

/** The console reports the open chat, so a message arriving in it doesn't also pop an alert. */
export function setViewingChat(next: ViewingChat | null): void {
  viewing = next;
}

export function getViewingChat(): ViewingChat | null {
  return viewing;
}

// --- Alert preferences (per browser) ---------------------------------------

export interface AlertSettings {
  /** A short chime when a message arrives. */
  sound: boolean;
  /** System notifications while the ERP is in a background tab. */
  desktop: boolean;
  /** Show who wrote and what; off for screens other people can see. */
  preview: boolean;
}

const DEFAULT_SETTINGS: AlertSettings = { sound: true, desktop: false, preview: true };
const SETTINGS_KEY = 'la-erp.messaging-alerts';

function readSettings(): AlertSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AlertSettings>) };
  } catch {
    // Storage blocked or unreadable: the defaults still work.
    return DEFAULT_SETTINGS;
  }
}

let loadedSettings: AlertSettings | null = null;
const settingsListeners = new Set<() => void>();

function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}

/** Read lazily (and quietly — this doubles as a render-time snapshot). */
export function getAlertSettings(): AlertSettings {
  loadedSettings ??= typeof window === 'undefined' ? DEFAULT_SETTINGS : readSettings();
  return loadedSettings;
}

export function updateAlertSettings(patch: Partial<AlertSettings>): void {
  const next = { ...getAlertSettings(), ...patch };
  loadedSettings = next;
  for (const listener of settingsListeners) listener();
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Kept for this page view only.
  }
}

export function useAlertSettings(): AlertSettings {
  return useSyncExternalStore(subscribeSettings, getAlertSettings, () => DEFAULT_SETTINGS);
}
