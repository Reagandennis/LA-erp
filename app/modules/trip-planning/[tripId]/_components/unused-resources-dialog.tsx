'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { APP_LOCALE } from '@/lib/locale';
import { type TripResourceSummary, distanceKm, formatDateRange } from '@/lib/trip-resource-model';

import type { TripDetail } from '../../types';

interface Verdict {
  resolution: 'unused' | 'used' | null;
  hours: string;
  startKm: string;
  endKm: string;
}

const BLANK: Verdict = { resolution: null, hours: '', startKm: '', endKm: '' };

function wholeKm(value: string): number | null | 'invalid' {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 9_999_999 ? n : 'invalid';
}

/** What is wrong with a "keep and log" entry, if anything. Hours and kilometres are both optional. */
function problem(verdict: Verdict): string | null {
  if (verdict.resolution !== 'used') return null;
  if (verdict.hours.trim() !== '') {
    const hours = Number(verdict.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 10_000) return 'Billable hours must be more than zero';
  }
  const start = wholeKm(verdict.startKm);
  const end = wholeKm(verdict.endKm);
  if (start === 'invalid' || end === 'invalid') return 'Odometer readings are whole kilometres';
  if ((start === null) !== (end === null)) return 'Give both odometer readings, or leave both empty';
  if (start !== null && end !== null && end < start) return 'The end reading is behind the start';
  return null;
}

const inputClass =
  'mt-0.5 w-full rounded-lg bg-white px-2.5 py-1.5 text-sm tabular-nums ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30';
const captionClass = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400';

/**
 * The check before a trip completes. Every staged resource that no event
 * used is put to the Controller: it went unused (and comes off the bill), or
 * it was used and simply never attached, in which case the hours or
 * kilometres are logged here. The trip completes once each one is answered.
 */
export function UnusedResourcesDialog({
  tripId,
  resources,
  completing,
  onClose,
  onDone,
}: {
  tripId: number;
  /** Staged, on no event, and not yet verified. */
  resources: TripResourceSummary[];
  /** Move the trip to Completed once verified; false when it already is. */
  completing: boolean;
  onClose: () => void;
  onDone: (trip: TripDetail) => void;
}) {
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const verdictOf = (id: number) => verdicts[id] ?? BLANK;
  const set = (id: number, next: Partial<Verdict>) =>
    setVerdicts((current) => ({ ...current, [id]: { ...(current[id] ?? BLANK), ...next } }));

  const resolved = resources.filter((resource) => verdictOf(resource.id).resolution !== null).length;
  const invalid = resources.some((resource) => problem(verdictOf(resource.id)) !== null);
  const ready = resolved === resources.length && !invalid;

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/resources/reconcile`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complete: completing,
          verdicts: resources.map((resource) => {
            const verdict = verdictOf(resource.id);
            if (verdict.resolution !== 'used') return { resourceId: resource.id, resolution: 'unused' };
            return {
              resourceId: resource.id,
              resolution: 'used',
              billableHours: verdict.hours.trim() === '' ? null : Number(verdict.hours),
              startOdometer: wholeKm(verdict.startKm),
              endOdometer: wholeKm(verdict.endKm),
            };
          }),
        }),
      });
      const data = (await response.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!response.ok || !data?.trip) {
        setError(data?.error ?? 'Could not save the verification');
        return;
      }
      onDone(data.trip);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end justify-center p-4 sm:items-center" role="presentation">
      <button type="button" aria-label="Cancel" onClick={() => !saving && onClose()} className="absolute inset-0 cursor-default bg-gray-900/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="unused-resources-title"
        className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 id="unused-resources-title" className="text-base font-bold text-gray-900">
            Unused resources verification
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            {resources.length === 1 ? 'This staged resource was' : `These ${resources.length} staged resources were`} never put on an itinerary
            event. Confirm what happened to {resources.length === 1 ? 'it' : 'each'} before the trip {completing ? 'is closed out for billing' : 'is billed'}.
          </p>
        </div>

        <ul className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {resources.map((resource) => {
            const verdict = verdictOf(resource.id);
            const issue = problem(verdict);
            const start = wholeKm(verdict.startKm);
            const end = wholeKm(verdict.endKm);
            const km = typeof start === 'number' && typeof end === 'number' ? distanceKm(start, end) : null;
            return (
              <li
                key={resource.id}
                className={`rounded-xl border p-3 ${
                  verdict.resolution === null ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200 bg-white'
                }`}
              >
                <p className="text-sm font-semibold text-gray-900">
                  {resource.serviceName}
                  {resource.quantity > 1 && <span className="ml-1 font-normal text-gray-500">×{resource.quantity}</span>}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {[resource.vendorName, formatDateRange(resource.startDate, resource.endDate, APP_LOCALE), resource.unitOfMeasure]
                    .filter(Boolean)
                    .join(' · ')}
                </p>

                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={verdict.resolution === 'unused'}
                    onClick={() => set(resource.id, { resolution: 'unused' })}
                    className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                      verdict.resolution === 'unused'
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    No, this was unused
                    <span className={`block text-[11px] font-normal ${verdict.resolution === 'unused' ? 'text-gray-300' : 'text-gray-500'}`}>
                      Comes off the billing log; the client isn’t charged.
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={verdict.resolution === 'used'}
                    onClick={() => set(resource.id, { resolution: 'used' })}
                    className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                      verdict.resolution === 'used'
                        ? 'border-primary bg-primary text-white'
                        : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Yes, keep &amp; log
                    <span className={`block text-[11px] font-normal ${verdict.resolution === 'used' ? 'text-white/80' : 'text-gray-500'}`}>
                      It was used but never attached to an event.
                    </span>
                  </button>
                </div>

                {verdict.resolution === 'used' && (
                  <div className="mt-2.5 rounded-lg bg-gray-50 p-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className={captionClass}>Billable hours</span>
                        <input
                          type="number"
                          min={0}
                          step="0.25"
                          inputMode="decimal"
                          value={verdict.hours}
                          onChange={(event) => set(resource.id, { hours: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className={captionClass}>Start km</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={verdict.startKm}
                          onChange={(event) => set(resource.id, { startKm: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                      <label className="block">
                        <span className={captionClass}>End km</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={verdict.endKm}
                          onChange={(event) => set(resource.id, { endKm: event.target.value })}
                          className={inputClass}
                        />
                      </label>
                    </div>
                    <p className={`mt-1.5 text-[11px] ${issue ? 'text-rose-600' : 'text-gray-500'}`}>
                      {issue ?? (km !== null ? `${km.toLocaleString()} km driven.` : 'Hours, kilometres or both; leave empty to keep it as staged.')}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="border-t border-gray-100 px-5 py-3.5">
          {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              {resolved} of {resources.length} resolved
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!ready || saving}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : completing ? 'Verify & mark completed' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
