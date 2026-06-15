'use client';

import { useState } from 'react';

import type { ProductOption } from '../types';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

interface CatalogClientProps {
  initialProducts: ProductOption[];
}

interface DraftState {
  id: number | null;
  name: string;
  description: string;
  sku: string;
  defaultUnitPrice: string;
  currency: string;
  taxable: boolean;
  archived: boolean;
}

const emptyDraft: DraftState = {
  id: null,
  name: '',
  description: '',
  sku: '',
  defaultUnitPrice: '0',
  currency: 'USD',
  taxable: true,
  archived: false,
};

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

export default function CatalogClient({ initialProducts }: CatalogClientProps) {
  const [products, setProducts] = useState<ProductOption[]>(initialProducts);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const startCreate = () => {
    setError(null);
    setDraft({ ...emptyDraft });
  };

  const startEdit = (product: ProductOption) => {
    setError(null);
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

  const closeDraft = () => setDraft(null);

  const upsertProduct = (product: ProductOption) => {
    setProducts((current) => {
      const without = current.filter((p) => p.id !== product.id);
      return [...without, product].sort((a, b) => a.name.localeCompare(b.name));
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    setError(null);
    if (!draft.name.trim()) {
      setError('Product name is required');
      return;
    }
    const price = Number(draft.defaultUnitPrice);
    if (!Number.isFinite(price) || price < 0) {
      setError('Default unit price must be zero or more');
      return;
    }

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      sku: draft.sku.trim() || null,
      defaultUnitPrice: price,
      currency: draft.currency,
      taxable: draft.taxable,
      archived: draft.id ? draft.archived : undefined,
    };

    setPending(true);
    try {
      const url = draft.id ? `/api/quotes/products/${draft.id}` : '/api/quotes/products';
      const method = draft.id ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { product?: ProductOption; error?: string }
        | null;
      if (!response.ok || !data?.product) {
        setError(data?.error ?? 'Could not save product');
        return;
      }
      upsertProduct(data.product);
      closeDraft();
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async (product: ProductOption) => {
    if (!confirm(`Delete product "${product.name}"? Past quotes that use it stay intact.`)) return;
    try {
      const response = await fetch(`/api/quotes/products/${product.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete product');
        return;
      }
      setProducts((current) => current.filter((p) => p.id !== product.id));
    } catch {
      setError('Network error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          {products.length} {products.length === 1 ? 'product' : 'products'} on file.
        </p>
        <button
          type="button"
          onClick={startCreate}
          className="px-5 py-2.5 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90"
        >
          + New product
        </button>
      </div>

      {products.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border-2 border-dashed border-gray-200">
          <h3 className="text-lg font-black text-gray-900">No products yet</h3>
          <p className="text-gray-500 mt-2 text-sm">
            Add reusable products or services so the builder can pre-fill line items.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {products.map((product) => (
            <div
              key={product.id}
              className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                product.archived ? 'opacity-60' : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-gray-900">
                  {product.name}
                  {product.archived && (
                    <span className="ml-2 text-[10px] font-bold uppercase text-amber-600">
                      Archived
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {product.sku ? `SKU ${product.sku} • ` : ''}
                  {formatMoney(product.defaultUnitPrice, product.currency)}{' '}
                  {product.taxable ? '• taxable' : '• non-taxable'}
                </p>
                {product.description && (
                  <p className="text-xs text-gray-500 mt-1">{product.description}</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(product)}
                  className="px-3 py-1.5 border-2 border-gray-200 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(product)}
                  className="px-3 py-1.5 text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && !draft && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
          {error}
        </div>
      )}

      {draft && (
        <>
          <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-40" onClick={closeDraft} />
          <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 pointer-events-none">
            <div className="bg-white w-full max-w-lg h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto rounded-none sm:rounded-2xl shadow-2xl pointer-events-auto p-6 sm:p-8 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black text-gray-900">
                  {draft.id ? 'Edit product' : 'New product'}
                </h2>
                <button
                  type="button"
                  onClick={closeDraft}
                  className="p-2 text-gray-400 hover:text-gray-700"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              <input
                type="text"
                placeholder="Name *"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
              <textarea
                placeholder="Description"
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                rows={2}
                className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm focus:ring-2 focus:ring-primary"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="SKU"
                  value={draft.sku}
                  onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
                  className="px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary"
                />
                <select
                  value={draft.currency}
                  onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
                  className="px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary"
                >
                  {CURRENCIES.includes(draft.currency) ? null : (
                    <option value={draft.currency}>{draft.currency}</option>
                  )}
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Default unit price"
                value={draft.defaultUnitPrice}
                onChange={(event) => setDraft({ ...draft, defaultUnitPrice: event.target.value })}
                className="w-full px-3 py-2 bg-gray-50 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                  <input
                    type="checkbox"
                    checked={draft.taxable}
                    onChange={(event) => setDraft({ ...draft, taxable: event.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Taxable by default
                </label>
                {draft.id && (
                  <label className="flex items-center gap-2 text-sm font-bold text-gray-700">
                    <input
                      type="checkbox"
                      checked={draft.archived}
                      onChange={(event) => setDraft({ ...draft, archived: event.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    Archived (hidden from picker)
                  </label>
                )}
              </div>

              {error && (
                <p className="text-xs font-bold text-rose-600">{error}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeDraft}
                  className="flex-1 px-4 py-2.5 border-2 border-gray-200 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={pending}
                  className="flex-1 px-4 py-2.5 bg-primary text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
                >
                  {pending ? 'Saving…' : draft.id ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
