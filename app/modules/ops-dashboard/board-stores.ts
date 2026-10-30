'use client';

import { useSyncExternalStore } from 'react';

import { OPS_PANELS, type OpsPanelKey, isOpsPanel } from '@/lib/ops-panels';

import { type PanelSize, clampCols, clampHeight } from './ops-model';

/**
 * Browser-side state the board shares between its parts: each viewer's layout
 * (kept in this browser only), and which flights the tracker found delayed.
 */

// --- Layout (per browser) ------------------------------------------------------

export interface OpsLayout {
  /** Every panel, in the order shown. */
  order: OpsPanelKey[];
  hidden: OpsPanelKey[];
  collapsed: OpsPanelKey[];
  /** Panels resized from their defaults. */
  sizes: Partial<Record<OpsPanelKey, PanelSize>>;
  /** '' for every country. */
  country: string;
}

// Bumped when the board's cards change, so every browser starts from the new default order.
const LAYOUT_KEY = 'ops-dashboard:layout:2';

export const DEFAULT_LAYOUT: OpsLayout = { order: [...OPS_PANELS], hidden: [], collapsed: [], sizes: {}, country: '' };

const layoutListeners = new Set<() => void>();
let layoutCache: { raw: string | null; layout: OpsLayout } = { raw: null, layout: DEFAULT_LAYOUT };
// When storage is blocked (private windows), the layout lasts for the visit.
let memoryLayout: OpsLayout | null = null;

/** Only sizes that make sense survive: a span of 1–3 columns, a height within the limits. */
function parseSizes(value: unknown): OpsLayout['sizes'] {
  if (!value || typeof value !== 'object') return {};
  const sizes: OpsLayout['sizes'] = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isOpsPanel(key) || !raw || typeof raw !== 'object') continue;
    const { cols, height } = raw as Record<string, unknown>;
    const size: PanelSize = {};
    if (typeof cols === 'number' && Number.isFinite(cols)) size.cols = clampCols(cols);
    if (typeof height === 'number' && Number.isFinite(height)) size.height = clampHeight(height);
    if (size.cols !== undefined || size.height !== undefined) sizes[key] = size;
  }
  return sizes;
}

export function parseLayout(raw: string | null): OpsLayout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof OpsLayout, unknown>>;
    const panels = (list: unknown) => (Array.isArray(list) ? list.filter(isOpsPanel) : []);
    const order = [...new Set(panels(value.order))];
    return {
      // Panels added since it was saved go at the end.
      order: [...order, ...OPS_PANELS.filter((key) => !order.includes(key))],
      hidden: panels(value.hidden),
      collapsed: panels(value.collapsed),
      sizes: parseSizes(value.sizes),
      country: typeof value.country === 'string' ? value.country : '',
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function layoutSnapshot(): OpsLayout {
  if (memoryLayout) return memoryLayout;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(LAYOUT_KEY);
  } catch {
    return DEFAULT_LAYOUT;
  }
  if (raw !== layoutCache.raw) layoutCache = { raw, layout: parseLayout(raw) };
  return layoutCache.layout;
}

export function updateLayout(change: (layout: OpsLayout) => OpsLayout): void {
  const next = change(layoutSnapshot());
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
  } catch {
    memoryLayout = next;
  }
  for (const listener of layoutListeners) listener();
}

function subscribeLayout(listener: () => void) {
  layoutListeners.add(listener);
  return () => layoutListeners.delete(listener);
}

/** The default on the server and while hydrating, then this browser's. */
export function useOpsLayout(): OpsLayout {
  return useSyncExternalStore(subscribeLayout, layoutSnapshot, () => DEFAULT_LAYOUT);
}

// --- Delayed flights -------------------------------------------------------------

export type FlightDelay = { id: number; label: string };

const NO_DELAYS: FlightDelay[] = [];
const delays = new Map<number, string>();
let delaySnapshot: FlightDelay[] = NO_DELAYS;
const delayListeners = new Set<() => void>();

/** A flight row says whether its live status is a delay (null once it isn't, or it's gone). */
export function reportFlightDelay(id: number, label: string | null): void {
  if ((delays.get(id) ?? null) === label) return;
  if (label) delays.set(id, label);
  else delays.delete(id);
  delaySnapshot = [...delays].map(([flightId, text]) => ({ id: flightId, label: text }));
  for (const listener of delayListeners) listener();
}

function subscribeDelays(listener: () => void) {
  delayListeners.add(listener);
  return () => delayListeners.delete(listener);
}

export function useFlightDelays(): FlightDelay[] {
  return useSyncExternalStore(subscribeDelays, () => delaySnapshot, () => NO_DELAYS);
}

// --- Fullscreen (wall display) ---------------------------------------------------

function subscribeFullscreen(listener: () => void) {
  document.addEventListener('fullscreenchange', listener);
  return () => document.removeEventListener('fullscreenchange', listener);
}

export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null, () => false);
}
