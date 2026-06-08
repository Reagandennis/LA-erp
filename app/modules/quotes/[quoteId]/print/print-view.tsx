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

function describeDiscount(type: string, value: number, currency: string) {
  if (type === 'none' || !value) return '—';
  if (type === 'percentage') return `${value}%`;
  return formatMoney(value, currency);
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
    <div className="bg-gray-100 min-h-screen p-6 print:p-0 print:bg-white">
      <div className="max-w-3xl mx-auto bg-white shadow-sm print:shadow-none print:max-w-none">
        <div className="px-4 py-3 print:hidden flex items-center justify-between border-b border-gray-100">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
            Printable view — {quote.reference}
          </p>
          <div className="flex gap-2">
            <a
              href={`/api/quotes/${quote.id}/pdf`}
              className="px-4 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-gray-200 rounded-xl hover:bg-gray-100"
            >
              Download PDF
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white rounded-xl hover:opacity-90"
              style={{ backgroundColor: brand.primaryColor }}
            >
              Print
            </button>
          </div>
        </div>

        <div className="p-10 text-sm text-gray-900">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-xs">
              {brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="max-h-16 max-w-[180px] object-contain mb-3"
                />
              ) : null}
              {brand.companyName && (
                <p className="text-lg font-black">{brand.companyName}</p>
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

            <div className="text-right min-w-[14rem]">
              <p
                className="text-xs uppercase tracking-widest font-black"
                style={{ color: brand.primaryColor }}
              >
                Quotation
              </p>
              <p className="text-2xl font-black">{quote.reference}</p>
              <div className="mt-3 grid grid-cols-2 gap-x-6 text-right">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500">
                    Issue date
                  </p>
                  <p className="font-bold">{formatDate(quote.issueDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500">
                    Valid until
                  </p>
                  <p className="font-bold">{formatDate(quote.expiryDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500">
                    Status
                  </p>
                  <p className="font-bold">{quote.status}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500">
                    Currency
                  </p>
                  <p className="font-bold">{quote.currency}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-8">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                Bill to
              </p>
              {billToLines.length === 0 ? (
                <p>—</p>
              ) : (
                billToLines.map((line, i) => <p key={i}>{line}</p>)
              )}
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                Ship to
              </p>
              <p>{shipLine ?? '—'}</p>
            </div>
          </div>

          <p className="mt-6 text-lg font-black">{quote.subject}</p>

          <table className="w-full mt-4 border-t border-gray-200">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-widest text-gray-500">
                <th className="text-left py-2 px-2">Description</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Unit</th>
                <th className="text-right py-2 px-2">Discount</th>
                <th className="text-right py-2 px-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-2 px-2">
                    {item.description}
                    {!item.taxable && (
                      <span className="text-[10px] text-gray-400 ml-2">Not taxable</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right">{item.quantity}</td>
                  <td className="py-2 px-2 text-right">
                    {formatMoney(item.unitPrice, quote.currency)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {describeDiscount(item.discountType, item.discountValue, quote.currency)}
                  </td>
                  <td className="py-2 px-2 text-right font-bold">
                    {formatMoney(item.total, quote.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end mt-4">
            <div className="w-64 border border-gray-200 rounded-lg p-3 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-gray-500">Subtotal</span>
                <span className="font-bold">
                  {formatMoney(quote.subtotal, quote.currency)}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-gray-500">
                  {taxLabel} ({(quote.taxRate * 100).toFixed(2)}%)
                </span>
                <span className="font-bold">
                  {formatMoney(quote.tax, quote.currency)}
                </span>
              </div>
              {quote.discountType !== 'none' && quote.discountAmount > 0 && (
                <div className="flex justify-between py-1">
                  <span className="text-gray-500">
                    Discount
                    {quote.discountType === 'percentage' ? ` (${quote.discountValue}%)` : ''}
                  </span>
                  <span className="font-bold">
                    − {formatMoney(quote.discountAmount, quote.currency)}
                  </span>
                </div>
              )}
              <div className="border-t border-gray-200 my-1" />
              <div className="flex justify-between py-1">
                <span className="font-black">Total</span>
                <span
                  className="font-black text-lg"
                  style={{ color: brand.primaryColor }}
                >
                  {formatMoney(quote.total, quote.currency)}
                </span>
              </div>
            </div>
          </div>

          {quote.notes && (
            <div className="mt-6 p-3 bg-amber-50 rounded-lg">
              <p className="text-[10px] uppercase tracking-widest text-amber-700 mb-1">
                Notes
              </p>
              <p className="text-amber-900 whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}
          {quote.terms && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg">
              <p className="text-[10px] uppercase tracking-widest text-gray-700 mb-1">
                Terms &amp; conditions
              </p>
              <p className="text-gray-800 whitespace-pre-wrap">{quote.terms}</p>
            </div>
          )}

          <p className="mt-10 text-center text-[10px] text-gray-400">
            {brand.companyName ?? ''} • {quote.reference}
          </p>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
