'use client';

import Link from 'next/link';
import { type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useRef, useState } from 'react';

import { APP_LOCALE } from '@/lib/locale';

import { PANEL_HEIGHT_STEP, type PanelCols, type PanelSize, SPAN_CLASS, clampCols, clampHeight, dragColumns } from './ops-model';

// ---------------------------------------------------------------- formatting

export const clock = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleTimeString(APP_LOCALE, { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

export const shortDate = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleDateString(APP_LOCALE, { timeZone, weekday: 'short', day: 'numeric', month: 'short' });

export const money = (value: number, currency: string) =>
  new Intl.NumberFormat(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

export const relativeDays = (days: number) =>
  days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`;

/** "now", "5m", "3h", then the date: how long ago a message came in. */
export function ago(iso: string, now: number | null): string {
  if (now === null) return '';
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return new Date(iso).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------- requests

/**
 * A change made from the board. The app's banner reports the outcome (and the
 * server's error) for every mutation, so callers only need to know if it worked.
 */
export async function send(url: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the look

/*
 * White cards on the app's grey page, like the rest of the ERP. Each card is a
 * title with a muted summary beside it ("11 open"), rows on hairline dividers,
 * and one tinted pill per row saying how it stands. Every panel draws from the
 * few colours below so the board reads as one thing.
 */

/** For references, registrations, flight numbers and tracker names. */
export const mono = 'font-mono';

export type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'danger';

/** Text in a tone's colour: a count worth noticing in a summary line. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-gray-500',
  info: 'text-sky-600',
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  danger: 'text-rose-600',
};

/** A solid block of the tone: dots and bar segments. */
export const TONE_SOLID: Record<Tone, string> = {
  neutral: 'bg-gray-300',
  info: 'bg-sky-500',
  good: 'bg-emerald-500',
  warn: 'bg-amber-400',
  danger: 'bg-rose-500',
};

const PILL: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  info: 'bg-sky-100 text-sky-700',
  good: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
};

export function Pill({ tone = 'neutral', title, children }: Readonly<{ tone?: Tone; title?: string; children: ReactNode }>) {
  return (
    <span title={title} className={`inline-flex max-w-full shrink-0 items-center rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums ${PILL[tone]}`}>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** One line of a list: a divider the width of the card between rows, none after the last. */
export const rowClass = 'flex items-center gap-3 border-b border-gray-100 py-2.5 last:border-b-0';

/** Secondary text under a row's label. */
export const subClass = 'block truncate text-xs text-gray-500';

export const fieldClass =
  'w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/15';

export const primaryButton = 'rounded-lg bg-primary px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-50';

/** A form that opens inside a panel, above its list. */
export const formClass = 'my-3 rounded-xl border border-gray-200 bg-gray-50 p-3';

// ---------------------------------------------------------------- building blocks

export interface Segment {
  label: string;
  value: number;
  tone: Tone;
}

/**
 * How a total splits, as a bar in the pill colours, with the tally under it
 * unless the caller lists the counts itself. Nothing at all when every
 * segment is empty.
 */
export function StackedBar({ segments, legend = true, className = '' }: Readonly<{ segments: Segment[]; legend?: boolean; className?: string }>) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return null;
  const filled = segments.filter((s) => s.value > 0);
  return (
    <div className={className}>
      <div
        className="flex h-2.5 gap-px overflow-hidden rounded-full bg-gray-100"
        role="img"
        aria-label={filled.map((s) => `${s.value} ${s.label}`).join(', ')}
      >
        {filled.map((s) => (
          <span key={s.label} className={`${TONE_SOLID[s.tone]} transition-[width] duration-300`} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
      </div>
      {legend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${TONE_SOLID[s.tone]}`} aria-hidden="true" />
              <span className={`font-semibold tabular-nums ${s.value > 0 && (s.tone === 'danger' || s.tone === 'warn') ? TONE_TEXT[s.tone] : 'text-gray-900'}`}>
                {s.value}
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A row of filters in a panel's header, one pressed. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: Readonly<{
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number; alert?: boolean }[];
  label: string;
}>) {
  return (
    <div className="flex shrink-0 rounded-lg bg-gray-100 p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
            value === o.value ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-primary'
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className={`ml-1 tabular-nums ${o.alert ? 'text-rose-600' : 'text-gray-400'}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

const ExpandIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M9 7h8v8" />
  </svg>
);

/** What the board decides about each panel: folded away, reloading, and the size its viewer gave it. */
export interface PanelFrame {
  collapsed: boolean;
  loading: boolean;
  onToggleCollapse: () => void;
  size: PanelSize;
  /** Null puts the panel back to its default size. */
  onResize: (size: PanelSize | null) => void;
}

/**
 * The corner grip. Dragging sets the height freely and the width in whole grid
 * columns; on the keyboard, the arrows do the same a step at a time. A double
 * click (or Delete) returns the panel to its default size.
 */
function ResizeHandle({
  cols,
  height,
  sectionRef,
  bodyRef,
  onDrag,
  onDone,
}: Readonly<{
  cols: PanelCols;
  height: number | undefined;
  sectionRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
  onDrag: (size: PanelSize) => void;
  onDone: (size: PanelSize | null) => void;
}>) {
  const begin = (e: PointerEvent<HTMLButtonElement>) => {
    const section = sectionRef.current;
    const body = bodyRef.current;
    const grid = section?.parentElement;
    if (!section || !body || !grid || e.button !== 0) return;
    e.preventDefault();
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns.split(' ').filter(Boolean);
    const gap = parseFloat(style.columnGap) || 0;
    const start = { x: e.clientX, y: e.clientY, width: section.offsetWidth, height: body.offsetHeight };
    let latest: PanelSize = { cols, height };

    const move = (ev: globalThis.PointerEvent) => {
      latest = {
        cols: dragColumns({
          cols,
          columns: tracks.length,
          startWidth: start.width,
          dx: ev.clientX - start.x,
          track: parseFloat(tracks[0] ?? '') || start.width,
          gap,
        }),
        height: clampHeight(start.height + ev.clientY - start.y),
      };
      onDrag(latest);
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      onDone(latest);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  };

  const keys = (e: KeyboardEvent<HTMLButtonElement>) => {
    const current = height ?? bodyRef.current?.offsetHeight ?? 0;
    const step: Record<string, PanelSize | null> = {
      ArrowUp: { cols, height: clampHeight(current - PANEL_HEIGHT_STEP) },
      ArrowDown: { cols, height: clampHeight(current + PANEL_HEIGHT_STEP) },
      ArrowLeft: { cols: clampCols(cols - 1), height },
      ArrowRight: { cols: clampCols(cols + 1), height },
      Delete: null,
      Backspace: null,
    };
    if (!(e.key in step)) return;
    e.preventDefault();
    onDone(step[e.key]!);
  };

  return (
    <button
      type="button"
      onPointerDown={begin}
      onKeyDown={keys}
      onDoubleClick={() => onDone(null)}
      aria-label="Resize panel. Arrow keys change its size; Delete resets it."
      title="Drag to resize · double-click to reset"
      className="absolute bottom-0.5 right-0.5 z-10 flex h-5 w-5 cursor-nwse-resize touch-none items-end justify-end rounded-br-2xl p-1 text-gray-300 opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover/panel:opacity-100"
    >
      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" d="M11 4L4 11M11 8L8 11" />
      </svg>
    </button>
  );
}

/**
 * One card of the board: its title, a muted summary on the right ("11 open"),
 * and its rows. The arrow in the corner opens the module it summarises;
 * `actions` holds the panel's own controls beside it. Clicking the title folds
 * the panel; its bottom corner resizes it.
 */
export function Panel({
  id,
  title,
  summary,
  href,
  moduleName,
  actions,
  frame,
  defaultCols = 1,
  children,
}: Readonly<{
  id: string;
  title: string;
  /** What the panel holds, in a few words beside the title. */
  summary?: ReactNode;
  href: string;
  moduleName: string;
  actions?: ReactNode;
  frame: PanelFrame;
  /** Columns it spans on wide screens until its viewer resizes it. */
  defaultCols?: PanelCols;
  children: ReactNode;
}>) {
  const { collapsed, loading, onToggleCollapse } = frame;
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Shown live while dragging; saved when the drag ends.
  const [dragging, setDragging] = useState<PanelSize | null>(null);
  const size = dragging ?? frame.size;
  const cols = size.cols ?? defaultCols;

  return (
    <section
      ref={sectionRef}
      id={id}
      className={`group/panel relative flex min-w-0 scroll-mt-16 flex-col rounded-2xl border bg-white shadow-sm ${SPAN_CLASS[cols]} ${
        dragging ? 'border-primary/40 ring-2 ring-primary/15' : 'border-gray-200'
      }`}
    >
      <header className={`flex items-center justify-between gap-3 px-5 py-4 ${collapsed ? '' : 'border-b border-gray-100'}`}>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? 'Show this panel' : 'Fold this panel away'}
          className="group flex shrink-0 items-center gap-2 text-left"
        >
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          {loading && (
            <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-primary" aria-label="Refreshing" />
          )}
          <svg
            className={`h-3.5 w-3.5 shrink-0 text-gray-300 transition-[opacity,transform] ${
              collapsed ? '-rotate-90' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className="flex min-w-0 items-center gap-2">
          {summary !== undefined && <p className="truncate text-sm text-gray-500">{summary}</p>}
          {!collapsed && actions}
          <Link
            href={href}
            title={`Open ${moduleName}`}
            aria-label={`Open ${moduleName}`}
            className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-50 hover:text-primary"
          >
            <ExpandIcon />
          </Link>
        </div>
      </header>
      {!collapsed && (
        <>
          <div
            ref={bodyRef}
            // A resized panel holds its height; content that needs to fill it (a chat, the map) reads data-sized.
            data-sized={size.height !== undefined ? '' : undefined}
            style={size.height !== undefined ? { height: size.height } : undefined}
            className={`flex-1 overflow-y-auto px-5 pb-3 ${size.height !== undefined ? '' : 'max-h-[32rem]'}`}
          >
            {children}
          </div>
          <ResizeHandle
            cols={cols}
            height={size.height}
            sectionRef={sectionRef}
            bodyRef={bodyRef}
            onDrag={setDragging}
            onDone={(next) => {
              setDragging(null);
              frame.onResize(next);
            }}
          />
        </>
      )}
    </section>
  );
}

export function Empty({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="py-8 text-center text-sm text-gray-400">{children}</p>;
}

export function HeaderButton({
  onClick,
  active = false,
  children,
}: Readonly<{ onClick: () => void; active?: boolean; children: ReactNode }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors ${
        active ? 'bg-primary text-white' : 'text-primary hover:bg-primary/5'
      }`}
    >
      {children}
    </button>
  );
}

/** A small action on a row: Start, Done, Complete. */
export function RowButton({
  onClick,
  disabled,
  tone = 'neutral',
  children,
}: Readonly<{ onClick: () => void; disabled?: boolean; tone?: 'neutral' | 'good'; children: ReactNode }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors disabled:opacity-50 ${
        tone === 'good'
          ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
          : 'border-gray-200 text-gray-600 hover:border-primary/30 hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}

export function Check({
  checked,
  disabled,
  onChange,
  label,
}: Readonly<{ checked: boolean; disabled?: boolean; onChange: () => void; label: string }>) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onChange}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'border-gray-700 text-gray-800' : 'border-gray-400 hover:border-primary'
      }`}
    >
      {checked && (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}
