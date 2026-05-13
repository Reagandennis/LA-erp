'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import TripBuilder from './trip-builder';
import TripDetailDrawer from './trip-detail-drawer';
import type { OwnerOption, TripDetail, TripStatusFilter, TripSummary } from './types';

interface CustomerOption {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
}

interface TripsClientProps {
  currentUser: { id: number; name: string; email: string };
  isAdmin: boolean;
  initialTrips: TripSummary[];
  initialCustomers: CustomerOption[];
  initialOwners: OwnerOption[];
}

const STATUS_FILTERS: TripStatusFilter[] = [
  'All',
  'Draft',
  'Planned',
  'Active',
  'Completed',
  'Cancelled',
];

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-50 text-gray-500 border-gray-100',
  Planned: 'bg-blue-50 text-blue-600 border-blue-100',
  Active: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  Completed: 'bg-violet-50 text-violet-600 border-violet-100',
  Cancelled: 'bg-rose-50 text-rose-600 border-rose-100',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function TripsClient({
  currentUser,
  isAdmin,
  initialTrips,
  initialCustomers,
  initialOwners,
}: TripsClientProps) {
  const [trips, setTrips] = useState<TripSummary[]>(initialTrips);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<TripStatusFilter>('All');
  const [selectedTripId, setSelectedTripId] = useState<number | null>(() => {
    // Honour ?focus=<tripId> from the quote drawer link.
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const focus = Number(params.get('focus'));
    return Number.isInteger(focus) && focus > 0 ? focus : null;
  });
  const [builderOpen, setBuilderOpen] = useState(false);

  const filteredTrips = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    return trips.filter((trip) => {
      const matchesSearch =
        normalized.length === 0 ||
        trip.reference.toLowerCase().includes(normalized) ||
        trip.trackingCode.toLowerCase().includes(normalized) ||
        trip.title.toLowerCase().includes(normalized) ||
        trip.customer.name.toLowerCase().includes(normalized) ||
        (trip.customer.company?.toLowerCase().includes(normalized) ?? false);
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
        createdBy: trip.createdBy,
        owner: trip.owner,
        sourceQuote: trip.sourceQuote,
        itemCount: 'items' in trip ? trip.items.length : trip.itemCount,
      };
      return [summary, ...without];
    });
  };

  const removeTrip = (tripId: number) => {
    setTrips((current) => current.filter((t) => t.id !== tripId));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-10">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 mb-6 md:mb-10">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Trip Planning
            </h1>
            <p className="text-gray-500 mt-1 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
              Run approved quotes as scheduled trips
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <Link
              href="/modules/quotes"
              className="px-4 py-2 border-2 border-gray-200 text-gray-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-100 whitespace-nowrap text-center"
            >
              Back to quotes
            </Link>
            <button
              type="button"
              onClick={() => setBuilderOpen(true)}
              className="w-full sm:w-auto px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
              </svg>
              New Trip
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-10">
          <SummaryCard label="Trips" value={`${totals.total}`} accent="text-gray-900" />
          <SummaryCard label="Planned" value={`${totals.planned}`} accent="text-blue-600" />
          <SummaryCard label="Active" value={`${totals.active}`} accent="text-emerald-600" />
          <SummaryCard label="Completed" value={`${totals.completed}`} accent="text-violet-600" />
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-3xl border border-gray-100 shadow-sm mb-6 flex flex-col lg:flex-row lg:items-center gap-3 md:gap-4">
          <div className="relative flex-1">
            <svg
              className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search by reference, tracking code, title, customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-6 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {STATUS_FILTERS.map((status) => (
              <button
                type="button"
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                  activeFilter === status
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100'
                    : 'text-gray-400 hover:bg-gray-100'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {filteredTrips.map((trip) => (
            <button
              key={trip.id}
              type="button"
              onClick={() => setSelectedTripId(trip.id)}
              className="w-full text-left bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:border-emerald-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                    {trip.reference} · {trip.trackingCode}
                  </p>
                  <p className="text-sm font-black text-gray-900 mt-1">{trip.title}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {trip.customer.name}
                    {trip.customer.company ? ` • ${trip.customer.company}` : ''}
                  </p>
                </div>
                <span
                  className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border whitespace-nowrap ${
                    STATUS_STYLES[trip.status] ?? STATUS_STYLES.Draft
                  }`}
                >
                  {trip.status}
                </span>
              </div>
              <div className="flex items-end justify-between mt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                  {trip.itemCount} items · {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Reference & Title
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Customer
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Tracking
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Status
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Owner
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                  Dates
                </th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredTrips.map((trip) => (
                <tr
                  key={trip.id}
                  onClick={() => setSelectedTripId(trip.id)}
                  className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
                >
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white text-[10px] font-black shrink-0">
                        TR
                      </div>
                      <div>
                        <p className="text-sm font-black text-gray-900 group-hover:text-emerald-700 transition-colors">
                          {trip.reference}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase truncate max-w-[200px] mt-0.5">
                          {trip.title}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-xs font-black text-gray-700">{trip.customer.name}</p>
                    {trip.customer.company && (
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                        {trip.customer.company}
                      </p>
                    )}
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-[11px] font-black text-emerald-700">{trip.trackingCode}</p>
                    {trip.sourceQuote && (
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                        from {trip.sourceQuote.reference}
                      </p>
                    )}
                  </td>
                  <td className="px-8 py-6">
                    <span
                      className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                        STATUS_STYLES[trip.status] ?? STATUS_STYLES.Draft
                      }`}
                    >
                      {trip.status}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-[11px] font-bold text-gray-600">
                      {trip.owner?.name ?? <span className="text-gray-300">— unassigned —</span>}
                    </p>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                      {formatDate(trip.startDate)}
                    </p>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      → {formatDate(trip.endDate)}
                    </p>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button
                      type="button"
                      className="p-2 text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                      aria-label="Open trip"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={3}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredTrips.length === 0 && (
            <div className="p-24 text-center">
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">No trips yet</h3>
              <p className="text-gray-500 mt-2 font-bold text-sm">
                Approved quotes can be turned into trips, or build one manually.
              </p>
            </div>
          )}
        </div>

        {filteredTrips.length === 0 && (
          <div className="md:hidden bg-white rounded-2xl p-10 text-center border border-gray-100">
            <h3 className="text-lg font-black text-gray-900">No trips yet</h3>
            <p className="text-gray-500 mt-2 text-sm">Tap New Trip to start one.</p>
          </div>
        )}
      </div>

      {builderOpen && (
        <TripBuilder
          customers={initialCustomers}
          owners={initialOwners}
          currentUser={currentUser}
          onClose={() => setBuilderOpen(false)}
          onSaved={(trip) => {
            upsertTrip(trip);
            setBuilderOpen(false);
            setSelectedTripId(trip.id);
          }}
        />
      )}

      {selectedTripId !== null && (
        <TripDetailDrawer
          tripId={selectedTripId}
          currentUser={currentUser}
          isAdmin={isAdmin}
          onClose={() => setSelectedTripId(null)}
          onChanged={(trip) => upsertTrip(trip)}
          onDeleted={(id) => {
            removeTrip(id);
            setSelectedTripId(null);
          }}
        />
      )}

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="bg-white p-4 md:p-6 rounded-2xl md:rounded-[2.5rem] border border-gray-100 shadow-sm">
      <p className="text-[9px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className={`text-lg md:text-2xl font-black ${accent}`}>{value}</p>
    </div>
  );
}
