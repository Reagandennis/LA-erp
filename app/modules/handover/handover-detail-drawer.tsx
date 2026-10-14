'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useEffect, useState } from 'react';

import type { HandoverDetail } from './types';

interface HandoverDetailDrawerProps {
  handoverId: number;
  currentUser: { id: number; name: string };
  isAdmin: boolean;
  onClose: () => void;
  onChanged: (handover: HandoverDetail) => void;
  onDeleted: (id: number) => void;
  onEdit: (handover: HandoverDetail) => void;
}

const HEADER_STYLES: Record<string, string> = {
  Normal: 'bg-primary',
  Attention: 'bg-amber-500',
  Urgent: 'bg-rose-600',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</h3>
      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{value}</p>
    </div>
  );
}

export default function HandoverDetailDrawer({
  handoverId,
  currentUser,
  isAdmin,
  onClose,
  onChanged,
  onDeleted,
  onEdit,
}: HandoverDetailDrawerProps) {
  const [handover, setHandover] = useState<HandoverDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // Which record the current `item`/`error` belong to; "loading" is derived
  // from it instead of being toggled with extra renders.
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const loading = loadedId !== handoverId;

  useEffect(() => {
    let active = true;
    fetch(`/api/handover/${handoverId}`, { credentials: 'include' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { item?: HandoverDetail; error?: string } | null;
        if (!active) return;
        if (!res.ok || !data?.item) {
          setHandover(null);
          setError(data?.error ?? 'Could not load handover');
          return;
        }
        setHandover(data.item);
        setError(null);
      })
      .catch(() => {
        if (active) {
          setHandover(null);
          setError('Network error');
        }
      })
      .finally(() => active && setLoadedId(handoverId));
    return () => {
      active = false;
    };
  }, [handoverId]);

  const acknowledge = async () => {
    setPending('ack');
    setError(null);
    try {
      const res = await fetch(`/api/handover/${handoverId}/acknowledge`, { method: 'POST', credentials: 'include' });
      const data = (await res.json().catch(() => null)) as { item?: HandoverDetail; error?: string } | null;
      if (!res.ok || !data?.item) {
        setError(data?.error ?? 'Could not acknowledge.');
        return;
      }
      setHandover(data.item);
      onChanged(data.item);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this handover? This cannot be undone.')) return;
    setPending('delete');
    setError(null);
    try {
      const res = await fetch(`/api/handover/${handoverId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? 'Could not delete.');
        return;
      }
      onDeleted(handoverId);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setPending(null);
    }
  };

  const isAuthor = handover?.createdBy?.id === currentUser.id;
  const canManage = Boolean(isAuthor || isAdmin);
  const canAcknowledge = Boolean(handover && !handover.acknowledgedBy && !isAuthor);
  const headerColor = handover ? HEADER_STYLES[handover.status] ?? HEADER_STYLES.Normal : HEADER_STYLES.Normal;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">Loading…</div>
        ) : !handover ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-600">{error ?? 'Handover not found'}</p>
            <button onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className={`${headerColor} px-6 py-5 text-white`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-white/70">{handover.shiftPeriod} shift · {handover.status}</p>
                  <h2 className="mt-1 text-xl font-bold">{handover.post ?? 'General handover'}</h2>
                  <p className="mt-0.5 text-sm text-white/80">{formatDate(handover.shiftDate)}</p>
                </div>
                <button onClick={onClose} className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {error && <p className="border-b border-rose-100 bg-rose-50 px-6 py-2.5 text-sm font-medium text-rose-700">{error}</p>}

            {/* Body */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <Field label="Situation summary" value={handover.summary} />
              <Field label="Incidents during shift" value={handover.incidents} />
              <Field label="Watch items for next shift" value={handover.watchItems} />

              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Outgoing officer</span>
                  <span className="font-semibold text-gray-900">{handover.createdBy?.name ?? '—'}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-gray-500">Receipt</span>
                  {handover.acknowledgedBy ? (
                    <span className="text-right">
                      <span className="block font-semibold text-blue-700">{handover.acknowledgedBy.name}</span>
                      <span className="block text-xs text-gray-400">{formatDateTime(handover.acknowledgedAt)}</span>
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-600">Awaiting acknowledgement</span>
                  )}
                </div>
              </div>

              {canAcknowledge && (
                <button
                  type="button"
                  onClick={acknowledge}
                  disabled={pending !== null}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  {pending === 'ack' ? 'Acknowledging…' : 'Acknowledge handover'}
                </button>
              )}
              {!handover.acknowledgedBy && isAuthor && (
                <p className="text-center text-xs text-gray-400">The incoming shift will acknowledge this handover.</p>
              )}
            </div>

            {/* Footer actions */}
            {canManage && (
              <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending !== null}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                >
                  {pending === 'delete' ? 'Deleting…' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(handover)}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Edit
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
