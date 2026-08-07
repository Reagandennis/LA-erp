'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import InvoiceBuilder from './invoice-builder';
import InvoiceDetailDrawer from './invoice-detail-drawer';
import type {
  ApproverOption,
  BrandProfileOption,
  CustomerOption,
  InvoiceableQuote,
  InvoiceDetail,
  InvoiceSummary,
  OrganizationBranding,
  ProductOption,
  StatusFilter,
} from './types';

interface InvoicesClientProps {
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
  initialInvoices: InvoiceSummary[];
  customers: CustomerOption[];
  products: ProductOption[];
  brandProfiles: BrandProfileOption[];
  invoiceableQuotes: InvoiceableQuote[];
  organization: OrganizationBranding;
  quickBooks: { configured: boolean; connected: boolean };
  approvers: ApproverOption[];
}

const STATUS_FILTERS: StatusFilter[] = [
  'All',
  'Draft',
  'Pending Approval',
  'Approved',
  'Declined',
  'Sent',
  'Overdue',
  'Partial',
  'Paid',
  'Void',
];

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  'Pending Approval': 'bg-amber-50 text-amber-700',
  Approved: 'bg-emerald-50 text-emerald-700',
  Declined: 'bg-rose-50 text-rose-700',
  Sent: 'bg-blue-50 text-blue-700',
  Partial: 'bg-amber-50 text-amber-700',
  Paid: 'bg-emerald-50 text-emerald-700',
  Void: 'bg-gray-100 text-gray-400',
  Overdue: 'bg-rose-50 text-rose-700',
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
}

function displayStatus(invoice: InvoiceSummary): string {
  return invoice.isOverdue ? 'Overdue' : invoice.status;
}

export default function InvoicesClient({
  currentUser,
  isAdmin,
  initialInvoices,
  customers: initialCustomers,
  products,
  brandProfiles,
  invoiceableQuotes,
  organization,
  quickBooks,
  approvers,
}: InvoicesClientProps) {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>(initialInvoices);
  const [customers, setCustomers] = useState<CustomerOption[]>(initialCustomers);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [builderState, setBuilderState] = useState<
    | { open: false }
    | { open: true; mode: 'create'; invoice: null }
    | { open: true; mode: 'edit'; invoice: InvoiceDetail }
  >({ open: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('All');
  const [showQuotePicker, setShowQuotePicker] = useState(false);
  const router = useRouter();

  // While the quote picker is open, refresh the server-provided quote list when
  // the user returns to this tab — they may have just edited a quote elsewhere.
  useEffect(() => {
    if (!showQuotePicker) return;
    const refresh = () => router.refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [showQuotePicker, router]);
  const [creatingFromQuote, setCreatingFromQuote] = useState<number | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter((inv) => {
      const matchesSearch =
        q.length === 0 ||
        inv.number.toLowerCase().includes(q) ||
        inv.customer.name.toLowerCase().includes(q) ||
        (inv.customer.company?.toLowerCase().includes(q) ?? false);
      const matchesFilter =
        activeFilter === 'All' || (activeFilter === 'Overdue' ? inv.isOverdue : inv.status === activeFilter);
      return matchesSearch && matchesFilter;
    });
  }, [invoices, searchQuery, activeFilter]);

  const totals = useMemo(() => {
    const currency = organization.defaultCurrency || 'USD';
    const active = invoices.filter((i) => i.status !== 'Void');
    return {
      outstanding: active
        .filter((i) => i.status === 'Sent' || i.status === 'Partial')
        .reduce((acc, i) => acc + i.balanceDue, 0),
      overdue: active.filter((i) => i.isOverdue).reduce((acc, i) => acc + i.balanceDue, 0),
      paid: active.reduce((acc, i) => acc + i.amountPaid, 0),
      drafts: invoices.filter((i) => i.status === 'Draft').length,
      currency,
    };
  }, [invoices, organization.defaultCurrency]);

  const upsertInvoice = (invoice: InvoiceSummary | InvoiceDetail) => {
    setInvoices((current) => {
      const without = current.filter((i) => i.id !== invoice.id);
      const { ...summary } = invoice;
      return [summary as InvoiceSummary, ...without].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    });
  };

  const removeInvoice = (id: number) => setInvoices((current) => current.filter((i) => i.id !== id));

  const handleCreateFromQuote = async (quoteId: number) => {
    setCreatingFromQuote(quoteId);
    setQuoteError(null);
    try {
      const response = await fetch('/api/invoices/from-quote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId }),
      });
      const data = (await response.json().catch(() => null)) as
        | { invoice?: InvoiceDetail; error?: string }
        | null;
      if (!response.ok || !data?.invoice) {
        setQuoteError(data?.error ?? 'Could not create invoice from quote');
        return;
      }
      upsertInvoice(data.invoice);
      setShowQuotePicker(false);
      setSelectedInvoiceId(data.invoice.id);
    } catch {
      setQuoteError('Network error. Try again.');
    } finally {
      setCreatingFromQuote(null);
    }
  };

  const hasInvoices = invoices.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Invoices</h1>
            <p className="mt-1 text-sm text-gray-500">
              Bill clients, track payments, and keep an eye on what&apos;s overdue.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {quickBooks.configured && !quickBooks.connected && (
              <a
                href="/api/quickbooks/connect"
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                Connect QuickBooks
              </a>
            )}
            {quickBooks.connected && (
              <span
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-xs font-semibold text-emerald-700"
                title="Payments recorded here are mirrored to QuickBooks"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                QuickBooks connected
              </span>
            )}
            {invoiceableQuotes.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuoteError(null);
                  setShowQuotePicker(true);
                }}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
              >
                From quote
              </button>
            )}
            <button
              type="button"
              onClick={() => setBuilderState({ open: true, mode: 'create', invoice: null })}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
              </svg>
              New invoice
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Outstanding" value={formatMoney(totals.outstanding, totals.currency)} accent="text-primary" />
          <SummaryCard
            label="Overdue"
            value={formatMoney(totals.overdue, totals.currency)}
            accent={totals.overdue > 0 ? 'text-rose-600' : 'text-gray-900'}
          />
          <SummaryCard label="Collected" value={formatMoney(totals.paid, totals.currency)} />
          <SummaryCard label="Drafts" value={`${totals.drafts}`} />
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by number or customer…"
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
                  activeFilter === status ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {filteredInvoices.map((invoice) => (
            <button
              key={invoice.id}
              type="button"
              onClick={() => setSelectedInvoiceId(invoice.id)}
              className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">{invoice.number}</p>
                  <p className="truncate text-sm text-gray-500">{invoice.customer.name}</p>
                </div>
                <StatusBadge invoice={invoice} />
              </div>
              <div className="mt-3 flex items-end justify-between">
                <p className="text-xs text-gray-400">Due {formatDate(invoice.dueDate)}</p>
                <div className="text-right">
                  <p className="text-base font-bold text-gray-900">{formatMoney(invoice.total, invoice.currency)}</p>
                  {invoice.balanceDue > 0 && invoice.balanceDue !== invoice.total && (
                    <p className="text-xs text-gray-400">{formatMoney(invoice.balanceDue, invoice.currency)} due</p>
                  )}
                </div>
              </div>
            </button>
          ))}
          {filteredInvoices.length === 0 && (
            <EmptyState filtered={hasInvoices} onCreate={() => setBuilderState({ open: true, mode: 'create', invoice: null })} />
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Number</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Issued</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Due</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Total</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredInvoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  onClick={() => setSelectedInvoiceId(invoice.id)}
                  className="group cursor-pointer transition-colors hover:bg-gray-50/70"
                >
                  <td className="px-6 py-4">
                    <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                      {invoice.number}
                    </p>
                    {invoice.sourceQuote && (
                      <p className="mt-0.5 text-xs text-gray-400">from {invoice.sourceQuote.reference}</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-700">{invoice.customer.name}</p>
                    {invoice.customer.company && (
                      <p className="mt-0.5 text-xs text-gray-400">{invoice.customer.company}</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-500">{formatDate(invoice.issueDate)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className={`text-sm ${invoice.isOverdue ? 'font-semibold text-rose-600' : 'text-gray-500'}`}>
                      {formatDate(invoice.dueDate)}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge invoice={invoice} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className="text-sm font-semibold text-gray-900">{formatMoney(invoice.total, invoice.currency)}</p>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className={`text-sm font-semibold ${invoice.balanceDue > 0 ? 'text-gray-900' : 'text-emerald-600'}`}>
                      {invoice.balanceDue > 0 ? formatMoney(invoice.balanceDue, invoice.currency) : 'Paid'}
                    </p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredInvoices.length === 0 && (
            <EmptyState filtered={hasInvoices} onCreate={() => setBuilderState({ open: true, mode: 'create', invoice: null })} />
          )}
        </div>
      </div>

      {showQuotePicker && (
        <QuotePicker
          quotes={invoiceableQuotes}
          creatingId={creatingFromQuote}
          error={quoteError}
          onPick={handleCreateFromQuote}
          onClose={() => setShowQuotePicker(false)}
        />
      )}

      {builderState.open && (
        <InvoiceBuilder
          mode={builderState.mode}
          invoice={builderState.mode === 'edit' ? builderState.invoice : null}
          customers={customers}
          products={products}
          brandProfiles={brandProfiles}
          organization={organization}
          approvers={approvers}
          onClose={() => setBuilderState({ open: false })}
          onCustomerCreated={(customer) =>
            setCustomers((current) =>
              [...current.filter((c) => c.id !== customer.id), customer].sort((a, b) => a.name.localeCompare(b.name)),
            )
          }
          onSaved={(invoice) => {
            upsertInvoice(invoice);
            setBuilderState({ open: false });
            setSelectedInvoiceId(invoice.id);
          }}
        />
      )}

      {selectedInvoiceId !== null && (
        <InvoiceDetailDrawer
          invoiceId={selectedInvoiceId}
          currentUser={currentUser}
          isAdmin={isAdmin}
          organization={organization}
          approvers={approvers}
          onClose={() => setSelectedInvoiceId(null)}
          onChanged={(invoice) => upsertInvoice(invoice)}
          onDeleted={(id) => {
            removeInvoice(id);
            setSelectedInvoiceId(null);
          }}
          onEdit={(invoice) => {
            setSelectedInvoiceId(null);
            setBuilderState({ open: true, mode: 'edit', invoice });
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ invoice }: { invoice: InvoiceSummary }) {
  const label = displayStatus(invoice);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[label] ?? STATUS_STYLES.Draft
      }`}
    >
      {label}
    </span>
  );
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}

function EmptyState({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{filtered ? 'No matching invoices' : 'No invoices yet'}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered ? 'Try a different search or clear the active filter.' : 'Create your first invoice to bill a client.'}
      </p>
      {!filtered && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
        >
          New invoice
        </button>
      )}
    </div>
  );
}

function QuotePicker({
  quotes,
  creatingId,
  error,
  onPick,
  onClose,
}: {
  quotes: InvoiceableQuote[];
  creatingId: number | null;
  error: string | null;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Invoice from a quote</h2>
              <p className="text-sm text-gray-500">Approved &amp; sent quotes you can bill.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {error && <p className="border-b border-rose-100 bg-rose-50 px-6 py-2.5 text-sm font-medium text-rose-700">{error}</p>}
          <div className="max-h-[60vh] divide-y divide-gray-50 overflow-y-auto">
            {quotes.map((quote) => (
              <div
                key={quote.id}
                className="flex w-full items-center justify-between gap-4 px-6 py-3.5 transition-colors hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{quote.reference}</p>
                  <p className="truncate text-xs text-gray-500">
                    {quote.customer} · {quote.subject}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-gray-900 sm:hidden">
                    {quote.total.toLocaleString(undefined, { style: 'currency', currency: quote.currency })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 whitespace-nowrap">
                  <span className="hidden text-sm font-semibold text-gray-900 sm:block">
                    {quote.total.toLocaleString(undefined, { style: 'currency', currency: quote.currency })}
                  </span>
                  <a
                    href={`/modules/quotes/${quote.id}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-primary/40 hover:text-primary"
                    title="Open the quote editor in a new tab — adjust it, then come back and create the invoice"
                  >
                    Edit quote
                  </a>
                  <button
                    type="button"
                    disabled={creatingId !== null}
                    onClick={() => onPick(quote.id)}
                    className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {creatingId === quote.id ? 'Creating…' : 'Create →'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-gray-100 px-6 py-3 text-xs text-gray-400">
            “Edit quote” opens the quote in a new tab — after saving changes there, come back and hit Create.
            Invoices created here start as drafts you can still edit before sending.
          </p>
        </div>
      </div>
    </>
  );
}
