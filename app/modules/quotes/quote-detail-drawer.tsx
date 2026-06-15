'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import CreateTripFromQuoteModal from './create-trip-from-quote-modal';
import type { ApproverOption, OrganizationBranding, QuoteDetail } from './types';

interface QuoteDetailDrawerProps {
  quoteId: number;
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
  organization: OrganizationBranding;
  approvers: ApproverOption[];
  onClose: () => void;
  onChanged: (quote: QuoteDetail) => void;
  onDeleted: (quoteId: number) => void;
  onDuplicated: (quote: QuoteDetail) => void;
  onEdit: (quote: QuoteDetail) => void;
}

const STATUS_HEADER_STYLES: Record<string, string> = {
  Draft: 'bg-white/15 text-white',
  Submitted: 'bg-blue-400/25 text-white',
  Approved: 'bg-emerald-400/25 text-white',
  Declined: 'bg-rose-400/30 text-white',
  Sent: 'bg-violet-400/25 text-white',
  Expired: 'bg-amber-400/25 text-white',
};

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function QuoteDetailDrawer({
  quoteId,
  currentUser,
  isAdmin,
  organization,
  approvers,
  onClose,
  onChanged,
  onDeleted,
  onDuplicated,
  onEdit,
}: QuoteDetailDrawerProps) {
  const [quote, setQuote] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [showDeclineNote, setShowDeclineNote] = useState(false);
  const [showTripModal, setShowTripModal] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/quotes/${quoteId}`, { credentials: 'include' })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { quote?: QuoteDetail; error?: string }
          | null;
        if (!active) return;
        if (!response.ok || !data?.quote) {
          setError(data?.error ?? 'Could not load quote');
          return;
        }
        setQuote(data.quote);
      })
      .catch(() => {
        if (active) setError('Network error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [quoteId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const callAction = async (
    label: string,
    url: string,
    body?: unknown,
  ): Promise<{ quote: QuoteDetail; prompts?: { createTrip?: boolean } } | null> => {
    setActionPending(label);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json().catch(() => null)) as
        | { quote?: QuoteDetail; prompts?: { createTrip?: boolean }; error?: string }
        | null;
      if (!response.ok || !data?.quote) {
        setError(data?.error ?? 'Action failed');
        return null;
      }
      setQuote(data.quote);
      onChanged(data.quote);
      return { quote: data.quote, prompts: data.prompts };
    } catch {
      setError('Network error');
      return null;
    } finally {
      setActionPending(null);
    }
  };

  const handleApprove = async () => {
    if (!quote) return;
    const result = await callAction('approve', `/api/quotes/${quote.id}/decision`, {
      decision: 'approved',
      note: decisionNote.trim() || null,
    });
    if (result?.prompts?.createTrip && !result.quote.trip) {
      setShowTripModal(true);
    }
  };

  const handleDecline = async () => {
    if (!quote) return;
    if (!decisionNote.trim()) {
      setError('Add a short note explaining why you are declining');
      return;
    }
    await callAction('decline', `/api/quotes/${quote.id}/decision`, {
      decision: 'declined',
      note: decisionNote.trim(),
    });
    setShowDeclineNote(false);
  };

  const handleSubmit = async () => {
    if (!quote) return;
    await callAction('submit', `/api/quotes/${quote.id}/submit`);
  };

  const handleMarkSent = async () => {
    if (!quote) return;
    await callAction('send', `/api/quotes/${quote.id}/send`);
  };

  const handleDuplicate = async () => {
    if (!quote) return;
    setActionPending('duplicate');
    setError(null);
    try {
      const response = await fetch(`/api/quotes/${quote.id}/duplicate`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await response.json().catch(() => null)) as
        | { quote?: QuoteDetail; error?: string }
        | null;
      if (!response.ok || !data?.quote) {
        setError(data?.error ?? 'Could not duplicate');
        return;
      }
      onDuplicated(data.quote);
    } catch {
      setError('Network error');
    } finally {
      setActionPending(null);
    }
  };

  const handleDelete = async () => {
    if (!quote) return;
    if (!confirm(`Delete quote ${quote.reference}? This cannot be undone.`)) {
      return;
    }
    setActionPending('delete');
    setError(null);
    try {
      const response = await fetch(`/api/quotes/${quote.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete quote');
        return;
      }
      onDeleted(quote.id);
    } catch {
      setError('Network error');
    } finally {
      setActionPending(null);
    }
  };

  const isCreator = quote ? quote.createdBy.id === currentUser.id : false;
  const isApprover = quote ? quote.approver?.id === currentUser.id : false;
  const canEdit =
    quote &&
    (isAdmin ||
      ((isCreator) && (quote.status === 'Draft' || quote.status === 'Declined')) ||
      (isApprover && quote.status === 'Approved'));
  const canSubmit =
    quote && (isCreator || isAdmin) && (quote.status === 'Draft' || quote.status === 'Declined');
  const canDecide = quote && (isApprover || isAdmin) && quote.status === 'Submitted';
  const canSend = quote && (isCreator || isAdmin) && quote.status === 'Approved';
  const canDelete =
    quote && (isCreator || isAdmin) && (quote.status === 'Draft' || quote.status === 'Declined');

  const issuer =
    quote?.brandProfile?.companyName ||
    quote?.brandProfile?.name ||
    organization.companyName ||
    'Organization default';

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-sm"
        onClick={() => (actionPending ? null : onClose())}
      />
      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col overflow-y-auto bg-white shadow-2xl sm:max-w-2xl">
        {loading && <div className="p-16 text-center text-sm text-gray-500">Loading…</div>}

        {!loading && error && !quote && (
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

        {!loading && quote && (
          <>
            {/* Header */}
            <div className="relative overflow-hidden bg-primary px-6 py-6 text-white sm:px-8 sm:py-8">
              <div className="relative z-10 mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-secondary">
                    {quote.reference}
                  </span>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight">{quote.subject}</h2>
                  <p className="mt-1 truncate text-sm text-white/60">
                    {quote.customer.name}
                    {quote.customer.company ? ` · ${quote.customer.company}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
                  aria-label="Close drawer"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="relative z-10 flex flex-wrap items-center gap-2 text-xs text-white/60">
                <span
                  className={`rounded-full px-2.5 py-1 font-semibold ${
                    STATUS_HEADER_STYLES[quote.status] ?? STATUS_HEADER_STYLES.Draft
                  }`}
                >
                  {quote.status}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  {quote.brandProfile?.primaryColor && (
                    <span
                      className="h-2.5 w-2.5 rounded-full ring-1 ring-white/30"
                      style={{ backgroundColor: quote.brandProfile.primaryColor }}
                    />
                  )}
                  {issuer}
                </span>
                <span className="text-white/30">·</span>
                <span>By {quote.createdBy.name}</span>
                <span className="text-white/30">·</span>
                <span>{quote.currency}</span>
              </div>
              <div className="absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-secondary/10 blur-3xl" />
            </div>

            {/* Body */}
            <div className="flex-1 space-y-7 px-6 py-6 sm:px-8">
              <div className="grid grid-cols-3 gap-2.5">
                <Cell label="Issued" value={formatDate(quote.issueDate)} />
                <Cell label="Expires" value={formatDate(quote.expiryDate)} />
                <Cell label={organization.taxLabel || 'Tax'} value={`${(quote.taxRate * 100).toFixed(2)}%`} />
                <Cell label="Submitted" value={formatDateTime(quote.submittedAt)} />
                <Cell label="Decided" value={formatDateTime(quote.decidedAt)} />
                <Cell label="Sent" value={formatDateTime(quote.sentAt)} />
              </div>

              <div>
                <h3 className="mb-3 border-b border-gray-100 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Line items
                </h3>
                <div className="space-y-2">
                  {quote.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{item.description}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {item.quantity} {Number(item.quantity) === 1 ? 'day' : 'days'} ·{' '}
                          {formatMoney(item.unitPrice, quote.currency)}/day
                          {!item.taxable ? ' · non-taxable' : ''}
                        </p>
                      </div>
                      <p className="whitespace-nowrap text-sm font-semibold text-gray-900">
                        {formatMoney(item.total, quote.currency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5 rounded-2xl border border-gray-100 bg-gray-50/60 p-5">
                <Row label="Subtotal" value={formatMoney(quote.subtotal, quote.currency)} />
                <Row
                  label={`${organization.taxLabel || 'Tax'} (${(quote.taxRate * 100).toFixed(2)}%)`}
                  value={formatMoney(quote.tax, quote.currency)}
                />
                {quote.discountType !== 'none' && quote.discountAmount > 0 && (
                  <Row
                    label={`Discount${quote.discountType === 'percentage' ? ` (${quote.discountValue}%)` : ''}`}
                    value={`- ${formatMoney(quote.discountAmount, quote.currency)}`}
                  />
                )}
                <div className="flex items-center justify-between border-t border-gray-200 pt-2.5">
                  <span className="text-sm font-semibold text-gray-900">Total</span>
                  <span className="text-xl font-bold text-primary">
                    {formatMoney(quote.total, quote.currency)}
                  </span>
                </div>
              </div>

              {quote.notes && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-5">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Internal notes
                  </h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-900/80">{quote.notes}</p>
                </div>
              )}

              {quote.terms && (
                <div className="rounded-2xl border border-gray-100 bg-gray-50/60 p-5">
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Terms &amp; conditions
                  </h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{quote.terms}</p>
                </div>
              )}

              {quote.decisionNote && (
                <div
                  className={`rounded-2xl border p-5 ${
                    quote.status === 'Declined'
                      ? 'border-rose-100 bg-rose-50 text-rose-900'
                      : 'border-emerald-100 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider">Approver note</h4>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{quote.decisionNote}</p>
                </div>
              )}

              {canDecide && (
                <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50 p-5">
                  <h4 className="text-sm font-semibold text-blue-900">Decision required</h4>
                  <textarea
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    rows={3}
                    placeholder="Optional note for approval, required for decline"
                    className="w-full rounded-xl bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={handleApprove}
                      disabled={actionPending !== null}
                      className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {actionPending === 'approve' ? 'Approving…' : 'Approve quote'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (showDeclineNote) handleDecline();
                        else setShowDeclineNote(true);
                      }}
                      disabled={actionPending !== null}
                      className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                    >
                      {actionPending === 'decline'
                        ? 'Declining…'
                        : showDeclineNote
                          ? 'Confirm decline'
                          : 'Decline quote'}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
                  {error}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-gray-100 bg-white px-6 py-4 sm:px-8">
              {quote.trip ? (
                <Link
                  href={`/modules/trip-planning?focus=${quote.trip.id}`}
                  className="w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                >
                  View trip {quote.trip.reference} · {quote.trip.trackingCode}
                </Link>
              ) : (
                quote.status === 'Approved' && (
                  <button
                    type="button"
                    onClick={() => setShowTripModal(true)}
                    className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                  >
                    Create trip from quote
                  </button>
                )
              )}

              {canSend && (
                <button
                  type="button"
                  onClick={handleMarkSent}
                  disabled={actionPending !== null}
                  className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionPending === 'send' ? 'Marking sent…' : 'Mark as dispatched'}
                </button>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <a
                  href={`/api/quotes/${quote.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-gray-200 py-2.5 text-center text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
                >
                  Download PDF
                </a>
                <Link
                  href={`/modules/quotes/${quote.id}/print`}
                  target="_blank"
                  className="rounded-xl border border-gray-200 py-2.5 text-center text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
                >
                  Preview proposal
                </Link>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(quote)}
                    className="rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
                  >
                    Edit
                  </button>
                )}
                {canSubmit && (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={actionPending !== null}
                    className="rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
                  >
                    {actionPending === 'submit' ? 'Submitting…' : 'Submit for approval'}
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleDuplicate}
                  disabled={actionPending !== null}
                  className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 disabled:opacity-50"
                >
                  {actionPending === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={actionPending !== null}
                    className="text-sm font-medium text-rose-600 transition-colors hover:text-rose-800 disabled:opacity-50"
                  >
                    {actionPending === 'delete' ? 'Deleting…' : 'Delete quote'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {showTripModal && quote && (
        <CreateTripFromQuoteModal
          quote={quote}
          owners={approvers}
          currentUser={currentUser}
          onClose={() => setShowTripModal(false)}
          onCreated={({ quote: refreshedQuote }) => {
            setQuote(refreshedQuote);
            onChanged(refreshedQuote);
            setShowTripModal(false);
          }}
        />
      )}
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
