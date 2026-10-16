'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useMemo, useState } from 'react';

import type { DiscountType, TemplateOption } from '../types';

const BRAND = '#03458f';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR'] as const;
const DISCOUNT_TYPES: DiscountType[] = ['none', 'percentage', 'fixed'];

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';
const smallInput =
  'w-full px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30';

interface TemplatesClientProps {
  initialTemplates: TemplateOption[];
}

type ItemForm = {
  description: string;
  quantity: string;
  days: string;
  unitPrice: string;
  taxable: boolean;
  discountType: DiscountType;
  discountValue: string;
};

type TemplateForm = {
  name: string;
  description: string;
  currency: string;
  taxPercent: string; // shown as a percentage, stored as a 0–1 fraction
  discountType: DiscountType;
  discountValue: string;
  terms: string;
  notes: string;
  items: ItemForm[];
};

const EMPTY_ITEM: ItemForm = { description: '', quantity: '1', days: '1', unitPrice: '0', taxable: true, discountType: 'none', discountValue: '0' };

const EMPTY_FORM: TemplateForm = {
  name: '',
  description: '',
  currency: 'USD',
  taxPercent: '0',
  discountType: 'none',
  discountValue: '0',
  terms: '',
  notes: '',
  items: [{ ...EMPTY_ITEM }],
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function TemplatesClient({ initialTemplates }: TemplatesClientProps) {
  const [templates, setTemplates] = useState<TemplateOption[]>(initialTemplates);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/api/quotes/templates', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.templates)) setTemplates(data.templates as TemplateOption[]);
    } catch {
      /* ignore */
    }
  };

  // --- Editor open/close ----------------------------------------------------

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, items: [{ ...EMPTY_ITEM }] });
    setEditingId(null);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (t: TemplateOption) => {
    setForm({
      name: t.name,
      description: t.description ?? '',
      currency: t.currency,
      taxPercent: String(+(t.taxRate * 100).toFixed(4)),
      discountType: t.discountType,
      discountValue: String(t.discountValue),
      terms: t.terms ?? '',
      notes: t.notes ?? '',
      items: t.items.length
        ? t.items.map((i) => ({
            description: i.description,
            quantity: String(i.quantity),
            days: String(i.days ?? 1),
            unitPrice: String(i.unitPrice),
            taxable: i.taxable,
            discountType: i.discountType,
            discountValue: String(i.discountValue),
          }))
        : [{ ...EMPTY_ITEM }],
    });
    setEditingId(t.id);
    setFormError(null);
    setEditorOpen(true);
  };

  // --- Item helpers ---------------------------------------------------------

  const setItem = (idx: number, patch: Partial<ItemForm>) =>
    setForm((f) => ({ ...f, items: f.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }));
  const removeItem = (idx: number) =>
    setForm((f) => ({ ...f, items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items }));

  // Light preview: net line totals before tax & template-level discount.
  const itemsSubtotal = useMemo(() => {
    return form.items.reduce((sum, it) => {
      const qty = Number(it.quantity) || 0;
      const days = Number(it.days) || 0;
      const price = Number(it.unitPrice) || 0;
      const gross = qty * days * price;
      const dv = Number(it.discountValue) || 0;
      const disc = it.discountType === 'percentage' ? (gross * dv) / 100 : it.discountType === 'fixed' ? dv : 0;
      return sum + Math.max(0, gross - disc);
    }, 0);
  }, [form.items]);

  // --- Submit ---------------------------------------------------------------

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('Template name is required.');
      return;
    }
    const items = form.items
      .filter((it) => it.description.trim())
      .map((it) => ({
        description: it.description.trim(),
        quantity: Number(it.quantity) || 0,
        days: Number(it.days) || 1,
        unitPrice: Number(it.unitPrice) || 0,
        taxable: it.taxable,
        discountType: it.discountType,
        discountValue: Number(it.discountValue) || 0,
        productId: null,
      }));
    if (items.length === 0) {
      setFormError('Add at least one line item with a description.');
      return;
    }
    if (items.some((it) => it.quantity <= 0)) {
      setFormError('Each line item needs a quantity greater than zero.');
      return;
    }

    const taxPercent = Number(form.taxPercent) || 0;
    if (taxPercent < 0 || taxPercent > 100) {
      setFormError('Tax rate must be between 0 and 100%.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      taxRate: taxPercent / 100,
      currency: form.currency,
      terms: form.terms.trim() || null,
      notes: form.notes.trim() || null,
      discountType: 'none',
      discountValue: 0,
      items,
    };

    setBusy(true);
    setFormError(null);
    try {
      const url = editingId ? `/api/quotes/templates/${editingId}` : '/api/quotes/templates';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setFormError(data?.error ?? 'Could not save the template.');
        setBusy(false);
        return;
      }
      await refresh();
      setEditorOpen(false);
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (template: TemplateOption) => {
    if (!confirm(`Delete template "${template.name}"?`)) return;
    try {
      const response = await fetch(`/api/quotes/templates/${template.id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete');
        return;
      }
      setTemplates((current) => current.filter((t) => t.id !== template.id));
    } catch {
      setError('Network error');
    }
  };

  // --- Render ---------------------------------------------------------------

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95"
          style={{ backgroundColor: BRAND }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New template
        </button>
      </div>

      {error && <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {templates.length === 0 ? (
        <div className="bg-white rounded-2xl p-10 text-center border border-dashed border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">No templates yet</h3>
          <p className="text-gray-500 mt-2 text-sm">
            Click “New template” to build one, or save a setup from the quote builder.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {templates.map((template) => (
            <div key={template.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <button onClick={() => openEdit(template)} className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold text-gray-900">{template.name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {template.items.length} line item{template.items.length === 1 ? '' : 's'} • {template.currency} • tax{' '}
                  {(template.taxRate * 100).toFixed(2)}%
                  {template.discountType !== 'none' ? ` • discount ${template.discountType}` : ''}
                </p>
                {template.description && <p className="text-xs text-gray-500 mt-1 truncate">{template.description}</p>}
              </button>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => openEdit(template)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#03458f] hover:bg-blue-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(template)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
              <h2 className="text-lg font-semibold text-gray-900">{editingId ? 'Edit template' : 'New template'}</h2>
              <button onClick={() => setEditorOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={save} className="p-6 space-y-4">
              {formError && <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">{formError}</div>}

              <div>
                <Label>Template name *</Label>
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Standard close-protection package" autoFocus />
              </div>

              <div>
                <Label>Description</Label>
                <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional summary" />
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Line items *</Label>
                  <span className="text-xs text-gray-400">Subtotal {money(itemsSubtotal, form.currency)}</span>
                </div>
                <div className="space-y-2">
                  {form.items.map((it, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 p-3 bg-gray-50/50">
                      <div className="flex items-start gap-2">
                        <span className="flex h-6 w-6 mt-1 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500">{i + 1}</span>
                        <div className="flex-1 space-y-2">
                          <input className={smallInput} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Item description" />
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <div>
                              <MiniLabel>Qty</MiniLabel>
                              <input type="number" min={0} step="any" className={smallInput} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} />
                            </div>
                            <div>
                              <MiniLabel>Days</MiniLabel>
                              <input type="number" min={0} step="any" className={smallInput} value={it.days} onChange={(e) => setItem(i, { days: e.target.value })} />
                            </div>
                            <div>
                              <MiniLabel>Cost</MiniLabel>
                              <input type="number" min={0} step="any" className={smallInput} value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} />
                            </div>
                            <div>
                              <MiniLabel>Discount</MiniLabel>
                              <select className={smallInput} value={it.discountType} onChange={(e) => setItem(i, { discountType: e.target.value as DiscountType })}>
                                {DISCOUNT_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                              </select>
                            </div>
                            <div>
                              <MiniLabel>Disc. value</MiniLabel>
                              <input type="number" min={0} step="any" disabled={it.discountType === 'none'} className={`${smallInput} disabled:opacity-50`} value={it.discountValue} onChange={(e) => setItem(i, { discountValue: e.target.value })} />
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                            <input type="checkbox" checked={it.taxable} onChange={(e) => setItem(i, { taxable: e.target.checked })} className="w-3.5 h-3.5 rounded accent-[#03458f]" />
                            Taxable
                          </label>
                        </div>
                        <button type="button" onClick={() => removeItem(i)} className="p-1.5 mt-1 text-gray-300 hover:text-rose-500" aria-label="Remove item">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addItem} className="mt-2 text-sm font-semibold text-[#03458f] hover:underline">+ Add line item</button>
              </div>

              {/* Totals config */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Label>Currency</Label>
                  <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                    {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Tax %</Label>
                  <input type="number" min={0} max={100} step="any" className={inputClass} value={form.taxPercent} onChange={(e) => setForm({ ...form, taxPercent: e.target.value })} />
                </div>
              </div>

              <div>
                <Label>Terms</Label>
                <textarea rows={2} className={`${inputClass} resize-none`} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Payment terms, validity, etc." />
              </div>
              <div>
                <Label>Notes</Label>
                <textarea rows={2} className={`${inputClass} resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setEditorOpen(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50" style={{ backgroundColor: BRAND }}>
                  {busy ? 'Saving…' : editingId ? 'Save template' : 'Create template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 mb-1.5 block">{children}</label>;
}
function MiniLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[11px] text-gray-400 mb-1 block">{children}</label>;
}
