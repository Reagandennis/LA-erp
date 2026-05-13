'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import QuoteBuilder from './quote-builder';
import QuoteDetailDrawer from './quote-detail-drawer';
import type {
  ApproverOption,
  CustomerOption,
  OrganizationBranding,
  ProductOption,
  QuoteDetail,
  QuoteSummary,
  StatusFilter,
  TemplateOption,
} from './types';

interface QuotesClientProps {
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
  initialQuotes: QuoteSummary[];
  initialCustomers: CustomerOption[];
  initialApprovers: ApproverOption[];
  initialProducts: ProductOption[];
  initialTemplates: TemplateOption[];
  organization: OrganizationBranding;
}

const STATUS_FILTERS: StatusFilter[] = [
  'All',
  'Draft',
  'Submitted',
  'Approved',
  'Declined',
  'Sent',
];

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-50 text-gray-500 border-gray-100',
  Submitted: 'bg-blue-50 text-blue-600 border-blue-100',
  Approved: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  Declined: 'bg-rose-50 text-rose-600 border-rose-100',
  Sent: 'bg-violet-50 text-violet-600 border-violet-100',
  Expired: 'bg-amber-50 text-amber-600 border-amber-100',
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

export default function QuotesClient({
  currentUser,
  isAdmin,
  initialQuotes,
  initialCustomers,
  initialApprovers,
  initialProducts,
  initialTemplates,
  organization,
}: QuotesClientProps) {
  const [quotes, setQuotes] = useState<QuoteSummary[]>(initialQuotes);
  const [customers, setCustomers] = useState<CustomerOption[]>(initialCustomers);
  const [approvers] = useState<ApproverOption[]>(initialApprovers);
  const [products] = useState<ProductOption[]>(initialProducts);
  const [templates, setTemplates] = useState<TemplateOption[]>(initialTemplates);
  const [selectedQuoteId, setSelectedQuoteId] = useState<number | null>(null);
  const [builderState, setBuilderState] = useState<
    | { open: false }
    | { open: true; mode: 'create'; prefillTemplate?: TemplateOption }
    | { open: true; mode: 'edit'; quote: QuoteDetail }
  >({ open: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('All');

  const filteredQuotes = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return quotes.filter((quote) => {
      const matchesSearch =
        normalized.length === 0 ||
        quote.reference.toLowerCase().includes(normalized) ||
        quote.subject.toLowerCase().includes(normalized) ||
        quote.customer.name.toLowerCase().includes(normalized) ||
        (quote.customer.company?.toLowerCase().includes(normalized) ?? false);
      const matchesFilter = activeFilter === 'All' || quote.status === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [quotes, searchQuery, activeFilter]);

  const totals = useMemo(() => {
    const display = organization.defaultCurrency || 'USD';
    return {
      totalValue: quotes.reduce((acc, q) => acc + q.total, 0),
      pending: quotes.filter((q) => q.status === 'Submitted').length,
      approved: quotes.filter((q) => q.status === 'Approved' || q.status === 'Sent').length,
      drafts: quotes.filter((q) => q.status === 'Draft' || q.status === 'Declined').length,
      currency: display,
    };
  }, [quotes, organization.defaultCurrency]);

  const upsertQuote = (quote: QuoteSummary | QuoteDetail) => {
    setQuotes((current) => {
      const without = current.filter((q) => q.id !== quote.id);
      return [
        {
          id: quote.id,
          reference: quote.reference,
          trackingCode: quote.trackingCode,
          subject: quote.subject,
          status: quote.status,
          issueDate: quote.issueDate,
          expiryDate: quote.expiryDate,
          currency: quote.currency,
          taxRate: quote.taxRate,
          discountType: quote.discountType,
          discountValue: quote.discountValue,
          discountAmount: quote.discountAmount,
          subtotal: quote.subtotal,
          tax: quote.tax,
          total: quote.total,
          notes: quote.notes,
          terms: quote.terms,
          decisionNote: quote.decisionNote,
          submittedAt: quote.submittedAt,
          decidedAt: quote.decidedAt,
          sentAt: quote.sentAt,
          createdAt: quote.createdAt,
          updatedAt: quote.updatedAt,
          customer: quote.customer,
          createdBy: quote.createdBy,
          approver: quote.approver,
          itemCount: 'items' in quote ? quote.items.length : quote.itemCount,
          trip: quote.trip,
        },
        ...without,
      ];
    });
  };

  const removeQuote = (quoteId: number) => {
    setQuotes((current) => current.filter((q) => q.id !== quoteId));
  };

  const openBuilderForEdit = (quote: QuoteDetail) => {
    setSelectedQuoteId(null);
    setBuilderState({ open: true, mode: 'edit', quote });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-10">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 mb-6 md:mb-10">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Quotations
            </h1>
            <p className="text-gray-500 mt-1 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
              Build proposals, route through approval, dispatch to clients
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="flex gap-2 text-[10px] font-black uppercase tracking-widest">
              <Link
                href="/modules/quotes/catalog"
                className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-100 whitespace-nowrap"
              >
                Catalog
              </Link>
              <Link
                href="/modules/quotes/templates"
                className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-100 whitespace-nowrap"
              >
                Templates
              </Link>
              {isAdmin && (
                <Link
                  href="/admin/organization"
                  className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-100 whitespace-nowrap"
                >
                  Branding
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBuilderState({ open: true, mode: 'create' })}
              className="w-full sm:w-auto px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              New Quotation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-10">
          <SummaryCard
            label="Total Value"
            value={formatMoney(totals.totalValue, totals.currency)}
            accent="text-gray-900"
          />
          <SummaryCard label="Pending Approval" value={`${totals.pending}`} accent="text-blue-600" />
          <SummaryCard label="Approved or Sent" value={`${totals.approved}`} accent="text-emerald-600" />
          <SummaryCard label="Drafts and Declined" value={`${totals.drafts}`} accent="text-gray-400" />
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-3xl border border-gray-100 shadow-sm mb-6 flex flex-col lg:flex-row lg:items-center gap-3 md:gap-4">
          <div className="relative flex-1">
            <svg
              className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search by reference, subject, customer..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full pl-12 pr-6 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {STATUS_FILTERS.map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                  activeFilter === status
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100'
                    : 'text-gray-400 hover:bg-gray-100'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-3">
          {filteredQuotes.map((quote) => {
            const needsMyApproval =
              quote.status === 'Submitted' &&
              (quote.approver?.id === currentUser.id || isAdmin);
            return (
              <button
                key={quote.id}
                type="button"
                onClick={() => setSelectedQuoteId(quote.id)}
                className="w-full text-left bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:border-emerald-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                      {quote.reference}
                    </p>
                    <p className="text-sm font-black text-gray-900 mt-1">{quote.subject}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {quote.customer.name}
                      {quote.customer.company ? ` • ${quote.customer.company}` : ''}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border whitespace-nowrap ${
                      STATUS_STYLES[quote.status] ?? STATUS_STYLES.Draft
                    }`}
                  >
                    {quote.status}
                  </span>
                </div>
                <div className="flex items-end justify-between mt-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Expires {formatDate(quote.expiryDate)}
                    </p>
                    {needsMyApproval && (
                      <p className="text-[10px] mt-1 font-black text-blue-600 uppercase tracking-widest">
                        Awaiting your decision
                      </p>
                    )}
                  </div>
                  <p className="text-base font-black text-gray-900">
                    {formatMoney(quote.total, quote.currency)}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Reference & Subject
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Customer
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">
                  Value
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Status
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Approver
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Expiry
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredQuotes.map((quote) => {
                const needsMyApproval =
                  quote.status === 'Submitted' &&
                  (quote.approver?.id === currentUser.id || isAdmin);
                return (
                  <tr
                    key={quote.id}
                    onClick={() => setSelectedQuoteId(quote.id)}
                    className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
                  >
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                          QT
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-900 group-hover:text-emerald-700 transition-colors">
                            {quote.reference}
                          </p>
                          <p className="text-[10px] text-gray-400 font-bold uppercase truncate max-w-[200px] mt-0.5">
                            {quote.subject}
                          </p>
                          {quote.trackingCode && (
                            <p className="text-[9px] text-emerald-700 font-black uppercase tracking-widest mt-0.5">
                              {quote.trackingCode}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <p className="text-xs font-black text-gray-700">{quote.customer.name}</p>
                      {quote.customer.company && (
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                          {quote.customer.company}
                        </p>
                      )}
                    </td>
                    <td className="px-8 py-6 text-right">
                      <p className="text-sm font-black text-gray-900">
                        {formatMoney(quote.total, quote.currency)}
                      </p>
                      <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">
                        {quote.itemCount} line items
                      </p>
                    </td>
                    <td className="px-8 py-6">
                      <span
                        className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                          STATUS_STYLES[quote.status] ?? STATUS_STYLES.Draft
                        }`}
                      >
                        {quote.status}
                      </span>
                      {needsMyApproval && (
                        <p className="text-[9px] mt-1 font-black text-blue-600 uppercase tracking-widest">
                          Awaiting your decision
                        </p>
                      )}
                      {quote.trip && (
                        <p className="text-[9px] mt-1 font-black text-emerald-700 uppercase tracking-widest">
                          → {quote.trip.reference}
                        </p>
                      )}
                    </td>
                    <td className="px-8 py-6">
                      <p className="text-[11px] font-bold text-gray-600">
                        {quote.approver?.name ?? <span className="text-gray-300">— unassigned —</span>}
                      </p>
                    </td>
                    <td className="px-8 py-6">
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        {formatDate(quote.expiryDate)}
                      </p>
                    </td>
                    <td className="px-8 py-6 text-right">
                      <button
                        type="button"
                        className="p-2 text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                        aria-label="Open quote"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredQuotes.length === 0 && (
            <div className="p-24 text-center">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-200">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">
                No quotations to show
              </h3>
              <p className="text-gray-500 mt-2 font-bold text-sm">
                Build your first proposal with the New Quotation button.
              </p>
            </div>
          )}
        </div>

        {filteredQuotes.length === 0 && (
          <div className="md:hidden bg-white rounded-2xl p-10 text-center border border-gray-100">
            <h3 className="text-lg font-black text-gray-900">No quotations to show</h3>
            <p className="text-gray-500 mt-2 text-sm">
              Tap New Quotation to build your first proposal.
            </p>
          </div>
        )}
      </div>

      {builderState.open && (
        <QuoteBuilder
          mode={builderState.mode}
          quote={builderState.mode === 'edit' ? builderState.quote : null}
          customers={customers}
          approvers={approvers}
          products={products}
          templates={templates}
          organization={organization}
          onClose={() => setBuilderState({ open: false })}
          onCustomerCreated={(customer) =>
            setCustomers((current) =>
              [...current.filter((c) => c.id !== customer.id), customer].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            )
          }
          onTemplateCreated={(template) =>
            setTemplates((current) =>
              [...current.filter((t) => t.id !== template.id), template].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
            )
          }
          onSaved={(quote) => {
            upsertQuote(quote);
            setBuilderState({ open: false });
            setSelectedQuoteId(quote.id);
          }}
        />
      )}

      {selectedQuoteId !== null && (
        <QuoteDetailDrawer
          quoteId={selectedQuoteId}
          currentUser={currentUser}
          isAdmin={isAdmin}
          organization={organization}
          approvers={approvers}
          onClose={() => setSelectedQuoteId(null)}
          onChanged={(quote) => upsertQuote(quote)}
          onDeleted={(id) => {
            removeQuote(id);
            setSelectedQuoteId(null);
          }}
          onDuplicated={(quote) => {
            upsertQuote(quote);
            setSelectedQuoteId(quote.id);
          }}
          onEdit={openBuilderForEdit}
        />
      )}

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-[2.5rem] border border-gray-100 shadow-sm">
      <p className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className={`text-lg md:text-2xl font-black ${accent}`}>{value}</p>
    </div>
  );
}
