'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';

import type { BrandProfileOption, CustomerOption, OrganizationBranding, ProductOption } from './types';

/**
 * Layout pieces shared by the quote and invoice builders, so both forms get
 * the same wide dialog, sections, fields, catalog picker and totals.
 *
 * The dialog body is a size container: its grids switch on the dialog's own
 * width (`@md:`, `@3xl:` …) rather than the viewport's. Viewport breakpoints
 * are what squeezed four columns into a narrow modal on a wide screen.
 */

export const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20';

/** Tighter inputs for line-item rows. */
export const cellInputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/20';

/** Numeric line-item cells: right-aligned, without spinner arrows crowding short values. */
export const numberCellInputClass = `${cellInputClass} text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

export const labelClass = 'mb-1.5 block text-xs font-medium text-gray-600';

/** A line-item field's own label: shown while rows stack, screen-reader only once the column headers show. */
export const cellLabelClass = 'mb-1 block text-[11px] font-medium text-gray-500 @4xl:sr-only';

/** Column headers above the line items, shown only at table width. */
export const itemHeaderClass =
  'hidden gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 @4xl:grid';

export const primaryButton =
  'inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50';

export const secondaryButton =
  'inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50';

export const ghostButton =
  'hidden items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 sm:inline-flex';

export function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 });
}

export function BuilderShell({
  title,
  subtitle,
  busy,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle: string;
  busy: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <>
      {/* Above the top bar (z-200), which would otherwise cover the dialog's header. */}
      <div className="fixed inset-0 z-[220] bg-gray-900/40 backdrop-blur-sm" onClick={() => (busy ? null : onClose())} />
      <div className="pointer-events-none fixed inset-0 z-[230] flex items-stretch justify-center sm:items-center sm:p-4 lg:p-8">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="builder-title"
          className="pointer-events-auto flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl"
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-8 sm:py-5">
            <div className="min-w-0">
              <h2 id="builder-title" className="text-lg font-bold tracking-tight text-gray-900 sm:text-xl">
                {title}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="@container min-h-0 flex-1 overflow-y-auto">
            <div className="divide-y divide-gray-100 px-5 sm:px-8">{children}</div>
          </div>

          <footer className="shrink-0 border-t border-gray-100 bg-white px-5 py-4 sm:px-8">{footer}</footer>
        </div>
      </div>
    </>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

export function PercentInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <span className="relative block">
      <input
        type="number"
        min="0"
        max="100"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} pr-9`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-gray-400">%</span>
    </span>
  );
}

export function BrandSelect({
  label,
  hint,
  brandProfiles,
  organization,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  brandProfiles: BrandProfileOption[];
  organization: OrganizationBranding;
  value: string;
  onChange: (value: string) => void;
}) {
  if (brandProfiles.length === 0) {
    return (
      <div>
        <span className={labelClass}>{label}</span>
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500">
          No companies yet —{' '}
          <Link href="/modules/quotes/settings" className="font-semibold text-primary hover:underline">
            add one in Settings
          </Link>
          .
        </div>
      </div>
    );
  }

  const selected = brandProfiles.find((b) => String(b.id) === value) ?? null;
  return (
    <Field label={label} hint={hint}>
      <span className="relative block">
        {selected && (
          <span
            className="pointer-events-none absolute left-3.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ring-1 ring-black/5"
            style={{ backgroundColor: selected.primaryColor }}
          />
        )}
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} ${selected ? 'pl-9' : ''}`}
        >
          <option value="">
            {organization.companyName ? `${organization.companyName} (default)` : 'Organization default'}
          </option>
          {brandProfiles.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.companyName || brand.name}
              {brand.isDefault ? ' • default' : ''}
            </option>
          ))}
        </select>
      </span>
    </Field>
  );
}

/**
 * Customer dropdown plus the inline "new customer" form. Renders as a fragment
 * so the form becomes its own full-width row in the parent's two-column grid.
 */
export function CustomerSelect({
  label,
  customers,
  value,
  onChange,
  onCreated,
}: {
  label: string;
  customers: CustomerOption[];
  value: string;
  onChange: (value: string) => void;
  onCreated: (customer: CustomerOption) => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor="builder-customer" className="text-xs font-medium text-gray-600">
            {label}
          </label>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-xs font-semibold text-primary hover:text-primary/80"
            >
              + New client
            </button>
          )}
        </div>
        <select
          id="builder-customer"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          <option value="">Select a client…</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
              {customer.company ? ` — ${customer.company}` : ''}
            </option>
          ))}
        </select>
      </div>
      {creating && (
        <NewCustomerForm
          onCancel={() => setCreating(false)}
          onCreated={(customer) => {
            onCreated(customer);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

const EMPTY_CUSTOMER = { name: '', email: '', phone: '', company: '', address: '', billingAddress: '' };

function NewCustomerForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (customer: CustomerOption) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_CUSTOMER);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const bind = (field: keyof typeof EMPTY_CUSTOMER) => ({
    value: draft[field],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setDraft((current) => ({ ...current, [field]: event.target.value })),
    className: inputClass,
  });

  const handleSave = async () => {
    setError(null);
    if (!draft.name.trim()) {
      setError('Client name is required');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/quotes/customers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim() || null,
          company: draft.company.trim() || null,
          address: draft.address.trim() || null,
          billingAddress: draft.billingAddress.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { customer?: CustomerOption; error?: string }
        | null;
      if (!response.ok || !data?.customer) {
        setError(data?.error ?? 'Could not create client');
        return;
      }
      onCreated(data.customer);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 @2xl:col-span-2 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gray-900">New client</p>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
        <Field label="Name *">
          <input type="text" {...bind('name')} />
        </Field>
        <Field label="Company">
          <input type="text" {...bind('company')} />
        </Field>
        <Field label="Email">
          <input type="email" {...bind('email')} />
        </Field>
        <Field label="Phone">
          <input type="tel" {...bind('phone')} />
        </Field>
        <Field label="Physical address">
          <input type="text" {...bind('address')} />
        </Field>
        <Field label="Billing address">
          <input type="text" {...bind('billingAddress')} />
        </Field>
      </div>
      {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end">
        <button type="button" disabled={saving} onClick={handleSave} className={primaryButton}>
          {saving ? 'Saving…' : 'Save client'}
        </button>
      </div>
    </div>
  );
}

/** Description input for a line item, with the catalog toggle tucked inside it. */
export function ItemDescriptionInput({
  id,
  value,
  placeholder,
  onChange,
  catalogOpen,
  onToggleCatalog,
}: {
  id: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  catalogOpen: boolean;
  /** Omit when there is no catalog to pick from. */
  onToggleCatalog?: () => void;
}) {
  return (
    <>
      <label htmlFor={id} className={cellLabelClass}>
        Description
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${cellInputClass} ${onToggleCatalog ? 'pr-24 @4xl:pr-10 @5xl:pr-24' : ''}`}
        />
        {onToggleCatalog && (
          <button
            type="button"
            onClick={onToggleCatalog}
            aria-expanded={catalogOpen}
            className={`absolute inset-y-1 right-1 inline-flex items-center gap-1 rounded-md px-2 text-xs font-semibold transition-colors ${
              catalogOpen ? 'bg-primary/10 text-primary' : 'text-primary hover:bg-primary/5'
            }`}
            title="Insert from catalog"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            {/* Icon-only while the table is at its tightest, so the description keeps the room. */}
            <span className="@4xl:sr-only @5xl:not-sr-only">Catalog</span>
          </button>
        )}
      </div>
    </>
  );
}

/** The standardized catalog runs to hundreds of services; search narrows it. */
const PICKER_LIMIT = 80;

export function CatalogPicker({
  products,
  onPick,
}: {
  products: ProductOption[];
  onPick: (product: ProductOption) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q
    ? products.filter(
        (product) =>
          [product.name, product.sku, product.country].some((value) => value?.toLowerCase().includes(q)),
      )
    : products;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-2">
        <input
          type="search"
          autoFocus
          placeholder="Search the catalog…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      <ul className="max-h-56 divide-y divide-gray-50 overflow-y-auto">
        {matches.slice(0, PICKER_LIMIT).map((product) => (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => onPick(product)}
              className="flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left transition-colors hover:bg-primary/5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{product.name}</span>
                {(product.sku || product.unitOfMeasure || !product.taxable) && (
                  <span className="block text-xs text-gray-500">
                    {[product.sku, product.country, product.unitOfMeasure, product.taxable ? null : 'Non-taxable']
                      .filter(Boolean)
                      .join(' • ')}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-gray-600">
                {formatMoney(product.defaultUnitPrice, product.currency)}
              </span>
            </button>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-gray-500">No products match “{query.trim()}”.</li>
        )}
        {matches.length > PICKER_LIMIT && (
          <li className="px-3 py-2 text-center text-xs text-gray-400">
            Showing {PICKER_LIMIT} of {matches.length}. Search by name, service code or country.
          </li>
        )}
      </ul>
    </div>
  );
}

export function TaxableCheckbox({
  checked,
  onChange,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-xs font-medium text-gray-600 @4xl:justify-center ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
      />
      <span className="@4xl:sr-only">Taxable</span>
    </label>
  );
}

export function RemoveItemButton({
  label,
  disabled,
  onClick,
  className = '',
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <div className={`flex justify-end ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0l-.5 12a2 2 0 01-2 2H9.5a2 2 0 01-2-2L7 7"
          />
        </svg>
      </button>
    </div>
  );
}

export function AddItemButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 border-t border-gray-100 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 @4xl:justify-start"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
      </svg>
      Add line item
    </button>
  );
}

export function TotalsCard({
  currency,
  subtotal,
  tax,
  taxRate,
  total,
  taxLabel,
}: {
  currency: string;
  subtotal: number;
  tax: number;
  taxRate: number;
  total: number;
  taxLabel: string;
}) {
  return (
    <div className="h-fit space-y-2.5 rounded-xl border border-gray-200 bg-gray-50/70 p-5">
      <div className="flex justify-between text-sm text-gray-500">
        <span>Subtotal</span>
        <span className="font-medium tabular-nums text-gray-800">{formatMoney(subtotal, currency)}</span>
      </div>
      <div className="flex justify-between text-sm text-gray-500">
        <span>
          {taxLabel} ({(taxRate * 100).toFixed(2)}%)
        </span>
        <span className="font-medium tabular-nums text-gray-800">{formatMoney(tax, currency)}</span>
      </div>
      <div className="flex items-baseline justify-between border-t border-gray-200 pt-3">
        <span className="text-sm font-semibold text-gray-900">Total</span>
        <span className="text-xl font-bold tabular-nums text-primary">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

/** Error banner, running total and the action buttons, pinned under the form. */
export function BuilderFooter({
  error,
  totalLabel,
  total,
  children,
}: {
  error: string | null;
  totalLabel: string;
  total: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-baseline justify-between gap-3 sm:block">
          <p className="text-xs font-medium text-gray-500">{totalLabel}</p>
          <p className="text-lg font-bold tabular-nums text-gray-900">{total}</p>
        </div>
        <div className="flex flex-col-reverse gap-2.5 sm:ml-auto sm:flex-row">{children}</div>
      </div>
    </div>
  );
}
