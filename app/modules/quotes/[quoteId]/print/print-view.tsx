'use client';

import { useEffect } from 'react';

import type { QuoteDetail } from '../../types';

interface BrandView {
  companyName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  primaryColor: string;
  logoUrl: string | null;
}

interface Props {
  quote: QuoteDetail;
  taxLabel: string;
  brand: BrandView;
  customer: {
    name: string;
    company: string | null;
    email: string | null;
    address: string | null;
    billingAddress: string | null;
  };
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function PrintView({ quote, taxLabel, brand, customer }: Props) {
  useEffect(() => {
    document.title = `${quote.reference} — ${quote.subject}`;
  }, [quote.reference, quote.subject]);

  const addressLines = [
    brand.addressLine1,
    brand.addressLine2,
    [brand.city, brand.region, brand.postalCode].filter(Boolean).join(' '),
    brand.country,
  ].filter((l): l is string => Boolean(l && l.trim()));

  const billToLines = [
    customer.company,
    customer.name,
    customer.email,
    customer.billingAddress,
  ].filter((l): l is string => Boolean(l));

  const shipLine = customer.address ?? customer.billingAddress;

  return (
    <div className="min-h-screen bg-gray-100 p-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none">
        {/* Screen-only toolbar */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 print:hidden">
          <p className="text-sm font-medium text-gray-500">Proposal preview — {quote.reference}</p>
          <div className="flex gap-2">
            <a
              href={`/api/quotes/${quote.id}/pdf`}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Download PDF
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              style={{ backgroundColor: brand.primaryColor }}
            >
              Print
            </button>
          </div>
        </div>

        {/* Brand accent bar */}
        <div className="h-1.5 w-full" style={{ backgroundColor: brand.primaryColor }} />

        <div className="p-10 text-sm text-gray-800">
          {/* Header */}
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-xs">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logoUrl} alt="" className="mb-3 max-h-16 max-w-[180px] object-contain" />
              ) : null}
              {brand.companyName && (
                <p className="text-lg font-bold text-gray-900">{brand.companyName}</p>
              )}
              {addressLines.map((line, i) => (
                <p key={i} className="text-xs text-gray-500">
                  {line}
                </p>
              ))}
              {brand.email && <p className="text-xs text-gray-500">{brand.email}</p>}
              {brand.phone && <p className="text-xs text-gray-500">{brand.phone}</p>}
              {brand.website && <p className="text-xs text-gray-500">{brand.website}</p>}
            </div>

            <div className="min-w-[14rem] text-right">
              <p
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: brand.primaryColor }}
              >
                Quotation
              </p>
              <p className="text-2xl font-bold text-gray-900">{quote.reference}</p>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-right">
                <Meta label="Issue date" value={formatDate(quote.issueDate)} />
                <Meta label="Valid until" value={formatDate(quote.expiryDate)} />
                <Meta label="Status" value={quote.status} />
                <Meta label="Currency" value={quote.currency} />
              </div>
            </div>
          </div>

          {/* Bill to / Ship to */}
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Bill to</p>
              {billToLines.length === 0 ? (
                <p className="text-gray-400">—</p>
              ) : (
                billToLines.map((line, i) => (
                  <p key={i} className={i === 0 ? 'font-medium text-gray-900' : 'text-gray-600'}>
                    {line}
                  </p>
                ))
              )}
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Ship to</p>
              <p className="text-gray-600">{shipLine ?? '—'}</p>
            </div>
          </div>

          <p className="mt-8 text-lg font-semibold text-gray-900">{quote.subject}</p>

          {/* Items */}
          <table className="mt-4 w-full">
            <thead>
              <tr className="border-b-2 text-xs uppercase tracking-wider text-gray-500" style={{ borderColor: brand.primaryColor }}>
                <th className="px-2 py-2.5 text-left font-semibold">Description</th>
                <th className="px-2 py-2.5 text-right font-semibold">Days</th>
                <th className="px-2 py-2.5 text-right font-semibold">Unit</th>
                <th className="px-2 py-2.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-2 py-2.5">
                    <span className="font-medium text-gray-900">{item.description}</span>
                    {!item.taxable && <span className="ml-2 text-xs text-gray-400">Not taxable</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {formatMoney(item.unitPrice, quote.currency)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                    {formatMoney(item.total, quote.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-5 flex justify-end">
            <div className="w-72 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium tabular-nums text-gray-900">
                  {formatMoney(quote.subtotal, quote.currency)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">
                  {taxLabel} ({(quote.taxRate * 100).toFixed(2)}%)
                </span>
                <span className="font-medium tabular-nums text-gray-900">
                  {formatMoney(quote.tax, quote.currency)}
                </span>
              </div>
              {quote.discountType !== 'none' && quote.discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">
                    Discount{quote.discountType === 'percentage' ? ` (${quote.discountValue}%)` : ''}
                  </span>
                  <span className="font-medium tabular-nums text-gray-900">
                    − {formatMoney(quote.discountAmount, quote.currency)}
                  </span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between border-t-2 pt-2.5" style={{ borderColor: brand.primaryColor }}>
                <span className="text-sm font-semibold text-gray-900">Total</span>
                <span className="text-xl font-bold tabular-nums" style={{ color: brand.primaryColor }}>
                  {formatMoney(quote.total, quote.currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes / terms */}
          {quote.notes && (
            <div className="mt-8 rounded-lg bg-amber-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-700">Notes</p>
              <p className="whitespace-pre-wrap leading-relaxed text-amber-900">{quote.notes}</p>
            </div>
          )}
          {quote.terms && (
            <div className="mt-3 rounded-lg bg-gray-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Terms &amp; conditions
              </p>
              <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{quote.terms}</p>
            </div>
          )}

          <p className="mt-10 text-center text-xs text-gray-400">
            {brand.companyName ?? ''} · {quote.reference}
          </p>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="font-semibold text-gray-900">{value}</p>
    </div>
  );
}
