'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useEffect, useState } from 'react';

import type { ApproverOption, QuoteDetail, QuoteTripSummary } from './types';

interface CreateTripFromQuoteModalProps {
  quote: QuoteDetail;
  owners: ApproverOption[];
  currentUser: { id: number; name: string; email: string };
  onClose: () => void;
  onCreated: (payload: { trip: QuoteTripSummary; quote: QuoteDetail }) => void;
}

function formatMoney(value: number, currency: string) {
  return value.toLocaleString(APP_LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
}

export default function CreateTripFromQuoteModal({
  quote,
  owners,
  currentUser,
  onClose,
  onCreated,
}: CreateTripFromQuoteModalProps) {
  const [title, setTitle] = useState(quote.subject);
  const [ownerId, setOwnerId] = useState(String(currentUser.id));
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(quote.expiryDate.slice(0, 10));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, pending]);

  const handleCreate = async () => {
    setError(null);
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setPending(true);
    try {
      const r = await fetch(`/api/quotes/${quote.id}/trip`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          ownerId: ownerId ? Number(ownerId) : null,
          startDate,
          endDate,
          notes: notes.trim() || null,
        }),
      });
      const data = (await r.json().catch(() => null)) as
        | {
            trip?: {
              id: number;
              reference: string;
              trackingCode: string;
              status: string;
            };
            quote?: QuoteDetail;
            error?: string;
          }
        | null;
      if (!r.ok || !data?.trip || !data?.quote) {
        setError(data?.error ?? 'Could not create trip');
        return;
      }
      onCreated({
        trip: {
          id: data.trip.id,
          reference: data.trip.reference,
          trackingCode: data.trip.trackingCode,
          status: data.trip.status,
        },
        quote: data.quote,
      });
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[240]"
        onClick={() => (pending ? null : onClose())}
      />
      <div className="fixed inset-0 z-[245] flex items-stretch sm:items-center justify-center sm:p-4 pointer-events-none">
        <div className="bg-white w-full max-w-xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto rounded-none sm:rounded-[2rem] shadow-2xl pointer-events-auto">
          <div className="p-6 sm:p-8 border-b border-gray-100 flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em]">
                Create trip from quote
              </p>
              <h2 className="mt-1 text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                {quote.reference}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {quote.customer.name}
                {quote.customer.company ? ` • ${quote.customer.company}` : ''} ·{' '}
                {quote.items.length} {quote.items.length === 1 ? 'item' : 'items'} ·{' '}
                {formatMoney(quote.total, quote.currency)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="p-2 text-gray-400 hover:text-gray-700 rounded-xl disabled:opacity-50"
              aria-label="Close"
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

          <div className="p-6 sm:p-8 space-y-5">
            <Field label="Trip title">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              />
            </Field>

            <Field label="Owner">
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
              >
                <option value={String(currentUser.id)}>{currentUser.name} (you)</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {o.email}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
                />
              </Field>
              <Field label="End date">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
                />
              </Field>
            </div>

            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary"
              />
            </Field>

            <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4">
              <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">
                Itinerary preview
              </p>
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {quote.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between text-xs text-gray-700"
                  >
                    <span className="truncate flex-1 pr-3">{item.description}</span>
                    <span className="font-bold whitespace-nowrap">
                      {item.quantity} × {formatMoney(item.unitPrice, quote.currency)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-3">
                Items will be deep-cloned to the trip; the quote is not modified.
              </p>
            </div>

            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div className="p-4 sm:p-6 border-t border-gray-100 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sm:ml-auto px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50"
            >
              Skip for now
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={pending}
              className="px-6 py-3 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? 'Creating…' : 'Create trip'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
        {label}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
