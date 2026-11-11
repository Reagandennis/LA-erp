'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useConfirm } from '@/app/ui/confirm-dialog';
import { useSyncedState } from '@/app/ui/use-synced-state';
import { SERVICE_CATEGORIES, SERVICE_COUNTRIES } from '@/lib/service-catalog';
import { type VendorStatus, VENDOR_STATUSES } from '@/lib/trip-resource-model';
import type { CatalogService, VendorDto, VendorRegister } from '@/lib/vendors';

type StatusFilter = 'All' | VendorStatus;
type Tab = 'profile' | 'services' | 'vehicles' | 'people';

const STATUS_STYLES: Record<VendorStatus, string> = {
  Approved: 'bg-emerald-50 text-emerald-700',
  Pending: 'bg-amber-50 text-amber-700',
  Suspended: 'bg-rose-50 text-rose-700',
};

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';

/** How many rows a list draws at once; the catalog and the registers run to hundreds. */
const SHOWN = 80;

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  );
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>{children}</span>;
}

function SummaryCard({ label, value, hint, accent = 'text-gray-900' }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${accent}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

interface Draft {
  name: string;
  internal: boolean;
  status: VendorStatus;
  countries: string[];
  contactName: string;
  email: string;
  phone: string;
  notes: string;
}

const BLANK: Draft = {
  name: '',
  internal: false,
  status: 'Pending',
  countries: [],
  contactName: '',
  email: '',
  phone: '',
  notes: '',
};

function draftOf(vendor: VendorDto): Draft {
  return {
    name: vendor.name,
    internal: vendor.internal,
    status: vendor.status,
    countries: vendor.countries,
    contactName: vendor.contactName ?? '',
    email: vendor.email ?? '',
    phone: vendor.phone ?? '',
    notes: vendor.notes ?? '',
  };
}

/** One row a vendor can have: a service, a vehicle or a person. */
interface LinkItem {
  id: number;
  title: string;
  subtitle: string;
  /** Free text the search box matches. */
  haystack: string;
  /** Values for the two dropdown filters. */
  a: string;
  b: string;
  /** This vendor's, nobody's, or another vendor's (whose name is shown). */
  owner: 'mine' | 'free' | 'other';
  ownerName?: string;
}

interface LinkFilter {
  label: string;
  options: string[];
}

/**
 * Two lists for one kind of thing: what the vendor has, and what it could
 * have, under shared filters. Used for its services, vehicles and people.
 */
function LinkManager({
  items,
  noun,
  nounPlural,
  mineTitle,
  filterA,
  filterB,
  defaultA,
  busy,
  onChange,
}: {
  items: LinkItem[];
  noun: string;
  nounPlural: string;
  mineTitle: string;
  filterA: LinkFilter;
  filterB: LinkFilter;
  /** Where the first filter starts, when that value has rows. */
  defaultA?: string;
  busy: boolean;
  onChange: (change: { add: number[]; remove: number[] }) => void;
}) {
  const [query, setQuery] = useState('');
  const [a, setA] = useState(defaultA && filterA.options.includes(defaultA) ? defaultA : '');
  const [b, setB] = useState('');

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => (!a || item.a === a) && (!b || item.b === b) && (!q || item.haystack.includes(q)));
  }, [items, query, a, b]);
  const mine = matching.filter((item) => item.owner === 'mine');
  const available = matching.filter((item) => item.owner !== 'mine');
  const free = available.filter((item) => item.owner === 'free');
  const total = items.filter((item) => item.owner === 'mine').length;

  const row = (item: LinkItem) => (
    <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-gray-900">{item.title}</span>
        <span className="block truncate text-xs text-gray-500">
          {item.subtitle}
          {item.owner === 'other' && <span className="text-amber-700"> · with {item.ownerName}</span>}
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(item.owner === 'mine' ? { add: [], remove: [item.id] } : { add: [item.id], remove: [] })}
        className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
          item.owner === 'mine' ? 'text-gray-500 hover:bg-rose-50 hover:text-rose-600' : 'bg-primary/10 text-primary hover:bg-primary/20'
        }`}
      >
        {item.owner === 'mine' ? 'Remove' : item.owner === 'other' ? 'Move here' : 'Add'}
      </button>
    </li>
  );

  const more = (count: number) =>
    count > SHOWN && <li className="px-3 py-2 text-xs text-gray-400">Showing {SHOWN} of {count.toLocaleString()}. Narrow the filters to see the rest.</li>;

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl bg-gray-50 p-3">
        <input
          type="search"
          placeholder={`Search ${nounPlural}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-xl bg-white px-3.5 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="grid grid-cols-2 gap-2">
          <select aria-label={filterA.label} value={a} onChange={(event) => setA(event.target.value)} className="rounded-xl bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">{filterA.label}: all</option>
            {filterA.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select aria-label={filterB.label} value={b} onChange={(event) => setB(event.target.value)} className="rounded-xl bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">{filterB.label}: all</option>
            {filterB.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {mineTitle} · {total.toLocaleString()}
          </h4>
          {mine.length > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange({ add: [], remove: mine.map((item) => item.id) })}
              className="text-xs font-medium text-gray-500 hover:text-rose-600 disabled:opacity-50"
            >
              Remove the {mine.length.toLocaleString()} shown
            </button>
          )}
        </div>
        {mine.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-400">
            {total === 0 ? `No ${nounPlural} yet. Add them from the list below.` : `None of its ${nounPlural} match the filters.`}
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-gray-50 overflow-y-auto rounded-2xl border border-gray-100 bg-white">
            {mine.slice(0, SHOWN).map(row)}
            {more(mine.length)}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Add {nounPlural} · {available.length.toLocaleString()} available
          </h4>
          {free.length > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onChange({ add: free.map((item) => item.id), remove: [] })}
              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              Add all {free.length.toLocaleString()}
              {free.length < available.length ? ' untagged' : ''}
            </button>
          )}
        </div>
        {available.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-gray-400">
            No other {noun} matches the filters.
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-gray-50 overflow-y-auto rounded-2xl border border-gray-100 bg-white">
            {available.slice(0, SHOWN).map(row)}
            {more(available.length)}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Known values first, in the given order, then anything else in use. */
function ordered(known: readonly string[], values: Iterable<string>): string[] {
  const present = new Set(values);
  return [...known.filter((value) => present.has(value)), ...[...present].filter((value) => !known.includes(value)).sort()];
}

export default function VendorsClient({ initialRegister, catalog }: { initialRegister: VendorRegister; catalog: CatalogService[] }) {
  const [register, setRegister] = useSyncedState<VendorRegister>(initialRegister);
  const { confirm, dialog } = useConfirm();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [countryFilter, setCountryFilter] = useState('');
  /** The vendor in the drawer: an id, or 'new' while one is being created. */
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  const [tab, setTab] = useState<Tab>('profile');
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { vendors, vehicles, people } = register;
  const vendor = typeof openId === 'number' ? (vendors.find((candidate) => candidate.id === openId) ?? null) : null;
  const vendorNames = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);

  const counts = useMemo(() => {
    const vehiclesBy = new Map<number, number>();
    const peopleBy = new Map<number, number>();
    for (const v of vehicles) if (v.vendorId != null) vehiclesBy.set(v.vendorId, (vehiclesBy.get(v.vendorId) ?? 0) + 1);
    for (const p of people) if (p.vendorId != null) peopleBy.set(p.vendorId, (peopleBy.get(p.vendorId) ?? 0) + 1);
    return { vehiclesBy, peopleBy };
  }, [vehicles, people]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vendors.filter((v) => {
      if (statusFilter !== 'All' && v.status !== statusFilter) return false;
      if (countryFilter && !v.countries.includes(countryFilter)) return false;
      if (!q) return true;
      return [v.name, v.contactName, v.email, v.phone, ...v.countries].some((value) => value?.toLowerCase().includes(q));
    });
  }, [vendors, searchQuery, statusFilter, countryFilter]);

  const taggedVehicles = vehicles.filter((v) => v.vendorId != null).length;
  const taggedPeople = people.filter((p) => p.vendorId != null).length;

  const close = useCallback(() => {
    setOpenId(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (openId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, close]);

  const openVendor = (target: VendorDto, startTab: Tab = 'profile') => {
    setDraft(draftOf(target));
    setTab(startTab);
    setError(null);
    setOpenId(target.id);
  };

  const startAdd = () => {
    // The first vendor is usually our own fleet and staff.
    setDraft({ ...BLANK, internal: vendors.length === 0 });
    setTab('profile');
    setError(null);
    setOpenId('new');
  };

  /** Sends a change and takes the register it hands back. Returns the vendor it was about. */
  const send = async (url: string, method: string, body: unknown | undefined, failure: string): Promise<VendorDto | null | false> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        credentials: 'include',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const data = (await response.json().catch(() => null)) as { register?: VendorRegister; vendor?: VendorDto | null; error?: string } | null;
      if (!response.ok || !data?.register) {
        setError(data?.error ?? failure);
        return false;
      }
      setRegister(data.register);
      return data.vendor ?? null;
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!draft.name.trim()) {
      setError('Give the vendor a name');
      return;
    }
    if (openId === 'new') {
      const created = await send('/api/vendors', 'POST', draft, 'Could not add the vendor');
      // Straight on to what it supplies: a vendor with no services offers a trip nothing.
      if (created) openVendor(created, 'services');
      return;
    }
    if (vendor) {
      const saved = await send(`/api/vendors/${vendor.id}`, 'PATCH', draft, 'Could not save the vendor');
      if (saved) setDraft(draftOf(saved));
    }
  };

  const removeVendor = async () => {
    if (!vendor) return;
    const ok = await confirm({
      title: `Delete ${vendor.name}?`,
      message: 'Its catalog goes with it. Its vehicles and people stay in their registers, untagged.',
      confirmLabel: 'Delete vendor',
    });
    if (!ok) return;
    const result = await send(`/api/vendors/${vendor.id}`, 'DELETE', undefined, 'Could not delete the vendor');
    if (result !== false) close();
  };

  const changeLinks = (kind: 'services' | 'vehicles' | 'people') => (change: { add: number[]; remove: number[] }) => {
    if (!vendor) return;
    void send(`/api/vendors/${vendor.id}/links`, 'PUT', { kind, ...change }, 'Could not save that change');
  };

  // ── What the open vendor has, and could have ──────────────────────────
  const serviceItems = useMemo<LinkItem[]>(() => {
    if (!vendor) return [];
    const mine = new Set(vendor.serviceIds);
    return catalog.map((service) => ({
      id: service.id,
      title: service.name,
      subtitle: [service.code, service.unitOfMeasure].filter(Boolean).join(' · '),
      haystack: [service.name, service.code, service.serviceClass, service.country].filter(Boolean).join(' ').toLowerCase(),
      a: service.country ?? 'No country',
      b: service.category ?? 'Uncategorised',
      owner: mine.has(service.id) ? 'mine' : 'free',
    }));
  }, [vendor, catalog]);

  const vehicleItems = useMemo<LinkItem[]>(() => {
    if (!vendor) return [];
    return vehicles.map((vehicle) => ({
      id: vehicle.id,
      title: vehicle.registration,
      subtitle: [[vehicle.make, vehicle.model].filter(Boolean).join(' '), vehicle.type].filter(Boolean).join(' · '),
      haystack: [vehicle.registration, vehicle.make, vehicle.model, vehicle.type].filter(Boolean).join(' ').toLowerCase(),
      a: vehicle.type,
      b: vehicle.vendorId == null ? 'Untagged' : vehicle.vendorId === vendor.id ? vendor.name : (vendorNames.get(vehicle.vendorId) ?? 'Another vendor'),
      owner: vehicle.vendorId === vendor.id ? 'mine' : vehicle.vendorId == null ? 'free' : 'other',
      ownerName: vehicle.vendorId != null ? vendorNames.get(vehicle.vendorId) : undefined,
    }));
  }, [vendor, vehicles, vendorNames]);

  const peopleItems = useMemo<LinkItem[]>(() => {
    if (!vendor) return [];
    return people.map((person) => ({
      id: person.id,
      title: person.name,
      subtitle: [person.roles.join(', ') || 'No operational role', person.engagement].join(' · '),
      haystack: [person.name, ...person.roles, person.engagement].join(' ').toLowerCase(),
      // A person may hold several roles; the filter takes the first.
      a: person.roles[0] ?? 'No role',
      b: person.engagement,
      owner: person.vendorId === vendor.id ? 'mine' : person.vendorId == null ? 'free' : 'other',
      ownerName: person.vendorId != null ? vendorNames.get(person.vendorId) : undefined,
    }));
  }, [vendor, people, vendorNames]);

  const tabs: Array<{ key: Tab; label: string }> = vendor
    ? [
        { key: 'profile', label: 'Profile' },
        { key: 'services', label: `Services · ${vendor.serviceIds.length}` },
        { key: 'vehicles', label: `Vehicles · ${counts.vehiclesBy.get(vendor.id) ?? 0}` },
        { key: 'people', label: `People · ${counts.peopleBy.get(vendor.id) ?? 0}` },
      ]
    : [{ key: 'profile', label: 'Profile' }];

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      {dialog}
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Vendors &amp; suppliers</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Who supplies our services, vehicles and people. A trip’s Trip Resources panel offers the approved vendors for its country, each with
              the services listed here.
            </p>
          </div>
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
            </svg>
            Add vendor
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Vendors" value={`${vendors.length}`} accent="text-primary" />
          <SummaryCard
            label="Approved"
            value={`${vendors.filter((v) => v.status === 'Approved').length}`}
            hint={plural(vendors.filter((v) => v.status === 'Pending').length, 'pending', 'pending')}
          />
          <SummaryCard label="Vehicles tagged" value={`${taggedVehicles}`} hint={`of ${vehicles.length.toLocaleString()} in the fleet`} />
          <SummaryCard label="People tagged" value={`${taggedPeople}`} hint={`of ${people.length.toLocaleString()} in personnel`} />
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by name, contact or country…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <select
              aria-label="Country"
              value={countryFilter}
              onChange={(event) => setCountryFilter(event.target.value)}
              className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All countries</option>
              {SERVICE_COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 overflow-x-auto">
              {(['All', ...VENDOR_STATUSES] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    statusFilter === status ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="space-y-3">
            {filtered.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => openVendor(v)}
                className="group w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30 sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">{initials(v.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">{v.name}</h3>
                      <Badge className={v.internal ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600'}>{v.internal ? 'Internal' : 'External'}</Badge>
                      <Badge className={STATUS_STYLES[v.status]}>{v.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">{v.countries.length > 0 ? v.countries.join(' · ') : 'No countries set'}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {plural(v.serviceIds.length, 'service')} · {plural(counts.vehiclesBy.get(v.id) ?? 0, 'vehicle')} ·{' '}
                      {plural(counts.peopleBy.get(v.id) ?? 0, 'person', 'people')}
                      {v.tripCount > 0 ? ` · staged on ${plural(v.tripCount, 'trip')}` : ''}
                      {v.contactName ? ` · ${v.contactName}` : ''}
                    </p>
                    {v.status === 'Approved' && (v.serviceIds.length === 0 || v.countries.length === 0) && (
                      <p className="mt-1.5 text-xs font-medium text-amber-700">
                        Approved, but trips can’t stage from it yet: it needs {v.countries.length === 0 ? 'a country' : ''}
                        {v.countries.length === 0 && v.serviceIds.length === 0 ? ' and ' : ''}
                        {v.serviceIds.length === 0 ? 'services in its catalog' : ''}.
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m4-14h10M7 11h10M7 15h4" />
              </svg>
            </div>
            {vendors.length === 0 ? (
              <>
                <h3 className="text-lg font-semibold text-gray-900">No vendors yet</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
                  Start with your own fleet and staff as an internal vendor, then add each outside supplier. Give each one its countries and
                  services, tag its vehicles and people, and approve it so trips can stage from it.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-gray-900">No vendors found</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">Try a different search or clear the filters.</p>
              </>
            )}
          </div>
        )}
      </div>

      {openId !== null && (
        <>
          <div className="fixed inset-0 z-[220] bg-gray-900/30 backdrop-blur-sm" onClick={close} />
          <div className="fixed right-0 top-0 z-[230] flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-gray-100 bg-white">
              <div className="flex items-center justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-gray-900">{vendor ? vendor.name : 'New vendor'}</h2>
                  {vendor && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge className={vendor.internal ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-600'}>{vendor.internal ? 'Internal' : 'External'}</Badge>
                      <Badge className={STATUS_STYLES[vendor.status]}>{vendor.status}</Badge>
                    </div>
                  )}
                </div>
                <button type="button" onClick={close} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {vendor && (
                <div className="flex gap-1 overflow-x-auto px-6 pb-2">
                  {tabs.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        setTab(entry.key);
                        setError(null);
                      }}
                      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        tab === entry.key ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                      }`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 px-6 py-6">
              {error && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700">{error}</p>}

              {tab === 'profile' && (
                <div className="space-y-5">
                  <div>
                    <label className={labelClass}>Vendor name</label>
                    <input
                      type="text"
                      value={draft.name}
                      placeholder="Company name"
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className="w-full rounded-xl bg-gray-50 px-4 py-3 text-lg font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <span className={labelClass}>Type</span>
                      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
                        {([false, true] as const).map((internal) => (
                          <button
                            key={String(internal)}
                            type="button"
                            aria-pressed={draft.internal === internal}
                            onClick={() => setDraft({ ...draft, internal })}
                            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                              draft.internal === internal ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            {internal ? 'Internal' : 'External'}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs text-gray-400">{draft.internal ? 'Our own fleet and staff.' : 'An outside supplier.'}</p>
                    </div>
                    <div>
                      <label className={labelClass}>Status</label>
                      <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as VendorStatus })} className={inputClass}>
                        {VENDOR_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1.5 text-xs text-gray-400">Only approved vendors are offered to trips.</p>
                    </div>
                  </div>

                  <div>
                    <span className={labelClass}>Countries it works in</span>
                    <div className="flex flex-wrap gap-1.5">
                      {SERVICE_COUNTRIES.map((country) => {
                        const on = draft.countries.includes(country);
                        return (
                          <button
                            key={country}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              setDraft({ ...draft, countries: on ? draft.countries.filter((c) => c !== country) : [...draft.countries, country] })
                            }
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                              on ? 'border-primary bg-primary text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            {country}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">A trip sees this vendor when its country is one of these.</p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={labelClass}>Contact name</label>
                      <input type="text" value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Phone</label>
                      <input type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} className={inputClass} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Email</label>
                      <input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className={inputClass} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Notes</label>
                      <textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className={inputClass} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-5">
                    {vendor ? (
                      <button type="button" onClick={() => void removeVendor()} disabled={busy} className="text-sm font-medium text-gray-400 transition-colors hover:text-rose-600 disabled:opacity-50">
                        Delete vendor
                      </button>
                    ) : (
                      <span />
                    )}
                    <div className="flex gap-2">
                      <button type="button" onClick={close} className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50">
                        {vendor ? 'Close' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveProfile()}
                        disabled={busy}
                        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {busy ? 'Saving…' : vendor ? 'Save' : 'Add vendor'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {vendor && tab === 'services' && (
                <LinkManager
                  key={`services:${vendor.id}`}
                  items={serviceItems}
                  noun="service"
                  nounPlural="services"
                  mineTitle="In its catalog"
                  filterA={{ label: 'Country', options: ordered(SERVICE_COUNTRIES, serviceItems.map((item) => item.a)) }}
                  filterB={{ label: 'Category', options: ordered(SERVICE_CATEGORIES, serviceItems.map((item) => item.b)) }}
                  // A one-country vendor opens on that country, where "add all" is most use.
                  defaultA={vendor.countries.length === 1 ? vendor.countries[0] : undefined}
                  busy={busy}
                  onChange={changeLinks('services')}
                />
              )}

              {vendor && tab === 'vehicles' && (
                <LinkManager
                  key={`vehicles:${vendor.id}`}
                  items={vehicleItems}
                  noun="vehicle"
                  nounPlural="vehicles"
                  mineTitle="Its vehicles"
                  filterA={{ label: 'Type', options: ordered([], vehicleItems.map((item) => item.a)) }}
                  filterB={{ label: 'Vendor', options: ordered(['Untagged'], vehicleItems.map((item) => item.b)) }}
                  busy={busy}
                  onChange={changeLinks('vehicles')}
                />
              )}

              {vendor && tab === 'people' && (
                <LinkManager
                  key={`people:${vendor.id}`}
                  items={peopleItems}
                  noun="person"
                  nounPlural="people"
                  mineTitle="Its people"
                  filterA={{ label: 'Role', options: ordered([], peopleItems.map((item) => item.a)) }}
                  filterB={{ label: 'Engagement', options: ordered([], peopleItems.map((item) => item.b)) }}
                  busy={busy}
                  onChange={changeLinks('people')}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
