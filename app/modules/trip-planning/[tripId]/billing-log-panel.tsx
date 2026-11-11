'use client';

import { useMemo } from 'react';

import { APP_LOCALE } from '@/lib/locale';
import {
  type BillingDayLine,
  buildBillingLog,
  formatDateRange,
  formatHours,
  verificationNotice,
} from '@/lib/trip-resource-model';

import type { TripDetail } from '../types';

const KIND_LABEL = { driver: 'Driver', officer: 'CPO', vehicle: 'Vehicle' } as const;

const STATUS_PILL: Record<string, string> = {
  Assigned: 'bg-emerald-50 text-emerald-700',
  'Kept and logged': 'bg-blue-50 text-blue-700',
  'Needs verification': 'bg-amber-50 text-amber-800',
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

const headClass = 'px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400';
const cellClass = 'px-3 py-2.5 align-top text-sm text-gray-700';

/**
 * What billing reads for a trip: each staged service and how much of it the
 * itinerary used, then the hours and kilometres logged day by day. Resources
 * verified as unused are listed apart and left off the export.
 */
export default function BillingLogPanel({ trip, onVerify }: { trip: TripDetail; onVerify: (() => void) | null }) {
  const log = useMemo(() => buildBillingLog(trip), [trip]);
  const pending = log.services.filter((line) => line.status === 'Needs verification').length;
  const empty = log.services.length === 0 && log.days.length === 0 && log.notBilled.length === 0;

  const byDay = useMemo(() => {
    const groups = new Map<number, BillingDayLine[]>();
    for (const line of log.days) groups.set(line.dayId, [...(groups.get(line.dayId) ?? []), line]);
    return [...groups.values()];
  }, [log.days]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Billing log</h2>
          <p className="mt-1 text-xs text-gray-500">
            The staged services this trip used, and each day’s hours and kilometres. No prices: those come from the quote.
          </p>
        </div>
        {!empty && (
          <a
            href={`/api/trips/${trip.id}/billing`}
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
            </svg>
            Export CSV
          </a>
        )}
      </div>

      {empty ? (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
          Nothing to bill yet. Stage services under Trip Resources, attach them to events, and log each day’s shifts and odometer readings.
        </p>
      ) : (
        <div className="space-y-6">
          {pending > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
              <p className="text-sm font-medium text-amber-800">
                {verificationNotice(pending).replace(/^./, (c) => c.toUpperCase())}. Until then {pending === 1 ? 'it stays' : 'they stay'} on the log below.
              </p>
              {onVerify && (
                <button type="button" onClick={onVerify} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
                  Verify now
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Services billed" value={String(log.services.length)} hint={log.notBilled.length > 0 ? `${log.notBilled.length} not billed` : undefined} />
            <Tile label="Hours on shift" value={log.totals.hours > 0 ? formatHours(log.totals.hours) : '—'} />
            <Tile label="Kilometres" value={log.totals.km > 0 ? log.totals.km.toLocaleString(APP_LOCALE) : '—'} />
            <Tile
              label="Kept & logged"
              value={log.totals.keptHours > 0 ? formatHours(log.totals.keptHours) : log.totals.keptKm > 0 ? `${log.totals.keptKm.toLocaleString(APP_LOCALE)} km` : '—'}
              hint={log.totals.keptHours > 0 && log.totals.keptKm > 0 ? `${log.totals.keptKm.toLocaleString(APP_LOCALE)} km` : undefined}
            />
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Staged services</h3>
            {log.services.length === 0 ? (
              <p className="rounded-xl border border-gray-100 bg-white px-4 py-4 text-sm text-gray-400">No billable services.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead>
                    <tr>
                      <th className={headClass}>Service</th>
                      <th className={headClass}>Staged</th>
                      <th className={headClass}>Used</th>
                      <th className={headClass}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {log.services.map((line) => (
                      <tr key={line.resourceId}>
                        <td className={cellClass}>
                          <p className="font-semibold text-gray-900">{line.serviceName}</p>
                          <p className="text-xs text-gray-500">{[line.vendorName, line.serviceCode, line.unitOfMeasure].filter(Boolean).join(' · ')}</p>
                        </td>
                        <td className={`${cellClass} whitespace-nowrap`}>
                          <p>{formatDateRange(line.startDate, line.endDate, APP_LOCALE)}</p>
                          <p className="text-xs text-gray-500">
                            {line.stagedDays !== null ? `${line.stagedDays} day${line.stagedDays === 1 ? '' : 's'} · ` : ''}×{line.quantity}
                          </p>
                        </td>
                        <td className={cellClass}>
                          {line.status === 'Assigned' ? (
                            <>
                              <p className="whitespace-nowrap">
                                {line.usedDays > 0 ? `${line.usedDays} day${line.usedDays === 1 ? '' : 's'}` : '—'} · {line.eventCount} event{line.eventCount === 1 ? '' : 's'}
                              </p>
                              {line.usedOn && <p className="text-xs text-gray-500">{line.usedOn}</p>}
                            </>
                          ) : line.status === 'Kept and logged' ? (
                            <p className="whitespace-nowrap">
                              {[line.billableHours !== null ? formatHours(line.billableHours) : null, line.km !== null ? `${line.km.toLocaleString(APP_LOCALE)} km` : null]
                                .filter(Boolean)
                                .join(' · ') || 'As staged'}
                            </p>
                          ) : (
                            <p className="text-gray-400">On no event</p>
                          )}
                        </td>
                        <td className={cellClass}>
                          <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_PILL[line.status]}`}>{line.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Daily shifts &amp; odometer</h3>
            {byDay.length === 0 ? (
              <p className="rounded-xl border border-gray-100 bg-white px-4 py-4 text-sm text-gray-400">
                No shifts or odometer readings logged yet. They are entered on each day, under its header.
              </p>
            ) : (
              <div className="space-y-3">
                {byDay.map((lines) => {
                  const first = lines[0];
                  const hours = lines.reduce((total, line) => total + (line.hours ?? 0), 0);
                  const km = lines.reduce((total, line) => total + (line.km ?? 0), 0);
                  return (
                    <div key={first.dayId} className="overflow-hidden rounded-xl border border-gray-100 bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">
                          Day {first.dayNumber}
                          {first.dateKey && <span className="ml-1.5 font-normal text-gray-500">{formatDateRange(first.dateKey, first.dateKey, APP_LOCALE)}</span>}
                        </p>
                        <p className="text-xs font-semibold tabular-nums text-gray-700">
                          {[hours > 0 ? formatHours(hours) : null, km > 0 ? `${km.toLocaleString(APP_LOCALE)} km` : null].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <ul className="divide-y divide-gray-50">
                        {lines.map((line) => {
                          const vehicle = line.kind === 'vehicle';
                          const total = vehicle ? (line.km !== null ? `${line.km.toLocaleString(APP_LOCALE)} km` : null) : line.hours !== null ? formatHours(line.hours) : null;
                          return (
                            <li key={line.logId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                              <span className="min-w-0">
                                <span className="text-sm font-medium text-gray-900">{line.label}</span>
                                <span className="ml-1.5 text-xs text-gray-500">{KIND_LABEL[line.kind]}</span>
                              </span>
                              <span className="flex items-center gap-3 text-sm tabular-nums text-gray-600">
                                <span>
                                  {vehicle
                                    ? `${line.startOdometer?.toLocaleString(APP_LOCALE) ?? '—'} → ${line.endOdometer?.toLocaleString(APP_LOCALE) ?? '—'}`
                                    : `${line.shiftStart ?? '—'} → ${line.shiftEnd ?? '—'}`}
                                </span>
                                <span className={`w-24 text-right font-semibold ${total ? 'text-gray-900' : 'text-amber-700'}`}>{total ?? 'Incomplete'}</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {log.notBilled.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Verified unused · not billed</h3>
              <ul className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
                {log.notBilled.map((line) => (
                  <li key={line.resourceId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm text-gray-400 line-through">
                      {line.serviceName}
                      {line.quantity > 1 ? ` ×${line.quantity}` : ''}
                    </span>
                    <span className="text-xs text-gray-400">
                      {line.vendorName} · {formatDateRange(line.startDate, line.endDate, APP_LOCALE)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
