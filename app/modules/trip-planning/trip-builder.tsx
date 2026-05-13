'use client';

import { useEffect, useState } from 'react';

import type { OwnerOption, TripDetail, TripStatus } from './types';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

interface CustomerOption {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
}

interface TripBuilderProps {
  customers: CustomerOption[];
  owners: OwnerOption[];
  currentUser: { id: number; name: string; email: string };
  onClose: () => void;
  onSaved: (trip: TripDetail) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUSES: TripStatus[] = ['Draft', 'Planned', 'Active'];

export default function TripBuilder({
  customers,
  owners,
  currentUser,
  onClose,
  onSaved,
}: TripBuilderProps) {
  const [customerId, setCustomerId] = useState('');
  const [ownerId, setOwnerId] = useState(String(currentUser.id));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TripStatus>('Draft');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDaysIso(7));
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = async () => {
    setError(null);
    const cId = Number(customerId);
    if (!Number.isInteger(cId) || cId <= 0) {
      setError('Pick a customer');
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setPending(true);
    try {
      const r = await fetch('/api/trips', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: cId,
          ownerId: ownerId ? Number(ownerId) : null,
          title: title.trim(),
          description: description.trim() || null,
          status,
          startDate,
          endDate,
          currency,
          notes: notes.trim() || null,
          items: [],
        }),
      });
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not save trip');
        return;
      }
      onSaved(data.trip);
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-40"
        onClick={() => (pending ? null : onClose())}
      />
      <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 pointer-events-none">
        <div className="bg-white w-full max-w-2xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto rounded-none sm:rounded-[2rem] shadow-2xl pointer-events-auto">
          <div className="p-6 sm:p-8 border-b border-gray-100 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
            <div>
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.3em]">
                New Trip
              </p>
              <h2 className="mt-1 text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                Plan a new trip
              </h2>
              <p className="text-xs text-gray-500 font-bold mt-2">
                Set up the basics — you&apos;ll build the day-by-day itinerary on the next page.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 rounded-xl"
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

          <div className="p-6 sm:p-8 space-y-6">
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <Field label="Customer">
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? ` — ${c.company}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Owner">
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value={String(currentUser.id)}>
                    {currentUser.name} (you)
                  </option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — {o.email}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Title" wide>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short, descriptive title"
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </Field>
              <Field label="Description" wide>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-emerald-500"
                />
              </Field>
              <Field label="Start date">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </Field>
              <Field label="End date">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </Field>
              <Field label="Currency">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  {COMMON_CURRENCIES.includes(currency) ? null : (
                    <option value={currency}>{currency}</option>
                  )}
                  {COMMON_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TripStatus)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
            </section>

            <Field label="Notes" wide>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-emerald-500"
              />
            </Field>

            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div className="p-4 sm:p-6 border-t border-gray-100 flex flex-col sm:flex-row gap-3 sticky bottom-0 bg-white">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sm:ml-auto px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Create & open itinerary'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
        {label}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
