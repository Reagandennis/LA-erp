'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PAYMENT_METHODS } from './types';
import type { ApproverOption, InvoiceDetail, OrganizationBranding } from './types';

interface InvoiceDetailDrawerProps {
  invoiceId: number;
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
  organization: OrganizationBranding;
  approvers: ApproverOption[];
  onClose: () => void;
  onChanged: (invoice: InvoiceDetail) => void;
  onDeleted: (invoiceId: number) => void;
  onEdit: (invoice: InvoiceDetail) => void;
}

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-white/15 text-white',
  'Pending Approval': 'bg-amber-400/25 text-white',
  Approved: 'bg-emerald-400/30 text-white',
  Declined: 'bg-rose-400/30 text-white',
  Sent: 'bg-blue-400/25 text-white',
  Partial: 'bg-amber-400/25 text-white',
  Paid: 'bg-emerald-400/30 text-white',
  Void: 'bg-white/10 text-white/70',
  Overdue: 'bg-rose-400/30 text-white',
};

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, { style: 'currency', currency, maximumFractionDigits: 2 });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function InvoiceDetailDrawer({
  invoiceId,
  currentUser,
  isAdmin,
  organization,
  onClose,
  onChanged,
  onDeleted,
  onEdit,
  approvers,
}: InvoiceDetailDrawerProps) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickBooksNotice, setQuickBooksNotice] = useState<{ tone: 'ok' | 'warn'; message: string } | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [submitApproverId, setSubmitApproverId] = useState('');
  const [decisionDraft, setDecisionDraft] = useState('');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payment, setPayment] = useState({
    amount: '',
    method: PAYMENT_METHODS[0],
    paidAt: todayIso(),
    reference: '',
    note: '',
  });

  // Which record the current `invoice`/`error` belong to; "loading" is derived
  // from it instead of being toggled with extra renders.
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const loading = loadedId !== invoiceId;

  useEffect(() => {
    let active = true;
    fetch(`/api/invoices/${invoiceId}`, { credentials: 'include' })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { invoice?: InvoiceDetail; error?: string } | null;
        if (!active) return;
        if (!response.ok || !data?.invoice) {
          setInvoice(null);
          setError(data?.error ?? 'Could not load invoice');
          return;
        }
        setInvoice(data.invoice);
        setError(null);
        setPayment((p) => ({ ...p, amount: data.invoice!.balanceDue > 0 ? String(data.invoice!.balanceDue) : '' }));
      })
      .catch(() => {
        if (active) {
          setInvoice(null);
          setError('Network error');
        }
      })
      .finally(() => active && setLoadedId(invoiceId));
    return () => {
      active = false;
    };
  }, [invoiceId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const callAction = async (label: string, url: string, body?: Record<string, unknown>): Promise<void> => {
    setActionPending(label);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        ...(body !== undefined
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const data = (await response.json().catch(() => null)) as { invoice?: InvoiceDetail; error?: string } | null;
      if (!response.ok || !data?.invoice) {
        setError(data?.error ?? 'Action failed');
        return;
      }
      setInvoice(data.invoice);
      onChanged(data.invoice);
    } catch {
      setError('Network error');
    } finally {
      setActionPending(null);
    }
  };

  const handleRecordPayment = async () => {
    if (!invoice) return;
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a payment amount greater than zero');
      return;
    }
    setActionPending('payment');
    setError(null);
    setQuickBooksNotice(null);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          method: payment.method,
          paidAt: payment.paidAt,
          reference: payment.reference.trim() || null,
          note: payment.note.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            invoice?: InvoiceDetail & { quickbooks?: { status: string; error?: string } };
            error?: string;
          }
        | null;
      if (!response.ok || !data?.invoice) {
        setError(data?.error ?? 'Could not record payment');
        return;
      }
      const quickbooks = data.invoice.quickbooks;
      if (quickbooks?.status === 'synced') {
        setQuickBooksNotice({ tone: 'ok', message: 'Payment also recorded in QuickBooks.' });
      } else if (quickbooks?.status === 'failed') {
        setQuickBooksNotice({
          tone: 'warn',
          message: `Payment recorded locally, but QuickBooks sync failed: ${quickbooks.error ?? 'unknown error'}`,
        });
      }
      setInvoice(data.invoice);
      onChanged(data.invoice);
      setShowPaymentForm(false);
      setPayment((p) => ({ ...p, amount: data.invoice!.balanceDue > 0 ? String(data.invoice!.balanceDue) : '', reference: '', note: '' }));
    } catch {
      setError('Network error');
    } finally {
      setActionPending(null);
    }
  };

  const handleDelete = async () => {
    if (!invoice) return;
    if (!confirm(`Delete draft ${invoice.number}? This cannot be undone.`)) return;
    setActionPending('delete');
    setError(null);
    try {
      const response = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete');
        return;
      }
      onDeleted(invoice.id);
    } catch {
      setError('Network error');
    } finally {
      setActionPending(null);
    }
  };

  const handleVoid = async () => {
    if (!invoice) return;
    if (!confirm(`Void ${invoice.number}? It will no longer count toward what's owed.`)) return;
    await callAction('void', `/api/invoices/${invoice.id}/void`);
  };

  const statusLabel = invoice ? (invoice.isOverdue ? 'Overdue' : invoice.status) : '';
  const issuer =
    invoice?.brandProfile?.companyName || invoice?.brandProfile?.name || organization.companyName || 'Organization default';
  const canEdit = invoice && (invoice.status === 'Draft' || invoice.status === 'Declined');
  const canPay =
    invoice &&
    (invoice.status === 'Approved' || invoice.status === 'Sent' || invoice.status === 'Partial') &&
    invoice.balanceDue > 0;
  const taxLabel = organization.taxLabel || 'Tax';

  return (
    <>
      {/* Above the top bar (z-200), so the drawer's header and close button are never covered. */}
      <div
        className="fixed inset-0 z-[220] bg-gray-900/20 backdrop-blur-sm"
        onClick={() => (actionPending ? null : onClose())}
      />
      <div className="fixed right-0 top-0 z-[230] flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-2xl">
        {loading && <div className="p-16 text-center text-sm text-gray-500">Loading…</div>}

        {!loading && error && !invoice && (
          <div className="p-16 text-center">
            <p className="text-sm font-semibold text-rose-600">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-black"
            >
              Close
            </button>
          </div>
        )}

        {!loading && invoice && (
          <>
            <div className="relative overflow-hidden bg-primary px-6 py-6 text-white sm:px-8 sm:py-8">
              <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-secondary">{invoice.number}</span>
                  <h2 className="mt-1 truncate text-2xl font-bold tracking-tight">{invoice.customer.name}</h2>
                  <p className="mt-1 truncate text-sm text-white/60">
                    {invoice.customer.company ? invoice.customer.company : invoice.customer.email ?? ''}
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
                <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                  <span className={`rounded-full px-2.5 py-1 font-semibold ${STATUS_STYLES[statusLabel] ?? STATUS_STYLES.Draft}`}>
                    {statusLabel}
                  </span>
                  <span>{issuer}</span>
                  <span className="text-white/30">·</span>
                  <span>Due {formatDate(invoice.dueDate)}</span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
                    {invoice.balanceDue > 0 ? 'Balance due' : 'Paid in full'}
                  </p>
                  <p className="text-2xl font-bold">{formatMoney(invoice.balanceDue, invoice.currency)}</p>
                </div>
              </div>
              <div className="absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-secondary/10 blur-3xl" />
            </div>

            <div className="flex-1 space-y-7 px-6 py-6 sm:px-8">
              <div className="grid grid-cols-3 gap-2.5">
                <Cell label="Issued" value={formatDate(invoice.issueDate)} />
                <Cell label="Due" value={formatDate(invoice.dueDate)} />
                <Cell label={taxLabel} value={`${(invoice.taxRate * 100).toFixed(2)}%`} />
              </div>

              <div>
                <h3 className="mb-3 border-b border-gray-100 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Line items
                </h3>
                <div className="space-y-2">
                  {invoice.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{item.description}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {item.quantity} {Number(item.quantity) === 1 ? 'day' : 'days'} ·{' '}
                          {formatMoney(item.unitPrice, invoice.currency)}/day
                          {!item.taxable ? ' · non-taxable' : ''}
                        </p>
                      </div>
                      <p className="whitespace-nowrap text-sm font-semibold text-gray-900">
                        {formatMoney(item.total, invoice.currency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5 rounded-2xl border border-gray-100 bg-gray-50/60 p-5">
                <Row label="Subtotal" value={formatMoney(invoice.subtotal, invoice.currency)} />
                <Row label={`${taxLabel} (${(invoice.taxRate * 100).toFixed(2)}%)`} value={formatMoney(invoice.tax, invoice.currency)} />
                <div className="flex items-center justify-between border-t border-gray-200 pt-2.5">
                  <span className="text-sm font-semibold text-gray-900">Total</span>
                  <span className="text-base font-bold text-gray-900">{formatMoney(invoice.total, invoice.currency)}</span>
                </div>
                {invoice.amountPaid > 0 && (
                  <Row label="Amount paid" value={`- ${formatMoney(invoice.amountPaid, invoice.currency)}`} />
                )}
                <div className="flex items-center justify-between border-t border-gray-200 pt-2.5">
                  <span className="text-sm font-semibold text-gray-900">Balance due</span>
                  <span className="text-lg font-bold text-primary">{formatMoney(invoice.balanceDue, invoice.currency)}</span>
                </div>
              </div>

              {canPay && showPaymentForm && (
                <div className="space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
                  <h4 className="text-sm font-semibold text-emerald-900">Record a payment</h4>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={payment.amount}
                        onChange={(e) => setPayment((p) => ({ ...p, amount: e.target.value }))}
                        className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Date</label>
                      <input
                        type="date"
                        value={payment.paidAt}
                        onChange={(e) => setPayment((p) => ({ ...p, paidAt: e.target.value }))}
                        className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Method</label>
                      <select
                        value={payment.method}
                        onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))}
                        className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Reference</label>
                      <input
                        type="text"
                        value={payment.reference}
                        placeholder="Optional"
                        onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))}
                        className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPaymentForm(false)}
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleRecordPayment}
                      disabled={actionPending !== null}
                      className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {actionPending === 'payment' ? 'Saving…' : 'Record payment'}
                    </button>
                  </div>
                </div>
              )}

              {invoice.payments.length > 0 && (
                <div>
                  <h3 className="mb-3 border-b border-gray-100 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Payments
                  </h3>
                  <div className="space-y-2">
                    {invoice.payments.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                        <div>
                          <span className="font-medium text-gray-900">{formatMoney(p.amount, invoice.currency)}</span>
                          <span className="text-gray-500"> · {p.method}</span>
                          {p.reference && <span className="text-gray-400"> · {p.reference}</span>}
                        </div>
                        <span className="text-xs text-gray-400">{formatDate(p.paidAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {invoice.notes && (
                <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-5">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Message</h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{invoice.notes}</p>
                </div>
              )}

              {quickBooksNotice && (
                <div
                  className={`rounded-xl border p-4 text-sm font-medium ${
                    quickBooksNotice.tone === 'ok'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {quickBooksNotice.message}
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">{error}</div>
              )}
            </div>

            <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-gray-100 bg-white px-6 py-4 sm:px-8">
              {canPay && !showPaymentForm && (
                <button
                  type="button"
                  onClick={() => setShowPaymentForm(true)}
                  className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  Record payment
                </button>
              )}
              {(invoice.status === 'Draft' || invoice.status === 'Declined') && (
                <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {invoice.status === 'Declined' ? 'Declined — revise and resubmit' : 'Submit for approval'}
                  </p>
                  {invoice.status === 'Declined' && invoice.decisionNote && (
                    <p className="text-sm text-rose-600">“{invoice.decisionNote}”</p>
                  )}
                  <div className="flex gap-2">
                    <select
                      value={submitApproverId}
                      onChange={(event) => setSubmitApproverId(event.target.value)}
                      className="flex-1 rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">Select approver…</option>
                      {approvers.map((approver) => (
                        <option key={approver.id} value={approver.id}>{approver.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={actionPending !== null || !submitApproverId}
                      onClick={() =>
                        callAction('submit', `/api/invoices/${invoice.id}/submit`, {
                          approverId: Number(submitApproverId),
                        })
                      }
                      className="rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {actionPending === 'submit' ? 'Submitting…' : 'Submit'}
                    </button>
                  </div>
                </div>
              )}
              {invoice.status === 'Pending Approval' &&
                (invoice.createdBy.id !== currentUser.id &&
                (isAdmin || invoice.approver?.id === currentUser.id) ? (
                  <div className="space-y-2 rounded-xl border border-amber-100 bg-amber-50/60 p-3.5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                      Awaiting your approval
                    </p>
                    <input
                      type="text"
                      placeholder="Decision note (optional)"
                      value={decisionDraft}
                      onChange={(event) => setDecisionDraft(event.target.value)}
                      className="w-full rounded-lg bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={actionPending !== null}
                        onClick={() =>
                          callAction('decision', `/api/invoices/${invoice.id}/decision`, {
                            decision: 'approved',
                            note: decisionDraft.trim() || null,
                          })
                        }
                        className="rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {actionPending === 'decision' ? 'Saving…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        disabled={actionPending !== null}
                        onClick={() =>
                          callAction('decision', `/api/invoices/${invoice.id}/decision`, {
                            decision: 'declined',
                            note: decisionDraft.trim() || null,
                          })
                        }
                        className="rounded-lg border border-rose-200 bg-white py-2.5 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-xl border border-amber-100 bg-amber-50/60 p-3.5 text-sm text-amber-700">
                    Awaiting approval from{' '}
                    {invoice.approver
                      ? `${invoice.approver.name} (${invoice.approver.email})`
                      : 'the assigned approver'}
                    . You submitted this invoice, so you cannot approve it yourself.
                  </p>
                ))}
              {invoice.status === 'Approved' && (
                <button
                  type="button"
                  onClick={() => callAction('send', `/api/invoices/${invoice.id}/send`)}
                  disabled={actionPending !== null}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionPending === 'send' ? 'Sending…' : 'Email to customer'}
                </button>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <a
                  href={`/api/invoices/${invoice.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-gray-200 py-2.5 text-center text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
                >
                  Download PDF
                </a>
                <Link
                  href={`/modules/invoices-review/${invoice.id}/print`}
                  target="_blank"
                  className="rounded-xl border border-gray-200 py-2.5 text-center text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
                >
                  Preview
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(invoice)}
                    className="rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
                  >
                    Edit
                  </button>
                )}
                {invoice.status !== 'Void' && invoice.status !== 'Paid' && (
                  <button
                    type="button"
                    onClick={handleVoid}
                    disabled={actionPending !== null}
                    className="rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  >
                    {actionPending === 'void' ? 'Voiding…' : 'Void'}
                  </button>
                )}
              </div>
              {(invoice.status === 'Draft' || invoice.status === 'Declined') && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={actionPending !== null}
                  className="text-sm font-medium text-rose-600 transition-colors hover:text-rose-800 disabled:opacity-50"
                >
                  {actionPending === 'delete' ? 'Deleting…' : 'Delete draft'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <p className="text-xs font-medium text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
