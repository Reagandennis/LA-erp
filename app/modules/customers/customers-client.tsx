'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { AccountStatus, CustomerAccount } from '@/lib/accounts';

interface CustomersClientProps {
  initialAccounts: CustomerAccount[];
  currency: string;
}

type Filter = 'All' | AccountStatus;

const FILTERS: Filter[] = ['All', 'Overdue', 'Open', 'Settled', 'New'];

const STATUS_STYLES: Record<string, string> = {
  Overdue: 'bg-rose-50 text-rose-700',
  Open: 'bg-blue-50 text-blue-700',
  Settled: 'bg-emerald-50 text-emerald-700',
  New: 'bg-gray-100 text-gray-600',
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Sent: 'bg-blue-50 text-blue-700',
  Partial: 'bg-amber-50 text-amber-700',
  Paid: 'bg-emerald-50 text-emerald-700',
  Void: 'bg-gray-100 text-gray-400',
  Overdue: 'bg-rose-50 text-rose-700',
};

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits: 2 });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function CustomersClient({ initialAccounts, currency }: CustomersClientProps) {
  const [accounts, setAccounts] = useState<CustomerAccount[]>(initialAccounts);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<Filter>('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesSearch =
        q.length === 0 ||
        account.name.toLowerCase().includes(q) ||
        (account.company?.toLowerCase().includes(q) ?? false) ||
        (account.email?.toLowerCase().includes(q) ?? false);
      const matchesFilter = activeFilter === 'All' || account.status === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [accounts, searchQuery, activeFilter]);

  const totals = useMemo(
    () => ({
      receivable: accounts.reduce((acc, a) => acc + a.balance, 0),
      overdue: accounts.reduce((acc, a) => acc + a.overdue, 0),
      collected: accounts.reduce((acc, a) => acc + a.totalPaid, 0),
      active: accounts.filter((a) => a.balance > 0).length,
    }),
    [accounts],
  );

  const selected = selectedId === null ? null : accounts.find((a) => a.id === selectedId) ?? null;
  const hasAccounts = accounts.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Customers</h1>
            <p className="mt-1 text-sm text-gray-500">
              Your customers and what they owe, drawn straight from invoices.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewForm(true)}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
            </svg>
            New customer
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Total receivable" value={formatMoney(totals.receivable, currency)} accent="text-primary" />
          <SummaryCard
            label="Overdue"
            value={formatMoney(totals.overdue, currency)}
            accent={totals.overdue > 0 ? 'text-rose-600' : 'text-gray-900'}
          />
          <SummaryCard label="Collected" value={formatMoney(totals.collected, currency)} />
          <SummaryCard label="Open accounts" value={`${totals.active}`} />
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
              placeholder="Search by name, company, or email…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {FILTERS.map((status) => (
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
          {filtered.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => setSelectedId(account.id)}
              className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={account.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{account.name}</p>
                    {account.company && <p className="truncate text-xs text-gray-400">{account.company}</p>}
                  </div>
                </div>
                <StatusBadge status={account.status} />
              </div>
              <div className="mt-3 flex items-end justify-between">
                <p className="text-xs text-gray-400">Last activity {formatDate(account.lastActivity)}</p>
                <p className="text-base font-bold text-gray-900">{formatMoney(account.balance, account.currency)}</p>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <EmptyState filtered={hasAccounts} />}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Account</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Open balance</th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-400">Overdue</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Last activity</th>
                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((account) => (
                <tr
                  key={account.id}
                  onClick={() => setSelectedId(account.id)}
                  className="group cursor-pointer transition-colors hover:bg-gray-50/70"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={account.name} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                          {account.name}
                        </p>
                        <p className="truncate text-xs text-gray-400">
                          {account.company || account.email || `${account.invoiceCount} invoices`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className="text-sm font-semibold text-gray-900">{formatMoney(account.balance, account.currency)}</p>
                    {account.openCount > 0 && (
                      <p className="text-xs text-gray-400">{account.openCount} open</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className={`text-sm font-semibold ${account.overdue > 0 ? 'text-rose-600' : 'text-gray-300'}`}>
                      {account.overdue > 0 ? formatMoney(account.overdue, account.currency) : '—'}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm text-gray-500">{formatDate(account.lastActivity)}</p>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={account.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <EmptyState filtered={hasAccounts} />}
        </div>
      </div>

      {selected && (
        <AccountDrawer account={selected} onClose={() => setSelectedId(null)} />
      )}

      {showNewForm && (
        <NewCustomerModal
          currency={currency}
          onClose={() => setShowNewForm(false)}
          onCreated={(account) => {
            setAccounts((current) => [account, ...current.filter((a) => a.id !== account.id)]);
            setShowNewForm(false);
            setSelectedId(account.id);
          }}
        />
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
      {initials(name)}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.New}`}>
      {status}
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

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{filtered ? 'No matching accounts' : 'No accounts yet'}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered ? 'Try a different search or filter.' : 'Add a customer or create an invoice to get started.'}
      </p>
    </div>
  );
}

function AccountDrawer({ account, onClose }: { account: CustomerAccount; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-2xl">
        <div className="relative overflow-hidden bg-primary px-6 py-6 text-white sm:px-8 sm:py-8">
          <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-bold tracking-tight">{account.name}</h2>
              <p className="mt-1 truncate text-sm text-white/60">
                {account.company || account.email || 'Customer account'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${account.status === 'Overdue' ? 'bg-rose-400/30' : 'bg-white/15'} text-white`}>
              {account.status}
            </span>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Open balance</p>
              <p className="text-2xl font-bold">{formatMoney(account.balance, account.currency)}</p>
            </div>
          </div>
          <div className="absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-secondary/10 blur-3xl" />
        </div>

        <div className="flex-1 space-y-7 px-6 py-6 sm:px-8">
          <div className="grid grid-cols-3 gap-2.5">
            <Cell label="Billed" value={formatMoney(account.totalBilled, account.currency)} />
            <Cell label="Collected" value={formatMoney(account.totalPaid, account.currency)} />
            <Cell label="Overdue" value={formatMoney(account.overdue, account.currency)} accent={account.overdue > 0 ? 'text-rose-600' : undefined} />
          </div>

          {(account.email || account.phone || account.billingAddress) && (
            <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-5 text-sm">
              {account.email && <p className="text-gray-700">{account.email}</p>}
              {account.phone && <p className="text-gray-500">{account.phone}</p>}
              {account.billingAddress && <p className="mt-1 whitespace-pre-wrap text-gray-500">{account.billingAddress}</p>}
            </div>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Invoices</h3>
              <Link href="/modules/invoices-review" target="_blank" className="text-xs font-semibold text-primary hover:text-primary/80">
                Go to invoices →
              </Link>
            </div>
            {account.invoices.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No invoices yet for this account.</p>
            ) : (
              <div className="space-y-2">
                {account.invoices.map((invoice) => {
                  const label = invoice.isOverdue ? 'Overdue' : invoice.status;
                  return (
                    <a
                      key={invoice.id}
                      href={`/modules/invoices-review/${invoice.id}/print`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 transition-colors hover:border-primary/30 hover:bg-white"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{invoice.number}</p>
                        <p className="text-xs text-gray-400">
                          Issued {formatDate(invoice.issueDate)} · due {formatDate(invoice.dueDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_STATUS_STYLES[label] ?? INVOICE_STATUS_STYLES.Draft}`}>
                          {label}
                        </span>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900">{formatMoney(invoice.total, invoice.currency)}</p>
                          {invoice.balanceDue > 0 && (
                            <p className="text-xs text-gray-400">{formatMoney(invoice.balanceDue, invoice.currency)} due</p>
                          )}
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Cell({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

function NewCustomerModal({
  currency,
  onClose,
  onCreated,
}: {
  currency: string;
  onClose: () => void;
  onCreated: (account: CustomerAccount) => void;
}) {
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', company: '', billingAddress: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    if (!draft.name.trim()) {
      setError('Customer name is required');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/quotes/customers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim() || null,
          company: draft.company.trim() || null,
          address: null,
          billingAddress: draft.billingAddress.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { customer?: { id: number; name: string; email: string | null; phone: string | null; company: string | null; billingAddress: string | null }; error?: string }
        | null;
      if (!response.ok || !data?.customer) {
        setError(data?.error ?? 'Could not create customer');
        return;
      }
      onCreated({
        id: data.customer.id,
        name: data.customer.name,
        email: data.customer.email,
        company: data.customer.company,
        phone: data.customer.phone,
        billingAddress: data.customer.billingAddress,
        status: 'New',
        balance: 0,
        totalBilled: 0,
        totalPaid: 0,
        overdue: 0,
        invoiceCount: 0,
        openCount: 0,
        lastActivity: null,
        currency,
        invoices: [],
      });
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm" onClick={() => (saving ? null : onClose())} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-lg font-bold text-gray-900">New customer</h2>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-3 px-6 py-5">
            <input
              type="text"
              placeholder="Customer name *"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className={inputClass}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="email"
                placeholder="Email"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                className={inputClass}
              />
              <input
                type="text"
                placeholder="Phone"
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                className={inputClass}
              />
            </div>
            <input
              type="text"
              placeholder="Company"
              value={draft.company}
              onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Billing address"
              value={draft.billingAddress}
              onChange={(e) => setDraft((d) => ({ ...d, billingAddress: e.target.value }))}
              className={inputClass}
            />
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add customer'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
