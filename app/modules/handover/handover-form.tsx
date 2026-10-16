'use client';

import { useState } from 'react';

import { HANDOVER_STATUSES, SHIFT_PERIODS, type HandoverDetail } from './types';

interface HandoverFormProps {
  mode: 'create' | 'edit';
  handover: HandoverDetail | null;
  onClose: () => void;
  onSaved: (handover: HandoverDetail) => void;
}

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-semibold text-gray-500">{children}</label>;
}

export default function HandoverForm({ mode, handover, onClose, onSaved }: HandoverFormProps) {
  const [shiftDate, setShiftDate] = useState(handover ? handover.shiftDate.slice(0, 10) : todayIso());
  const [shiftPeriod, setShiftPeriod] = useState(handover?.shiftPeriod ?? 'Day');
  const [post, setPost] = useState(handover?.post ?? '');
  const [status, setStatus] = useState(handover?.status ?? 'Normal');
  const [summary, setSummary] = useState(handover?.summary ?? '');
  const [incidents, setIncidents] = useState(handover?.incidents ?? '');
  const [watchItems, setWatchItems] = useState(handover?.watchItems ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!summary.trim()) {
      setError('A handover summary is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      shiftDate,
      shiftPeriod,
      post: post.trim() || null,
      status,
      summary: summary.trim(),
      incidents: incidents.trim() || null,
      watchItems: watchItems.trim() || null,
    };
    try {
      const url = mode === 'edit' && handover ? `/api/handover/${handover.id}` : '/api/handover';
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as { item?: HandoverDetail; error?: string } | null;
      if (!res.ok || !payload?.item) {
        setError(payload?.error ?? 'Could not save the handover.');
        return;
      }
      onSaved(payload.item);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[220] bg-gray-900/40 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="fixed inset-0 z-[230] flex items-end justify-center p-0 sm:items-center sm:p-4">
        <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{mode === 'edit' ? 'Edit handover' : 'New handover'}</h2>
              <p className="text-sm text-gray-500">End-of-shift status for the next team.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && <p className="border-b border-rose-100 bg-rose-50 px-6 py-2.5 text-sm font-medium text-rose-700">{error}</p>}

          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Shift date</Label>
                <input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className={inputClass} />
              </div>
              <div>
                <Label>Shift</Label>
                <select value={shiftPeriod} onChange={(e) => setShiftPeriod(e.target.value)} className={inputClass}>
                  {SHIFT_PERIODS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Post / location</Label>
                <input value={post} onChange={(e) => setPost(e.target.value)} placeholder="e.g. Main gate, Residence A" className={inputClass} />
              </div>
              <div>
                <Label>Priority</Label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                  {HANDOVER_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label>Situation summary</Label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="Overall status at end of shift — all normal, or the headline."
                className={inputClass}
              />
            </div>

            <div>
              <Label>Incidents during shift</Label>
              <textarea
                value={incidents}
                onChange={(e) => setIncidents(e.target.value)}
                rows={3}
                placeholder="Notable events, visitors, alarms, deliveries… (optional)"
                className={inputClass}
              />
            </div>

            <div>
              <Label>Watch items for next shift</Label>
              <textarea
                value={watchItems}
                onChange={(e) => setWatchItems(e.target.value)}
                rows={3}
                placeholder="Follow-ups, pending tasks, things to keep an eye on… (optional)"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Log handover'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
