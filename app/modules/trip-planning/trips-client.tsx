'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import TripBuilder from './trip-builder';
import type { OwnerOption, TravelerOption, TripDetail, TripStatusFilter, TripSummary } from './types';

interface CustomerOption {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
}

interface TripsClientProps {
  currentUser: { id: number; name: string; email: string };
  initialTrips: TripSummary[];
  initialCustomers: CustomerOption[];
  initialOwners: OwnerOption[];
  initialTravelers: TravelerOption[];
}

const STATUS_FILTERS: TripStatusFilter[] = ['All', 'Draft', 'Planned', 'Active', 'Completed', 'Cancelled'];

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-600',
  Planned: 'bg-blue-50 text-blue-700',
  Active: 'bg-emerald-50 text-emerald-700',
  Completed: 'bg-violet-50 text-violet-700',
  Cancelled: 'bg-rose-50 text-rose-700',
};

/** "Lead Name +2", or null when the trip has no travellers yet. */
function travelerLine(travelers: TripSummary['travelers']): string | null {
  if (travelers.length === 0) return null;
  const [lead, ...rest] = travelers;
  return rest.length > 0 ? `${lead.name} +${rest.length}` : lead.name;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TripsClient({
  currentUser,
  initialTrips,
  initialCustomers,
  initialOwners,
  initialTravelers,
}: TripsClientProps) {
  const router = useRouter();
  const [trips, setTrips] = useState<TripSummary[]>(initialTrips);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<TripStatusFilter>('All');
  const [builderOpen, setBuilderOpen] = useState(false);

  // Honour legacy ?focus=<tripId> deep links (from quote drawer, notifications) by
  // redirecting to the dedicated itinerary page.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const focus = Number(params.get('focus'));
    if (Number.isInteger(focus) && focus > 0) {
      router.replace(`/modules/trip-planning/${focus}`);
    }
  }, [router]);

  const filteredTrips = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return trips.filter((trip) => {
      const matchesSearch =
        normalized.length === 0 ||
        trip.reference.toLowerCase().includes(normalized) ||
        trip.trackingCode.toLowerCase().includes(normalized) ||
        trip.title.toLowerCase().includes(normalized) ||
        trip.customer.name.toLowerCase().includes(normalized) ||
        (trip.customer.company?.toLowerCase().includes(normalized) ?? false) ||
        trip.travelers.some((traveler) => traveler.name.toLowerCase().includes(normalized));
      const matchesFilter = activeFilter === 'All' || trip.status === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [trips, searchQuery, activeFilter]);

  const totals = useMemo(
    () => ({
      total: trips.length,
      planned: trips.filter((t) => t.status === 'Planned').length,
      active: trips.filter((t) => t.status === 'Active').length,
      completed: trips.filter((t) => t.status === 'Completed').length,
    }),
    [trips],
  );

  const upsertTrip = (trip: TripSummary | TripDetail) => {
    setTrips((current) => {
      const without = current.filter((t) => t.id !== trip.id);
      const summary: TripSummary = {
        id: trip.id,
        reference: trip.reference,
        trackingCode: trip.trackingCode,
        title: trip.title,
        description: trip.description,
        status: trip.status,
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
      return [summary, ...without];
    });
  };

  const openTrip = (tripId: number) => {
    router.push(`/modules/trip-planning/${tripId}`);
  };

  const hasTrips = trips.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        {/* Header */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Trip planning</h1>
            <p className="mt-1 text-sm text-gray-500">Run approved quotes as scheduled trips.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/modules/quotes"
              className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
            >
              Back to quotes
            </Link>
            <button
              type="button"
              onClick={() => setBuilderOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
              </svg>
              New trip
            </button>
          </div>
        </header>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Trips" value={`${totals.total}`} accent="text-primary" />
          <SummaryCard label="Planned" value={`${totals.planned}`} />
          <SummaryCard label="Active" value={`${totals.active}`} />
          <SummaryCard label="Completed" value={`${totals.completed}`} />
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
              type="text"
              placeholder="Search by reference, tracking code, title, client, or traveller…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {STATUS_FILTERS.map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  activeFilter === status ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {filteredTrips.map((trip) => (
            <button
              key={trip.id}
              type="button"
              onClick={() => openTrip(trip.id)}
              className="w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30"
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
                {trip.itemCount} items · {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
              </p>
              <div className="mt-2">
                <ResourceBadge count={trip.assignmentCount} />
              </div>
            </button>
          ))}
          {filteredTrips.length === 0 && <EmptyState filtered={hasTrips} onCreate={() => setBuilderOpen(true)} />}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white md:block">
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
              {filteredTrips.map((trip) => (
                <tr
                  key={trip.id}
                  onClick={() => openTrip(trip.id)}
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
                    <p className="text-sm text-gray-500">{formatDate(trip.startDate)}</p>
                    <p className="text-xs text-gray-400">→ {formatDate(trip.endDate)}</p>
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
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredTrips.length === 0 && <EmptyState filtered={hasTrips} onCreate={() => setBuilderOpen(true)} />}
        </div>
      </div>

      {builderOpen && (
        <TripBuilder
          customers={initialCustomers}
          travelers={initialTravelers}
          owners={initialOwners}
          currentUser={currentUser}
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
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
