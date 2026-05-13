'use client';

import { useEffect, useMemo, useState } from 'react';

import type {
  ApproverOption,
  CustomerOption,
  DiscountType,
  OrganizationBranding,
  ProductOption,
  QuoteDetail,
  TemplateOption,
} from './types';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

interface QuoteBuilderProps {
  mode: 'create' | 'edit';
  quote: QuoteDetail | null;
  customers: CustomerOption[];
  approvers: ApproverOption[];
  products: ProductOption[];
  templates: TemplateOption[];
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
    unitPrice: '0',
    taxable: true,
    discountType: 'none',
    discountValue: '0',
    productId: null,
  };
}

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

export default function QuoteBuilder({
  mode,
  quote,
  customers,
  approvers,
  products,
  templates,
  organization,
  onClose,
  onSaved,
  onCustomerCreated,
  onTemplateCreated,
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
  const [currency, setCurrency] = useState<string>(
    quote?.currency ?? organization.defaultCurrency ?? 'USD',
  );
  const [taxRatePct, setTaxRatePct] = useState<string>(
    quote
      ? String(round2(quote.taxRate * 100))
      : String(round2((organization.defaultTaxRate ?? 0) * 100)),
  );
  const [quoteDiscountType, setQuoteDiscountType] = useState<DiscountType>(
    quote?.discountType ?? 'none',
  );
  const [quoteDiscountValue, setQuoteDiscountValue] = useState<string>(
    quote ? String(quote.discountValue) : '0',
  );
  const [notes, setNotes] = useState<string>(quote?.notes ?? '');
  const [terms, setTerms] = useState<string>(quote?.terms ?? '');
  const [items, setItems] = useState<ItemDraft[]>(
    quote && quote.items.length > 0
      ? quote.items.map((item) => ({
          key: makeKey(),
          description: item.description,
          quantity: String(item.quantity),
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
      const unit = Number(item.unitPrice) || 0;
      const gross = qty * unit;
      const discountValue = Number(item.discountValue) || 0;
      let lineDiscount = 0;
      if (item.discountType === 'percentage') {
        lineDiscount = (gross * discountValue) / 100;
      } else if (item.discountType === 'fixed') {
        lineDiscount = discountValue;
      }
      lineDiscount = clamp(round2(lineDiscount), round2(gross));
      const net = round2(gross - lineDiscount);
      return { net, taxable: item.taxable };
    });

    const subtotal = round2(lineSummaries.reduce((acc, line) => acc + line.net, 0));
    const taxableSubtotal = lineSummaries.reduce(
      (acc, line) => (line.taxable ? acc + line.net : acc),
      0,
    );
    const taxRate = (Number(taxRatePct) || 0) / 100;
    const tax = round2(taxableSubtotal * taxRate);
    const preDiscount = round2(subtotal + tax);

    let quoteDiscount = 0;
    const dv = Number(quoteDiscountValue) || 0;
    if (quoteDiscountType === 'percentage') quoteDiscount = (preDiscount * dv) / 100;
    else if (quoteDiscountType === 'fixed') quoteDiscount = dv;
    quoteDiscount = clamp(round2(quoteDiscount), preDiscount);

    const total = round2(preDiscount - quoteDiscount);
    return { subtotal, tax, taxRate, quoteDiscount, total };
  }, [items, taxRatePct, quoteDiscountType, quoteDiscountValue]);

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
    setQuoteDiscountType(template.discountType);
    setQuoteDiscountValue(String(template.discountValue));
    if (template.terms) setTerms(template.terms);
    if (template.notes) setNotes(template.notes);
    if (template.items.length > 0) {
      setItems(
        template.items.map((item) => ({
          key: makeKey(),
          description: item.description,
          quantity: String(item.quantity),
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
      unitPrice: Number(item.unitPrice),
      taxable: item.taxable,
      discountType: item.discountType,
      discountValue: Number(item.discountValue) || 0,
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
      currency,
      taxRate: (Number(taxRatePct) || 0) / 100,
      discountType: quoteDiscountType,
      discountValue: Number(quoteDiscountValue) || 0,
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
          discountType: quoteDiscountType,
          discountValue: Number(quoteDiscountValue) || 0,
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

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-40"
        onClick={() => (submitting ? null : onClose())}
      />
      <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 pointer-events-none">
        <div className="bg-white w-full max-w-4xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto rounded-none sm:rounded-[2rem] shadow-2xl pointer-events-auto">
          <div className="p-6 sm:p-8 border-b border-gray-100 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
            <div>
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.3em]">
                {mode === 'edit' ? 'Edit Quotation' : 'New Quotation'}
              </p>
              <h2 className="mt-1 text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                {mode === 'edit' && quote ? `Editing ${quote.reference}` : 'Build a proposal'}
              </h2>
              {organization.companyName && (
                <p className="text-[10px] sm:text-xs font-bold text-gray-500 mt-1">
                  Issued by {organization.companyName}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 rounded-xl"
              aria-label="Close builder"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-6 sm:space-y-8">
            {mode === 'create' && templates.length > 0 && (
              <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
                      Start from a template
                    </p>
                    <p className="text-xs text-emerald-900 mt-1">
                      Pre-fills currency, tax, terms, and line items.
                    </p>
                  </div>
                  <select
                    onChange={(event) => {
                      const id = Number(event.target.value);
                      const template = templates.find((t) => t.id === id);
                      if (template) applyTemplate(template);
                      event.target.value = '';
                    }}
                    defaultValue=""
                    className="px-3 py-2 bg-white border border-emerald-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
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
              </div>
            )}

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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
                    className="px-3 sm:px-4 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-gray-50 whitespace-nowrap"
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                      placeholder="Physical address"
                      value={customerDraft.address}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, address: event.target.value }))
                      }
                      className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="text"
                      placeholder="Billing address"
                      value={customerDraft.billingAddress}
                      onChange={(event) =>
                        setCustomerDraft((current) => ({ ...current, billingAddress: event.target.value }))
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

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  {COMMON_CURRENCIES.includes(currency) ? null : <option value={currency}>{currency}</option>}
                  {COMMON_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  {organization.taxLabel || 'Tax'} rate (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRatePct}
                  onChange={(event) => setTaxRatePct(event.target.value)}
                  className="mt-2 w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
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
                  const qty = Number(item.quantity) || 0;
                  const unit = Number(item.unitPrice) || 0;
                  const gross = qty * unit;
                  const dv = Number(item.discountValue) || 0;
                  let lineDiscount = 0;
                  if (item.discountType === 'percentage') lineDiscount = (gross * dv) / 100;
                  else if (item.discountType === 'fixed') lineDiscount = dv;
                  lineDiscount = clamp(round2(lineDiscount), round2(gross));
                  const net = round2(gross - lineDiscount);
                  return (
                    <div
                      key={item.key}
                      className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3"
                    >
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-12 md:col-span-6">
                          <input
                            type="text"
                            placeholder="Description"
                            value={item.description}
                            onChange={(event) =>
                              updateItem(item.key, { description: event.target.value, productId: null })
                            }
                            className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                          />
                          {products.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setProductPickerForKey((current) =>
                                  current === item.key ? null : item.key,
                                )
                              }
                              className="mt-1 text-[10px] font-black text-emerald-700 uppercase tracking-widest hover:text-emerald-900"
                            >
                              {productPickerForKey === item.key ? 'Hide catalog' : '+ Insert from catalog'}
                            </button>
                          )}
                        </div>
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
                          onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                          className="col-span-4 md:col-span-2 px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                        />
                        <p className="col-span-3 md:col-span-1 text-right text-sm font-black text-gray-900">
                          {formatMoney(net, currency)}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeItem(item.key)}
                          className="col-span-1 p-2 text-gray-300 hover:text-rose-600 rounded-xl"
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

                      <div className="grid grid-cols-12 gap-2 items-center">
                        <label className="col-span-12 md:col-span-3 flex items-center gap-2 text-[11px] font-bold text-gray-700">
                          <input
                            type="checkbox"
                            checked={item.taxable}
                            onChange={(event) => updateItem(item.key, { taxable: event.target.checked })}
                            className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          Taxable
                        </label>
                        <select
                          value={item.discountType}
                          onChange={(event) =>
                            updateItem(item.key, { discountType: event.target.value as DiscountType })
                          }
                          className="col-span-6 md:col-span-3 px-3 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="none">No discount</option>
                          <option value="percentage">% discount</option>
                          <option value="fixed">Fixed discount</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Discount"
                          value={item.discountValue}
                          disabled={item.discountType === 'none'}
                          onChange={(event) => updateItem(item.key, { discountValue: event.target.value })}
                          className="col-span-6 md:col-span-3 px-3 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
                        />
                        <p className="col-span-12 md:col-span-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                          Gross {formatMoney(round2(gross), currency)} − discount {formatMoney(lineDiscount, currency)}
                        </p>
                      </div>

                      {productPickerForKey === item.key && (
                        <div className="bg-white rounded-xl border border-gray-200 max-h-56 overflow-y-auto">
                          {products.map((product) => (
                            <button
                              key={product.id}
                              type="button"
                              onClick={() => applyProduct(item.key, product)}
                              className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-gray-100 last:border-b-0"
                            >
                              <p className="text-sm font-bold text-gray-900">{product.name}</p>
                              <p className="text-[10px] text-gray-500">
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
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-3">
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Notes (internal)
                </label>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                />
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Terms & conditions (shown to client)
                </label>
                <textarea
                  value={terms}
                  onChange={(event) => setTerms(event.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="bg-gray-50 rounded-2xl p-5 space-y-4">
                <div>
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                    Quote-level discount
                  </label>
                  <div className="mt-2 flex gap-2">
                    <select
                      value={quoteDiscountType}
                      onChange={(event) => setQuoteDiscountType(event.target.value as DiscountType)}
                      className="flex-1 px-3 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="none">None</option>
                      <option value="percentage">% of total</option>
                      <option value="fixed">Fixed amount</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={quoteDiscountValue}
                      disabled={quoteDiscountType === 'none'}
                      onChange={(event) => setQuoteDiscountValue(event.target.value)}
                      className="w-24 px-3 py-2 bg-white rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-200 space-y-1">
                  <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
                  <Row
                    label={`${organization.taxLabel || 'Tax'} (${(totals.taxRate * 100).toFixed(2)}%)`}
                    value={formatMoney(totals.tax, currency)}
                  />
                  {quoteDiscountType !== 'none' && totals.quoteDiscount > 0 && (
                    <Row
                      label={`Discount${quoteDiscountType === 'percentage' ? ` (${quoteDiscountValue}%)` : ''}`}
                      value={`- ${formatMoney(totals.quoteDiscount, currency)}`}
                    />
                  )}
                  <div className="flex justify-between text-sm font-black text-gray-900 pt-2 border-t border-gray-200">
                    <span>Total</span>
                    <span className="text-emerald-600">{formatMoney(totals.total, currency)}</span>
                  </div>
                </div>
              </div>
            </section>

            {showTemplateForm ? (
              <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                  Save as reusable template
                </p>
                <input
                  type="text"
                  placeholder="Template name"
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  className="w-full px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
                {templateError && <p className="text-xs font-bold text-rose-600">{templateError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTemplateForm(false)}
                    className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAsTemplate}
                    disabled={submitting !== null}
                    className="flex-1 px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black disabled:opacity-50"
                  >
                    {submitting === 'template' ? 'Saving…' : 'Save template'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowTemplateForm(true)}
                className="text-xs font-black text-gray-500 uppercase tracking-widest hover:text-gray-900"
              >
                + Save current setup as a template
              </button>
            )}

            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div className="p-4 sm:p-6 border-t border-gray-100 flex flex-col sm:flex-row gap-3 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting !== null}
              className="sm:ml-auto px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50"
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs font-bold text-gray-500">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
