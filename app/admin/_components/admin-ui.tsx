'use client';

import { useEffect, useMemo, useState } from 'react';

import { APP_LOCALE } from '@/lib/locale';

import type { AdminModule } from './admin-types';

/**
 * Small building blocks shared by the admin console's tabs, so every panel
 * has the same cards, badges, drawers and module picker.
 */

export const BRAND = '#03458f';

export const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#03458f]/40 focus:outline-none focus:ring-2 focus:ring-[#03458f]/20 disabled:bg-gray-50 disabled:text-gray-500';

export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#03458f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#03458f]/90 disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

export const dangerButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40';

// --- Formatting ------------------------------------------------------------------

/** "just now", "5 min ago", "3 h ago", "yesterday", "Oct 3" — for activity columns. */
export function relativeTime(value: string | null, now: number): string {
  if (!value) return 'Never';
  const t = new Date(value).getTime();
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
    ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** "Chrome on macOS" from a user-agent string; good enough to recognise a device. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /curl|node|undici/i.test(ua)
              ? 'Script'
              : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Plain-language names for audit actions; unknown ones fall back to the raw code. */
const ACTION_LABELS: Record<string, string> = {
  'auth.login.succeeded': 'Signed in',
  'auth.login.failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'admin.user.created': 'Created a user',
  'admin.user.updated': 'Updated a user',
  'admin.user.deleted': 'Deleted a user',
  'admin.user.password_reset': 'Reset a password',
  'admin.role.created': 'Created a role',
  'admin.role.updated': 'Updated a role',
  'admin.role.deleted': 'Deleted a role',
  'admin.session.revoked': 'Signed out a session',
  'admin.session.revoked_all': 'Signed a user out everywhere',
  'admin.upload_limits.updated': 'Changed upload limits',
  'admin.organization.updated': 'Updated the organization',
  'admin.organization.logo.updated': 'Changed the logo',
  'admin.organization.logo.cleared': 'Removed the logo',
  'admin.email.test': 'Sent a test email',
  'messaging.account.unlinked': 'Unlinked a messaging account',
};

const ACRONYMS: Record<string, string> = { ai: 'AI', pdf: 'PDF', csv: 'CSV', sop: 'SOP', kpi: 'KPI', crm: 'CRM' };

/** "invoice.pdf.downloaded" → "Invoice PDF downloaded" for actions without a hand-written label. */
export function describeAction(action: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const words = action
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.toLowerCase());
  if (words.length === 0) return action;
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** "::ffff:10.0.0.5" → "10.0.0.5"; loopback reads as this computer. */
export function formatIp(ip: string | null): string {
  if (!ip) return 'Unknown IP';
  const plain = ip.replace(/^::ffff:/i, '');
  return plain === '::1' || plain === '127.0.0.1' ? 'This computer (localhost)' : plain;
}

// --- Generated passwords ---------------------------------------------------------

/**
 * A password that passes the app's rules (8+ characters, a letter and a digit),
 * from the browser's CSPRNG. Ambiguous characters (0/O, 1/l/I) are left out
 * so it can be read out over the phone.
 */
export function generatePassword(length = 14): string {
  const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => all[b % all.length]!);
  // Guarantee one of each required class at random positions.
  const extra = new Uint32Array(4);
  crypto.getRandomValues(extra);
  chars[extra[0]! % length] = letters[extra[1]! % letters.length]!;
  let digitAt = extra[2]! % length;
  if (digitAt === extra[0]! % length) digitAt = (digitAt + 1) % length;
  chars[digitAt] = digits[extra[3]! % digits.length]!;
  return chars.join('');
}

export function isValidPassword(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

// --- Pieces ----------------------------------------------------------------------

export function Card({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-gray-100 bg-white p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  inactive: 'bg-gray-100 text-gray-600 ring-gray-500/15',
  suspended: 'bg-amber-50 text-amber-800 ring-amber-600/20',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${STATUS_STYLES[status] ?? STATUS_STYLES.inactive}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-emerald-500' : status === 'suspended' ? 'bg-amber-500' : 'bg-gray-400'}`}
        aria-hidden="true"
      />
      {status}
    </span>
  );
}

export function RoleBadge({ name, isAdmin }: { name: string; isAdmin?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-[12rem] items-center truncate rounded-md px-2 py-0.5 text-xs font-medium ${
        isAdmin ? 'bg-[#03458f] text-white' : 'bg-blue-50 text-[#03458f]'
      }`}
    >
      {name}
    </span>
  );
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 text-lg rounded-2xl' : size === 'sm' ? 'h-8 w-8 text-xs rounded-lg' : 'h-10 w-10 text-sm rounded-xl';
  return (
    <span className={`flex shrink-0 items-center justify-center bg-[#03458f] font-semibold text-white ${box}`}>
      {initials(name)}
    </span>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="font-medium text-gray-900">{title}</p>
      {detail && <p className="mt-1 text-sm text-gray-500">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <svg
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputClass} pl-10`}
      />
    </div>
  );
}

/** Right-hand panel over the page; Escape or the backdrop closes it. */
export function Drawer({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEscape(onClose);
  return (
    <>
      {/* Above the layout's clock bar (z-200) and notification bell. */}
      <div className="fixed inset-0 z-[210] bg-gray-900/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={`fixed right-0 top-0 z-[220] flex h-full w-full flex-col bg-white shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
          <div className="min-w-0 text-lg font-semibold text-gray-900">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-gray-100 bg-white px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </>
  );
}

/** Centred dialog; Escape or the backdrop closes it. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center bg-gray-900/30 p-3 backdrop-blur-[2px] sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full flex-col rounded-2xl bg-white shadow-xl ${size === 'lg' ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 sm:px-6">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// --- Module picker ---------------------------------------------------------------

/**
 * Pick modules, grouped by category, with search and per-category select-all.
 * `locked` marks modules the person already gets some other way (a role): they
 * show as ticked with where they come from, and can't be toggled here.
 */
export function ModulePicker({
  modules,
  selected,
  onChange,
  locked,
  disabled = false,
}: {
  modules: AdminModule[];
  selected: number[];
  onChange: (next: number[]) => void;
  locked?: Map<number, string>;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCategory = new Map<string, AdminModule[]>();
    for (const m of modules) {
      if (q && !m.name.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) continue;
      const list = byCategory.get(m.category) ?? [];
      list.push(m);
      byCategory.set(m.category, list);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, list]) => ({ category, list: list.sort((a, b) => a.sortOrder - b.sortOrder) }));
  }, [modules, query]);

  const visibleIds = groups.flatMap((g) => g.list.map((m) => m.id)).filter((id) => !locked?.has(id));
  const setMany = (ids: number[], on: boolean) => {
    const next = new Set(selectedSet);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange([...next]);
  };

  const total = new Set([...selected, ...(locked ? [...locked.keys()] : [])]).size;

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={query} onChange={setQuery} placeholder="Search modules…" className="flex-1" />
        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            disabled={disabled || visibleIds.length === 0}
            onClick={() => setMany(visibleIds, true)}
            className="rounded-lg px-2.5 py-1.5 font-medium text-[#03458f] hover:bg-blue-50 disabled:opacity-40"
          >
            Select all
          </button>
          <button
            type="button"
            disabled={disabled || selected.length === 0}
            onClick={() => setMany(visibleIds, false)}
            className="rounded-lg px-2.5 py-1.5 font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-500" aria-live="polite">
        {total} of {modules.length} modules
      </p>

      <div className="mt-3 space-y-4">
        {groups.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No modules match “{query}”.</p>}
        {groups.map(({ category, list }) => {
          const free = list.filter((m) => !locked?.has(m.id)).map((m) => m.id);
          const on = list.filter((m) => selectedSet.has(m.id) || locked?.has(m.id)).length;
          const allOn = free.length > 0 && free.every((id) => selectedSet.has(id));
          return (
            <fieldset key={category}>
              <div className="mb-1.5 flex items-center justify-between">
                <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {category} <span className="font-normal normal-case tracking-normal text-gray-400">· {on}/{list.length}</span>
                </legend>
                {free.length > 0 && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setMany(free, !allOn)}
                    className="text-xs font-medium text-[#03458f] hover:underline disabled:opacity-40"
                  >
                    {allOn ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {list.map((m) => {
                  const via = locked?.get(m.id);
                  const checked = Boolean(via) || selectedSet.has(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition ${
                        via
                          ? 'cursor-default border-gray-100 bg-gray-50'
                          : checked
                            ? 'cursor-pointer border-[#03458f]/30 bg-blue-50/60'
                            : 'cursor-pointer border-gray-100 hover:bg-gray-50'
                      } ${disabled ? 'opacity-60' : ''}`}
                      title={m.description}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || Boolean(via)}
                        onChange={() => setMany([m.id], !selectedSet.has(m.id))}
                        className="h-4 w-4 shrink-0 rounded accent-[#03458f]"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{m.name}</span>
                      {via && <span className="shrink-0 truncate text-[11px] text-gray-500">via {via}</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
