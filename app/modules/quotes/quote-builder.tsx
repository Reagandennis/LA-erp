'use client';

import { useMemo, useState } from 'react';

import {
  AddItemButton,
  BrandSelect,
  BuilderFooter,
  BuilderShell,
  CatalogPicker,
  cellLabelClass,
  CustomerSelect,
  Field,
  formatMoney,
  ghostButton,
  inputClass,
  itemHeaderClass,
  ItemDescriptionInput,
  numberCellInputClass,
  PercentInput,
  primaryButton,
  RemoveItemButton,
  secondaryButton,
  Section,
  TaxableCheckbox,
  TotalsCard,
} from './builder-ui';
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

// Description | Qty | Days | Cost | Tax | Sub-total | remove — once the dialog is wide enough for a table.
const ITEM_COLUMNS = '@4xl:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_7rem_3.5rem_7.5rem_2.25rem]';

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
  const taxLabel = organization.taxLabel || 'Tax';

  // Product picker for items
  const [productPickerForKey, setProductPickerForKey] = useState<string | null>(null);

  // Save-as-template
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState<string | null>(null);

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

  return (
    <BuilderShell
      title={mode === 'edit' && quote ? `Edit ${quote.reference}` : 'New quotation'}
      subtitle={
        mode === 'edit'
          ? 'Update the details below and save.'
          : 'Fill in the details, add line items, then save or submit for approval.'
      }
      busy={submitting !== null}
      onClose={onClose}
      footer={
        <BuilderFooter error={error} totalLabel="Quote total" total={formatMoney(totals.total, currency)}>
          <button type="button" onClick={onClose} disabled={submitting !== null} className={ghostButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave('save')}
            disabled={submitting !== null}
            className={secondaryButton}
          >
            {submitting === 'save' ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSave('submit')}
            disabled={submitting !== null}
            className={primaryButton}
          >
            {submitting === 'submit' ? 'Submitting…' : 'Submit for approval'}
          </button>
        </BuilderFooter>
      }
    >
      {mode === 'create' && templates.length > 0 && (
        <div className="py-5">
          <div className="flex flex-col gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 @xl:flex-row @xl:items-center @xl:justify-between">
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
              aria-label="Apply a template"
              className={`${inputClass} border-primary/20 @xl:w-64`}
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

      <Section title="From & to" description="The company issuing this quote and the customer it's for.">
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @2xl:gap-x-6">
          <BrandSelect
            label="Issued by"
            hint="Its logo, address & color appear on the proposal."
            brandProfiles={brandProfiles}
            organization={organization}
            value={brandProfileId}
            onChange={setBrandProfileId}
          />
          <CustomerSelect
            label="Prepared for"
            customers={customers}
            value={customerId}
            onChange={setCustomerId}
            onCreated={(customer) => {
              onCustomerCreated(customer);
              setCustomerId(String(customer.id));
            }}
          />
        </div>
      </Section>

      <Section title="Quote details">
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
          <Field label="Subject" className="@md:col-span-2 @3xl:col-span-3">
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="What is this quote for?"
              className={inputClass}
            />
          </Field>
          <Field label="Issue date">
            <input
              type="date"
              value={issueDate}
              onChange={(event) => setIssueDate(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Expiry date">
            <input
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Currency">
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={inputClass}>
              {COMMON_CURRENCIES.includes(currency) ? null : <option value={currency}>{currency}</option>}
              {COMMON_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`${taxLabel} rate`}>
            <PercentInput value={taxRatePct} onChange={setTaxRatePct} />
          </Field>
          <Field label="Approver" hint="Required when you submit for approval." className="@md:col-span-1 @3xl:col-span-2">
            <select value={approverId} onChange={(event) => setApproverId(event.target.value)} className={inputClass}>
              <option value="">No approver yet</option>
              {approvers.map((approver) => (
                <option key={approver.id} value={approver.id}>
                  {approver.name} — {approver.email}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section
        title="Line items"
        description="Each line is qty × days × cost."
        action={
          !showTemplateForm && (
            <button
              type="button"
              onClick={() => setShowTemplateForm(true)}
              className="text-xs font-semibold text-primary hover:text-primary/80"
            >
              Save as template
            </button>
          )
        }
      >
        {showTemplateForm && (
          <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4">
            <p className="text-sm font-semibold text-gray-900">Save as reusable template</p>
            <p className="mt-0.5 text-xs text-gray-500">Keeps these line items with the currency, tax, notes and terms.</p>
            <div className="mt-3 flex flex-col gap-2.5 @xl:flex-row">
              <input
                type="text"
                placeholder="Template name"
                aria-label="Template name"
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                className={`${inputClass} @xl:flex-1`}
              />
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowTemplateForm(false)}
                  className={`${secondaryButton} flex-1 @xl:flex-none`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveAsTemplate}
                  disabled={submitting !== null}
                  className={`${primaryButton} flex-1 @xl:flex-none`}
                >
                  {submitting === 'template' ? 'Saving…' : 'Save template'}
                </button>
              </div>
            </div>
            {templateError && <p className="mt-2 text-xs font-medium text-rose-600">{templateError}</p>}
          </div>
        )}
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <div className={`${itemHeaderClass} ${ITEM_COLUMNS}`}>
            <span>Service / description</span>
            <span className="pr-3 text-right">Qty</span>
            <span className="pr-3 text-right">Days</span>
            <span className="pr-3 text-right">Cost</span>
            <span className="text-center">{taxLabel}</span>
            <span className="text-right">Sub-total</span>
            <span className="sr-only">Remove</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {items.map((item, index) => {
              const qty = Number(item.quantity) || 0;
              const days = Number(item.days) || 0;
              const unit = Number(item.unitPrice) || 0;
              const net = round2(qty * days * unit);
              return (
                <li key={item.key} className="px-4 py-3.5">
                  <div className={`grid grid-cols-6 items-center gap-x-3 gap-y-3 ${ITEM_COLUMNS}`}>
                    <div className="col-span-6 @4xl:col-span-1">
                      <ItemDescriptionInput
                        id={`item-${item.key}`}
                        value={item.description}
                        placeholder={`Item ${index + 1} description`}
                        onChange={(value) => updateItem(item.key, { description: value, productId: null })}
                        catalogOpen={productPickerForKey === item.key}
                        onToggleCatalog={
                          products.length > 0
                            ? () => setProductPickerForKey((current) => (current === item.key ? null : item.key))
                            : undefined
                        }
                      />
                    </div>
                    <label className="col-span-2 @4xl:col-span-1">
                      <span className={cellLabelClass}>Qty</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={item.quantity}
                        onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                        className={numberCellInputClass}
                      />
                    </label>
                    <label className="col-span-2 @4xl:col-span-1">
                      <span className={cellLabelClass}>Days</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={item.days}
                        onChange={(event) => updateItem(item.key, { days: event.target.value })}
                        className={numberCellInputClass}
                      />
                    </label>
                    <label className="col-span-2 @4xl:col-span-1">
                      <span className={cellLabelClass}>Cost</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(event) => updateItem(item.key, { unitPrice: event.target.value })}
                        className={numberCellInputClass}
                      />
                    </label>
                    <TaxableCheckbox
                      checked={item.taxable}
                      onChange={(checked) => updateItem(item.key, { taxable: checked })}
                      className="col-span-3 @4xl:col-span-1"
                    />
                    <p className="col-span-2 text-right text-sm font-semibold tabular-nums text-gray-900 @4xl:col-span-1">
                      {formatMoney(net, currency)}
                    </p>
                    <RemoveItemButton
                      label={`Remove item ${index + 1}`}
                      disabled={items.length === 1}
                      onClick={() => removeItem(item.key)}
                      className="col-span-1"
                    />
                  </div>
                  {productPickerForKey === item.key && (
                    <CatalogPicker products={products} onPick={(product) => applyProduct(item.key, product)} />
                  )}
                </li>
              );
            })}
          </ul>
          <AddItemButton onClick={() => setItems((current) => [...current, emptyItem()])} />
        </div>
      </Section>

      <Section title="Notes & terms">
        <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <Field label="Notes (internal)">
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className={inputClass} />
            </Field>
            <Field label="Terms & conditions (shown to client)">
              <textarea value={terms} onChange={(event) => setTerms(event.target.value)} rows={4} className={inputClass} />
            </Field>
          </div>
          <TotalsCard
            currency={currency}
            subtotal={totals.subtotal}
            tax={totals.tax}
            taxRate={totals.taxRate}
            total={totals.total}
            taxLabel={taxLabel}
          />
        </div>
      </Section>
    </BuilderShell>
  );
}
