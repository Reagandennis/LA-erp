'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import ShowMoreButton from '@/app/ui/show-more-button';

import CloseoutPanel from './closeout-panel';
import {
  STATUS_FILTERS,
  TRIP_SORT_OPTIONS,
  appendTripPage,
  applyListQuery,
  formatTripDate,
  listPageSearchParams,
  listQueryKey,
  type TripListQuery,
} from './list-model';
import TripBuilder from './trip-builder';
import type {
  CloseoutTrip,
  TripCloseout,
  TripDetail,
  TripFormOptions,
  TripPage,
  TripSort,
  TripStatusCounts,
  TripStatusFilter,
  TripSummary,
  TripsTab,
} from './types';

interface TripsClientProps {
  currentUser: { id: number; name: string; email: string };
  /** False for a verifier with only the close-out grant: the Close out tab alone. */
  canPlan: boolean;
  /** Whether the Close out tab exists for this user at all. */
  canCloseOut: boolean;
  initialTab: TripsTab;
  /** The search, status and sort the page opened with, read from the URL. */
  initialQuery: TripListQuery;
  /** The first page of `initialQuery`; the rest comes from /api/trips. */
  initialTrips: TripSummary[];
  initialTotal: number;
  initialCounts: TripStatusCounts;
  /** Null until the Close out tab is opened (or without the grant); then fetched on demand. */
  initialCloseoutTrips: CloseoutTrip[] | null;
  /** Completed trips awaiting close-out, for the tab badge while the list isn't loaded. */
  initialPendingCloseouts: number;
}

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Planned: 'bg-blue-50 text-blue-700',
  Active: 'bg-emerald-50 text-emerald-700',
  Completed: 'bg-violet-50 text-violet-700',
  Cancelled: 'bg-rose-50 text-rose-700',
};

const SEARCH_DEBOUNCE_MS = 300;

/** "Lead Name +2", or null when the trip has no travellers yet. */
function travelerLine(travelers: TripSummary['travelers']): string | null {
  if (travelers.length === 0) return null;
  const [lead, ...rest] = travelers;
  return rest.length > 0 ? `${lead.name} +${rest.length}` : lead.name;
}

async function fetchTripPage(query: TripListQuery, page: number): Promise<TripPage> {
  const r = await fetch(`/api/trips?${listPageSearchParams(query, page)}`, { credentials: 'include', cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as TripPage;
}

/** The rows loaded so far for one query, page by page. */
interface LoadedList {
  key: string;
  trips: TripSummary[];
  total: number;
  page: number;
}

export default function TripsClient({
  currentUser,
  canPlan,
  canCloseOut,
  initialTab,
  initialQuery,
  initialTrips,
  initialTotal,
  initialCounts,
  initialCloseoutTrips,
  initialPendingCloseouts,
}: TripsClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TripsTab>(initialTab);
  const [closeoutTrips, setCloseoutTrips] = useState<CloseoutTrip[] | null>(initialCloseoutTrips);
  const [closeoutError, setCloseoutError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(initialQuery.q);
  const [settledQuery, setSettledQuery] = useState(initialQuery.q);
  const [activeFilter, setActiveFilter] = useState<TripStatusFilter>(initialQuery.status);
  const [sort, setSort] = useState<TripSort>(initialQuery.sort);
  const [counts, setCounts] = useState<TripStatusCounts>(initialCounts);

  // The New trip form's clients, owners and travellers are fetched the first
  // time it opens and kept for the next; the form shows once they're here.
  const [formOptions, setFormOptions] = useState<TripFormOptions | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderOpening, setBuilderOpening] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  const query: TripListQuery = { q: settledQuery, status: activeFilter, sort };
  const wantKey = listQueryKey(query);
  const [loaded, setLoaded] = useState<LoadedList>({
    key: listQueryKey(initialQuery),
    trips: initialTrips,
    total: initialTotal,
    page: 1,
  });
  const [listError, setListError] = useState<{ key: string; message: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Typing settles into a query after a pause, so each keystroke isn't a request.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // The settled query lives in the URL (next to `tab`), so a refresh, a
  // shared link or coming back from an itinerary lands on the same view.
  useEffect(() => {
    const url = new URL(window.location.href);
    const before = url.search;
    applyListQuery(url.searchParams, { q: settledQuery, status: activeFilter, sort });
    if (url.search !== before) window.history.replaceState(null, '', url);
  }, [settledQuery, activeFilter, sort]);

  // A new query (search text, status pill or sort) fetches its first page from
  // the server. The list keeps showing the previous rows, dimmed, until it arrives.
  const listCurrent = loaded.key === wantKey;
  const listFailed = listError?.key === wantKey;
  useEffect(() => {
    if (listCurrent || listFailed) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchTripPage({ q: settledQuery, status: activeFilter, sort }, 1);
        if (cancelled) return;
        setLoaded({ key: wantKey, trips: page.trips, total: page.total, page: page.page });
      } catch {
        if (!cancelled) setListError({ key: wantKey, message: "The trips couldn't be loaded. Try again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantKey, listCurrent, listFailed, settledQuery, activeFilter, sort]);

  const loadMore = async () => {
    if (!listCurrent || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchTripPage(query, loaded.page + 1);
      setLoaded((current) => {
        if (current.key !== wantKey) return current;
        return { ...current, trips: appendTripPage(current.trips, page.trips), total: page.total, page: page.page };
      });
    } catch {
      setListError({ key: wantKey, message: "More trips couldn't be loaded. Try again." });
    } finally {
      setLoadingMore(false);
    }
  };

  const upsertTrip = (trip: TripSummary | TripDetail) => {
    const summary: TripSummary = {
      id: trip.id,
      reference: trip.reference,
      trackingCode: trip.trackingCode,
      title: trip.title,
      description: trip.description,
      status: trip.status,
      country: trip.country,
      currency: trip.currency,
      startDate: trip.startDate,
      endDate: trip.endDate,
      notes: trip.notes,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
      customer: trip.customer,
      travelers: trip.travelers,
      createdBy: trip.createdBy,
      owner: trip.owner,
      sourceQuote: trip.sourceQuote,
      itemCount: 'items' in trip ? trip.items.length : trip.itemCount,
      assignmentCount: 'assignmentCount' in trip ? trip.assignmentCount : 0,
      logCount: trip.logCount,
    };
    setLoaded((current) => {
      const isNew = !current.trips.some((t) => t.id === summary.id);
      return {
        ...current,
        trips: [summary, ...current.trips.filter((t) => t.id !== summary.id)],
        total: isNew ? current.total + 1 : current.total,
      };
    });
    setCounts((current) => ({
      ...current,
      [summary.status]: current[summary.status] + 1,
      total: current.total + 1,
    }));
  };

  const openTrip = (tripId: number) => {
    router.push(`/modules/trip-planning/${tripId}`);
  };

  const openBuilder = async () => {
    setBuilderError(null);
    if (formOptions) {
      setBuilderOpen(true);
      return;
    }
    setBuilderOpening(true);
    try {
      const r = await fetch('/api/trips/form-options', { credentials: 'include' });
      const data = (await r.json().catch(() => null)) as (TripFormOptions & { error?: string }) | null;
      if (!r.ok || !data?.customers) {
        setBuilderError(data?.error ?? "The trip form couldn't be opened. Try again.");
        return;
      }
      setFormOptions(data);
      setBuilderOpen(true);
    } catch {
      setBuilderError("The trip form couldn't be opened. Try again.");
    } finally {
      setBuilderOpening(false);
    }
  };

  const showTab = (next: TripsTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'trips') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  // The close-out list is every completed trip, so it is fetched the first
  // time the tab is shown rather than shipped with the Trips screen.
  useEffect(() => {
    // After a failure the Retry button clears the error, which re-runs this.
    if (tab !== 'close-out' || !canCloseOut || closeoutTrips !== null || closeoutError) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/trips/closeout', { credentials: 'include', cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { trips: CloseoutTrip[] };
        if (!cancelled) setCloseoutTrips(data.trips);
      } catch {
        if (!cancelled) setCloseoutError("The close-out list couldn't be loaded. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, canCloseOut, closeoutTrips, closeoutError]);

  const saveCloseout = (tripId: number, closeout: TripCloseout) => {
    setCloseoutTrips((current) =>
      current ? current.map((trip) => (trip.id === tripId ? { ...trip, closeout } : trip)) : current,
    );
  };

  const pendingCloseouts = closeoutTrips
    ? closeoutTrips.filter((trip) => !trip.closeout?.closedAt).length
    : initialPendingCloseouts;

  const hasTrips = counts.total > 0;
  const isFiltered = settledQuery.length > 0 || activeFilter !== 'All';
  const rows = loaded.trips;
  const remaining = Math.max(0, loaded.total - rows.length);
  const listStale = !listCurrent && !listFailed;

  const listFooter = (
    <>
      {listFailed && (
        <div className="px-6 py-4 text-center text-sm text-rose-700">
          {listError?.message}{' '}
          <button type="button" className="font-semibold underline" onClick={() => setListError(null)}>
            Retry
          </button>
        </div>
      )}
      {listCurrent && rows.length > 0 && (
        <p className="px-6 pt-4 text-center text-xs text-gray-400">
          Showing {rows.length.toLocaleString()} of {loaded.total.toLocaleString()} trips
        </p>
      )}
      {listCurrent && (
        <ShowMoreButton hiddenCount={remaining} onShowMore={() => void loadMore()} noun={loadingMore ? 'trips loading…' : 'trips'} />
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        {/* Header */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
              {canPlan ? 'Trip planning' : 'Trip close-out'}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {tab === 'close-out' ? 'Verify completed trips and close them out.' : 'Run approved quotes as scheduled trips.'}
            </p>
          </div>
          {canPlan && (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/modules/quotes"
                className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
              >
                Back to quotes
              </Link>
              <button
                type="button"
                onClick={() => void openBuilder()}
                disabled={builderOpening}
                aria-busy={builderOpening || undefined}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                </svg>
                {builderOpening ? 'Opening…' : 'New trip'}
              </button>
            </div>
          )}
        </header>

        {builderError && (
          <div role="alert" className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {builderError}
          </div>
        )}

        {canPlan && canCloseOut && (
          <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Trip planning sections">
            <div className="flex w-max gap-1 rounded-xl border border-gray-100 bg-white p-1">
              {(['trips', 'close-out'] as const).map((id) => {
                const active = tab === id;
                const count = id === 'trips' ? counts.total : pendingCloseouts;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => showTab(id)}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                      active ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {id === 'trips' ? 'Trips' : 'Close out'}
                    <span
                      className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}
                      title={id === 'close-out' ? 'Awaiting close-out' : undefined}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {tab === 'close-out' && canCloseOut ? (
          closeoutTrips ? (
            <CloseoutPanel trips={closeoutTrips} onSaved={saveCloseout} />
          ) : closeoutError ? (
            <div className="rounded-2xl border border-rose-100 bg-rose-50 px-6 py-10 text-center text-sm text-rose-700">
              {closeoutError}{' '}
              <button type="button" className="font-semibold underline" onClick={() => setCloseoutError(null)}>
                Retry
              </button>
            </div>
          ) : (
            <div className="animate-pulse space-y-3" aria-busy="true">
              <div className="h-14 rounded-2xl border border-gray-100 bg-white" />
              <div className="h-64 rounded-2xl border border-gray-100 bg-white" />
            </div>
          )
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
              <SummaryCard label="Trips" value={counts.total.toLocaleString()} accent="text-primary" />
              <SummaryCard label="Planned" value={counts.Planned.toLocaleString()} />
              <SummaryCard label="Active" value={counts.Active.toLocaleString()} />
              <SummaryCard label="Completed" value={counts.Completed.toLocaleString()} />
            </div>

            {/* Toolbar */}
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
                  type="search"
                  aria-label="Search trips"
                  placeholder="Search by reference, tracking code, task number, client, or traveller…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide" role="group" aria-label="Filter by status">
                {STATUS_FILTERS.map((status) => {
                  const active = activeFilter === status;
                  // Counts are the viewer's trips in each status, regardless of the search.
                  const count = status === 'All' ? counts.total : counts[status];
                  return (
                    <button
                      type="button"
                      key={status}
                      onClick={() => setActiveFilter(status)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                      }`}
                    >
                      {status}
                      <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-500 lg:border-l lg:border-gray-100 lg:pl-3">
                <span className="whitespace-nowrap">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as TripSort)}
                  className="w-full rounded-lg bg-gray-50 px-2.5 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30 lg:w-auto"
                >
                  {TRIP_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Mobile cards */}
            <div className={`space-y-3 md:hidden ${listStale ? 'opacity-60' : ''}`} aria-busy={listStale || undefined}>
              {rows.map((trip) => (
                <Link
                  key={trip.id}
                  href={`/modules/trip-planning/${trip.id}`}
                  className="block w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{trip.reference}</p>
                      <p className="truncate text-sm text-gray-500">{trip.title}</p>
                    </div>
                    <StatusBadge status={trip.status} />
                  </div>
                  <p className="mt-2 truncate text-xs text-gray-400">
                    {trip.customer.name}
                    {trip.customer.company ? ` · ${trip.customer.company}` : ''}
                  </p>
                  {travelerLine(trip.travelers) && (
                    <p className="mt-0.5 truncate text-xs text-gray-500">{travelerLine(trip.travelers)}</p>
                  )}
                  <p className="mt-2 text-xs text-gray-400">
                    {trip.itemCount} items · {formatTripDate(trip.startDate)} → {formatTripDate(trip.endDate)}
                  </p>
                  <div className="mt-2">
                    <ResourceBadge count={trip.assignmentCount} />
                  </div>
                </Link>
              ))}
              {listCurrent && rows.length === 0 && (
                <EmptyState filtered={hasTrips || isFiltered} onCreate={() => void openBuilder()} />
              )}
              {listFooter}
            </div>

            {/* Desktop table */}
            <div
              className={`hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block ${listStale ? 'opacity-60' : ''}`}
              aria-busy={listStale || undefined}
            >
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Reference</th>
                    <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Client</th>
                    <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Tracking</th>
                    <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                    <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Owner</th>
                    <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Dates</th>
                    <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Resources</th>
                    <th className="w-10 px-6 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((trip) => (
                    <tr
                      key={trip.id}
                      // The reference is the real link (keyboard, middle-click, new tab);
                      // the rest of the row opens the trip as a convenience.
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        openTrip(trip.id);
                      }}
                      className="group cursor-pointer transition-colors hover:bg-gray-50/70"
                    >
                      <td className="px-6 py-4">
                        <Link
                          href={`/modules/trip-planning/${trip.id}`}
                          className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary focus:outline-none focus-visible:underline"
                        >
                          {trip.reference}
                        </Link>
                        <p className="mt-0.5 max-w-[220px] truncate text-sm text-gray-500">{trip.title}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-700">{trip.customer.name}</p>
                        {trip.customer.company && <p className="mt-0.5 text-xs text-gray-400">{trip.customer.company}</p>}
                        {travelerLine(trip.travelers) && (
                          <p className="mt-0.5 max-w-[220px] truncate text-xs text-gray-500" title={trip.travelers.map((t) => t.name).join(', ')}>
                            {travelerLine(trip.travelers)}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-primary">{trip.trackingCode}</p>
                        {trip.sourceQuote && <p className="mt-0.5 text-xs text-gray-400">from {trip.sourceQuote.reference}</p>}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={trip.status} />
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-600">
                          {trip.owner?.name ?? <span className="text-gray-300">Unassigned</span>}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-gray-500">{formatTripDate(trip.startDate)}</p>
                        <p className="text-xs text-gray-400">→ {formatTripDate(trip.endDate)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <ResourceBadge count={trip.assignmentCount} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <svg
                          className="ml-auto h-4 w-4 text-gray-300 transition-colors group-hover:text-primary"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {listCurrent && rows.length === 0 && (
                <EmptyState filtered={hasTrips || isFiltered} onCreate={() => void openBuilder()} />
              )}
              {listFooter}
            </div>
          </>
        )}
      </div>

      {builderOpen && formOptions && (
        <TripBuilder
          customers={formOptions.customers}
          travelers={formOptions.travelers}
          owners={formOptions.owners}
          currentUser={currentUser}
          nextReferenceNumber={formOptions.nextReferenceNumber}
          onClose={() => setBuilderOpen(false)}
          onSaved={(trip) => {
            upsertTrip(trip);
            setBuilderOpen(false);
            openTrip(trip.id);
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.Draft}`}>
      {status}
    </span>
  );
}

function ResourceBadge({ count }: { count: number }) {
  if (count > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        {count} allocated
      </span>
    );
  }
  return <span className="text-xs text-gray-300">Not allocated</span>;
}

function EmptyState({ filtered, onCreate }: { filtered: boolean; onCreate: () => void }) {
  return (
    <div className="px-6 py-16 text-center sm:py-20">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900">{filtered ? 'No matching trips' : 'No trips yet'}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
        {filtered ? 'Try a different search or clear the filter.' : 'Approved quotes can become trips, or build one manually.'}
      </p>
      {!filtered && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
        >
          New trip
        </button>
      )}
    </div>
  );
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}
