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
} from '../quotes/builder-ui';
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

// Description | Days | Rate | Tax | Amount | remove — once the dialog is wide enough for a table.
const ITEM_COLUMNS = '@4xl:grid-cols-[minmax(0,1fr)_5rem_7rem_3.5rem_7.5rem_2.25rem]';

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
  const [productPickerForKey, setProductPickerForKey] = useState<string | null>(null);
  const taxLabel = organization.taxLabel || 'Tax';

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
      setError('Pick a client to bill');
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

  return (
    <BuilderShell
      title={mode === 'edit' && invoice ? `Edit ${invoice.number}` : 'New invoice'}
      subtitle={
        mode === 'edit'
          ? 'Update the details below and save.'
          : 'Bill a client — save it as a draft or submit it for approval.'
      }
      busy={submitting !== null}
      onClose={onClose}
      footer={
        <BuilderFooter error={error} totalLabel="Invoice total" total={formatMoney(totals.total, currency)}>
          <button type="button" onClick={onClose} disabled={submitting !== null} className={ghostButton}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSave('draft')}
            disabled={submitting !== null}
            className={secondaryButton}
          >
            {submitting === 'draft' ? 'Saving…' : 'Save as draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSave('submit')}
            disabled={submitting !== null}
            className={primaryButton}
          >
            {submitting === 'submit' ? 'Saving…' : 'Save & submit for approval'}
          </button>
        </BuilderFooter>
      }
    >
      <Section title="From & to" description="The company sending this invoice and the client paying it.">
        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @2xl:gap-x-6">
          <BrandSelect
            label="From (your company)"
            brandProfiles={brandProfiles}
            organization={organization}
            value={brandProfileId}
            onChange={setBrandProfileId}
          />
          <CustomerSelect
            label="Bill to"
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

      <Section title="Invoice details">
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
          <Field label="Invoice date">
            <input
              type="date"
              value={issueDate}
              onChange={(event) => applyIssueDate(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Payment terms">
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
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
                setTermsPreset('Custom');
              }}
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
          <Field label="Approver" hint="Required when you submit for approval.">
            <select value={approverId} onChange={(event) => setApproverId(event.target.value)} className={inputClass}>
              <option value="">Select approver…</option>
              {approvers.map((approver) => (
                <option key={approver.id} value={approver.id}>
                  {approver.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      <Section title="Line items" description="Each line is days × rate.">
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <div className={`${itemHeaderClass} ${ITEM_COLUMNS}`}>
            <span>Description</span>
            <span className="pr-3 text-right">Days</span>
            <span className="pr-3 text-right">Rate</span>
            <span className="text-center">{taxLabel}</span>
            <span className="text-right">Amount</span>
            <span className="sr-only">Remove</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {items.map((item, index) => {
              const qty = Number(item.quantity) || 0;
              const unit = Number(item.unitPrice) || 0;
              const net = round2(qty * unit);
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
                    <label className="col-span-3 @4xl:col-span-1">
                      <span className={cellLabelClass}>Days</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={item.quantity}
                        onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                        className={numberCellInputClass}
                      />
                    </label>
                    <label className="col-span-3 @4xl:col-span-1">
                      <span className={cellLabelClass}>Rate</span>
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

      <Section title="Message & terms">
        <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-4">
            <Field label="Message on invoice">
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Thank you for your business."
                className={inputClass}
              />
            </Field>
            <Field label="Terms & conditions">
              <textarea value={terms} onChange={(event) => setTerms(event.target.value)} rows={3} className={inputClass} />
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
