'use client';

import { useEffect, useMemo, useState } from 'react';

import { APP_LOCALE } from '@/lib/locale';
import {
  MAX_SERVICES_PER_EVENT,
  SERVICE_CATEGORIES,
  SERVICE_COUNTRIES,
  defaultServiceCategory,
  joinServices,
  serviceMatches,
  splitServices,
  transportTypeForService,
  type ServiceOption,
} from '@/lib/service-catalog';

import {
  type TripResourceSummary,
  coversDate,
  formatDateRange,
  isPerDay,
  resourceUsage,
} from '@/lib/trip-resource-model';

import type { EditorState } from '../editor-state';
import { useTripPool } from './trip-pool';

const COUNTRY_KEY = 'trip-planning:service-country';
const SHOWN = 60;

// One fetch per page visit: every event editor shares the catalog.
let catalog: Promise<ServiceOption[]> | null = null;

function loadServices(): Promise<ServiceOption[]> {
  catalog ??= fetch('/api/trips/services', { credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Could not load the services');
      return ((await response.json()) as { services: ServiceOption[] }).services;
    })
    .catch((error: unknown) => {
      catalog = null;
      throw error;
    });
  return catalog;
}

function readCountry(): string {
  try {
    return window.localStorage.getItem(COUNTRY_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberCountry(country: string) {
  try {
    window.localStorage.setItem(COUNTRY_KEY, country);
  } catch {
    // Private windows: the picker just opens on every country next time.
  }
}

/** The services already on the event. */
export function pickedServices(editor: EditorState) {
  return splitServices(editor.details.service, editor.details.serviceCode);
}

/**
 * Adds the picked service to the event (an event can sell several); `null`
 * clears them all. A transport event takes its Type from the service just
 * picked. Picking a service that is already on the event changes nothing.
 */
export function servicePatch(
  editor: EditorState,
  service: Pick<ServiceOption, 'name' | 'code' | 'category' | 'subCategory'> | null,
): Partial<EditorState> {
  const details = { ...editor.details };
  if (!service) {
    delete details.service;
    delete details.serviceCode;
    return { details };
  }
  const current = pickedServices(editor);
  const already = current.some((s) => (service.code ? s.code === service.code : s.name === service.name));
  const next = already || current.length >= MAX_SERVICES_PER_EVENT ? current : [...current, { name: service.name, code: service.code ?? '' }];
  const joined = joinServices(next);
  details.service = joined.service;
  if (joined.serviceCode) details.serviceCode = joined.serviceCode;
  else delete details.serviceCode;
  const type = editor.category === 'transportation' ? transportTypeForService(service) : null;
  if (type) details.mode = type;
  return { details };
}

/** Takes one service off the event, leaving the others in order. */
export function removeServicePatch(editor: EditorState, index: number): Partial<EditorState> {
  const details = { ...editor.details };
  const next = pickedServices(editor).filter((_, i) => i !== index);
  if (next.length === 0) {
    delete details.service;
    delete details.serviceCode;
    return { details };
  }
  const joined = joinServices(next);
  details.service = joined.service;
  if (joined.serviceCode) details.serviceCode = joined.serviceCode;
  else delete details.serviceCode;
  return { details };
}

function sameService(resource: TripResourceSummary, service: { name: string; code: string }): boolean {
  return resource.serviceCode && service.code ? resource.serviceCode === service.code : resource.serviceName === service.name;
}

/**
 * Picks a service from the trip's staged pool: the event sells it and is tied
 * to the pool entry, which is what marks that entry as used. A service the
 * event already names (typed before the pool existed) is just tied.
 */
export function resourcePatch(editor: EditorState, resource: TripResourceSummary): Partial<EditorState> {
  if (editor.resourceIds.includes(resource.id)) return {};
  const service = { name: resource.serviceName, code: resource.serviceCode ?? '' };
  const named = pickedServices(editor).some((picked) => (service.code ? picked.code === service.code : picked.name === service.name));
  if (!named && pickedServices(editor).length >= MAX_SERVICES_PER_EVENT) return {};
  return {
    ...servicePatch(editor, {
      name: resource.serviceName,
      code: resource.serviceCode,
      category: resource.category,
      subCategory: resource.subCategory,
    }),
    resourceIds: [...editor.resourceIds, resource.id],
  };
}

/** Takes one service off the event, and unties the pool entry it was picked from. */
export function removeServiceAt(editor: EditorState, index: number, pool: readonly TripResourceSummary[]): Partial<EditorState> {
  const removed = pickedServices(editor)[index];
  const byId = new Map(pool.map((resource) => [resource.id, resource]));
  const tied = removed
    ? editor.resourceIds.find((id) => {
        const resource = byId.get(id);
        return resource ? sameService(resource, removed) : false;
      })
    : undefined;
  return {
    ...removeServicePatch(editor, index),
    resourceIds: editor.resourceIds.filter((id) => id !== tied),
  };
}

/** "3 days remaining", "On 2 events", "Unused": where a staged resource stands. */
export function poolStatus(
  resource: TripResourceSummary,
  usage: ReturnType<typeof resourceUsage>,
): { label: string; tone: 'used' | 'idle' | 'muted' | 'kept' } {
  if (usage.state === 'unused') return { label: 'Verified unused', tone: 'muted' };
  if (usage.state === 'kept') return { label: 'Kept and logged', tone: 'kept' };
  if (usage.state === 'unassigned') return { label: 'Unused', tone: 'idle' };
  if (isPerDay(resource.unitOfMeasure) && usage.remainingDays !== null && usage.usedDayIds.length > 0) {
    return usage.remainingDays === 0
      ? { label: `All ${usage.stagedDays} day${usage.stagedDays === 1 ? '' : 's'} assigned`, tone: 'used' }
      : { label: `${usage.remainingDays} day${usage.remainingDays === 1 ? '' : 's'} remaining`, tone: 'used' };
  }
  return { label: `On ${usage.eventCount} event${usage.eventCount === 1 ? '' : 's'}`, tone: 'used' };
}

/**
 * The standardized services an event sells, picked from Products & Services,
 * so the itinerary uses the catalog's names: "Airport Transfer - SUV Executive
 * - Nairobi (NBO)" rather than whatever was typed. One event can carry
 * several — a transfer and the meet-and-greet that goes with it.
 *
 * Once the trip has a staged resource pool the picker offers that instead of
 * the whole catalog, so what an event sells is what was staged for the trip;
 * the catalog stays one click away for a service nobody staged.
 */
export default function ServicePicker({
  editor,
  patch,
  showCost,
  tripCountry,
}: {
  editor: EditorState;
  patch: (next: Partial<EditorState>) => void;
  showCost: boolean;
  /** The picker opens on the trip's country; otherwise on the last one chosen. */
  tripCountry: string | null;
}) {
  const pool = useTripPool();
  // What the Controller verified as unused is off the table.
  const staged = useMemo(() => pool.resources.filter((resource) => resource.resolution !== 'unused'), [pool.resources]);
  const hasPool = staged.length > 0;
  const [open, setOpen] = useState(false);
  /** The whole catalog rather than the pool: always, while nothing is staged. */
  const [browsing, setBrowsing] = useState(false);
  const showCatalog = browsing || !hasPool;
  const [services, setServices] = useState<ServiceOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState<string>(() => defaultServiceCategory(editor.category) ?? '');

  const picked = pickedServices(editor);
  const pickedCodes = new Set(picked.map((s) => s.code).filter(Boolean));
  const pickedNames = new Set(picked.map((s) => s.name));
  const full = picked.length >= MAX_SERVICES_PER_EVENT;

  useEffect(() => {
    if (!open || !showCatalog || services) return;
    let live = true;
    loadServices()
      .then((list) => live && setServices(list))
      .catch(() => live && setError('Could not load the services. Close and try again.'));
    return () => {
      live = false;
    };
  }, [open, showCatalog, services]);

  const countries = useMemo(() => {
    const present = new Set((services ?? []).map((s) => s.country).filter((c): c is string => Boolean(c)));
    const known = SERVICE_COUNTRIES.filter((c) => present.has(c));
    return [...known, ...[...present].filter((c) => !(SERVICE_COUNTRIES as readonly string[]).includes(c)).sort()];
  }, [services]);

  const categories = useMemo(() => {
    const present = new Set((services ?? []).map((s) => s.category).filter((c): c is string => Boolean(c)));
    return SERVICE_CATEGORIES.filter((c) => present.has(c));
  }, [services]);

  const matches = useMemo(
    () =>
      (services ?? []).filter(
        (s) => (!country || s.country === country) && (!category || s.category === category) && serviceMatches(s, query),
      ),
    [services, country, category, query],
  );

  // Staged for the event's own date first, then the rest of the pool.
  const stagedRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staged
      .filter(
        (resource) =>
          !q || [resource.serviceName, resource.serviceCode, resource.vendorName].some((value) => value?.toLowerCase().includes(q)),
      )
      .map((resource) => ({
        resource,
        usage: resourceUsage(resource, pool.items, pool.days),
        onDate: coversDate(resource, editor.date || null),
      }))
      .sort((a, b) => Number(b.onDate) - Number(a.onDate));
  }, [staged, query, pool.items, pool.days, editor.date]);

  const openPicker = () => {
    setError(null);
    setBrowsing(false);
    setQuery('');
    setCountry(tripCountry || readCountry());
    setCategory(defaultServiceCategory(editor.category) ?? '');
    setOpen(true);
  };

  const pick = (service: ServiceOption) => {
    patch(servicePatch(editor, service));
    setOpen(false);
  };

  const pickStaged = (resource: TripResourceSummary) => {
    patch(resourcePatch(editor, resource));
    setOpen(false);
  };

  const isPicked = (service: ServiceOption) => (service.code ? pickedCodes.has(service.code) : pickedNames.has(service.name));

  const fieldClass = 'w-full rounded-lg bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div className="block">
      <span className="text-xs font-medium text-gray-500">{picked.length > 1 ? 'Services' : 'Service'}</span>

      {picked.length > 0 && (
        <ul className="mt-1 space-y-1.5">
          {picked.map((service, index) => (
            <li key={`${service.code || service.name}-${index}`} className="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{service.name}</p>
                {service.code && <p className="font-mono text-[11px] text-gray-500">{service.code}</p>}
              </div>
              <button
                type="button"
                onClick={() => patch(removeServiceAt(editor, index, pool.resources))}
                aria-label={`Remove ${service.name}`}
                className="text-xs font-medium text-gray-500 hover:text-rose-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!open && !full && (
        <button
          type="button"
          onClick={openPicker}
          className={`flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-sm text-gray-500 transition hover:border-primary/40 hover:text-primary ${picked.length > 0 ? 'mt-1.5' : 'mt-1'}`}
        >
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
          </svg>
          {picked.length > 0
            ? 'Add another service'
            : hasPool
              ? 'Pick the service from the staged pool'
              : 'Pick the service from Products & Services'}
        </button>
      )}
      {full && !open && <p className="mt-1.5 text-[11px] text-gray-400">An event can carry up to {MAX_SERVICES_PER_EVENT} services.</p>}

      {open && !showCatalog && (
        <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="space-y-2 border-b border-gray-100 p-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Staged resource pool</p>
            {staged.length > 6 && (
              <input
                type="search"
                autoFocus
                placeholder="Search the pool…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={fieldClass}
              />
            )}
          </div>
          <ul className="max-h-64 divide-y divide-gray-50 overflow-y-auto">
            {stagedRows.map(({ resource, usage, onDate }) => {
              const taken = editor.resourceIds.includes(resource.id);
              const status = poolStatus(resource, usage);
              return (
                <li key={resource.id}>
                  <button
                    type="button"
                    disabled={taken}
                    onClick={() => pickStaged(resource)}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-primary/5 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-900">
                        {resource.serviceName}
                        {resource.quantity > 1 && <span className="ml-1 font-normal text-gray-500">×{resource.quantity}</span>}
                      </span>
                      <span className="block text-[11px] text-gray-500">
                        {[resource.vendorName, formatDateRange(resource.startDate, resource.endDate, APP_LOCALE), resource.unitOfMeasure]
                          .filter(Boolean)
                          .join(' · ')}
                        {taken && ' · on this event'}
                      </span>
                      {!onDate && editor.date && (
                        <span className="mt-0.5 block text-[11px] font-medium text-amber-700">Not staged for this event’s date</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        status.tone === 'used'
                          ? 'bg-emerald-50 text-emerald-700'
                          : status.tone === 'kept'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {status.label}
                    </span>
                  </button>
                </li>
              );
            })}
            {stagedRows.length === 0 && <li className="px-3 py-4 text-center text-sm text-gray-500">Nothing in the pool matches.</li>}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setBrowsing(true);
              }}
              className="text-xs font-medium text-gray-500 hover:text-primary"
            >
              Not staged? Browse the full catalog
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-gray-500 hover:text-gray-700">
              Close
            </button>
          </div>
        </div>
      )}

      {open && showCatalog && (
        <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="space-y-2 border-b border-gray-100 p-2">
            {hasPool ? (
              <button type="button" onClick={() => setBrowsing(false)} className="px-1 text-xs font-medium text-primary hover:underline">
                ← Back to the staged pool
              </button>
            ) : (
              pool.tripId > 0 && (
                <p className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-500">
                  Nothing is staged for this trip yet, so this is the full catalog. Stage services under Trip Resources to pick from the pool.
                </p>
              )
            )}
            <div className="flex gap-2">
              <input
                type="search"
                autoFocus
                placeholder="Search by name, code or city…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={fieldClass}
              />
              <select
                aria-label="Country"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  rememberCountry(e.target.value);
                }}
                className={`${fieldClass} w-40 shrink-0`}
              >
                <option value="">All countries</option>
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {categories.length > 0 && (
              <div className="flex gap-1 overflow-x-auto">
                {['', ...categories].map((c) => (
                  <button
                    key={c || 'all'}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      category === c ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {c || 'All'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error ? (
            <p className="px-3 py-4 text-sm text-rose-600">{error}</p>
          ) : !services ? (
            <p className="px-3 py-4 text-sm text-gray-500">Loading the catalog…</p>
          ) : (
            <ul className="max-h-64 divide-y divide-gray-50 overflow-y-auto">
              {matches.slice(0, SHOWN).map((service) => {
                const taken = isPicked(service);
                return (
                  <li key={service.id}>
                    <button
                      type="button"
                      disabled={taken}
                      onClick={() => pick(service)}
                      className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-primary/5 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">{service.name}</span>
                        <span className="block text-[11px] text-gray-500">
                          {[service.code, service.unitOfMeasure, country ? null : service.country].filter(Boolean).join(' · ')}
                          {taken && ' · on this event'}
                        </span>
                      </span>
                      {showCost && service.defaultUnitPrice && service.currency ? (
                        <span className="shrink-0 text-xs tabular-nums text-gray-600">
                          {service.defaultUnitPrice.toLocaleString(APP_LOCALE, { style: 'currency', currency: service.currency })}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {matches.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-gray-500">
                  {services.length === 0 ? 'Products & Services has no active services yet.' : 'No service matches.'}
                </li>
              )}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2">
            <p className="text-[11px] text-gray-400">
              {services && matches.length > SHOWN ? `Showing ${SHOWN} of ${matches.length}. Narrow the search.` : ''}
            </p>
            <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-gray-500 hover:text-gray-700">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
