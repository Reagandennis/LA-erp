'use client';

import React, { useMemo, useState } from 'react';

import {
  BRAND,
  ChipFilter,
  CurrencySelect,
  ErrorBanner,
  FleetModal,
  Label,
  NoVehiclesNotice,
  PageHeader,
  SearchInput,
  StatCard,
  VehicleFilter,
  VehicleSelect,
  formatMoney,
  formatNumber,
  formatTotals,
  inputClass,
  readNumber,
} from '@/app/modules/_components/fleet-ui';
import ShowMoreButton from '@/app/ui/show-more-button';
import { useShowMore } from '@/app/ui/use-show-more';
import {
  FUEL_TYPES,
  type FleetVehicleRef,
  type FuelLogDto,
  averageKmPerLitre,
  dateKeyToDate,
  dateToDateKey,
  fuelEconomyByLog,
  totalsByCurrency,
  vehicleLabel,
} from '@/lib/fleet';
import { APP_LOCALE } from '@/lib/locale';

type Period = 'month' | '90d' | 'year' | 'all';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

/** First day of the period, as a key compared against ISO timestamps. */
function periodStart(period: Period, today: string): string | null {
  if (period === 'month') return `${today.slice(0, 7)}-01`;
  if (period === 'year') return `${today.slice(0, 4)}-01-01`;
  if (period === '90d') return dateToDateKey(new Date(dateKeyToDate(today).getTime() - 89 * 86_400_000));
  return null;
}

type FuelForm = {
  vehicleId: string;
  filledAt: string;
  litres: string;
  cost: string;
  currency: string;
  odometerKm: string;
  fuelType: string;
  fullTank: boolean;
  station: string;
  filledBy: string;
  notes: string;
};

/** "YYYY-MM-DDTHH:mm" in the browser's timezone, for a datetime-local input. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatFilledAt(iso: string) {
  return new Date(iso).toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const byNewest = (a: FuelLogDto, b: FuelLogDto) => b.filledAt.localeCompare(a.filledAt) || b.id - a.id;

export default function FuelClient({
  initialLogs,
  vehicles,
  defaultCurrency,
  today,
}: {
  initialLogs: FuelLogDto[];
  vehicles: FleetVehicleRef[];
  defaultCurrency: string;
  today: string;
}) {
  const [logs, setLogs] = useState<FuelLogDto[]>(initialLogs);
  const [search, setSearch] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FuelForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consumption needs each vehicle's whole history, not just what is filtered.
  const economy = useMemo(() => fuelEconomyByLog(logs), [logs]);

  const filtered = useMemo(() => {
    const start = periodStart(period, today);
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (vehicleFilter !== null && log.vehicle.id !== vehicleFilter) return false;
      if (start && log.filledAt < start) return false;
      if (!q) return true;
      return [log.vehicle.registration, log.vehicle.make, log.vehicle.model, log.station, log.filledBy, log.fuelType, log.notes]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [logs, search, vehicleFilter, period, today]);
  const { visible, hiddenCount, showMore, showAll } = useShowMore(filtered);

  const stats = useMemo(() => {
    const litres = filtered.reduce((sum, log) => sum + log.litres, 0);
    const kmPerLitre = averageKmPerLitre(filtered.flatMap((log) => economy.get(log.id) ?? []));
    return { fills: filtered.length, litres, spend: totalsByCurrency(filtered), kmPerLitre };
  }, [filtered, economy]);

  const byVehicle = useMemo(() => {
    const groups = new Map<number, FuelLogDto[]>();
    for (const log of filtered) groups.set(log.vehicle.id, [...(groups.get(log.vehicle.id) ?? []), log]);
    return [...groups.values()]
      .map((list) => ({
        vehicle: list[0]!.vehicle,
        fills: list.length,
        litres: list.reduce((sum, log) => sum + log.litres, 0),
        spend: totalsByCurrency(list),
        kmPerLitre: averageKmPerLitre(list.flatMap((log) => economy.get(log.id) ?? [])),
      }))
      .sort((a, b) => b.litres - a.litres);
  }, [filtered, economy]);

  /** The latest odometer reading on file for a vehicle, to catch typos in a new one. */
  const lastReading = (vehicleId: number, exceptId: number | null) =>
    logs.find((log) => log.vehicle.id === vehicleId && log.id !== exceptId && log.odometerKm != null) ?? null;

  // --- Form -----------------------------------------------------------------

  const openCreate = () => {
    setEditingId(null);
    setError(null);
    setForm({
      vehicleId: vehicleFilter !== null ? String(vehicleFilter) : vehicles.length === 1 ? String(vehicles[0]!.id) : '',
      filledAt: toLocalInput(new Date()),
      litres: '',
      cost: '',
      currency: logs[0]?.currency ?? defaultCurrency,
      odometerKm: '',
      fuelType: 'Petrol',
      fullTank: true,
      station: '',
      filledBy: '',
      notes: '',
    });
  };

  const openEdit = (log: FuelLogDto) => {
    setEditingId(log.id);
    setError(null);
    setForm({
      vehicleId: String(log.vehicle.id),
      filledAt: toLocalInput(new Date(log.filledAt)),
      litres: String(log.litres),
      cost: log.cost != null ? String(log.cost) : '',
      currency: log.currency,
      odometerKm: log.odometerKm != null ? String(log.odometerKm) : '',
      fuelType: log.fuelType,
      fullTank: log.fullTank,
      station: log.station ?? '',
      filledBy: log.filledBy ?? '',
      notes: log.notes ?? '',
    });
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    let body: Record<string, unknown>;
    try {
      if (!form.vehicleId) throw new Error('Pick a vehicle.');
      const filledAt = new Date(form.filledAt);
      if (!form.filledAt || Number.isNaN(filledAt.getTime())) throw new Error('Enter the date and time of the fill-up.');
      const litres = readNumber(form.litres, 'Litres');
      if (litres === null) throw new Error('Enter how many litres went in.');
      body = {
        vehicleId: Number(form.vehicleId),
        filledAt: filledAt.toISOString(),
        litres,
        cost: readNumber(form.cost, 'Cost'),
        currency: form.currency,
        odometerKm: readNumber(form.odometerKm, 'Odometer'),
        fuelType: form.fuelType,
        fullTank: form.fullTank,
        station: form.station.trim() || null,
        filledBy: form.filledBy.trim() || null,
        notes: form.notes.trim() || null,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editingId ? `/api/fleet/fuel/${editingId}` : '/api/fleet/fuel', {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.item) {
        setError(payload?.error ?? 'Could not save the fill-up.');
        return;
      }
      const item = payload.item as FuelLogDto;
      setLogs((prev) => [item, ...prev.filter((log) => log.id !== item.id)].sort(byNewest));
      closeForm();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editingId || !window.confirm('Delete this fill-up? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/fuel/${editingId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 404) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error ?? 'Could not delete the fill-up.');
        return;
      }
      setLogs((prev) => prev.filter((log) => log.id !== editingId));
      closeForm();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const reading = form?.vehicleId ? lastReading(Number(form.vehicleId), editingId) : null;
  const periodLabel = PERIODS.find((p) => p.value === period)!.label.toLowerCase();

  // --- Render ---------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Car Fuel"
          subtitle="Log fill-ups per vehicle and keep an eye on fuel spend and consumption."
          actionLabel="Log fill-up"
          onAction={openCreate}
          actionDisabled={vehicles.length === 0}
        />

        {vehicles.length === 0 && <NoVehiclesNotice />}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label="Fill-ups" value={formatNumber(stats.fills)} hint={periodLabel} />
          <StatCard label="Litres" value={formatNumber(stats.litres, 1)} hint={periodLabel} />
          <StatCard label="Spend" value={formatTotals(stats.spend)} hint={periodLabel} />
          <StatCard
            label="Consumption"
            value={stats.kmPerLitre != null ? `${formatNumber(stats.kmPerLitre, 1)} km/L` : '—'}
            hint="Full-tank fill-ups with odometer readings"
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search vehicle, station, driver…" />
          <VehicleFilter vehicles={vehicles} value={vehicleFilter} onChange={setVehicleFilter} />
        </div>
        <div className="mb-5">
          <ChipFilter options={PERIODS} value={period} onChange={setPeriod} />
        </div>

        {error && !form && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">No fill-ups found</p>
            <p className="text-gray-500 text-sm mt-1">
              {logs.length === 0 ? 'Log the first fill-up to start tracking fuel.' : 'Try a different search, vehicle or period.'}
            </p>
            {logs.length > 0 && period !== 'all' && (
              <button onClick={() => setPeriod('all')} className="mt-3 text-sm font-semibold text-[#03458f] hover:underline">
                Show all time
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Vehicle</th>
                    <th className="px-4 py-3 font-medium text-right">Litres</th>
                    <th className="px-4 py-3 font-medium text-right">Cost</th>
                    <th className="px-4 py-3 font-medium text-right">Odometer</th>
                    <th className="px-4 py-3 font-medium text-right">km/L</th>
                    <th className="px-4 py-3 font-medium">Station</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((log) => {
                    const e = economy.get(log.id);
                    return (
                      <tr
                        key={log.id}
                        onClick={() => openEdit(log)}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/70 cursor-pointer"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-gray-700">{formatFilledAt(log.filledAt)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-medium text-gray-900">{log.vehicle.registration}</span>
                          <span className="ml-2 text-xs text-gray-400">{log.fuelType}{log.fullTank ? '' : ' · top-up'}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-900">{formatNumber(log.litres, 2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 whitespace-nowrap">
                          {log.cost != null ? formatMoney(log.cost, log.currency) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 whitespace-nowrap">
                          {log.odometerKm != null ? `${formatNumber(log.odometerKm)} km` : '—'}
                        </td>
                        <td
                          className="px-4 py-3 text-right tabular-nums text-gray-700 whitespace-nowrap"
                          title={e ? `${formatNumber(e.distanceKm)} km on ${formatNumber(e.litres, 2)} L` : undefined}
                        >
                          {e ? formatNumber(e.kmPerLitre, 1) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 max-w-[12rem] truncate">{log.station ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              openEdit(log);
                            }}
                            className="text-xs font-semibold text-[#03458f] hover:underline"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ShowMoreButton hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} noun="fill-ups" />

            {byVehicle.length > 1 && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">By vehicle · {periodLabel}</h2>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="px-4 py-3 font-medium">Vehicle</th>
                        <th className="px-4 py-3 font-medium text-right">Fill-ups</th>
                        <th className="px-4 py-3 font-medium text-right">Litres</th>
                        <th className="px-4 py-3 font-medium text-right">Spend</th>
                        <th className="px-4 py-3 font-medium text-right">km/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byVehicle.map((row) => (
                        <tr key={row.vehicle.id} className="border-b border-gray-50 last:border-0">
                          <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">{vehicleLabel(row.vehicle)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.fills)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatNumber(row.litres, 1)}</td>
                          <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">{formatTotals(row.spend)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {row.kmPerLitre != null ? formatNumber(row.kmPerLitre, 1) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {form && (
        <FleetModal
          title={editingId ? 'Edit fill-up' : 'Log fill-up'}
          onClose={closeForm}
          error={error}
          onSubmit={submit}
          footer={
            <>
              {editingId ? (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="px-4 py-2.5 rounded-xl border border-rose-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                style={{ backgroundColor: BRAND }}
              >
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Log fill-up'}
              </button>
            </>
          }
        >
          <div>
            <Label>Vehicle *</Label>
            <VehicleSelect vehicles={vehicles} value={form.vehicleId} onChange={(vehicleId) => setForm({ ...form, vehicleId })} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Date &amp; time *</Label>
              <input
                type="datetime-local"
                className={inputClass}
                value={form.filledAt}
                onChange={(e) => setForm({ ...form, filledAt: e.target.value })}
              />
            </div>
            <div>
              <Label>Fuel type</Label>
              <select className={inputClass} value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
                {FUEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Litres *</Label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className={inputClass}
                value={form.litres}
                onChange={(e) => setForm({ ...form, litres: e.target.value })}
                placeholder="e.g. 45.5"
              />
            </div>
            <div>
              <Label>Odometer (km)</Label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step="1"
                className={inputClass}
                value={form.odometerKm}
                onChange={(e) => setForm({ ...form, odometerKm: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
          {reading && (
            <p className="-mt-2 text-xs text-gray-400">
              Last reading for this vehicle: {formatNumber(reading.odometerKm!)} km on {formatFilledAt(reading.filledAt)}
            </p>
          )}

          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div>
              <Label>Total cost</Label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className={inputClass}
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <CurrencySelect value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
              checked={form.fullTank}
              onChange={(e) => setForm({ ...form, fullTank: e.target.checked })}
            />
            <span>
              Filled to the top
              <span className="block text-xs text-gray-400">Full fill-ups with an odometer reading work out the consumption.</span>
            </span>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Station</Label>
              <input
                className={inputClass}
                value={form.station}
                onChange={(e) => setForm({ ...form, station: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <Label>Filled by</Label>
              <input
                className={inputClass}
                value={form.filledBy}
                onChange={(e) => setForm({ ...form, filledBy: e.target.value })}
                placeholder="Driver name"
              />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <textarea
              rows={2}
              className={inputClass}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional"
            />
          </div>
        </FleetModal>
      )}
    </div>
  );
}
