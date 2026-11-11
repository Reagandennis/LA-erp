'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { useConfirm } from '@/app/ui/confirm-dialog';
import { APP_LOCALE } from '@/lib/locale';
import { SERVICE_CATEGORIES } from '@/lib/service-catalog';
import {
  type ResourceKind,
  type TripResourceSummary,
  formatDateRange,
  formatHours,
  distanceKm,
  resourceUsage,
  unverifiedResources,
  verificationNotice,
} from '@/lib/trip-resource-model';

import type { TripDetail } from '../../types';
import { poolStatus } from './service-picker';

interface ServiceOption {
  productId: number;
  name: string;
  code: string | null;
  category: string | null;
  serviceClass: string | null;
  unitOfMeasure: string | null;
  kind: ResourceKind;
}

interface VendorOption {
  id: number;
  name: string;
  internal: boolean;
  services: ServiceOption[];
}

interface PoolOptions {
  country: string | null;
  countries: string[];
  vendors: VendorOption[];
}

const OPEN_KEY = 'trip-planning:resources-open';

// Whether the panel is expanded, remembered per browser. A tiny store rather
// than state, so the first paint matches the server (expanded) and then
// settles on what this browser last chose.
const openListeners = new Set<() => void>();

function subscribeOpen(listener: () => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Private windows: it just opens expanded next time.
  }
  for (const listener of openListeners) listener();
}

const fieldClass =
  'w-full rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/30';
const captionClass = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400';

const STATUS_TONE = {
  used: 'bg-emerald-50 text-emerald-700',
  kept: 'bg-blue-50 text-blue-700',
  idle: 'bg-gray-100 text-gray-600',
  muted: 'bg-gray-100 text-gray-500',
} as const;

/** One vendor's catalog for the country, and the form that stages a service from it. */
function VendorStager({
  vendor,
  tripDates,
  headcount,
  busy,
  onStage,
}: {
  vendor: VendorOption;
  tripDates: { start: string; end: string };
  headcount: number;
  busy: boolean;
  onStage: (input: { vendorId: number; productId: number; startDate: string | null; endDate: string | null; quantity: number }) => Promise<boolean>;
}) {
  const [productId, setProductId] = useState('');
  const [start, setStart] = useState(tripDates.start);
  const [end, setEnd] = useState(tripDates.end);
  const [quantity, setQuantity] = useState('1');
  const service = vendor.services.find((candidate) => String(candidate.productId) === productId) ?? null;

  const groups = useMemo(() => {
    const byCategory = new Map<string, ServiceOption[]>();
    for (const option of vendor.services) {
      const key = option.category ?? 'Other';
      byCategory.set(key, [...(byCategory.get(key) ?? []), option]);
    }
    const known = (SERVICE_CATEGORIES as readonly string[]).filter((category) => byCategory.has(category));
    return [...known, ...[...byCategory.keys()].filter((key) => !known.includes(key)).sort()].map((category) => ({
      category,
      services: byCategory.get(category)!,
    }));
  }, [vendor.services]);

  const pick = (value: string) => {
    setProductId(value);
    const picked = vendor.services.find((candidate) => String(candidate.productId) === value);
    // People are staged per traveller; a vehicle is staged one at a time.
    setQuantity(picked?.kind === 'personnel' ? String(Math.max(1, headcount)) : '1');
  };

  const count = Number(quantity);
  const validCount = Number.isInteger(count) && count >= 1 && count <= 999;
  const backwards = Boolean(start && end && end < start);

  const stage = async () => {
    if (!service || !validCount || backwards) return;
    const ok = await onStage({
      vendorId: vendor.id,
      productId: service.productId,
      startDate: start || null,
      endDate: end || null,
      quantity: count,
    });
    if (ok) setProductId('');
  };

  if (vendor.services.length === 0) {
    return <p className="px-3 pb-3 text-xs text-gray-500">No services in this vendor’s catalog for this country yet.</p>;
  }

  return (
    <div className="space-y-2 px-3 pb-3">
      <label className="block">
        <span className="sr-only">Service</span>
        <select value={productId} onChange={(event) => pick(event.target.value)} className={fieldClass}>
          <option value="">Choose a service…</option>
          {groups.map((group) => (
            <optgroup key={group.category} label={group.category}>
              {group.services.map((option) => (
                <option key={option.productId} value={option.productId}>
                  {option.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {service && (
        <>
          <p className="text-[11px] text-gray-500">{[service.code, service.unitOfMeasure].filter(Boolean).join(' · ')}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className={captionClass}>From</span>
              <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={`${fieldClass} mt-0.5 px-1.5 text-xs`} />
            </label>
            <label className="block">
              <span className={captionClass}>To</span>
              <input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} className={`${fieldClass} mt-0.5 px-1.5 text-xs`} />
            </label>
          </div>
          <div className="flex items-end gap-2">
            <label className="block w-20">
              <span className={captionClass}>{service.kind === 'personnel' ? 'How many' : 'Quantity'}</span>
              <input
                type="number"
                min={1}
                max={999}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className={`${fieldClass} mt-0.5 tabular-nums`}
              />
            </label>
            <button
              type="button"
              onClick={() => void stage()}
              disabled={busy || !validCount || backwards}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
              </svg>
              {busy ? 'Adding…' : 'Add to pool'}
            </button>
          </div>
          {service.kind === 'personnel' && headcount > 0 && (
            <p className="text-[11px] text-gray-400">
              {headcount} traveller{headcount === 1 ? '' : 's'} on this trip.
            </p>
          )}
          {backwards && <p className="text-xs text-rose-600">The end date is before the start date.</p>}
        </>
      )}
    </div>
  );
}

/**
 * Trip Resources: where the Controller stages what the trip will use. Pick
 * the country, open an approved vendor, choose one of its services and add it
 * to the pool with its dates and quantity. Events then pick their service
 * from the pool, and whatever no event used is flagged for verification
 * before the trip completes.
 */
export default function TripResourcesPanel({
  trip,
  canEdit,
  billingOpen,
  onTripChange,
  onOpenBilling,
  onVerify,
}: {
  trip: TripDetail;
  canEdit: boolean;
  /** The billing log is what the main pane is showing. */
  billingOpen: boolean;
  onTripChange: (trip: TripDetail) => void;
  onOpenBilling: () => void;
  /** Open the unused-resources check. */
  onVerify: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => true);
  const [country, setCountry] = useState(trip.country ?? '');
  const [options, setOptions] = useState<PoolOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = () => writeOpen(!open);

  useEffect(() => {
    if (!open || !canEdit) return;
    let live = true;
    fetch(`/api/trips/${trip.id}/resources${country ? `?country=${encodeURIComponent(country)}` : ''}`, { credentials: 'include' })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as (PoolOptions & { error?: string }) | null;
        if (!response.ok || !data?.vendors) throw new Error(data?.error ?? 'Could not load the approved vendors');
        if (!live) return;
        setOptions(data);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (live) setLoadError(cause instanceof Error ? cause.message : 'Could not load the approved vendors');
      });
    return () => {
      live = false;
    };
  }, [open, canEdit, trip.id, country]);

  const dated = trip.days.map((day) => day.dateKey).filter((key): key is string => Boolean(key)).sort();
  const tripDates = { start: dated[0] ?? '', end: dated.at(-1) ?? '' };

  const rows = useMemo(
    () => trip.resources.map((resource) => ({ resource, usage: resourceUsage(resource, trip.items, trip.days) })),
    [trip.resources, trip.items, trip.days],
  );
  const pending = unverifiedResources(trip.resources, trip.items);
  // Nothing needs verifying while the trip is still being planned: everything starts out unassigned.
  const flagged = pending.length > 0 && (trip.status === 'Active' || trip.status === 'Completed');

  const send = async (key: string, url: string, init: RequestInit, failure: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(url, { credentials: 'include', ...init });
      const data = (await response.json().catch(() => null)) as { trip?: TripDetail; error?: string } | null;
      if (!response.ok || !data?.trip) {
        setError(data?.error ?? failure);
        return false;
      }
      onTripChange(data.trip);
      return true;
    } finally {
      setBusy(null);
    }
  };

  const stage = (input: { vendorId: number; productId: number; startDate: string | null; endDate: string | null; quantity: number }) =>
    send(
      `stage:${input.vendorId}`,
      `/api/trips/${trip.id}/resources`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
      'Could not add that to the pool',
    );

  const remove = async (resource: TripResourceSummary, events: number) => {
    const ok = await confirm({
      title: 'Take this out of the pool?',
      message:
        events > 0
          ? `“${resource.serviceName}” is on ${events} event${events === 1 ? '' : 's'}. They keep its name, but stop counting against the pool.`
          : `“${resource.serviceName}” from ${resource.vendorName} will be removed from this trip’s staged resources.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await send(`row:${resource.id}`, `/api/trips/${trip.id}/resources/${resource.id}`, { method: 'DELETE' }, 'Could not remove it');
  };

  const undo = (resource: TripResourceSummary) =>
    send(
      `row:${resource.id}`,
      `/api/trips/${trip.id}/resources/${resource.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution: null }) },
      'Could not undo that',
    );

  // The trip's own country first, then every country with an approved vendor.
  const countries = [...new Set([...(trip.country ? [trip.country] : []), ...(options?.countries ?? [])])];
  const vendors = options?.vendors ?? [];

  return (
    <section className="border-b border-gray-100">
      {dialog}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          Trip resources
        </span>
        <span className="flex items-center gap-2">
          {flagged && <span className="h-2 w-2 rounded-full bg-amber-500" title={verificationNotice(pending.length)} />}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">{trip.resources.length}</span>
          <svg className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          {canEdit && (
            <>
              <label className="block">
                <span className={captionClass}>Country</span>
                <select
                  value={country}
                  onChange={(event) => {
                    setCountry(event.target.value);
                    setVendorId(null);
                    setLoadError(null);
                  }}
                  className={`${fieldClass} mt-1`}
                >
                  {!country && <option value="">Choose a country…</option>}
                  {countries.map((name) => (
                    <option key={name} value={name}>
                      {name}
                      {name === trip.country ? ' (this trip)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className={captionClass}>Approved vendors &amp; services</p>
                {loadError ? (
                  <p className="mt-1 text-xs text-rose-600">{loadError}</p>
                ) : !options || (options.country ?? '') !== country ? (
                  <p className="mt-1 text-xs text-gray-400">Loading…</p>
                ) : !country ? (
                  <p className="mt-1 text-xs text-gray-500">Pick the country to see its approved vendors.</p>
                ) : vendors.length === 0 ? (
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    No approved vendors for {country} yet. Add them, with their services, under{' '}
                    <Link href="/modules/vendors-suppliers" className="font-medium text-primary hover:underline">
                      Vendors/Suppliers
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5">
                    {vendors.map((vendor) => {
                      const expanded = vendorId === vendor.id;
                      return (
                        <li key={vendor.id} className={`overflow-hidden rounded-xl border ${expanded ? 'border-primary/30 bg-primary/5' : 'border-gray-200 bg-white'}`}>
                          <button
                            type="button"
                            onClick={() => setVendorId(expanded ? null : vendor.id)}
                            aria-expanded={expanded}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-gray-900">{vendor.name}</span>
                              <span className="block text-[11px] text-gray-500">
                                {vendor.internal ? 'Internal · ' : ''}
                                {vendor.services.length} service{vendor.services.length === 1 ? '' : 's'}
                              </span>
                            </span>
                            <svg className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {expanded && (
                            <VendorStager
                              vendor={vendor}
                              tripDates={tripDates}
                              headcount={trip.travelers.length}
                              busy={busy === `stage:${vendor.id}`}
                              onStage={stage}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}

          <div>
            <p className={captionClass}>Staged resource pool</p>
            {rows.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500">
                Nothing staged yet.{canEdit ? ' Services added here are what this trip’s events pick from.' : ''}
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {rows.map(({ resource, usage }) => {
                  const status = poolStatus(resource, usage);
                  const needsVerdict = usage.state === 'unassigned' && flagged;
                  const km = distanceKm(resource.startOdometer, resource.endOdometer);
                  const logged = [
                    resource.billableHours != null ? formatHours(resource.billableHours) : null,
                    km != null ? `${km.toLocaleString()} km` : null,
                  ].filter(Boolean);
                  return (
                    <li
                      key={resource.id}
                      className={`rounded-xl border px-3 py-2 ${
                        usage.state === 'assigned'
                          ? 'border-emerald-100 bg-emerald-50/50'
                          : needsVerdict
                            ? 'border-amber-200 bg-amber-50/60'
                            : 'border-gray-200 bg-gray-50/70'
                      } ${busy === `row:${resource.id}` ? 'opacity-60' : ''}`}
                    >
                      <p className={`text-sm font-semibold leading-snug ${usage.state === 'unused' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        {resource.serviceName}
                        {resource.quantity > 1 && <span className="ml-1 font-normal text-gray-500">×{resource.quantity}</span>}
                      </p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {resource.vendorName} · {formatDateRange(resource.startDate, resource.endDate, APP_LOCALE)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${needsVerdict ? 'bg-amber-100 text-amber-800' : STATUS_TONE[status.tone]}`}>
                          {needsVerdict ? 'Unused · needs verification' : usage.state === 'unused' ? 'Verified unused · not billed' : status.label}
                        </span>
                        {usage.state === 'kept' && logged.length > 0 && <span className="text-[11px] text-gray-500">{logged.join(' · ')}</span>}
                        {canEdit && (
                          <span className="ml-auto flex items-center gap-2.5">
                            {(usage.state === 'kept' || usage.state === 'unused') && (
                              <button type="button" onClick={() => void undo(resource)} disabled={busy !== null} className="text-[11px] font-medium text-gray-500 hover:text-primary disabled:opacity-50">
                                Undo
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void remove(resource, usage.eventCount)}
                              disabled={busy !== null}
                              className="text-[11px] font-medium text-gray-400 hover:text-rose-600 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {error && <p className="text-xs text-rose-600">{error}</p>}

          {flagged &&
            (canEdit ? (
              <button
                type="button"
                onClick={onVerify}
                className="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                {verificationNotice(pending.length).replace(/^./, (c) => c.toUpperCase())}
              </button>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                {verificationNotice(pending.length).replace(/^./, (c) => c.toUpperCase())}
              </p>
            ))}

          {(trip.resources.length > 0 || trip.dayLogs.length > 0) && (
            <button
              type="button"
              onClick={onOpenBilling}
              aria-pressed={billingOpen}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                billingOpen ? 'border-primary/30 bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Billing log
              <svg className="h-4 w-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
