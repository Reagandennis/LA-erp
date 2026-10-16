'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useMemo, useState, type ReactNode } from 'react';

import type { ProductSummary } from '@/lib/products';

interface ProductsClientProps {
  initialProducts: ProductSummary[];
  defaultCurrency: string;
}

type Filter = 'All' | 'Active' | 'Archived';

const FILTERS: Filter[] = ['All', 'Active', 'Archived'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

interface Draft {
  id: number | null;
  name: string;
  description: string;
  sku: string;
  defaultUnitPrice: string;
  currency: string;
  taxable: boolean;
  archived: boolean;
}

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 });
}

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';

export default function ProductsClient({ initialProducts, defaultCurrency }: ProductsClientProps) {
  const [products, setProducts] = useState<ProductSummary[]>(initialProducts);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>('Active');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch =
        q.length === 0 ||
        p.name.toLowerCase().includes(q) ||
        (p.sku?.toLowerCase().includes(q) ?? false) ||
        (p.description?.toLowerCase().includes(q) ?? false);
      const matchesFilter =
        activeFilter === 'All' || (activeFilter === 'Active' ? !p.archived : p.archived);
      return matchesSearch && matchesFilter;
    });
  }, [products, searchQuery, activeFilter]);

  const totals = useMemo(
    () => ({
      total: products.length,
      active: products.filter((p) => !p.archived).length,
      archived: products.filter((p) => p.archived).length,
      taxable: products.filter((p) => p.taxable && !p.archived).length,
    }),
    [products],
  );

  const openEdit = (product: ProductSummary) => {
    setError(null);
    setIsNew(false);
    setDraft({
      id: product.id,
      name: product.name,
      description: product.description ?? '',
      sku: product.sku ?? '',
      defaultUnitPrice: String(product.defaultUnitPrice),
      currency: product.currency,
      taxable: product.taxable,
      archived: product.archived,
    });
  };

  const openNew = () => {
    setError(null);
    setIsNew(true);
    setDraft({
      id: null,
      name: '',
      description: '',
      sku: '',
      defaultUnitPrice: '0',
      currency: defaultCurrency || 'USD',
      taxable: true,
      archived: false,
    });
  };

  const closeDrawer = () => {
    setDraft(null);
    setIsNew(false);
    setError(null);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('Name is required');
      return;
    }
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      sku: draft.sku.trim() || null,
      defaultUnitPrice: Number(draft.defaultUnitPrice) || 0,
      currency: draft.currency,
      taxable: draft.taxable,
    };
    if (!isNew) payload.archived = draft.archived;

    setSaving(true);
    setError(null);
    try {
      const url = isNew ? '/api/quotes/products' : `/api/quotes/products/${draft.id}`;
      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { product?: ProductSummary; error?: string }
        | null;
      if (!response.ok || !data?.product) {
        setError(data?.error ?? 'Could not save the item');
        return;
      }
      const saved = data.product;
      setProducts((current) =>
        isNew ? [saved, ...current] : current.map((p) => (p.id === saved.id ? saved : p)),
      );
      closeDrawer();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    if (!confirm(`Delete “${draft.name}”? This cannot be undone — archive it instead to keep history.`)) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotes/products/${draft.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete');
        return;
      }
      const id = draft.id;
      setProducts((current) => current.filter((p) => p.id !== id));
      closeDrawer();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const hasProducts = products.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Products &amp; services</h1>
            <p className="mt-1 text-sm text-gray-500">Your catalog of priced items — reused across quotes and invoices.</p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
            </svg>
            New item
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Items" value={`${totals.total}`} accent="text-primary" />
          <SummaryCard label="Active" value={`${totals.active}`} />
          <SummaryCard label="Archived" value={`${totals.archived}`} />
          <SummaryCard label="Taxable" value={`${totals.taxable}`} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, SKU, or description…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setActiveFilter(status)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  activeFilter === status ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => openEdit(product)}
                className={`group rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30 sm:p-5 ${
                  product.archived ? 'opacity-70' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                        {product.name}
                      </h3>
                      {product.archived && <Badge className="bg-gray-100 text-gray-500">Archived</Badge>}
                      {!product.taxable && <Badge className="bg-amber-50 text-amber-700">Non-taxable</Badge>}
                    </div>
                    {product.sku && <p className="mt-0.5 text-xs text-gray-400">SKU {product.sku}</p>}
                    {product.description && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-gray-500">{product.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-bold text-gray-900">
                      {formatMoney(product.defaultUnitPrice, product.currency)}
                    </p>
                    <p className="text-xs text-gray-400">per unit</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{hasProducts ? 'No matching items' : 'No items yet'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {hasProducts ? 'Try a different search or filter.' : 'Add your first product or service to reuse it on quotes and invoices.'}
            </p>
            {!hasProducts && (
              <button
                type="button"
                onClick={openNew}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                New item
              </button>
            )}
          </div>
        )}
      </div>

      {draft && (
        <>
          <div className="fixed inset-0 z-[220] bg-gray-900/30 backdrop-blur-sm" onClick={() => (saving ? null : closeDrawer())} />
          <div className="fixed right-0 top-0 z-[230] flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">{isNew ? 'New item' : 'Edit item'}</h2>
              <button type="button" onClick={closeDrawer} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-5 px-6 py-6">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  type="text"
                  value={draft.name}
                  placeholder="Product or service name"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full rounded-xl bg-gray-50 px-4 py-3 text-base font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  value={draft.description}
                  rows={3}
                  placeholder="Optional — what's included, scope, etc."
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>SKU / code</label>
                  <input type="text" value={draft.sku} placeholder="Optional" onChange={(e) => setDraft({ ...draft, sku: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Currency</label>
                  <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} className={inputClass}>
                    {CURRENCIES.includes(draft.currency) ? null : <option value={draft.currency}>{draft.currency}</option>}
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Default unit price</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draft.defaultUnitPrice}
                    onChange={(e) => setDraft({ ...draft, defaultUnitPrice: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex w-full items-center gap-2 rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={draft.taxable}
                      onChange={(e) => setDraft({ ...draft, taxable: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                    />
                    Taxable
                  </label>
                </div>
              </div>

              {!isNew && (
                <label className="flex w-fit items-center gap-2 text-sm font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={draft.archived}
                    onChange={(e) => setDraft({ ...draft, archived: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                  Archived (hidden from new quotes &amp; invoices)
                </label>
              )}

              {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            </div>

            <div className="sticky bottom-0 flex items-center gap-2.5 border-t border-gray-100 bg-white px-6 py-4">
              {!isNew && (
                <button type="button" onClick={remove} disabled={saving} className="text-sm font-medium text-rose-600 transition-colors hover:text-rose-800 disabled:opacity-50">
                  Delete
                </button>
              )}
              <button type="button" onClick={closeDrawer} disabled={saving} className="ml-auto rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Saving…' : isNew ? 'Add item' : 'Save changes'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}
