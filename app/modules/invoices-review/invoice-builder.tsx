'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type {
  ApproverOption,
  BrandProfileOption,
  CustomerOption,
  DiscountType,
  InvoiceDetail,
  OrganizationBranding,
  ProductOption,
} from './types';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

const TERMS_PRESETS = [
  { label: 'Due on receipt', days: 0 },
  { label: 'Net 7', days: 7 },
  { label: 'Net 14', days: 14 },
  { label: 'Net 30', days: 30 },
  { label: 'Net 60', days: 60 },
];

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';
const sectionTitleClass = 'text-sm font-semibold text-gray-900';

interface InvoiceBuilderProps {
  mode: 'create' | 'edit';
  invoice: InvoiceDetail | null;
  customers: CustomerOption[];
  products: ProductOption[];
  brandProfiles: BrandProfileOption[];
  organization: OrganizationBranding;
  approvers: ApproverOption[];
  onClose: () => void;
  onSaved: (invoice: InvoiceDetail) => void;
  onCustomerCreated: (customer: CustomerOption) => void;
}

interface ItemDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxable: boolean;
  productId: number | null;
}

function makeKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyItem(): ItemDraft {
  return { key: makeKey(), description: '', quantity: '1', unitPrice: '0', taxable: true, productId: null };
}

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function InvoiceBuilder({
  mode,
  invoice,
  customers,
  products,
  brandProfiles,
  organization,
  approvers,
  onClose,
  onSaved,
  onCustomerCreated,
}: InvoiceBuilderProps) {
  const defaultBrandId = brandProfiles.find((b) => b.isDefault)?.id ?? null;
  const initialDiff = invoice
    ? Math.round(
        (new Date(invoice.dueDate).getTime() - new Date(invoice.issueDate).getTime()) /
          (24 * 3600 * 1000),
      )
    : 14;

  const [customerId, setCustomerId] = useState(invoice?.customer.id ? String(invoice.customer.id) : '');
  const [brandProfileId, setBrandProfileId] = useState(
    invoice?.brandProfile?.id
      ? String(invoice.brandProfile.id)
      : mode === 'create' && defaultBrandId
        ? String(defaultBrandId)
        : '',
  );
  const [issueDate, setIssueDate] = useState(invoice ? invoice.issueDate.slice(0, 10) : todayIso());
  const [termsPreset, setTermsPreset] = useState(
    invoice
      ? TERMS_PRESETS.find((p) => p.days === initialDiff)?.label ?? 'Custom'
      : 'Net 14',
  );
  const [dueDate, setDueDate] = useState(
    invoice ? invoice.dueDate.slice(0, 10) : addDaysIso(todayIso(), 14),
  );
  const [currency, setCurrency] = useState(invoice?.currency ?? organization.defaultCurrency ?? 'USD');
  const [taxRatePct, setTaxRatePct] = useState(
    invoice ? String(round2(invoice.taxRate * 100)) : String(round2((organization.defaultTaxRate ?? 0) * 100)),
  );
  const [notes, setNotes] = useState(invoice?.notes ?? '');
  const [terms, setTerms] = useState(invoice?.terms ?? '');
  const [items, setItems] = useState<ItemDraft[]>(
    invoice && invoice.items.length > 0
      ? invoice.items.map((item) => ({
          key: makeKey(),
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          taxable: item.taxable,
          productId: item.productId,
        }))
      : [emptyItem()],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'draft' | 'submit' | null>(null);
  const [approverId, setApproverId] = useState<string>(invoice?.approver?.id ? String(invoice.approver.id) : '');

  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerDraft, setCustomerDraft] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    address: '',
    billingAddress: '',
  });
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [productPickerForKey, setProductPickerForKey] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const applyIssueDate = (value: string) => {
    setIssueDate(value);
    const preset = TERMS_PRESETS.find((p) => p.label === termsPreset);
    if (preset && value) setDueDate(addDaysIso(value, preset.days));
  };

  const applyTermsPreset = (label: string) => {
    setTermsPreset(label);
    const preset = TERMS_PRESETS.find((p) => p.label === label);
    if (preset && issueDate) setDueDate(addDaysIso(issueDate, preset.days));
  };

  const totals = useMemo(() => {
    const lines = items.map((item) => {
      const qty = Number(item.quantity) || 0;
      const unit = Number(item.unitPrice) || 0;
      return { net: round2(qty * unit), taxable: item.taxable };
    });
    const subtotal = round2(lines.reduce((acc, l) => acc + l.net, 0));
    const taxable = lines.reduce((acc, l) => (l.taxable ? acc + l.net : acc), 0);
    const taxRate = (Number(taxRatePct) || 0) / 100;
    const tax = round2(taxable * taxRate);
    return { subtotal, tax, taxRate, total: round2(subtotal + tax) };
  }, [items, taxRatePct]);

  const updateItem = (key: string, patch: Partial<Omit<ItemDraft, 'key'>>) => {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const removeItem = (key: string) => {
    setItems((current) => (current.length === 1 ? current : current.filter((item) => item.key !== key)));
  };

  const applyProduct = (key: string, product: ProductOption) => {
    updateItem(key, {
      description: product.name,
      unitPrice: String(product.defaultUnitPrice),
      taxable: product.taxable,
      productId: product.id,
    });
    setProductPickerForKey(null);
  };

  const collectItemsPayload = () =>
    items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      taxable: item.taxable,
      discountType: 'none' as DiscountType,
      discountValue: 0,
      productId: item.productId,
    }));

  const handleSave = async (action: 'draft' | 'submit') => {
    setError(null);
    const numericCustomerId = Number(customerId);
    if (!Number.isInteger(numericCustomerId) || numericCustomerId <= 0) {
      setError('Pick a customer to bill');
      return;
    }
    const numericApproverId = approverId ? Number(approverId) : null;
    if (action === 'submit' && (!numericApproverId || numericApproverId <= 0)) {
      setError('Pick an approver before submitting for approval');
      return;
    }
    const itemsPayload = collectItemsPayload();
    const invalid = itemsPayload.find(
      (item) =>
        !item.description ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice < 0,
    );
    if (invalid) {
      setError('Each line needs a description, positive days, and a non-negative rate');
      return;
    }

    const payload = {
      customerId: numericCustomerId,
      brandProfileId: brandProfileId ? Number(brandProfileId) : null,
      issueDate,
      dueDate,
      currency,
      taxRate: (Number(taxRatePct) || 0) / 100,
      discountType: 'none',
      discountValue: 0,
      notes: notes.trim() || null,
      terms: terms.trim() || null,
      items: itemsPayload,
    };

    setSubmitting(action);
    try {
      const url = mode === 'edit' && invoice ? `/api/invoices/${invoice.id}` : '/api/invoices';
      const method = mode === 'edit' && invoice ? 'PATCH' : 'POST';
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { invoice?: InvoiceDetail; error?: string }
        | null;
      if (!response.ok || !data?.invoice) {
        setError(data?.error ?? 'Could not save the invoice');
        return;
      }

      let saved = data.invoice;
      if (action === 'submit') {
        const submitResponse = await fetch(`/api/invoices/${saved.id}/submit`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approverId: numericApproverId }),
        });
        const submitData = (await submitResponse.json().catch(() => null)) as
          | { invoice?: InvoiceDetail; error?: string }
          | null;
        if (!submitResponse.ok || !submitData?.invoice) {
          // The invoice itself was saved — surface the submit failure but keep the draft.
          setError(submitData?.error ?? 'Invoice saved as draft, but submitting for approval failed');
          onSaved(saved);
          return;
        }
        saved = submitData.invoice;
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
          billingAddress: customerDraft.billingAddress.trim() || null,
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
      setCustomerDraft({ name: '', email: '', phone: '', company: '', address: '', billingAddress: '' });
      setShowCustomerForm(false);
    } catch {
      setCustomerError('Network error. Try again.');
    } finally {
      setCreatingCustomer(false);
    }
  };

  const selectedBrand = brandProfiles.find((b) => String(b.id) === brandProfileId) ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm"
        onClick={() => (submitting ? null : onClose())}
      />
      <div className="fixed inset-0 z-50 flex items-stretch justify-center pointer-events-none sm:items-center sm:p-4">
        <div className="pointer-events-auto h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-6 py-5 sm:px-8">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-gray-900 sm:text-xl">
                {mode === 'edit' && invoice ? `Edit ${invoice.number}` : 'New invoice'}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                {mode === 'edit'
                  ? 'Update the details below and save.'
                  : 'Bill a customer — save as a draft or save and send.'}
              </p>
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
          </div>

          <div className="space-y-8 px-6 py-6 sm:px-8">
            {/* From / To */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              <div>
                <label className={labelClass}>From (your company)</label>
                {brandProfiles.length > 0 ? (
                  <div className="relative">
                    {selectedBrand && (
                      <span
                        className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ring-1 ring-black/5"
                        style={{ backgroundColor: selectedBrand.primaryColor }}
                      />
                    )}
                    <select
                      value={brandProfileId}
                      onChange={(event) => setBrandProfileId(event.target.value)}
                      className={`${inputClass} ${selectedBrand ? 'pl-8' : ''}`}
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
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500">
                    No companies yet —{' '}
                    <Link href="/modules/quotes/settings" className="font-semibold text-primary hover:underline">
                      add one in Settings
                    </Link>
                    .
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Bill to</label>
                  <button
                    type="button"
                    onClick={() => setShowCustomerForm((value) => !value)}
                    className="mb-1.5 text-xs font-semibold text-primary hover:text-primary/80"
                  >
                    {showCustomerForm ? 'Cancel' : '+ New customer'}
                  </button>
                </div>
                <select
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a customer…</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                      {customer.company ? ` — ${customer.company}` : ''}
                    </option>
                  ))}
                </select>
                {showCustomerForm && (
                  <div className="mt-3 space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <input
                      type="text"
                      placeholder="Customer name *"
                      value={customerDraft.name}
                      onChange={(e) => setCustomerDraft((c) => ({ ...c, name: e.target.value }))}
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        type="email"
                        placeholder="Email"
                        value={customerDraft.email}
                        onChange={(e) => setCustomerDraft((c) => ({ ...c, email: e.target.value }))}
                        className="rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <input
                        type="text"
                        placeholder="Phone"
                        value={customerDraft.phone}
                        onChange={(e) => setCustomerDraft((c) => ({ ...c, phone: e.target.value }))}
                        className="rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Company"
                      value={customerDraft.company}
                      onChange={(e) => setCustomerDraft((c) => ({ ...c, company: e.target.value }))}
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <input
                      type="text"
                      placeholder="Billing address"
                      value={customerDraft.billingAddress}
                      onChange={(e) => setCustomerDraft((c) => ({ ...c, billingAddress: e.target.value }))}
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    {customerError && <p className="text-xs font-medium text-rose-600">{customerError}</p>}
                    <button
                      type="button"
                      disabled={creatingCustomer}
                      onClick={handleCreateCustomer}
                      className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {creatingCustomer ? 'Saving…' : 'Save customer'}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Dates & terms */}
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className={labelClass}>Invoice date</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(event) => applyIssueDate(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Terms</label>
                <select
                  value={termsPreset}
                  onChange={(event) => applyTermsPreset(event.target.value)}
                  className={inputClass}
                >
                  {TERMS_PRESETS.map((preset) => (
                    <option key={preset.label} value={preset.label}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="Custom">Custom</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Approver</label>
                <select value={approverId} onChange={(event) => setApproverId(event.target.value)} className={inputClass}>
                  <option value="">Select approver…</option>
                  {approvers.map((approver) => (
                    <option key={approver.id} value={approver.id}>
                      {approver.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-gray-400">Required when you submit for approval.</p>
              </div>
              <div>
                <label className={labelClass}>Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => {
                    setDueDate(event.target.value);
                    setTermsPreset('Custom');
                  }}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Currency</label>
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className={inputClass}
                >
                  {COMMON_CURRENCIES.includes(currency) ? null : <option value={currency}>{currency}</option>}
                  {COMMON_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {/* Line items */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className={sectionTitleClass}>Line items</h3>
                <div className="w-36">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={taxRatePct}
                    onChange={(event) => setTaxRatePct(event.target.value)}
                    className="w-full rounded-lg bg-gray-50 px-3 py-1.5 text-right text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
                    aria-label="Tax rate percent"
                  />
                  <p className="mt-1 text-right text-[10px] text-gray-400">{organization.taxLabel || 'Tax'} rate (%)</p>
                </div>
              </div>
              <div className="space-y-2.5">
                {items.map((item, index) => {
                  const qty = Number(item.quantity) || 0;
                  const unit = Number(item.unitPrice) || 0;
                  const net = round2(qty * unit);
                  return (
                    <div key={item.key} className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Item {index + 1}</span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.key)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m1 0l-.5 12a2 2 0 01-2 2H9.5a2 2 0 01-2-2L7 7"
                              />
                            </svg>
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-12 items-center gap-2">
                        <div className="col-span-12 md:col-span-6">
                          <input
                            type="text"
                            placeholder={`Item ${index + 1} description`}
                            value={item.description}
                            onChange={(event) =>
                              updateItem(item.key, { description: event.target.value, productId: null })
                            }
                            className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          {products.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setProductPickerForKey((current) => (current === item.key ? null : item.key))
                              }
                              className="mt-1.5 text-xs font-medium text-primary hover:text-primary/80"
                            >
                              {productPickerForKey === item.key ? 'Hide catalog' : '+ Insert from catalog'}
                            </button>
                          )}
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Days"
                          value={item.quantity}
                          onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                          className="col-span-4 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 md:col-span-2"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Rate"
                          value={item.unitPrice}
                          onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                          className="col-span-4 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 md:col-span-2"
                        />
                        <p className="col-span-4 text-right text-sm font-semibold text-gray-900 md:col-span-2">
                          {formatMoney(net, currency)}
                        </p>
                      </div>
                      <label className="flex w-fit items-center gap-2 text-xs font-medium text-gray-600">
                        <input
                          type="checkbox"
                          checked={item.taxable}
                          onChange={(event) => updateItem(item.key, { taxable: event.target.checked })}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                        />
                        Taxable
                      </label>
                      {productPickerForKey === item.key && (
                        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                          {products.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => applyProduct(item.key, product)}
                              className="w-full border-b border-gray-100 px-3 py-2 text-left last:border-b-0 hover:bg-primary/5"
                            >
                              <p className="text-sm font-medium text-gray-900">{product.name}</p>
                              <p className="text-xs text-gray-500">
                                {formatMoney(product.defaultUnitPrice, product.currency)}
                                {product.sku ? ` • SKU ${product.sku}` : ''}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setItems((current) => [...current, emptyItem()])}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-semibold text-gray-500 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                </svg>
                Add line item
              </button>
            </section>

            {/* Notes / terms / totals */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-4 md:col-span-2">
                <div>
                  <label className={labelClass}>Message on invoice</label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    placeholder="Thank you for your business."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Terms &amp; conditions</label>
                  <textarea
                    value={terms}
                    onChange={(event) => setTerms(event.target.value)}
                    rows={3}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50/60 p-5">
                <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
                <Row
                  label={`${organization.taxLabel || 'Tax'} (${(totals.taxRate * 100).toFixed(2)}%)`}
                  value={formatMoney(totals.tax, currency)}
                />
                <div className="flex items-center justify-between border-t border-gray-200 pt-2.5">
                  <span className="text-sm font-semibold text-gray-900">Total</span>
                  <span className="text-lg font-bold text-primary">{formatMoney(totals.total, currency)}</span>
                </div>
              </div>
            </section>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-gray-100 bg-white px-6 py-4 sm:flex-row sm:px-8">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting !== null}
              className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 sm:ml-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave('draft')}
              disabled={submitting !== null}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {submitting === 'draft' ? 'Saving…' : 'Save as draft'}
            </button>
            <button
              type="button"
              onClick={() => handleSave('submit')}
              disabled={submitting !== null}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting === 'submit' ? 'Saving…' : 'Save & submit for approval'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs text-gray-500">
      <span>{label}</span>
      <span className="font-medium text-gray-700">{value}</span>
    </div>
  );
}
