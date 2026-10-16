'use client';

import Link from 'next/link';
import { type ReactNode, useSyncExternalStore } from 'react';

import {
  CalendarIcon,
  ChatHistoryIcon,
  ClipboardCheckIcon,
  CloseIcon,
  DocumentIcon,
  type IconComponent,
  InboxIcon,
  TruckIcon,
} from './icons';

export type ToastSource = 'todo' | 'quote' | 'invoice' | 'trip' | 'message' | 'file' | 'calendar';

const SOURCE_META: Record<
  ToastSource,
  { Icon: IconComponent; label: string; accent: string }
> = {
  todo: { Icon: ClipboardCheckIcon, label: 'Task', accent: 'bg-primary/10 text-primary' },
  quote: { Icon: DocumentIcon, label: 'Quote', accent: 'bg-amber-100 text-amber-600' },
  invoice: { Icon: DocumentIcon, label: 'Invoice', accent: 'bg-blue-100 text-blue-600' },
  trip: { Icon: TruckIcon, label: 'Trip', accent: 'bg-teal-100 text-teal-600' },
  message: {
    Icon: ChatHistoryIcon,
    label: 'Message',
    accent: 'bg-indigo-100 text-indigo-600',
  },
  file: { Icon: InboxIcon, label: 'File', accent: 'bg-emerald-100 text-emerald-600' },
  calendar: { Icon: CalendarIcon, label: 'Calendar', accent: 'bg-rose-100 text-rose-600' },
};

/** Short relative time — "just now", "4m", "2h", "3d". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function Toast({
  source,
  title,
  message,
  timestamp,
  href,
  actionLabel = 'View',
  onAction,
  onDismiss,
}: Readonly<{
  source: ToastSource;
  title: string;
  message: string;
  timestamp?: string;
  href?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}>) {
  const meta = SOURCE_META[source] ?? SOURCE_META.todo;
  const Icon = meta.Icon;

  return (
    <div className="pointer-events-auto w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
      <div className="flex items-start gap-3 p-3.5">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.accent}`}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-sm font-bold text-gray-900">{title}</p>
            {timestamp && (
              <span className="shrink-0 text-[10px] font-bold text-gray-400">
                {relativeTime(timestamp)}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
            {message}
          </p>

          {href && (
            <Link
              href={href}
              onClick={onAction}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
            >
              {actionLabel}
              <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="shrink-0 rounded-lg p-1 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Fixed stack for incoming notification toasts. Sits top-right under the top bar,
 * clear of the banner stack in the bottom-right so action feedback and incoming
 * alerts never overlap.
 */
export function ToastStack({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-6 top-16 z-[250] flex w-[min(22rem,calc(100vw-3rem))] flex-col gap-2"
    >
      {children}
    </div>
  );
}

// --- Toasts raised from outside the bell ------------------------------------

export interface PushedToast {
  /** Same key replaces the toast (and restarts its timer) instead of stacking. */
  key: string;
  source: ToastSource;
  title: string;
  message: string;
  timestamp?: string;
  href?: string;
  actionLabel?: string;
}

/** Long enough to read a message and click through to it. */
const PUSHED_TOAST_MS = 8000;
const MAX_PUSHED_TOASTS = 3;

let pushed: PushedToast[] = [];
const pushedListeners = new Set<() => void>();
const pushedTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setPushed(next: PushedToast[]) {
  pushed = next;
  for (const listener of pushedListeners) listener();
}

/**
 * Show a toast in the same stack as the bell's, so alerts from different
 * sources never overlap on screen. Rendered by NotificationsBell.
 */
export function pushToast(toast: PushedToast): void {
  clearTimeout(pushedTimers.get(toast.key));
  setPushed([...pushed.filter((t) => t.key !== toast.key), toast].slice(-MAX_PUSHED_TOASTS));
  pushedTimers.set(
    toast.key,
    setTimeout(() => dismissPushedToast(toast.key), PUSHED_TOAST_MS),
  );
}

export function dismissPushedToast(key: string): void {
  clearTimeout(pushedTimers.get(key));
  pushedTimers.delete(key);
  if (pushed.some((t) => t.key === key)) setPushed(pushed.filter((t) => t.key !== key));
}

const NO_TOASTS: PushedToast[] = [];

function subscribePushed(listener: () => void) {
  pushedListeners.add(listener);
  return () => pushedListeners.delete(listener);
}

export function usePushedToasts(): PushedToast[] {
  return useSyncExternalStore(subscribePushed, () => pushed, () => NO_TOASTS);
}
