'use client';

import { useEffect, useMemo, useState } from 'react';

import type {
  ApproverOption,
  CustomerOption,
  QuoteDetail,
} from './types';

interface QuoteBuilderProps {
  mode: 'create' | 'edit';
  quote: QuoteDetail | null;
  customers: CustomerOption[];
  approvers: ApproverOption[];
  onClose: () => void;
  onSaved: (quote: QuoteDetail) => void;
  onCustomerCreated: (customer: CustomerOption) => void;
}

interface ItemDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

function makeKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyItem(): ItemDraft {
  return { key: makeKey(), description: '', quantity: '1', unitPrice: '0' };
}

function formatMoney(value: number) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

export default function QuoteBuilder({
  mode,
  quote,
  customers,
  approvers,
  onClose,
  onSaved,
  onCustomerCreated,
}: QuoteBuilderProps) {
  const [customerId, setCustomerId] = useState<string>(
    quote?.customer.id ? String(quote.customer.id) : '',
  );
  const [approverId, setApproverId] = useState<string>(
    quote?.approver?.id ? String(quote.approver.id) : '',
  );
  const [subject, setSubject] = useState<string>(quote?.subject ?? '');
  const [issueDate, setIssueDate] = useState<string>(
    quote ? quote.issueDate.slice(0, 10) : todayIso(),
  );
  const [expiryDate, setExpiryDate] = useState<string>(
    quote ? quote.expiryDate.slice(0, 10) : plusDaysIso(30),
  );
  const [taxRatePct, setTaxRatePct] = useState<string>(
    quote ? String(Math.round(quote.taxRate * 10000) / 100) : '0',
  );
  const [notes, setNotes] = useState<string>(quote?.notes ?? '');
  const [items, setItems] = useState<ItemDraft[]>(
    quote && quote.items.length > 0
      ? quote.items.map((item) => ({
          key: makeKey(),
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
        }))
      : [emptyItem()],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'save' | 'submit' | null>(null);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerDraft, setCustomerDraft] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    address: '',
  });
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const totals = useMemo(() => {
    const numericItems = items.map((item) => ({
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    }));
    const subtotal = numericItems.reduce(
      (acc, item) => acc + item.quantity * item.unitPrice,
      0,
    );
    const taxRate = (Number(taxRatePct) || 0) / 100;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;
    return { subtotal, tax, taxRate, total };
  }, [items, taxRatePct]);

  const updateItem = (key: string, patch: Partial<Omit<ItemDraft, 'key'>>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const removeItem = (key: string) => {
    setItems((current) => (current.length === 1 ? current : current.filter((item) => item.key !== key)));
  };

  const handleSave = async (action: 'save' | 'submit') => {
    setError(null);

    const numericCustomerId = Number(customerId);
    if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) {
      setError('Pick a customer');
      return;
    }
    if (!subject.trim()) {
      setError('Subject is required');
      return;
    }

    const itemsPayload = items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    }));
    const invalidItem = itemsPayload.find(
      (item) =>
        !item.description ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice < 0,
    );
    if (invalidItem) {
      setError('Each line item needs a description, positive quantity and non-negative unit price');
      return;
    }

    const numericApproverId = approverId ? Number(approverId) : null;
    if (action === 'submit' && (!numericApproverId || numericApproverId <= 0)) {
      setError('Pick an approver before submitting for approval');
      return;
    }

    const payload = {
      customerId: numericCustomerId,
      approverId: numericApproverId,
      subject: subject.trim(),
      issueDate,
      expiryDate,
      taxRate: (Number(taxRatePct) || 0) / 100,
      notes: notes.trim() || null,
      items: itemsPayload,
    };

    setSubmitting(action);
    try {
      const url =
        mode === 'edit' && quote ? `/api/quotes/${quote.id}` : '/api/quotes';
      const method = mode === 'edit' && quote ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { quote?: QuoteDetail; error?: string }
        | null;
      if (!response.ok || !data?.quote) {
        setError(data?.error ?? 'Could not save the quote');
        return;
      }

      let saved = data.quote;

      if (action === 'submit') {
        const submitResponse = await fetch(`/api/quotes/${saved.id}/submit`, {
          method: 'POST',
          credentials: 'include',
        });
        const submitData = (await submitResponse.json().catch(() => null)) as
          | { quote?: QuoteDetail; error?: string }
          | null;
        if (!submitResponse.ok || !submitData?.quote) {
          setError(submitData?.error ?? 'Quote saved but could not be submitted');
          onSaved(saved);
          return;
        }
        saved = submitData.quote;
      }

      onSaved(saved);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateCustomer = async () => {
    setCustomerError(null);
    if (!customerDraft.name.trim()) {
      setCustomerError('Customer name is required');
      return;
    }
    setCreatingCustomer(true);
    try {
      const response = await fetch('/api/quotes/customers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customerDraft.name.trim(),
          email: customerDraft.email.trim(),
          phone: customerDraft.phone.trim() || null,
          company: customerDraft.company.trim() || null,
          address: customerDraft.address.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { customer?: CustomerOption; error?: string }
        | null;
      if (!response.ok || !data?.customer) {
        setCustomerError(data?.error ?? 'Could not create customer');
        return;
      }
      onCustomerCreated(data.customer);
      setCustomerId(String(data.customer.id));
      setCustomerDraft({ name: '', email: '', phone: '', company: '', address: '' });
      setShowCustomerForm(false);
    } catch {
      setCustomerError('Network error. Try again.');
    } finally {
      setCreatingCustomer(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-40"
        onClick={() => (submitting ? null : onClose())}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-[2rem] shadow-2xl pointer-events-auto">
          <div className="p-8 border-b border-gray-100 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
            <div>
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.3em]">
                {mode === 'edit' ? 'Edit Quotation' : 'New Quotation'}
              </p>
              <h2 className="mt-1 text-2xl font-black text-gray-900 tracking-tight">
                {mode === 'edit' && quote
                  ? `Editing ${quote.reference}`
                  : 'Build a proposal'}
              </h2>
              <p className="text-xs font-bold text-gray-500 mt-1">
                Save as a draft, or submit straight to your approver.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 rounded-xl"
              aria-label="Close builder"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div className="p-8 space-y-8">
            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Customer
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={customerId}
                    onChange={(event) => setCustomerId(event.target.value)}
                    className="flex-1 px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Select a customer…</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                        {customer.company ? ` — ${customer.company}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowCustomerForm((value) => !value)}
                    className="px-4 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-50"
                  >
                    {showCustomerForm ? 'Cancel' : '+ New'}
                  </button>
                </div>
                {showCustomerForm && (
                  <div className="mt-3 p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                    <input
                      type="text"
                      placeholder="Customer name *"
                      value={customerDraft.name}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="email"
                        placeholder="Email"
                        value={customerDraft.email}
                        onChange={(event) =>
                          setCustomerDraft((current) => ({ ...current, email: event.target.value }))
                        }
                        className="px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Phone"
                        value={customerDraft.phone}
                        onChange={(event) =>
                          setCustomerDraft((current) => ({ ...current, phone: event.target.value }))
                        }
                        className="px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Company"
                      value={customerDraft.company}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, company: event.target.value }))
                      }
                      className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="text"
                      placeholder="Address"
                      value={customerDraft.address}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, address: event.target.value }))
                      }
                      className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                    {customerError && (
                      <p className="text-xs font-bold text-rose-600">{customerError}</p>
                    )}
                    <button
                      type="button"
                      disabled={creatingCustomer}
                      onClick={handleCreateCustomer}
                      className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black disabled:opacity-50"
                    >
                      {creatingCustomer ? 'Saving…' : 'Save customer'}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Approver
                </label>
                <select
                  value={approverId}
                  onChange={(event) => setApproverId(event.target.value)}
                  className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">No approver yet</option>
                  {approvers.map((approver) => (
                    <option key={approver.id} value={approver.id}>
                      {approver.name} — {approver.email}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] font-bold text-gray-400 mt-2">
                  Required when you submit the quote for approval.
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="What is this quote for?"
                  className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Issue date
                </label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(event) => setIssueDate(event.target.value)}
                  className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Expiry date
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(event) => setExpiryDate(event.target.value)}
                  className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em]">
                  Line items
                </h3>
                <button
                  type="button"
                  onClick={() => setItems((current) => [...current, emptyItem()])}
                  className="text-xs font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-800"
                >
                  + Add item
                </button>
              </div>
              <div className="space-y-3">
                {items.map((item) => {
                  const lineTotal =
                    (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
                  return (
                    <div
                      key={item.key}
                      className="grid grid-cols-12 gap-3 items-center p-4 bg-gray-50 rounded-2xl border border-gray-100"
                    >
                      <input
                        type="text"
                        placeholder="Description"
                        value={item.description}
                        onChange={(event) =>
                          updateItem(item.key, { description: event.target.value })
                        }
                        className="col-span-12 md:col-span-5 px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                        className="col-span-4 md:col-span-2 px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Unit price"
                        value={item.unitPrice}
                        onChange={(event) =>
                          updateItem(item.key, { unitPrice: event.target.value })
                        }
                        className="col-span-4 md:col-span-2 px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                      />
                      <p className="col-span-3 md:col-span-2 text-right text-sm font-black text-gray-900">
                        {formatMoney(lineTotal)}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeItem(item.key)}
                        className="col-span-1 md:col-span-1 p-2 text-gray-300 hover:text-rose-600 rounded-xl"
                        aria-label="Remove line item"
                        disabled={items.length === 1}
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3"
                          />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-3">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Notes (internal)
                </label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="bg-gray-50 rounded-2xl p-5 space-y-3">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Tax rate (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRatePct}
                  onChange={(event) => setTaxRatePct(event.target.value)}
                  className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
                <div className="pt-3 border-t border-gray-200 space-y-1">
                  <div className="flex justify-between text-xs font-bold text-gray-500">
                    <span>Subtotal</span>
                    <span>{formatMoney(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-gray-500">
                    <span>Tax</span>
                    <span>{formatMoney(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-black text-gray-900 pt-2 border-t border-gray-200">
                    <span>Total</span>
                    <span className="text-emerald-600">{formatMoney(totals.total)}</span>
                  </div>
                </div>
              </div>
            </section>

            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div className="p-6 border-t border-gray-100 flex flex-col md:flex-row gap-3 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting !== null}
              className="md:ml-auto px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave('save')}
              disabled={submitting !== null}
              className="px-6 py-3 border-2 border-gray-900 text-gray-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50"
            >
              {submitting === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={() => handleSave('submit')}
              disabled={submitting !== null}
              className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting === 'submit' ? 'Submitting…' : 'Submit for approval'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
