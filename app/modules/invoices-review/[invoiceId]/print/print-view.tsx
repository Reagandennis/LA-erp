'use client';

import { useEffect } from 'react';

import type { InvoiceDetail } from '../../types';

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
  invoice: InvoiceDetail;
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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PrintView({ invoice, taxLabel, brand, customer }: Props) {
  useEffect(() => {
    document.title = `${invoice.number} — ${invoice.customer.name}`;
  }, [invoice.number, invoice.customer.name]);

  const addressLines = [
    brand.addressLine1,
    brand.addressLine2,
    [brand.city, brand.region, brand.postalCode].filter(Boolean).join(' '),
    brand.country,
  ].filter((l): l is string => Boolean(l && l.trim()));

  const billToLines = [customer.company, customer.name, customer.email, customer.billingAddress].filter(
    (l): l is string => Boolean(l),
  );

  const statusLabel = invoice.isOverdue ? 'Overdue' : invoice.status;
  const fullyPaid = invoice.balanceDue <= 0;

  return (
    <div className="min-h-screen bg-gray-100 p-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-xl bg-white shadow-sm print:max-w-none print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 print:hidden">
          <p className="text-sm font-medium text-gray-500">Invoice preview — {invoice.number}</p>
          <div className="flex gap-2">
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
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

        <div className="h-1.5 w-full" style={{ backgroundColor: brand.primaryColor }} />

        <div className="p-10 text-sm text-gray-800">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-xs">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logoUrl} alt="" className="mb-3 max-h-16 max-w-[180px] object-contain" />
              ) : null}
              {brand.companyName && <p className="text-lg font-bold text-gray-900">{brand.companyName}</p>}
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
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: brand.primaryColor }}>
                Invoice
              </p>
              <p className="text-2xl font-bold text-gray-900">{invoice.number}</p>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-right">
                <Meta label="Issue date" value={formatDate(invoice.issueDate)} />
                <Meta label="Due date" value={formatDate(invoice.dueDate)} />
                <Meta label="Status" value={statusLabel} />
                <Meta label="Currency" value={invoice.currency} />
              </div>
            </div>
          </div>

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
            <div
              className="flex flex-col justify-center rounded-lg p-4 text-white"
              style={{ backgroundColor: fullyPaid ? '#059669' : brand.primaryColor }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider opacity-90">
                {fullyPaid ? 'Paid in full' : 'Balance due'}
              </p>
              <p className="mt-1 text-2xl font-bold">{formatMoney(invoice.balanceDue, invoice.currency)}</p>
              <p className="mt-1 text-xs opacity-90">Due {formatDate(invoice.dueDate)}</p>
            </div>
          </div>

          <table className="mt-8 w-full">
            <thead>
              <tr className="border-b-2 text-xs uppercase tracking-wider text-gray-500" style={{ borderColor: brand.primaryColor }}>
                <th className="px-2 py-2.5 text-left font-semibold">Description</th>
                <th className="px-2 py-2.5 text-right font-semibold">Days</th>
                <th className="px-2 py-2.5 text-right font-semibold">Unit</th>
                <th className="px-2 py-2.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="px-2 py-2.5">
                    <span className="font-medium text-gray-900">{item.description}</span>
                    {!item.taxable && <span className="ml-2 text-xs text-gray-400">Not taxable</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatMoney(item.unitPrice, invoice.currency)}</td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-gray-900">
                    {formatMoney(item.total, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-5 flex justify-end">
            <div className="w-72 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium tabular-nums text-gray-900">{formatMoney(invoice.subtotal, invoice.currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">
                  {taxLabel} ({(invoice.taxRate * 100).toFixed(2)}%)
                </span>
                <span className="font-medium tabular-nums text-gray-900">{formatMoney(invoice.tax, invoice.currency)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
                <span className="font-semibold text-gray-900">Total</span>
                <span className="font-semibold tabular-nums text-gray-900">{formatMoney(invoice.total, invoice.currency)}</span>
              </div>
              {invoice.amountPaid > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Amount paid</span>
                  <span className="font-medium tabular-nums text-gray-900">
                    − {formatMoney(invoice.amountPaid, invoice.currency)}
                  </span>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between border-t-2 pt-2.5" style={{ borderColor: brand.primaryColor }}>
                <span className="text-sm font-semibold text-gray-900">Balance due</span>
                <span className="text-xl font-bold tabular-nums" style={{ color: brand.primaryColor }}>
                  {formatMoney(invoice.balanceDue, invoice.currency)}
                </span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-8 rounded-lg bg-amber-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-700">Message</p>
              <p className="whitespace-pre-wrap leading-relaxed text-amber-900">{invoice.notes}</p>
            </div>
          )}
          {invoice.terms && (
            <div className="mt-3 rounded-lg bg-gray-50 p-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Terms &amp; conditions</p>
              <p className="whitespace-pre-wrap leading-relaxed text-gray-700">{invoice.terms}</p>
            </div>
          )}

          <p className="mt-10 text-center text-xs text-gray-400">
            {brand.companyName ?? ''} · {invoice.number}
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
