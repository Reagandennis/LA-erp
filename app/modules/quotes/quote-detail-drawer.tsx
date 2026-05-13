'use client';

import { useEffect, useState } from 'react';

import type { OrganizationBranding, QuoteDetail } from './types';

interface QuoteDetailDrawerProps {
  quoteId: number;
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
  organization: OrganizationBranding;
  onClose: () => void;
  onChanged: (quote: QuoteDetail) => void;
  onDeleted: (quoteId: number) => void;
  onDuplicated: (quote: QuoteDetail) => void;
  onEdit: (quote: QuoteDetail) => void;
}

const STATUS_HEADER_STYLES: Record<string, string> = {
  Draft: 'bg-gray-500/10 border-gray-500/20 text-gray-300',
  Submitted: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
  Approved: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
  Declined: 'bg-rose-500/10 border-rose-500/20 text-rose-300',
  Sent: 'bg-violet-500/10 border-violet-500/20 text-violet-300',
  Expired: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
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

function describeDiscount(type: string, value: number, currency: string) {
  if (type === 'none' || !value) return '—';
  if (type === 'percentage') return `${value}%`;
  return formatMoney(value, currency);
}

export default function QuoteDetailDrawer({
  quoteId,
  currentUser,
  isAdmin,
  organization,
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
  ): Promise<QuoteDetail | null> => {
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
        | { quote?: QuoteDetail; error?: string }
        | null;
      if (!response.ok || !data?.quote) {
        setError(data?.error ?? 'Action failed');
        return null;
      }
      setQuote(data.quote);
      onChanged(data.quote);
      return data.quote;
    } catch {
      setError('Network error');
      return null;
    } finally {
      setActionPending(null);
    }
  };

  const handleApprove = async () => {
    if (!quote) return;
    await callAction('approve', `/api/quotes/${quote.id}/decision`, {
      decision: 'approved',
      note: decisionNote.trim() || null,
    });
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

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40"
        onClick={() => (actionPending ? null : onClose())}
      />
      <div className="fixed right-0 top-0 h-full w-full sm:max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
        {loading && (
          <div className="p-16 text-center text-sm font-bold text-gray-500">Loading…</div>
        )}

        {!loading && error && !quote && (
          <div className="p-16 text-center">
            <p className="text-rose-600 font-bold text-sm">{error}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 px-6 py-3 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest"
            >
              Close
            </button>
          </div>
        )}

        {!loading && quote && (
          <>
            <div className="p-6 sm:p-10 border-b border-gray-50 bg-gray-900 text-white relative overflow-hidden">
              <div className="flex justify-between items-start mb-6 sm:mb-8 relative z-10">
                <div>
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em] mb-2 block">
                    {quote.reference}
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-1">{quote.subject}</h2>
                  <p className="text-white/50 font-bold text-sm">
                    {quote.customer.name}
                    {quote.customer.company ? ` • ${quote.customer.company}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white"
                  aria-label="Close drawer"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:gap-4 relative z-10">
                <div
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                    STATUS_HEADER_STYLES[quote.status] ?? STATUS_HEADER_STYLES.Draft
                  }`}
                >
                  {quote.status}
                </div>
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                  Created by {quote.createdBy.name}
                </span>
                {quote.approver && (
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                    Approver: {quote.approver.name}
                  </span>
                )}
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                  {quote.currency}
                </span>
              </div>
              <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl" />
            </div>

            <div className="p-6 sm:p-10 space-y-8 sm:space-y-10 flex-1">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <Cell label="Issued" value={formatDate(quote.issueDate)} />
                <Cell label="Expires" value={formatDate(quote.expiryDate)} />
                <Cell label={`${organization.taxLabel || 'Tax'}`} value={`${(quote.taxRate * 100).toFixed(2)}%`} />
                <Cell label="Submitted" value={formatDateTime(quote.submittedAt)} />
                <Cell label="Decided" value={formatDateTime(quote.decidedAt)} />
                <Cell label="Sent" value={formatDateTime(quote.sentAt)} />
              </div>

              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4 border-b border-gray-100 pb-3">
                  Line items
                </h3>
                <div className="space-y-3">
                  {quote.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-gray-900 truncate">{item.description}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                          QTY {item.quantity} • UNIT {formatMoney(item.unitPrice, quote.currency)}
                          {!item.taxable ? ' • non-taxable' : ''}
                          {item.discountType !== 'none' && item.discountValue > 0
                            ? ` • discount ${describeDiscount(item.discountType, item.discountValue, quote.currency)}`
                            : ''}
                        </p>
                      </div>
                      <p className="text-sm font-black text-gray-900 whitespace-nowrap">
                        {formatMoney(item.total, quote.currency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border-2 border-gray-100 rounded-[2rem] p-6 space-y-3">
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
                <div className="pt-3 border-t border-gray-100 flex justify-between items-center">
                  <span className="text-sm font-black text-gray-900 uppercase tracking-widest">Total</span>
                  <span className="text-2xl font-black text-emerald-600">
                    {formatMoney(quote.total, quote.currency)}
                  </span>
                </div>
              </div>

              {quote.notes && (
                <div className="bg-amber-50/50 p-6 rounded-[2rem] border border-amber-100">
                  <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-2">
                    Internal notes
                  </h4>
                  <p className="text-sm text-amber-900/80 leading-relaxed whitespace-pre-wrap">{quote.notes}</p>
                </div>
              )}

              {quote.terms && (
                <div className="bg-gray-50 p-6 rounded-[2rem] border border-gray-100">
                  <h4 className="text-[10px] font-black text-gray-700 uppercase tracking-widest mb-2">
                    Terms & conditions
                  </h4>
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{quote.terms}</p>
                </div>
              )}

              {quote.decisionNote && (
                <div
                  className={`p-6 rounded-[2rem] border ${
                    quote.status === 'Declined'
                      ? 'bg-rose-50 border-rose-100 text-rose-900'
                      : 'bg-emerald-50 border-emerald-100 text-emerald-900'
                  }`}
                >
                  <h4 className="text-[10px] font-black uppercase tracking-widest mb-2">Approver note</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{quote.decisionNote}</p>
                </div>
              )}

              {canDecide && (
                <div className="bg-blue-50 p-6 rounded-[2rem] border border-blue-100 space-y-3">
                  <h4 className="text-[10px] font-black text-blue-900 uppercase tracking-widest">
                    Decision required
                  </h4>
                  <textarea
                    value={decisionNote}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    rows={3}
                    placeholder="Optional note for approval, required for decline"
                    className="w-full px-3 py-2 bg-white rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-400"
                  />
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={handleApprove}
                      disabled={actionPending !== null}
                      className="flex-1 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
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
                      className="flex-1 py-3 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-700 disabled:opacity-50"
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
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
                  {error}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-8 sticky bottom-0 bg-white border-t border-gray-100 flex flex-col gap-3">
              <a
                href={`/api/quotes/${quote.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 sm:py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-[0.25em] text-xs hover:bg-black text-center"
              >
                Download PDF
              </a>

              {canSend && (
                <button
                  type="button"
                  onClick={handleMarkSent}
                  disabled={actionPending !== null}
                  className="w-full py-3 sm:py-4 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-[0.25em] text-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  {actionPending === 'send' ? 'Marking sent…' : 'Mark as dispatched'}
                </button>
              )}

              <div className="grid grid-cols-2 gap-3">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onEdit(quote)}
                    className="py-3 border-2 border-gray-900 text-gray-900 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-50"
                  >
                    Edit
                  </button>
                )}
                {canSubmit && (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={actionPending !== null}
                    className="py-3 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-black disabled:opacity-50"
                  >
                    {actionPending === 'submit' ? 'Submitting…' : 'Submit for approval'}
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleDuplicate}
                  disabled={actionPending !== null}
                  className="text-xs font-black text-gray-700 uppercase tracking-widest hover:text-gray-900 disabled:opacity-50"
                >
                  {actionPending === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={actionPending !== null}
                    className="text-xs font-black text-rose-600 uppercase tracking-widest hover:text-rose-800 disabled:opacity-50"
                  >
                    {actionPending === 'delete' ? 'Deleting…' : 'Delete quote'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-2xl p-3 sm:p-4">
      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xs font-bold text-gray-900">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="font-bold text-gray-500 uppercase tracking-widest">{label}</span>
      <span className="font-black text-gray-900">{value}</span>
    </div>
  );
}
