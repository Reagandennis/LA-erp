'use client';

import React, { useMemo, useState } from 'react';

import {
  ACCENT,
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
  formatDateKey,
  formatMoney,
  formatNumber,
  formatTotals,
  inputClass,
  readNumber,
} from '@/app/modules/_components/fleet-ui';
import ShowMoreButton from '@/app/ui/show-more-button';
import { useShowMore } from '@/app/ui/use-show-more';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_KINDS,
  MAINTENANCE_STATUSES,
  REMINDER_DAY_OPTIONS,
  SUGGESTED_KIND,
  type FleetVehicleRef,
  type MaintenanceDisplayStatus,
  type MaintenanceDto,
  type MaintenanceReminder,
  activeMaintenanceReminders,
  daysBetween,
  defaultReminderDays,
  isOpenMaintenance,
  maintenanceDisplayStatus,
  reminderMessage,
  totalsByCurrency,
  vehicleLabel,
} from '@/lib/fleet';

type View = 'open' | 'overdue' | 'completed' | 'cancelled' | 'all';
type KindFilter = 'all' | 'Scheduled' | 'Unscheduled';

const VIEWS: { value: View; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'Scheduled', label: 'Scheduled' },
  { value: 'Unscheduled', label: 'Unscheduled' },
];

const STATUS_COLOR: Record<MaintenanceDisplayStatus, string> = {
  Planned: BRAND,
  'Due soon': '#d97706',
  Overdue: '#e11d48',
  'In progress': ACCENT,
  Completed: '#22c55e',
  Cancelled: '#d1d5db',
};

const KIND_HINT: Record<string, string> = {
  Scheduled: 'Planned upkeep on a timetable: services, inspections, tyres.',
  Unscheduled: 'Unplanned work: breakdowns, accidents, faults found on the road.',
};

function reminderLabel(days: number) {
  if (days === 0) return 'On the day';
  return `${days} day${days === 1 ? '' : 's'} before`;
}

/** Open work first, soonest first; then finished work, latest first. */
function compareItems(a: MaintenanceDto, b: MaintenanceDto): number {
  const rank = (i: MaintenanceDto) => (isOpenMaintenance(i) ? 0 : i.status === 'Completed' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 0) {
    if (a.scheduledFor !== b.scheduledFor) {
      if (!a.scheduledFor) return 1;
      if (!b.scheduledFor) return -1;
      return a.scheduledFor.localeCompare(b.scheduledFor);
    }
    return b.createdAt.localeCompare(a.createdAt);
  }
  return (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt) || b.id - a.id;
}

type MaintenanceForm = {
  vehicleId: string;
  kind: string;
  category: string;
  title: string;
  status: string;
  scheduledFor: string;
  completedAt: string;
  odometerKm: string;
  cost: string;
  currency: string;
  provider: string;
  nextDueAt: string;
  nextDueKm: string;
  /** '' for no reminder. */
  reminderDays: string;
  notes: string;
  /** Once chosen by hand, the type and reminder stop following the category. */
  kindTouched: boolean;
  reminderTouched: boolean;
};

const reminderValue = (days: number | null) => (days == null ? '' : String(days));

function StatusBadge({ status }: { status: MaintenanceDisplayStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[status] }} />
      {status}
    </span>
  );
}

function KindChip({ kind }: { kind: string }) {
  const unscheduled = kind === 'Unscheduled';
  return (
    <span
      className={`px-2 py-0.5 rounded-md border text-xs ${
        unscheduled ? 'bg-rose-50 border-rose-100 text-rose-700' : 'bg-blue-50 border-blue-100 text-[#03458f]'
      }`}
    >
      {kind}
    </span>
  );
}

function BellIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function dueText(key: string, today: string): string {
  const days = daysBetween(today, key);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export default function MaintenanceClient({
  initialItems,
  vehicles,
  odometers,
  defaultCurrency,
  today,
}: {
  initialItems: MaintenanceDto[];
  vehicles: FleetVehicleRef[];
  odometers: Record<number, number>;
  defaultCurrency: string;
  today: string;
}) {
  const [items, setItems] = useState<MaintenanceDto[]>(initialItems);
  const [search, setSearch] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [view, setView] = useState<View>('open');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MaintenanceForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoped = useMemo(
    () =>
      items.filter(
        (i) =>
          (vehicleFilter === null || i.vehicle.id === vehicleFilter) && (kindFilter === 'all' || i.kind === kindFilter),
      ),
    [items, vehicleFilter, kindFilter],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((item) => {
        const display = maintenanceDisplayStatus(item, today);
        if (view === 'open' && !isOpenMaintenance(item)) return false;
        if (view === 'overdue' && display !== 'Overdue') return false;
        if (view === 'completed' && item.status !== 'Completed') return false;
        if (view === 'cancelled' && item.status !== 'Cancelled') return false;
        if (!q) return true;
        return [item.title, item.category, item.kind, item.provider, item.notes, item.vehicle.registration, item.vehicle.make, item.vehicle.model]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q));
      })
      .sort(compareItems);
  }, [scoped, search, view, today]);
  const { visible, hiddenCount, showMore, showAll } = useShowMore(filtered);

  const reminders = useMemo(() => activeMaintenanceReminders(scoped, odometers, today), [scoped, odometers, today]);

  const stats = useMemo(() => {
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const doneThisYear = scoped.filter((i) => i.status === 'Completed' && (i.completedAt ?? '') >= yearStart);
    return {
      open: scoped.filter(isOpenMaintenance).length,
      overdue: scoped.filter((i) => maintenanceDisplayStatus(i, today) === 'Overdue').length,
      spend: totalsByCurrency(doneThisYear),
      unscheduledSpend: totalsByCurrency(doneThisYear.filter((i) => i.kind === 'Unscheduled')),
      unscheduledJobs: doneThisYear.filter((i) => i.kind === 'Unscheduled').length,
    };
  }, [scoped, today]);

  // --- Form -----------------------------------------------------------------

  const blankForm = (): MaintenanceForm => ({
    vehicleId: vehicleFilter !== null ? String(vehicleFilter) : vehicles.length === 1 ? String(vehicles[0]!.id) : '',
    kind: 'Scheduled',
    category: 'Service',
    title: '',
    status: 'Planned',
    scheduledFor: '',
    completedAt: '',
    odometerKm: '',
    cost: '',
    currency: items[0]?.currency ?? defaultCurrency,
    provider: '',
    nextDueAt: '',
    nextDueKm: '',
    reminderDays: reminderValue(defaultReminderDays('Service')),
    notes: '',
    kindTouched: false,
    reminderTouched: false,
  });

  const openCreate = (prefill: Partial<MaintenanceForm> = {}) => {
    setEditingId(null);
    setError(null);
    setForm({ ...blankForm(), ...prefill });
  };

  const scheduleNew = () => openCreate();
  const logUnscheduled = () =>
    openCreate({ kind: 'Unscheduled', category: 'Repair', status: 'In progress', reminderDays: '', kindTouched: true });

  const openEdit = (item: MaintenanceDto, overrides: Partial<MaintenanceForm> = {}) => {
    setEditingId(item.id);
    setError(null);
    setForm({
      vehicleId: String(item.vehicle.id),
      kind: item.kind,
      category: item.category,
      title: item.title,
      status: item.status,
      scheduledFor: item.scheduledFor ?? '',
      completedAt: item.completedAt ?? '',
      odometerKm: item.odometerKm != null ? String(item.odometerKm) : '',
      cost: item.cost != null ? String(item.cost) : '',
      currency: item.currency,
      provider: item.provider ?? '',
      nextDueAt: item.nextDueAt ?? '',
      nextDueKm: item.nextDueKm != null ? String(item.nextDueKm) : '',
      reminderDays: reminderValue(item.reminderDays),
      notes: item.notes ?? '',
      kindTouched: true,
      reminderTouched: true,
      ...overrides,
    });
  };

  /** Book the next one from a completed job's next-due date or km. */
  const book = (item: MaintenanceDto) =>
    openCreate({
      vehicleId: String(item.vehicle.id),
      kind: item.kind,
      category: item.category,
      title: item.title,
      scheduledFor: item.nextDueAt && item.nextDueAt > today ? item.nextDueAt : today,
      provider: item.provider ?? '',
      currency: item.currency,
      reminderDays: reminderValue(item.reminderDays),
      kindTouched: true,
      reminderTouched: true,
    });

  const changeCategory = (category: string) =>
    setForm((f) =>
      f && {
        ...f,
        category,
        kind: f.kindTouched ? f.kind : (SUGGESTED_KIND[category] ?? f.kind),
        reminderDays: f.reminderTouched ? f.reminderDays : reminderValue(defaultReminderDays(category)),
      },
    );

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
      if (!form.title.trim()) throw new Error('Describe the work.');
      body = {
        vehicleId: Number(form.vehicleId),
        kind: form.kind,
        category: form.category,
        title: form.title.trim(),
        status: form.status,
        scheduledFor: form.scheduledFor || null,
        completedAt: form.status === 'Completed' ? form.completedAt || null : null,
        odometerKm: readNumber(form.odometerKm, 'Odometer'),
        cost: readNumber(form.cost, 'Cost'),
        currency: form.currency,
        provider: form.provider.trim() || null,
        nextDueAt: form.nextDueAt || null,
        nextDueKm: readNumber(form.nextDueKm, 'Next due odometer'),
        reminderDays: form.reminderDays === '' ? null : Number(form.reminderDays),
        notes: form.notes.trim() || null,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(editingId ? `/api/fleet/maintenance/${editingId}` : '/api/fleet/maintenance', {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.item) {
        setError(payload?.error ?? 'Could not save the maintenance record.');
        return;
      }
      const item = payload.item as MaintenanceDto;
      setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
      closeForm();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editingId || !window.confirm('Delete this maintenance record? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fleet/maintenance/${editingId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 404) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error ?? 'Could not delete the maintenance record.');
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== editingId));
      closeForm();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const reminderAction = (r: MaintenanceReminder) =>
    r.basis === 'planned' ? (
      <button onClick={() => openEdit(r.item)} className="text-xs font-semibold text-[#03458f] hover:underline">
        Open
      </button>
    ) : (
      <button onClick={() => book(r.item)} className="text-xs font-semibold text-[#03458f] hover:underline">
        Book it
      </button>
    );

  // --- Render ---------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        <PageHeader
          title="Car Maintenance"
          subtitle="Plan services and inspections, log unscheduled repairs, and keep each vehicle’s history."
          actionLabel="Schedule maintenance"
          onAction={scheduleNew}
          secondaryLabel="Log unscheduled repair"
          onSecondary={logUnscheduled}
          actionDisabled={vehicles.length === 0}
        />

        {vehicles.length === 0 && <NoVehiclesNotice />}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label="Open jobs" value={formatNumber(stats.open)} hint="Planned or in progress" />
          <StatCard label="Overdue" value={formatNumber(stats.overdue)} hint="Planned date has passed" />
          <StatCard label="Reminders" value={formatNumber(reminders.length)} hint="Due now or coming up" />
          <StatCard
            label="Spend this year"
            value={formatTotals(stats.spend)}
            hint={
              stats.unscheduledJobs > 0
                ? `Unscheduled: ${formatTotals(stats.unscheduledSpend)} (${stats.unscheduledJobs} job${stats.unscheduledJobs === 1 ? '' : 's'})`
                : 'Completed work'
            }
          />
        </div>

        {reminders.length > 0 && (
          <div className="mb-8 bg-amber-50/60 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3 text-amber-900">
              <BellIcon className="w-4 h-4" />
              <h2 className="text-sm font-semibold">Reminders</h2>
              <span className="text-xs text-amber-800/70">· also sent to everyone with Car Maintenance access</span>
            </div>
            <ul className="space-y-2">
              {reminders.map((r) => (
                <li key={r.key} className="flex items-start gap-3 text-sm">
                  <span
                    className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: r.stage === 'overdue' ? STATUS_COLOR.Overdue : STATUS_COLOR['Due soon'] }}
                  />
                  <span className="flex-1 text-gray-800">{reminderMessage(r)}</span>
                  {reminderAction(r)}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mb-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search work, garage, vehicle…" />
          <VehicleFilter vehicles={vehicles} value={vehicleFilter} onChange={setVehicleFilter} />
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          <ChipFilter options={VIEWS} value={view} onChange={setView} />
          <ChipFilter options={KIND_FILTERS} value={kindFilter} onChange={setKindFilter} />
        </div>

        {error && !form && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-200">
            <p className="text-gray-900 font-medium">No maintenance found</p>
            <p className="text-gray-500 text-sm mt-1">
              {items.length === 0
                ? 'Schedule a service or log a repair to start the history.'
                : 'Try a different search, vehicle, type or view.'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {visible.map((item) => {
              const display = maintenanceDisplayStatus(item, today);
              const open = isOpenMaintenance(item);
              return (
                <div
                  key={item.id}
                  onClick={() => openEdit(item)}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 hover:bg-gray-50/70 cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900 truncate">{item.title}</p>
                      <KindChip kind={item.kind} />
                      <span className="px-2 py-0.5 bg-gray-50 rounded-md border border-gray-100 text-xs text-gray-500">
                        {item.category}
                      </span>
                      <StatusBadge status={display} />
                      {item.reminderDays != null && (
                        <span className="text-gray-400" title={`Reminder: ${reminderLabel(item.reminderDays).toLowerCase()}`}>
                          <BellIcon />
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">
                      {vehicleLabel(item.vehicle)}
                      {item.provider && ` · ${item.provider}`}
                      {item.odometerKm != null && ` · ${formatNumber(item.odometerKm)} km`}
                    </p>
                    {item.status === 'Completed' && (item.nextDueAt || item.nextDueKm != null) && (
                      <p className="text-xs text-gray-400 mt-1">
                        Next due {item.nextDueAt && formatDateKey(item.nextDueAt)}
                        {item.nextDueAt && item.nextDueKm != null && ' or '}
                        {item.nextDueKm != null && `at ${formatNumber(item.nextDueKm)} km`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 sm:text-right shrink-0">
                    <div className="text-xs text-gray-500">
                      {item.status === 'Completed' ? (
                        <p>Done {formatDateKey(item.completedAt)}</p>
                      ) : item.scheduledFor ? (
                        <p>
                          {formatDateKey(item.scheduledFor)}
                          {open && <span className="block text-gray-400">{dueText(item.scheduledFor, today)}</span>}
                        </p>
                      ) : (
                        <p className="text-gray-400">No date</p>
                      )}
                      {item.cost != null && <p className="font-medium text-gray-900 mt-0.5">{formatMoney(item.cost, item.currency)}</p>}
                    </div>
                    {open && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openEdit(item, { status: 'Completed', completedAt: today });
                        }}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-white hover:border-[#03458f]/40"
                      >
                        Mark done
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <ShowMoreButton hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} noun="records" />
      </div>

      {form && (
        <FleetModal
          title={editingId ? 'Edit maintenance' : form.kind === 'Unscheduled' ? 'Log unscheduled repair' : 'Schedule maintenance'}
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
                {busy ? 'Saving…' : editingId ? 'Save changes' : 'Save'}
              </button>
            </>
          }
        >
          <div>
            <Label>Type</Label>
            <div className="grid grid-cols-2 gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1" role="radiogroup" aria-label="Type">
              {MAINTENANCE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === kind}
                  onClick={() => setForm({ ...form, kind, kindTouched: true })}
                  className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                    form.kind === kind ? 'text-white shadow-sm' : 'text-gray-500 hover:bg-white'
                  }`}
                  style={form.kind === kind ? { backgroundColor: kind === 'Unscheduled' ? '#be123c' : BRAND } : undefined}
                >
                  {kind}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">{KIND_HINT[form.kind]}</p>
          </div>

          <div>
            <Label>Vehicle *</Label>
            <VehicleSelect vehicles={vehicles} value={form.vehicleId} onChange={(vehicleId) => setForm({ ...form, vehicleId })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Category</Label>
              <select className={inputClass} value={form.category} onChange={(e) => changeCategory(e.target.value)}>
                {MAINTENANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Status</Label>
              <select
                className={inputClass}
                value={form.status}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.value,
                    completedAt: e.target.value === 'Completed' ? form.completedAt || today : form.completedAt,
                  })
                }
              >
                {MAINTENANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Work *</Label>
            <input
              className={inputClass}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={form.kind === 'Unscheduled' ? 'e.g. Flat battery, cracked windscreen' : 'e.g. 10,000 km service, annual inspection'}
              autoFocus={!editingId}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{form.kind === 'Unscheduled' ? 'Booked in for' : 'Planned date'}</Label>
              <input
                type="date"
                className={inputClass}
                value={form.scheduledFor}
                onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
              />
            </div>
            {form.status === 'Completed' && (
              <div>
                <Label>Completed on</Label>
                <input
                  type="date"
                  className={inputClass}
                  value={form.completedAt}
                  onChange={(e) => setForm({ ...form, completedAt: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
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
                placeholder={odometers[Number(form.vehicleId)] != null ? `Last: ${formatNumber(odometers[Number(form.vehicleId)]!)}` : 'Optional'}
              />
            </div>
            <div>
              <Label>Garage / provider</Label>
              <input
                className={inputClass}
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div>
              <Label>Cost</Label>
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

          <div className="rounded-xl border border-gray-100 p-3.5 space-y-3">
            <div>
              <p className="text-xs font-medium text-gray-500">Next due (whichever comes first)</p>
              <p className="text-[11px] text-gray-400 mt-0.5">Once this job is done, reminders move on to these.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="date"
                aria-label="Next due date"
                className={inputClass}
                value={form.nextDueAt}
                onChange={(e) => setForm({ ...form, nextDueAt: e.target.value })}
              />
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step="1"
                aria-label="Next due odometer (km)"
                className={inputClass}
                value={form.nextDueKm}
                onChange={(e) => setForm({ ...form, nextDueKm: e.target.value })}
                placeholder="km"
              />
            </div>
          </div>

          <div>
            <Label>Reminder</Label>
            <select
              className={inputClass}
              value={form.reminderDays}
              onChange={(e) => setForm({ ...form, reminderDays: e.target.value, reminderTouched: true })}
            >
              <option value="">No reminder</option>
              {REMINDER_DAY_OPTIONS.map((d) => (
                <option key={d} value={String(d)}>
                  {reminderLabel(d)}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-gray-400">
              Goes to the notifications of everyone with Car Maintenance access: before the planned date, again if it
              passes, then before the next due date or km.
            </p>
          </div>

          <div>
            <Label>Notes</Label>
            <textarea
              rows={3}
              className={inputClass}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Parts replaced, findings, invoice number…"
            />
          </div>
        </FleetModal>
      )}
    </div>
  );
}
