'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { TripDetail, TripStatus } from './types';

interface TripDetailDrawerProps {
  tripId: number;
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
  onClose: () => void;
  onChanged: (trip: TripDetail) => void;
  onDeleted: (tripId: number) => void;
}

const STATUS_HEADER_STYLES: Record<string, string> = {
  Draft: 'bg-gray-500/10 border-gray-500/20 text-gray-300',
  Planned: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
  Active: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
  Completed: 'bg-violet-500/10 border-violet-500/20 text-violet-300',
  Cancelled: 'bg-rose-500/10 border-rose-500/20 text-rose-300',
};

const ALL_STATUSES: TripStatus[] = ['Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

function formatMoney(value: number | null, currency: string) {
  if (value == null) return '—';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
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

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function TripDetailDrawer({
  tripId,
  currentUser,
  isAdmin,
  onClose,
  onChanged,
  onDeleted,
}: TripDetailDrawerProps) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [newItemPrice, setNewItemPrice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/trips/${tripId}`, { credentials: 'include' })
      .then(async (r) => {
        const data = (await r.json().catch(() => null)) as
          | { trip?: TripDetail; error?: string }
          | null;
        if (!active) return;
        if (!r.ok || !data?.trip) {
          setError(data?.error ?? 'Could not load trip');
          return;
        }
        setTrip(data.trip);
      })
      .catch(() => active && setError('Network error'))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [tripId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const setStatus = async (status: TripStatus) => {
    if (!trip || trip.status === status) return;
    setPending(`status:${status}`);
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not update status');
        return;
      }
      setTrip(data.trip);
      onChanged(data.trip);
    } finally {
      setPending(null);
    }
  };

  const toggleItemComplete = async (itemId: number, currentlyCompleted: boolean) => {
    if (!trip) return;
    setPending(`item:${itemId}`);
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}/items/${itemId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !currentlyCompleted }),
      });
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not update item');
        return;
      }
      setTrip(data.trip);
      onChanged(data.trip);
    } finally {
      setPending(null);
    }
  };

  const handleAddItem = async () => {
    if (!trip || !newItemDescription.trim()) return;
    const qty = Number(newItemQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be greater than zero');
      return;
    }
    setPending('add-item');
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              description: newItemDescription.trim(),
              quantity: qty,
              unitPrice: newItemPrice ? Number(newItemPrice) : null,
            },
          ],
        }),
      });
      const data = (await r.json().catch(() => null)) as
        | { trip?: TripDetail; error?: string }
        | null;
      if (!r.ok || !data?.trip) {
        setError(data?.error ?? 'Could not add item');
        return;
      }
      setTrip(data.trip);
      onChanged(data.trip);
      setNewItemDescription('');
      setNewItemQty('1');
      setNewItemPrice('');
      setShowAddItem(false);
    } finally {
      setPending(null);
    }
  };

  const handleDelete = async () => {
    if (!trip) return;
    if (!confirm(`Delete trip ${trip.reference}? This cannot be undone.`)) return;
    setPending('delete');
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete trip');
        return;
      }
      onDeleted(trip.id);
    } finally {
      setPending(null);
    }
  };

  const isCreator = trip ? trip.createdBy.id === currentUser.id : false;
  const isOwner = trip ? trip.owner?.id === currentUser.id : false;
  const canEdit =
    trip &&
    (isAdmin ||
      (trip.status !== 'Cancelled' &&
        (trip.status !== 'Completed' ? isCreator || isOwner : isOwner)));
  const canDelete = trip && (isCreator || isAdmin) && (trip.status === 'Draft' || trip.status === 'Cancelled');

  return (
    <>
      <div
        className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40"
        onClick={() => (pending ? null : onClose())}
      />
      <div className="fixed right-0 top-0 h-full w-full sm:max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
        {loading && <div className="p-16 text-center text-sm font-bold text-gray-500">Loading…</div>}

        {!loading && error && !trip && (
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

        {!loading && trip && (
          <>
            <div className="p-6 sm:p-10 border-b border-gray-50 bg-gray-900 text-white relative overflow-hidden">
              <div className="flex justify-between items-start mb-6 sm:mb-8 relative z-10">
                <div>
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em] mb-2 block">
                    {trip.reference} · {trip.trackingCode}
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-black tracking-tight mb-1">{trip.title}</h2>
                  <p className="text-white/50 font-bold text-sm">
                    {trip.customer.name}
                    {trip.customer.company ? ` • ${trip.customer.company}` : ''}
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
                    STATUS_HEADER_STYLES[trip.status] ?? STATUS_HEADER_STYLES.Draft
                  }`}
                >
                  {trip.status}
                </div>
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                  Created by {trip.createdBy.name}
                </span>
                {trip.owner && (
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                    Owner: {trip.owner.name}
                  </span>
                )}
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">
                  {trip.currency}
                </span>
              </div>
              {trip.sourceQuote && (
                <p className="text-[10px] font-black text-emerald-300 uppercase tracking-widest mt-3">
                  From quote{' '}
                  <Link
                    href={`/modules/quotes?focus=${trip.sourceQuote.id}`}
                    className="underline hover:text-emerald-200"
                  >
                    {trip.sourceQuote.reference}
                  </Link>
                </p>
              )}
              <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl" />
            </div>

            <div className="p-6 sm:p-10 space-y-8 flex-1">
              <div className="grid grid-cols-3 gap-3 text-xs">
                <Cell label="Start" value={formatDate(trip.startDate)} />
                <Cell label="End" value={formatDate(trip.endDate)} />
                <Cell label="Items" value={`${trip.items.length}`} />
              </div>

              {trip.description && (
                <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {trip.description}
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">
                    Itinerary
                  </h3>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setShowAddItem((v) => !v)}
                      className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-800"
                    >
                      {showAddItem ? 'Cancel' : '+ Add item'}
                    </button>
                  )}
                </div>
                {showAddItem && (
                  <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 mb-3 grid grid-cols-12 gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Description"
                      value={newItemDescription}
                      onChange={(e) => setNewItemDescription(e.target.value)}
                      className="col-span-12 md:col-span-6 px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Qty"
                      value={newItemQty}
                      onChange={(e) => setNewItemQty(e.target.value)}
                      className="col-span-5 md:col-span-2 px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Unit price"
                      value={newItemPrice}
                      onChange={(e) => setNewItemPrice(e.target.value)}
                      className="col-span-5 md:col-span-2 px-3 py-2 bg-white rounded-xl text-sm font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      disabled={pending === 'add-item'}
                      onClick={handleAddItem}
                      className="col-span-2 md:col-span-2 px-3 py-2 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
                <div className="space-y-3">
                  {trip.items.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">No itinerary items yet.</p>
                  ) : (
                    trip.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 gap-3"
                      >
                        <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={item.completedAt !== null}
                            onChange={() => toggleItemComplete(item.id, item.completedAt !== null)}
                            disabled={!canEdit || pending === `item:${item.id}`}
                            className="w-5 h-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm font-black truncate ${
                                item.completedAt ? 'line-through text-gray-400' : 'text-gray-900'
                              }`}
                            >
                              {item.description}
                            </p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                              QTY {item.quantity}
                              {item.unitPrice != null && ` • ${formatMoney(item.unitPrice, trip.currency)}`}
                              {item.completedAt && ` • completed ${formatDateTime(item.completedAt)}`}
                            </p>
                          </div>
                        </label>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {trip.notes && (
                <div className="bg-amber-50/50 p-6 rounded-[2rem] border border-amber-100">
                  <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-2">
                    Notes
                  </h4>
                  <p className="text-sm text-amber-900/80 whitespace-pre-wrap leading-relaxed">
                    {trip.notes}
                  </p>
                </div>
              )}

              {error && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
                  {error}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-6 border-t border-gray-100 sticky bottom-0 bg-white space-y-3">
              {canEdit && (
                <div>
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-2">
                    Status
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_STATUSES.map((s) => (
                      <button
                        type="button"
                        key={s}
                        onClick={() => setStatus(s)}
                        disabled={trip.status === s || pending !== null}
                        className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition ${
                          trip.status === s
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                        } disabled:opacity-50`}
                      >
                        {pending === `status:${s}` ? '…' : s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={pending !== null}
                  className="text-xs font-black text-rose-600 uppercase tracking-widest hover:text-rose-800 disabled:opacity-50"
                >
                  {pending === 'delete' ? 'Deleting…' : 'Delete trip'}
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
    <div className="bg-gray-50 rounded-2xl p-3 sm:p-4">
      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xs font-bold text-gray-900">{value}</p>
    </div>
  );
}
