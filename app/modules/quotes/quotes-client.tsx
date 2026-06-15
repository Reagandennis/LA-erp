'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import QuoteBuilder from './quote-builder';
import QuoteDetailDrawer from './quote-detail-drawer';
import type {
  ApproverOption,
  BrandProfileOption,
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
  initialBrandProfiles: BrandProfileOption[];
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

// Soft, semantic status badges — quiet by default, meaning carried by hue.
const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Submitted: 'bg-blue-50 text-blue-700',
  Approved: 'bg-emerald-50 text-emerald-700',
  Declined: 'bg-rose-50 text-rose-700',
  Sent: 'bg-violet-50 text-violet-700',
  Expired: 'bg-amber-50 text-amber-700',
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
  initialBrandProfiles,
  organization,
}: QuotesClientProps) {
  const [quotes, setQuotes] = useState<QuoteSummary[]>(initialQuotes);
  const [customers, setCustomers] = useState<CustomerOption[]>(initialCustomers);
  const [approvers] = useState<ApproverOption[]>(initialApprovers);
  const [products] = useState<ProductOption[]>(initialProducts);
  const [templates, setTemplates] = useState<TemplateOption[]>(initialTemplates);
  const [brandProfiles] = useState<BrandProfileOption[]>(initialBrandProfiles);
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
          brandProfile: quote.brandProfile,
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

  const hasQuotes = quotes.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        {/* Header */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
              Quotations
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Build proposals, route them for approval, and send them to clients.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex items-center gap-0.5 rounded-xl border border-gray-100 bg-white p-1">
              <Link
                href="/modules/quotes/catalog"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
              >
                Catalog
              </Link>
              <Link
                href="/modules/quotes/templates"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
              >
                Templates
              </Link>
              {isAdmin && (
                <Link
                  href="/modules/quotes/settings"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
                >
                  Companies
                </Link>
              )}
            </nav>
            <button
              type="button"
              onClick={() => setBuilderState({ open: true, mode: 'create' })}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
              </svg>
              New quotation
            </button>
          </div>
        </header>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard
            label="Total value"
            value={formatMoney(totals.totalValue, totals.currency)}
            accent="text-primary"
          />
          <SummaryCard label="Pending approval" value={`${totals.pending}`} />
          <SummaryCard label="Approved & sent" value={`${totals.approved}`} />
          <SummaryCard label="Drafts & declined" value={`${totals.drafts}`} />
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search by reference, subject, or customer…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {STATUS_FILTERS.map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  activeFilter === status
                    ? 'bg-primary text-white'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile card list */}
        <div className="space-y-3 md:hidden">
          {filteredQuotes.map((quote) => {
            const needsMyApproval =
              quote.status === 'Submitted' &&
              (quote.approver?.id === currentUser.id || isAdmin);
            return (
              <button
                key={quote.id}
                type="button"
                onClick={() => setSelectedQuoteId(quote.id)}
                className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {quote.reference}
                    </p>
                    <p className="truncate text-sm text-gray-500">{quote.subject}</p>
                  </div>
                  <StatusBadge status={quote.status} />
                </div>
                <p className="mt-2 truncate text-xs text-gray-400">
                  {quote.customer.name}
                  {quote.customer.company ? ` · ${quote.customer.company}` : ''}
                </p>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-xs text-gray-400">Expires {formatDate(quote.expiryDate)}</p>
                    {needsMyApproval && <ApprovalPill className="mt-1.5" />}
                  </div>
                  <p className="text-base font-bold text-gray-900">
                    {formatMoney(quote.total, quote.currency)}
                  </p>
                </div>
              </button>
            );
          })}

          {filteredQuotes.length === 0 && (
            <EmptyState onCreate={() => setBuilderState({ open: true, mode: 'create' })} filtered={hasQuotes} />
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Reference
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Customer
                </th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Value
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Status
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Approver
                </th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Expires
                </th>
                <th className="w-10 px-6 py-3.5" />
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
                    className="group cursor-pointer transition-colors hover:bg-gray-50/70"
                  >
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                        {quote.reference}
                      </p>
                      <p className="mt-0.5 max-w-[240px] truncate text-sm text-gray-500">
                        {quote.subject}
                      </p>
                      {quote.trackingCode && (
                        <p className="mt-0.5 text-xs text-gray-400">{quote.trackingCode}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-700">{quote.customer.name}</p>
                      {quote.customer.company && (
                        <p className="mt-0.5 text-xs text-gray-400">{quote.customer.company}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        {formatMoney(quote.total, quote.currency)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {quote.itemCount} item{quote.itemCount === 1 ? '' : 's'}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={quote.status} />
                      {needsMyApproval && <ApprovalPill className="mt-1.5" />}
                      {quote.trip && (
                        <p className="mt-1 text-xs text-gray-400">→ {quote.trip.reference}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-600">
                        {quote.approver?.name ?? (
                          <span className="text-gray-300">Unassigned</span>
                        )}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-gray-500">{formatDate(quote.expiryDate)}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <svg
                        className="ml-auto h-4 w-4 text-gray-300 transition-colors group-hover:text-primary"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredQuotes.length === 0 && (
            <EmptyState onCreate={() => setBuilderState({ open: true, mode: 'create' })} filtered={hasQuotes} />
          )}
        </div>
      </div>

      {builderState.open && (
        <QuoteBuilder
          mode={builderState.mode}
          quote={builderState.mode === 'edit' ? builderState.quote : null}
          customers={customers}
          approvers={approvers}
          products={products}
          templates={templates}
          brandProfiles={brandProfiles}
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
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? STATUS_STYLES.Draft
      }`}
    >
      {status}
    </span>
  );
}

function ApprovalPill({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-secondary/20 px-2 py-0.5 text-[11px] font-semibold text-primary ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
      Needs your approval
    </span>
  );
}

function EmptyState({ onCreate, filtered }: { onCreate: () => void; filtered: boolean }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">
        {filtered ? 'No matching quotations' : 'No quotations yet'}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered
          ? 'Try a different search or clear the active filter.'
          : 'Create your first proposal to get started.'}
      </p>
      {!filtered && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
          </svg>
          New quotation
        </button>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = 'text-gray-900',
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}
