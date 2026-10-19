'use client';

import { useEffect, useState } from 'react';

import type { OwnerOption, TravelerOption, TripDetail, TripStatus } from './types';

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'ZAR', 'KES', 'NGN'];

interface CustomerOption {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
}

/** A traveller on the new trip: an existing one of the client's, or a name to create. */
interface PickedTraveler {
  travelerId?: number;
  name: string;
}

interface TripBuilderProps {
  customers: CustomerOption[];
  /** Every client's travellers; the picker shows the chosen client's. */
  travelers: TravelerOption[];
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
  travelers,
  owners,
  currentUser,
  onClose,
  onSaved,
}: TripBuilderProps) {
  const [customerId, setCustomerId] = useState('');
  const [pickedTravelers, setPickedTravelers] = useState<PickedTraveler[]>([]);
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

  const selectedCustomer = customers.find((c) => String(c.id) === customerId) ?? null;

  const handleSave = async () => {
    setError(null);
    const cId = Number(customerId);
    if (!Number.isInteger(cId) || cId <= 0) {
      setError('Pick a client');
      return;
    }
    if (pickedTravelers.length === 0) {
      setError('Add at least one traveller');
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
          // Lead first.
          travelers: pickedTravelers.map((t) =>
            t.travelerId ? { travelerId: t.travelerId } : { name: t.name },
          ),
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
        className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-[220]"
        onClick={() => (pending ? null : onClose())}
      />
      <div className="fixed inset-0 z-[230] flex items-stretch sm:items-center justify-center sm:p-4 pointer-events-none">
        <div className="bg-white w-full max-w-2xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto rounded-none sm:rounded-[2rem] shadow-2xl pointer-events-auto">
          <div className="p-6 sm:p-8 border-b border-gray-100 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
            <div>
              <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em]">
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
              <Field label="Client">
                <select
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    // Travellers belong to one client.
                    setPickedTravelers([]);
                  }}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select a client…</option>
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
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
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
              <Field label="Travellers" wide>
                {selectedCustomer ? (
                  <TravelerPicker
                    key={selectedCustomer.id}
                    clientName={selectedCustomer.name}
                    options={travelers.filter((t) => t.customerId === selectedCustomer.id)}
                    picked={pickedTravelers}
                    onChange={setPickedTravelers}
                  />
                ) : (
                  <p className="px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium text-gray-400">
                    Pick a client to choose their travellers.
                  </p>
                )}
              </Field>
              <Field label="Title" wide>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short, descriptive title"
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
                />
              </Field>
              <Field label="Description" wide>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary"
                />
              </Field>
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
              <Field label="Currency">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
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
                  className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
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
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary"
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
              className="px-6 py-3 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
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

/** Longest list rendered at once; some clients have hundreds of travellers. */
const MAX_SUGGESTIONS = 50;

function TravelerPicker({
  clientName,
  options,
  picked,
  onChange,
}: {
  clientName: string;
  /** The client's travellers. */
  options: TravelerOption[];
  /** Lead first. */
  picked: PickedTraveler[];
  onChange: (next: PickedTraveler[]) => void;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();

  const pickedIds = new Set(picked.flatMap((t) => (t.travelerId ? [t.travelerId] : [])));
  const matches = options.filter(
    (t) => !pickedIds.has(t.id) && (normalized === '' || t.name.toLowerCase().includes(normalized)),
  );
  // A name that's already a traveller of this client should be picked, not created twice.
  const canAddNew =
    normalized !== '' &&
    !options.some((t) => t.name.toLowerCase() === normalized) &&
    !picked.some((t) => t.name.toLowerCase() === normalized);

  const add = (traveler: PickedTraveler) => {
    onChange([...picked, traveler]);
    setQuery('');
  };
  const remove = (index: number) => onChange(picked.filter((_, i) => i !== index));
  const makeLead = (index: number) =>
    onChange([picked[index], ...picked.filter((_, i) => i !== index)]);

  return (
    <div className="space-y-3">
      {picked.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {picked.map((traveler, index) => (
            <li
              key={traveler.travelerId ?? `new:${traveler.name}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-1 text-xs font-bold text-primary"
            >
              {traveler.name}
              {index === 0 && (
                <span className="rounded-full bg-primary px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white">
                  Lead
                </span>
              )}
              {!traveler.travelerId && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-700">
                  New
                </span>
              )}
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => makeLead(index)}
                  className="rounded-full px-1.5 py-0.5 text-[10px] text-primary/70 hover:bg-primary/10 hover:text-primary"
                >
                  Make lead
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label={`Remove ${traveler.name}`}
                className="rounded-full p-1 text-primary/60 hover:bg-primary/10 hover:text-primary"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (matches[0]) add({ travelerId: matches[0].id, name: matches[0].name });
          else if (canAddNew) add({ name: query.trim() });
        }}
        placeholder={
          options.length > 0
            ? `Search ${clientName}'s travellers, or type a new name`
            : 'Type a name to add a traveller'
        }
        className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-primary"
      />

      {options.length === 0 && !canAddNew && (
        <p className="text-xs font-medium text-gray-400">
          {clientName} has no travellers yet. New ones you add here are saved to the client.
        </p>
      )}

      {(matches.length > 0 || canAddNew) && (
        <ul className="max-h-52 overflow-y-auto rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {matches.slice(0, MAX_SUGGESTIONS).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => add({ travelerId: t.id, name: t.name })}
                className="w-full px-4 py-2.5 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t.name}
              </button>
            </li>
          ))}
          {canAddNew && (
            <li>
              <button
                type="button"
                onClick={() => add({ name: query.trim() })}
                className="w-full px-4 py-2.5 text-left text-sm font-bold text-primary hover:bg-primary/5"
              >
                + Add &ldquo;{query.trim()}&rdquo; as a new traveller for {clientName}
              </button>
            </li>
          )}
        </ul>
      )}
      {matches.length > MAX_SUGGESTIONS && (
        <p className="text-xs font-medium text-gray-400">
          Showing {MAX_SUGGESTIONS} of {matches.length}. Keep typing to narrow the list.
        </p>
      )}
    </div>
  );
}
