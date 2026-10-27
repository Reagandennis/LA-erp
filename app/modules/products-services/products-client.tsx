'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useMemo, useState, type ReactNode } from 'react';

import type { ProductSummary, ServiceDetailKey } from '@/lib/products';
import {
  NAMING_RULES,
  SERVICE_CATEGORIES,
  SERVICE_COUNTRIES,
  SERVICE_TIERS,
  UNITS_OF_MEASURE,
} from '@/lib/service-catalog';

interface ProductsClientProps {
  initialProducts: ProductSummary[];
  defaultCurrency: string;
}

type Filter = 'Active' | 'Archived' | 'All';

const FILTERS: Filter[] = ['Active', 'Archived', 'All'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];
const UNCATEGORISED = 'Uncategorised';
const PROPOSED = /^PROPOSED\b/;

type Draft = Record<ServiceDetailKey, string> & {
  id: number | null;
  name: string;
  description: string;
  sku: string;
  defaultUnitPrice: string;
  currency: string;
  taxable: boolean;
  archived: boolean;
};

const DETAIL_KEYS: ServiceDetailKey[] = [
  'quickbooksName',
  'category',
  'subCategory',
  'serviceClass',
  'tier',
  'country',
  'location',
  'airportCode',
  'coverageScope',
  'vehicleExamples',
  'unitOfMeasure',
  'terms',
  'notes',
];

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 });
}

/** Known values first, in the master's order, then anything else in use. */
function ordered(known: readonly string[], values: Iterable<string | null>): string[] {
  const present = new Set([...values].filter((v): v is string => Boolean(v)));
  return [...known.filter((v) => present.has(v)), ...[...present].filter((v) => !known.includes(v)).sort()];
}

const countryRank = (country: string | null) => {
  const i = (SERVICE_COUNTRIES as readonly string[]).indexOf(country ?? '');
  return i === -1 ? SERVICE_COUNTRIES.length : i;
};

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';

export default function ProductsClient({ initialProducts, defaultCurrency }: ProductsClientProps) {
  const [products, setProducts] = useState<ProductSummary[]>(initialProducts);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>('Active');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const byStatus = useMemo(
    () => products.filter((p) => activeFilter === 'All' || (activeFilter === 'Active' ? !p.archived : p.archived)),
    [products, activeFilter],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return byStatus.filter((p) => {
      if (country && p.country !== country) return false;
      if (category && (p.category ?? UNCATEGORISED) !== category) return false;
      if (!q) return true;
      return [p.name, p.sku, p.quickbooksName, p.description, p.location, p.serviceClass].some((v) =>
        v?.toLowerCase().includes(q),
      );
    });
  }, [byStatus, searchQuery, country, category]);

  // Grouped by the master's categories, then by country within each.
  const groups = useMemo(() => {
    const map = new Map<string, ProductSummary[]>();
    for (const p of filtered) {
      const key = p.category ?? UNCATEGORISED;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return ordered([...SERVICE_CATEGORIES, UNCATEGORISED], map.keys()).map((key) => ({
      category: key,
      items: map
        .get(key)!
        .sort((a, b) => countryRank(a.country) - countryRank(b.country) || a.name.localeCompare(b.name)),
    }));
  }, [filtered]);

  const countries = useMemo(() => ordered(SERVICE_COUNTRIES, products.map((p) => p.country)), [products]);
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of byStatus) {
      if (country && p.country !== country) continue;
      const key = p.category ?? UNCATEGORISED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return ordered([...SERVICE_CATEGORIES, UNCATEGORISED], counts.keys()).map((key) => ({ key, count: counts.get(key)! }));
  }, [byStatus, country]);

  // Suggestions for the free-text columns, from what the catalog already uses.
  const suggestions = useMemo(() => {
    const distinct = (key: ServiceDetailKey) =>
      [...new Set(products.map((p) => p[key]).filter((v): v is string => Boolean(v)))].sort();
    return {
      subCategory: distinct('subCategory'),
      serviceClass: distinct('serviceClass'),
      location: distinct('location'),
      coverageScope: distinct('coverageScope'),
    };
  }, [products]);

  const totals = useMemo(() => {
    const active = products.filter((p) => !p.archived);
    return {
      active: active.length,
      archived: products.length - active.length,
      countries: new Set(active.map((p) => p.country).filter(Boolean)).size,
      unpriced: active.filter((p) => p.defaultUnitPrice === 0).length,
    };
  }, [products]);

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
      ...(Object.fromEntries(DETAIL_KEYS.map((key) => [key, product[key] ?? ''])) as Record<ServiceDetailKey, string>),
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
      ...(Object.fromEntries(DETAIL_KEYS.map((key) => [key, ''])) as Record<ServiceDetailKey, string>),
      // Start from the filters in view.
      category: category === UNCATEGORISED ? '' : category,
      country,
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
      setError('The standardized service name is required');
      return;
    }
    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      sku: draft.sku.trim() || null,
      defaultUnitPrice: Number(draft.defaultUnitPrice) || 0,
      currency: draft.currency,
      taxable: draft.taxable,
      ...Object.fromEntries(DETAIL_KEYS.map((key) => [key, draft[key].trim() || null])),
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
        setError(data?.error ?? 'Could not save the service');
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
  const set = (key: keyof Draft, value: string | boolean) => draft && setDraft({ ...draft, [key]: value });

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Products &amp; services</h1>
            <p className="mt-1 text-sm text-gray-500">
              The standardized service catalog, named as the Standardized Naming Master sets out. Reused across quotes,
              invoices and trips.
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
            </svg>
            New service
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Active services" value={`${totals.active}`} accent="text-primary" />
          <SummaryCard label="Countries" value={`${totals.countries}`} />
          <SummaryCard label="Without a price" value={`${totals.unpriced}`} />
          <SummaryCard label="Archived" value={`${totals.archived}`} />
        </div>

        <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
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
                placeholder="Search by name, service code, QuickBooks name or city…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <select
              aria-label="Country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 lg:w-48"
            >
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
          {categoryCounts.length > 0 && (
            <div className="flex gap-1 overflow-x-auto border-t border-gray-100 pt-3 scrollbar-hide">
              {[{ key: '', count: categoryCounts.reduce((sum, c) => sum + c.count, 0) }, ...categoryCounts].map(
                ({ key, count }) => (
                  <button
                    key={key || 'all'}
                    type="button"
                    onClick={() => setCategory(key)}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      category === key ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {key || 'All categories'} <span className="text-gray-400">{count}</span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>

        {groups.length > 0 ? (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.category}>
                <h2 className="mb-2 flex items-baseline gap-2 px-1 text-sm font-semibold text-gray-900">
                  {group.category}
                  <span className="text-xs font-normal text-gray-400">{group.items.length}</span>
                </h2>
                <ul className="divide-y divide-gray-50 overflow-hidden rounded-2xl border border-gray-100 bg-white">
                  {group.items.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className={`group flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-primary/5 sm:px-5 ${
                          product.archived ? 'opacity-70' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                              {product.name}
                            </h3>
                            {product.notes && PROPOSED.test(product.notes) && (
                              <Badge className="bg-amber-50 text-amber-700">Proposed</Badge>
                            )}
                            {product.archived && <Badge className="bg-gray-100 text-gray-500">Archived</Badge>}
                            {!product.taxable && <Badge className="bg-amber-50 text-amber-700">Non-taxable</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {[
                              product.sku && <span key="code" className="font-mono">{product.sku}</span>,
                              product.country,
                              product.unitOfMeasure,
                            ]
                              .filter(Boolean)
                              .flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {product.defaultUnitPrice > 0 ? (
                            <p className="text-sm font-bold text-gray-900">
                              {formatMoney(product.defaultUnitPrice, product.currency)}
                            </p>
                          ) : (
                            <p className="text-xs text-gray-400">No price yet</p>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{hasProducts ? 'No matching services' : 'No services yet'}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {hasProducts ? 'Try a different search or filter.' : 'Add your first service to reuse it on quotes, invoices and trips.'}
            </p>
            {!hasProducts && (
              <button
                type="button"
                onClick={openNew}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                New service
              </button>
            )}
          </div>
        )}
      </div>

      {draft && (
        <>
          <div className="fixed inset-0 z-[220] bg-gray-900/30 backdrop-blur-sm" onClick={() => (saving ? null : closeDrawer())} />
          <div className="fixed right-0 top-0 z-[230] flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">{isNew ? 'New service' : 'Edit service'}</h2>
              <button type="button" onClick={closeDrawer} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-6 px-6 py-6">
              <Section title="Naming">
                <Field label="Standardized service name" hint={`${NAMING_RULES.name.rule} e.g. ${NAMING_RULES.name.example}`}>
                  <input
                    type="text"
                    value={draft.name}
                    placeholder={NAMING_RULES.name.example}
                    onChange={(e) => set('name', e.target.value)}
                    className="w-full rounded-xl bg-gray-50 px-4 py-3 text-base font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </Field>
                <Field label="Service code" hint={NAMING_RULES.code.rule}>
                  <input
                    type="text"
                    value={draft.sku}
                    placeholder={NAMING_RULES.code.example}
                    onChange={(e) => set('sku', e.target.value.toUpperCase())}
                    className={`${inputClass} font-mono`}
                  />
                </Field>
                <Field label="QuickBooks item name" hint={NAMING_RULES.quickbooks.rule}>
                  <input
                    type="text"
                    value={draft.quickbooksName}
                    placeholder={NAMING_RULES.quickbooks.example}
                    onChange={(e) => set('quickbooksName', e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </Section>

              <Section title="Classification">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Service category">
                    <Choice value={draft.category} options={SERVICE_CATEGORIES} onChange={(v) => set('category', v)} />
                  </Field>
                  <Field label="Sub-category">
                    <Suggest id="sub-category" value={draft.subCategory} options={suggestions.subCategory} placeholder="Airport Transfer" onChange={(v) => set('subCategory', v)} />
                  </Field>
                  <Field label="Asset / personnel class">
                    <Suggest id="service-class" value={draft.serviceClass} options={suggestions.serviceClass} placeholder="SUV" onChange={(v) => set('serviceClass', v)} />
                  </Field>
                  <Field label="Tier / level" hint="Level 1 is entry, Level 3 most senior. Blank when there are no alternatives.">
                    <Choice value={draft.tier} options={SERVICE_TIERS} onChange={(v) => set('tier', v)} />
                  </Field>
                  <Field label="Country">
                    <Choice value={draft.country} options={SERVICE_COUNTRIES} onChange={(v) => set('country', v)} />
                  </Field>
                  <Field label="Location / city">
                    <Suggest id="location" value={draft.location} options={suggestions.location} placeholder="Nairobi" onChange={(v) => set('location', v)} />
                  </Field>
                  <Field label="Airport code">
                    <input
                      type="text"
                      maxLength={10}
                      value={draft.airportCode}
                      placeholder="NBO"
                      onChange={(e) => set('airportCode', e.target.value.toUpperCase())}
                      className={`${inputClass} font-mono`}
                    />
                  </Field>
                  <Field label="Coverage scope">
                    <Suggest id="coverage" value={draft.coverageScope} options={suggestions.coverageScope} placeholder="Airport <> City" onChange={(v) => set('coverageScope', v)} />
                  </Field>
                </div>
                <Field label="Vehicle examples" hint="The class is what is sold; the model is a fleet detail.">
                  <input
                    type="text"
                    value={draft.vehicleExamples}
                    placeholder="Prado, Fortuner"
                    onChange={(e) => set('vehicleExamples', e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </Section>

              <Section title="Selling">
                <Field label="Description">
                  <textarea
                    value={draft.description}
                    rows={3}
                    placeholder="What's included, waiting time, capacity…"
                    onChange={(e) => set('description', e.target.value)}
                    className={inputClass}
                  />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Unit of measure">
                    <Choice value={draft.unitOfMeasure} options={UNITS_OF_MEASURE} onChange={(v) => set('unitOfMeasure', v)} />
                  </Field>
                  <Field label="Currency">
                    <select value={draft.currency} onChange={(e) => set('currency', e.target.value)} className={inputClass}>
                      {CURRENCIES.includes(draft.currency) ? null : <option value={draft.currency}>{draft.currency}</option>}
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Default unit price">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.defaultUnitPrice}
                      onChange={(e) => set('defaultUnitPrice', e.target.value)}
                      className={inputClass}
                    />
                  </Field>
                  <div className="flex items-end">
                    <label className="flex w-full items-center gap-2 rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={draft.taxable}
                        onChange={(e) => set('taxable', e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                      />
                      Taxable
                    </label>
                  </div>
                </div>
              </Section>

              <Section title="Terms & notes">
                <Field label="Terms & conditions">
                  <textarea value={draft.terms} rows={2} onChange={(e) => set('terms', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Notes / open items">
                  <textarea value={draft.notes} rows={2} onChange={(e) => set('notes', e.target.value)} className={inputClass} />
                </Field>
              </Section>

              {!isNew && (
                <label className="flex w-fit items-center gap-2 text-sm font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={draft.archived}
                    onChange={(e) => set('archived', e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                  Archived (hidden from new quotes, invoices &amp; trips)
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
                {saving ? 'Saving…' : isNew ? 'Add service' : 'Save changes'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

/** The master's values, keeping one already saved that isn't among them. */
function Choice({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">—</option>
      {value && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/** Free text, suggesting what the catalog already uses so names stay consistent. */
function Suggest({
  id,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <>
      <input list={`${id}-options`} type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      <datalist id={`${id}-options`}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
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
