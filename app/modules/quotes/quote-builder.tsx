'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type {
  ApproverOption,
  BrandProfileOption,
  CustomerOption,
  DiscountType,
  OrganizationBranding,
  ProductOption,
  QuoteDetail,
  TemplateOption,
} from './types';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';
const sectionTitleClass = 'text-sm font-semibold text-gray-900';

interface QuoteBuilderProps {
  mode: 'create' | 'edit';
  quote: QuoteDetail | null;
  customers: CustomerOption[];
  approvers: ApproverOption[];
  products: ProductOption[];
  templates: TemplateOption[];
  brandProfiles: BrandProfileOption[];
  organization: OrganizationBranding;
  onClose: () => void;
  onSaved: (quote: QuoteDetail) => void;
  onCustomerCreated: (customer: CustomerOption) => void;
  onTemplateCreated: (template: TemplateOption) => void;
}

interface ItemDraft {
  key: string;
  description: string;
  quantity: string;
  days: string;
  unitPrice: string;
  taxable: boolean;
  discountType: DiscountType;
  discountValue: string;
  productId: number | null;
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
  return {
    key: makeKey(),
    description: '',
    quantity: '1',
    days: '1',
    unitPrice: '0',
    taxable: true,
    discountType: 'none',
    discountValue: '0',
    productId: null,
  };
}

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function QuoteBuilder({
  mode,
  quote,
  customers,
  approvers,
  products,
  templates,
  brandProfiles,
  organization,
  onClose,
  onSaved,
  onCustomerCreated,
  onTemplateCreated,
}: QuoteBuilderProps) {
  const defaultBrandId = brandProfiles.find((b) => b.isDefault)?.id ?? null;
  const [customerId, setCustomerId] = useState<string>(
    quote?.customer.id ? String(quote.customer.id) : '',
  );
  const [brandProfileId, setBrandProfileId] = useState<string>(
    quote?.brandProfile?.id
      ? String(quote.brandProfile.id)
      : mode === 'create' && defaultBrandId
        ? String(defaultBrandId)
        : '',
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
  const [currency, setCurrency] = useState<string>(
    quote?.currency ?? organization.defaultCurrency ?? 'USD',
  );
  const [taxRatePct, setTaxRatePct] = useState<string>(
    quote
      ? String(round2(quote.taxRate * 100))
      : String(round2((organization.defaultTaxRate ?? 0) * 100)),
  );
  const [notes, setNotes] = useState<string>(quote?.notes ?? '');
  const [terms, setTerms] = useState<string>(quote?.terms ?? '');
  const [items, setItems] = useState<ItemDraft[]>(
    quote && quote.items.length > 0
      ? quote.items.map((item) => ({
          key: makeKey(),
          description: item.description,
          quantity: String(item.quantity),
          days: String(item.days ?? 1),
          unitPrice: String(item.unitPrice),
          taxable: item.taxable,
          discountType: item.discountType,
          discountValue: String(item.discountValue),
          productId: item.productId,
        }))
      : [emptyItem()],
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<'save' | 'submit' | 'template' | null>(null);

  // Customer creation
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

  // Product picker for items
  const [productPickerForKey, setProductPickerForKey] = useState<string | null>(null);

  // Save-as-template
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const totals = useMemo(() => {
    const lineSummaries = items.map((item) => {
      const qty = Number(item.quantity) || 0;
      const days = Number(item.days) || 0;
      const unit = Number(item.unitPrice) || 0;
      const net = round2(qty * days * unit);
      return { net, taxable: item.taxable };
    });

    const subtotal = round2(lineSummaries.reduce((acc, line) => acc + line.net, 0));
    const taxableSubtotal = lineSummaries.reduce(
      (acc, line) => (line.taxable ? acc + line.net : acc),
      0,
    );
    const taxRate = (Number(taxRatePct) || 0) / 100;
    const tax = round2(taxableSubtotal * taxRate);
    const total = round2(subtotal + tax);
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

  const applyProduct = (key: string, product: ProductOption) => {
    updateItem(key, {
      description: product.name,
      unitPrice: String(product.defaultUnitPrice),
      taxable: product.taxable,
      productId: product.id,
    });
    setProductPickerForKey(null);
  };

  const applyTemplate = (template: TemplateOption) => {
    setCurrency(template.currency);
    setTaxRatePct(String(round2(template.taxRate * 100)));
    if (template.terms) setTerms(template.terms);
    if (template.notes) setNotes(template.notes);
    if (template.items.length > 0) {
      setItems(
        template.items.map((item) => ({
          key: makeKey(),
          description: item.description,
          quantity: String(item.quantity),
          days: String(item.days ?? 1),
          unitPrice: String(item.unitPrice),
          taxable: item.taxable,
          discountType: item.discountType,
          discountValue: String(item.discountValue),
          productId: item.productId,
        })),
      );
    }
  };

  const collectItemsPayload = () =>
    items.map((item) => ({
      description: item.description.trim(),
      quantity: Number(item.quantity),
      days: Number(item.days),
      unitPrice: Number(item.unitPrice),
      taxable: item.taxable,
      discountType: 'none' as DiscountType,
      discountValue: 0,
      productId: item.productId,
    }));

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

    const itemsPayload = collectItemsPayload();
    const invalidItem = itemsPayload.find(
      (item) =>
        !item.description ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.days) ||
        item.days <= 0 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice < 0,
    );
    if (invalidItem) {
      setError('Each line item needs a description, positive quantity, positive days, and non-negative cost');
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
      brandProfileId: brandProfileId ? Number(brandProfileId) : null,
      subject: subject.trim(),
      issueDate,
      expiryDate,
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
      const url = mode === 'edit' && quote ? `/api/quotes/${quote.id}` : '/api/quotes';
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

  const handleSaveAsTemplate = async () => {
    setTemplateError(null);
    if (!templateName.trim()) {
      setTemplateError('Template name is required');
      return;
    }
    const itemsPayload = collectItemsPayload();
    if (itemsPayload.some((item) => !item.description || item.quantity <= 0)) {
      setTemplateError('Add at least one valid line item before saving a template');
      return;
    }

    setSubmitting('template');
    try {
      const response = await fetch('/api/quotes/templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName.trim(),
          description: null,
          taxRate: (Number(taxRatePct) || 0) / 100,
          currency,
          terms: terms.trim() || null,
          notes: notes.trim() || null,
          discountType: 'none',
          discountValue: 0,
          items: itemsPayload,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { template?: TemplateOption; error?: string }
        | null;
      if (!response.ok || !data?.template) {
        setTemplateError(data?.error ?? 'Could not save template');
        return;
      }
      onTemplateCreated(data.template);
      setTemplateName('');
      setShowTemplateForm(false);
    } catch {
      setTemplateError('Network error. Try again.');
    } finally {
      setSubmitting(null);
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
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-6 py-5 sm:px-8">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-gray-900 sm:text-xl">
                {mode === 'edit' && quote ? `Edit ${quote.reference}` : 'New quotation'}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                {mode === 'edit'
                  ? 'Update the details below and save.'
                  : 'Fill in the details, add line items, then save or submit for approval.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close builder"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-8 px-6 py-6 sm:px-8">
            {mode === 'create' && templates.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-primary">Start from a template</p>
                  <p className="text-xs text-primary/70">Pre-fills currency, tax, terms, and line items.</p>
                </div>
                <select
                  onChange={(event) => {
                    const id = Number(event.target.value);
                    const template = templates.find((t) => t.id === id);
                    if (template) applyTemplate(template);
                    event.target.value = '';
                  }}
                  defaultValue=""
                  className="rounded-lg border border-primary/20 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="" disabled>
                    Apply a template…
                  </option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* From / To */}
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              <div>
                <label className={labelClass}>Issued by</label>
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
                        {organization.companyName
                          ? `${organization.companyName} (default)`
                          : 'Organization default'}
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
                    <Link
                      href="/modules/quotes/settings"
                      className="font-semibold text-primary hover:underline"
                    >
                      add one in Settings
                    </Link>
                    .
                  </div>
                )}
                <p className="mt-1.5 text-xs text-gray-400">
                  The company this quote comes from — its logo, address &amp; color appear on the proposal.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Prepared for</label>
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
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, name: event.target.value }))
                      }
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        type="email"
                        placeholder="Email"
                        value={customerDraft.email}
                        onChange={(event) =>
                          setCustomerDraft((current) => ({ ...current, email: event.target.value }))
                        }
                        className="rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <input
                        type="text"
                        placeholder="Phone"
                        value={customerDraft.phone}
                        onChange={(event) =>
                          setCustomerDraft((current) => ({ ...current, phone: event.target.value }))
                        }
                        className="rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <input
                      type="text"
                      placeholder="Company"
                      value={customerDraft.company}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, company: event.target.value }))
                      }
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <input
                      type="text"
                      placeholder="Physical address"
                      value={customerDraft.address}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, address: event.target.value }))
                      }
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <input
                      type="text"
                      placeholder="Billing address"
                      value={customerDraft.billingAddress}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, billingAddress: event.target.value }))
                      }
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

            {/* Subject + meta */}
            <section className="space-y-4">
              <div>
                <label className={labelClass}>Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="What is this quote for?"
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelClass}>Issue date</label>
                  <input
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Expiry date</label>
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(event) => setExpiryDate(event.target.value)}
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
                    {COMMON_CURRENCIES.includes(currency) ? null : (
                      <option value={currency}>{currency}</option>
                    )}
                    {COMMON_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{organization.taxLabel || 'Tax'} rate (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={taxRatePct}
                    onChange={(event) => setTaxRatePct(event.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Approver</label>
                <select
                  value={approverId}
                  onChange={(event) => setApproverId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">No approver yet</option>
                  {approvers.map((approver) => (
                    <option key={approver.id} value={approver.id}>
                      {approver.name} — {approver.email}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-gray-400">Required when you submit for approval.</p>
              </div>
            </section>

            {/* Line items */}
            <section>
              <h3 className={`${sectionTitleClass} mb-3`}>Line items</h3>
              <div className="space-y-2.5">
                {items.map((item, index) => {
                  const qty = Number(item.quantity) || 0;
                  const days = Number(item.days) || 0;
                  const unit = Number(item.unitPrice) || 0;
                  const net = round2(qty * days * unit);
                  return (
                    <div
                      key={item.key}
                      className="space-y-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5"
                    >
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

                      <div className="grid grid-cols-12 items-start gap-2">
                        <div className="col-span-12 md:col-span-4">
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Service / Description
                          </label>
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
                                setProductPickerForKey((current) =>
                                  current === item.key ? null : item.key,
                                )
                              }
                              className="mt-1.5 text-xs font-medium text-primary hover:text-primary/80"
                            >
                              {productPickerForKey === item.key ? 'Hide catalog' : '+ Insert from catalog'}
                            </button>
                          )}
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Qty
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Qty"
                            value={item.quantity}
                            onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                            className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Days
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="Days"
                            value={item.days}
                            onChange={(event) => updateItem(item.key, { days: event.target.value })}
                            className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                        <div className="col-span-3 md:col-span-2">
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Cost
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Cost"
                            value={item.unitPrice}
                            onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                            className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </div>
                        <div className="col-span-3 md:col-span-2 text-right">
                          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                            Sub-Total
                          </label>
                          <p className="py-2 text-sm font-semibold text-gray-900">{formatMoney(net, currency)}</p>
                        </div>
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
                                {product.taxable ? '' : ' • non-taxable'}
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
                  <label className={labelClass}>Notes (internal)</label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Terms &amp; conditions (shown to client)</label>
                  <textarea
                    value={terms}
                    onChange={(event) => setTerms(event.target.value)}
                    rows={4}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-4 rounded-xl border border-gray-100 bg-gray-50/60 p-5">
                <div className="space-y-1.5">
                  <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
                  <Row
                    label={`${organization.taxLabel || 'Tax'} (${(totals.taxRate * 100).toFixed(2)}%)`}
                    value={formatMoney(totals.tax, currency)}
                  />
                  <div className="flex items-center justify-between border-t border-gray-200 pt-2.5">
                    <span className="text-sm font-semibold text-gray-900">Total</span>
                    <span className="text-lg font-bold text-primary">
                      {formatMoney(totals.total, currency)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {showTemplateForm ? (
              <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className={sectionTitleClass}>Save as reusable template</p>
                <input
                  type="text"
                  placeholder="Template name"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {templateError && <p className="text-xs font-medium text-rose-600">{templateError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplateForm(false)}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAsTemplate}
                    disabled={submitting !== null}
                    className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {submitting === 'template' ? 'Saving…' : 'Save template'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTemplateForm(true)}
                className="text-sm font-medium text-gray-500 hover:text-gray-900"
              >
                + Save current setup as a template
              </button>
            )}

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
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
              onClick={() => handleSave('save')}
              disabled={submitting !== null}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {submitting === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={() => handleSave('submit')}
              disabled={submitting !== null}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting === 'submit' ? 'Submitting…' : 'Submit for approval'}
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
