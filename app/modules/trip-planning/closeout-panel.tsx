'use client';

import { APP_LOCALE } from '@/lib/locale';
import { CLOSEOUT_CHECKS, allChecksConfirmed } from '@/lib/trip-closeout-checks';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { CloseoutTrip, TripCloseout } from './types';

type CloseoutFilter = 'All' | 'Pending' | 'Closed out';

const FILTERS: CloseoutFilter[] = ['All', 'Pending', 'Closed out'];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(APP_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isClosed(trip: CloseoutTrip): boolean {
  return Boolean(trip.closeout?.closedAt);
}

/** "Lead Name +2", or null when the trip has no travellers. */
function travelerLine(travelers: string[]): string | null {
  if (travelers.length === 0) return null;
  const [lead, ...rest] = travelers;
  return rest.length > 0 ? `${lead} +${rest.length}` : lead;
}

export default function CloseoutPanel({
  trips,
  onSaved,
}: {
  trips: CloseoutTrip[];
  onSaved: (tripId: number, closeout: TripCloseout) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<CloseoutFilter>('All');
  const [openId, setOpenId] = useState<number | null>(null);

  const totals = useMemo(() => {
    const closed = trips.filter(isClosed).length;
    return { total: trips.length, pending: trips.length - closed, closed };
  }, [trips]);

  const filtered = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return trips.filter((trip) => {
      const matchesSearch =
        normalized.length === 0 ||
        trip.reference.toLowerCase().includes(normalized) ||
        trip.trackingCode.toLowerCase().includes(normalized) ||
        trip.title.toLowerCase().includes(normalized) ||
        trip.customer.name.toLowerCase().includes(normalized) ||
        (trip.customer.company?.toLowerCase().includes(normalized) ?? false) ||
        trip.travelers.some((name) => name.toLowerCase().includes(normalized));
      const matchesFilter =
        filter === 'All' || (filter === 'Closed out' ? isClosed(trip) : !isClosed(trip));
      return matchesSearch && matchesFilter;
    });
  }, [trips, searchQuery, filter]);

  const openTrip = trips.find((trip) => trip.id === openId) ?? null;

  return (
    <>
      <div className="grid grid-cols-3 gap-3 lg:gap-4">
        <SummaryCard label="Awaiting close-out" value={totals.pending} accent="text-amber-600" />
        <SummaryCard label="Closed out" value={totals.closed} accent="text-emerald-600" />
        <SummaryCard label="Total" value={totals.total} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by reference, tracking code, title, client, or traveller…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {FILTERS.map((option) => (
            <button
              type="button"
              key={option}
              onClick={() => setFilter(option)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                filter === option ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {filtered.map((trip) => (
          <button
            key={trip.id}
            type="button"
            onClick={() => setOpenId(trip.id)}
            className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{trip.reference}</p>
                <p className="truncate text-sm text-gray-500">{trip.title}</p>
              </div>
              <CloseoutBadge trip={trip} />
            </div>
            <p className="mt-2 truncate text-xs text-gray-400">
              {trip.customer.name}
              {trip.customer.company ? ` · ${trip.customer.company}` : ''}
            </p>
            <p className="mt-2 text-xs text-gray-400">
              {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
            </p>
          </button>
        ))}
        {filtered.length === 0 && <EmptyState filtered={trips.length > 0} />}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Reference</th>
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Client</th>
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Owner</th>
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Dates</th>
              <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Close-out</th>
              <th className="w-10 px-6 py-3.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((trip) => (
              <tr
                key={trip.id}
                onClick={() => setOpenId(trip.id)}
                className="group cursor-pointer transition-colors hover:bg-gray-50/70"
              >
                <td className="px-6 py-4">
                  <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                    {trip.reference}
                  </p>
                  <p className="mt-0.5 max-w-[220px] truncate text-sm text-gray-500">{trip.title}</p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-gray-700">{trip.customer.name}</p>
                  {trip.customer.company && <p className="mt-0.5 text-xs text-gray-400">{trip.customer.company}</p>}
                  {travelerLine(trip.travelers) && (
                    <p className="mt-0.5 max-w-[220px] truncate text-xs text-gray-500" title={trip.travelers.join(', ')}>
                      {travelerLine(trip.travelers)}
                    </p>
                  )}
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-gray-600">
                    {trip.owner?.name ?? <span className="text-gray-300">Unassigned</span>}
                  </p>
                </td>
                <td className="px-6 py-4">
                  <p className="text-sm text-gray-500">{formatDate(trip.startDate)}</p>
                  <p className="text-xs text-gray-400">→ {formatDate(trip.endDate)}</p>
                </td>
                <td className="px-6 py-4">
                  <CloseoutBadge trip={trip} />
                  {trip.closeout?.closedAt && (
                    <p className="mt-1 text-xs text-gray-400">
                      {formatDate(trip.closeout.closedAt)}
                      {trip.closeout.closedBy ? ` · ${trip.closeout.closedBy.name}` : ''}
                    </p>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <svg
                    className="ml-auto h-4 w-4 text-gray-300 transition-colors group-hover:text-primary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <EmptyState filtered={trips.length > 0} />}
      </div>

      {openTrip && (
        <CloseoutEditor
          // A fresh form per trip, and again after each save.
          key={`${openTrip.id}:${openTrip.closeout?.updatedAt ?? 'new'}`}
          trip={openTrip}
          onClose={() => setOpenId(null)}
          onSaved={(closeout, keepOpen) => {
            onSaved(openTrip.id, closeout);
            if (!keepOpen) setOpenId(null);
          }}
        />
      )}
    </>
  );
}

function CloseoutEditor({
  trip,
  onClose,
  onSaved,
}: {
  trip: CloseoutTrip;
  onClose: () => void;
  onSaved: (closeout: TripCloseout, keepOpen: boolean) => void;
}) {
  const saved = trip.closeout;
  const closed = Boolean(saved?.closedAt);
  const [checks, setChecks] = useState<string[]>(saved?.checks ?? []);
  const [summary, setSummary] = useState(saved?.summary ?? '');
  const [issues, setIssues] = useState(saved?.issues ?? '');
  const [clientFeedback, setClientFeedback] = useState(saved?.clientFeedback ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = allChecksConfirmed(checks);

  const toggle = (key: string) =>
    setChecks((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  const save = async (close: boolean) => {
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/trips/${trip.id}/closeout`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checks,
          summary: summary.trim() || null,
          issues: issues.trim() || null,
          clientFeedback: clientFeedback.trim() || null,
          closed: close,
        }),
      });
      const data = (await r.json().catch(() => null)) as { closeout?: TripCloseout; error?: string } | null;
      if (!r.ok || !data?.closeout) {
        setError(data?.error ?? 'Could not save the close-out');
        return;
      }
      // Reopening leaves the form up so the verifier can carry on editing.
      onSaved(data.closeout, closed && !close);
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
            <div className="min-w-0">
              <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em]">
                Close out · {trip.reference}
              </p>
              <h2 className="mt-1 text-xl sm:text-2xl font-black text-gray-900 tracking-tight truncate">{trip.title}</h2>
              <p className="text-xs text-gray-500 font-bold mt-2">
                {trip.customer.name}
                {trip.customer.company ? ` · ${trip.customer.company}` : ''} · {formatDate(trip.startDate)} →{' '}
                {formatDate(trip.endDate)}
              </p>
              {trip.canOpen && (
                <Link
                  href={`/modules/trip-planning/${trip.id}`}
                  className="mt-2 inline-block text-xs font-bold text-primary hover:underline"
                >
                  Open itinerary ({trip.itemCount} items, {trip.logCount} log entries) →
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 rounded-xl"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {closed && saved?.closedAt ? (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
                <p className="font-bold">
                  Closed out {formatDateTime(saved.closedAt)}
                  {saved.closedBy ? ` by ${saved.closedBy.name}` : ''}
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-700">
                  You can still correct anything below. Every check stays confirmed while the trip is closed out; reopen it
                  to untick one.
                </p>
              </div>
            ) : trip.status !== 'Completed' ? null : (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm font-bold text-amber-800">
                Awaiting close-out: confirm each check to verify this trip.
              </div>
            )}

            <section>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Verification</h3>
                <span className="text-xs font-bold text-gray-500 tabular-nums">
                  {checks.length} of {CLOSEOUT_CHECKS.length} confirmed
                </span>
              </div>
              <ul className="mt-3 rounded-2xl border border-gray-100 divide-y divide-gray-50">
                {CLOSEOUT_CHECKS.map((check) => {
                  const on = checks.includes(check.key);
                  return (
                    <li key={check.key}>
                      <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-gray-50/70">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(check.key)}
                          disabled={pending}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span>
                          <span className="block text-sm font-bold text-gray-900">{check.label}</span>
                          <span className="block text-xs text-gray-500">{check.hint}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>

            <Field label="Close-out notes">
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="How the trip went, and anything worth keeping on record."
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Issues & follow-ups">
              <textarea
                value={issues}
                onChange={(e) => setIssues(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Incidents, complaints, outstanding payments or returns."
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary"
              />
            </Field>
            <Field label="Client feedback">
              <textarea
                value={clientFeedback}
                onChange={(e) => setClientFeedback(e.target.value)}
                rows={2}
                maxLength={4000}
                className="w-full px-4 py-3 bg-gray-50 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-primary"
              />
            </Field>

            {saved && (
              <p className="text-xs text-gray-400">
                Last edited {formatDateTime(saved.updatedAt)}
                {saved.updatedBy ? ` by ${saved.updatedBy.name}` : ''}
              </p>
            )}

            {error && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm font-bold text-rose-700">
                {error}
              </div>
            )}
          </div>

          <div className="p-4 sm:p-6 border-t border-gray-100 flex flex-col sm:flex-row gap-3 sticky bottom-0 bg-white">
            {closed ? (
              <button
                type="button"
                onClick={() => save(false)}
                disabled={pending}
                className="px-6 py-3 text-rose-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-rose-50 disabled:opacity-50"
              >
                Reopen
              </button>
            ) : (
              <button
                type="button"
                onClick={() => save(false)}
                disabled={pending}
                className="px-6 py-3 border-2 border-gray-200 text-gray-700 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-gray-50 disabled:opacity-50"
              >
                Save progress
              </button>
            )}
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
              onClick={() => save(true)}
              disabled={pending || !complete}
              title={complete ? undefined : 'Confirm every check first'}
              className="px-6 py-3 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? 'Saving…' : closed ? 'Save changes' : 'Close out trip'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function CloseoutBadge({ trip }: { trip: CloseoutTrip }) {
  if (isClosed(trip)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Closed out
      </span>
    );
  }
  const done = trip.closeout?.checks.length ?? 0;
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      {done > 0 ? `Pending · ${done}/${CLOSEOUT_CHECKS.length}` : 'Pending'}
    </span>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <h3 className="text-lg font-semibold text-gray-900">{filtered ? 'No matching trips' : 'Nothing to close out yet'}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered ? 'Try a different search or filter.' : 'Trips show up here once they are marked Completed.'}
      </p>
    </div>
  );
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{label}</span>
      <span className="mt-2 block">{children}</span>
    </label>
  );
}
