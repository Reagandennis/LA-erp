'use client';

import React from 'react';

import { type FleetVehicleRef, vehicleLabel } from '@/lib/fleet';
import { APP_LOCALE } from '@/lib/locale';

export { formatDateKey } from '@/lib/fleet';

/** Shared by the Fleet submodules (Car Fuel, Car Maintenance), in the Vehicles page's style. */

export const BRAND = '#03458f';
export const ACCENT = '#f9b232';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

export const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

export function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 });
}

/** Totals kept per currency, e.g. "KES 12,400 · $85". */
export function formatTotals(totals: Record<string, number>) {
  const parts = Object.entries(totals).map(([currency, value]) => formatMoney(value, currency));
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function formatNumber(value: number, maximumFractionDigits = 0) {
  return value.toLocaleString(APP_LOCALE, { maximumFractionDigits });
}

/**
 * A form's number field: blank is null, anything unreadable is an error the
 * form shows (JSON would otherwise turn NaN into a silent null).
 */
export function readNumber(raw: string, label: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 mb-1.5 block">{children}</label>;
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 min-w-0">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-xl font-semibold text-gray-900 truncate">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
  actionDisabled,
  secondaryLabel,
  onSecondary,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
      <div>
        <p className="text-xs font-medium text-gray-400 mb-1">Fleet</p>
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        <p className="text-gray-500 mt-1 text-sm">{subtitle}</p>
      </div>
      <div className="flex flex-wrap gap-2 self-start md:self-auto">
        {secondaryLabel && onSecondary && (
          <button
            onClick={onSecondary}
            disabled={actionDisabled}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          onClick={onAction}
          disabled={actionDisabled}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95 disabled:opacity-50"
          style={{ backgroundColor: BRAND }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
      <p className="flex-1">{message}</p>
      <button onClick={onDismiss} className="text-rose-400 hover:text-rose-600" aria-label="Dismiss">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 min-w-0">
      <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
      />
    </div>
  );
}

export function ChipFilter<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
            value === o.value ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
          }`}
          style={value === o.value ? { backgroundColor: BRAND } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function VehicleFilter({
  vehicles,
  value,
  onChange,
}: {
  vehicles: FleetVehicleRef[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <select
      aria-label="Vehicle"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="sm:w-56 px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30"
    >
      <option value="">All vehicles</option>
      {vehicles.map((v) => (
        <option key={v.id} value={v.id}>
          {vehicleLabel(v)}
        </option>
      ))}
    </select>
  );
}

export function VehicleSelect({
  vehicles,
  value,
  onChange,
}: {
  vehicles: FleetVehicleRef[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick a vehicle…</option>
      {vehicles.map((v) => (
        <option key={v.id} value={v.id}>
          {vehicleLabel(v)}
        </option>
      ))}
    </select>
  );
}

export function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <select aria-label="Currency" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {COMMON_CURRENCIES.includes(value) ? null : <option value={value}>{value}</option>}
      {COMMON_CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}

export function FleetModal({
  title,
  onClose,
  error,
  onSubmit,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4">
          {error && <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{error}</div>}
          {children}
          <div className="flex gap-3 pt-2">{footer}</div>
        </form>
      </div>
    </div>
  );
}

export function NoVehiclesNotice() {
  return (
    <div className="mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
      There are no vehicles yet. Add them in the Vehicles module first, then record them here.
    </div>
  );
}
