'use client';

import Link from 'next/link';
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
  SearchInput,
  VehicleFilter,
  VehicleSelect,
  formatDateKey,
  formatMoney,
  formatNumber,
  inputClass,
  readNumber,
} from '@/app/modules/_components/fleet-ui';
import ShowMoreButton from '@/app/ui/show-more-button';
import { useShowMore } from '@/app/ui/use-show-more';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_KINDS,
  MAINTENANCE_STATUSES,
  READINESS_LABEL,
  READINESS_ORDER,
  REMINDER_DAY_OPTIONS,
  SUGGESTED_KIND,
  type FleetBoardRow,
  type FleetVehicleRef,
  type MaintenanceDisplayStatus,
  type MaintenanceDto,
  type UpcomingDue,
  type VehicleReadiness,
  type VehicleTripUse,
  buildFleetBoard,
  defaultReminderDays,
  dueSentence,
  dueWhen,
  daysBetween,
  isOpenMaintenance,
  maintenanceDisplayStatus,
  tripDays,
  vehicleLabel,
} from '@/lib/fleet';
import { useSyncedState } from '@/app/ui/use-synced-state';

type Tab = 'fleet' | 'jobs';
type View = 'open' | 'overdue' | 'completed' | 'cancelled' | 'all';
type KindFilter = 'all' | 'Scheduled' | 'Unscheduled';

/**
 * What the form is being opened to do. Each asks only for what is known at
 * that moment; "edit" is every field, for corrections.
 */
type FormMode = 'schedule' | 'repair' | 'complete' | 'edit';
type FormField =
  | 'kind'
  | 'vehicle'
  | 'category'
  | 'status'
  | 'garageState'
  | 'work'
  | 'planned'
  | 'completed'
  | 'odometer'
  | 'provider'
  | 'cost'
  | 'nextDue'
  | 'reminder'
  | 'notes';

const MODE_FIELDS: Record<FormMode, FormField[]> = {
  schedule: ['vehicle', 'category', 'work', 'planned', 'provider', 'reminder', 'notes'],
  repair: ['vehicle', 'category', 'work', 'garageState', 'planned', 'provider', 'notes'],
  complete: ['completed', 'odometer', 'provider', 'cost', 'nextDue', 'reminder', 'notes'],
  edit: ['kind', 'vehicle', 'category', 'status', 'work', 'planned', 'completed', 'odometer', 'provider', 'cost', 'nextDue', 'reminder', 'notes'],
};

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

/** Readiness as operations reads it: can this vehicle go out? */
const READINESS: Record<VehicleReadiness, { dot: string; pill: string; hint: string }> = {
  'off-road': { dot: '#111827', pill: 'bg-gray-900 text-white border-gray-900', hint: 'In the garage now' },
  overdue: { dot: '#e11d48', pill: 'bg-rose-50 text-rose-700 border-rose-100', hint: 'Past its date or km' },
  'due-soon': { dot: '#d97706', pill: 'bg-amber-50 text-amber-700 border-amber-100', hint: 'Due within 14 days' },
  ready: { dot: '#22c55e', pill: 'bg-emerald-50 text-emerald-700 border-emerald-100', hint: 'Nothing due' },
  'no-history': { dot: '#9ca3af', pill: 'bg-gray-100 text-gray-600 border-gray-200', hint: 'Nothing on record' },
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

function ReadinessPill({ readiness }: { readiness: VehicleReadiness }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${READINESS[readiness].pill}`}>
      {READINESS_LABEL[readiness]}
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
  return dueWhen(daysBetween(today, key));
}

/** The trip a vehicle is on now, or the next one it is booked for. */
function tripLine(row: FleetBoardRow): { title: string; days: string; now: boolean } | null {
  if (row.onTripToday) return { title: `On ${row.onTripToday.reference}`, days: `Now · ${tripDays(row.onTripToday)}`, now: true };
  const next = row.trips[0];
  return next ? { title: next.reference, days: tripDays(next), now: false } : null;
}

/** One thing that needs a decision today, and the action that settles it. */
type Attention = {
  key: string;
  tone: 'clash' | VehicleReadiness;
  row: FleetBoardRow;
  text: string;
  actionLabel: string;
  run: () => void;
};

const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wider text-gray-400';
const smallAction = 'shrink-0 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:border-[#03458f]/40 hover:bg-white';

export default function MaintenanceClient({
  initialItems,
  vehicles,
  tripUse,
  outsideFleet,
  odometers,
  defaultCurrency,
  today,
}: {
  initialItems: MaintenanceDto[];
  vehicles: FleetVehicleRef[];
  /** Where each vehicle is spoken for by a trip. */
  tripUse: VehicleTripUse[];
  /** Vehicles in the register that are not marked Internal, and so are not listed here. */
  outsideFleet: number;
  odometers: Record<number, number>;
  defaultCurrency: string;
  today: string;
}) {
  const [items, setItems] = useSyncedState<MaintenanceDto[]>(initialItems);
  const [tab, setTab] = useState<Tab>('fleet');
  const [search, setSearch] = useState('');
  /** A readiness tile pressed: the fleet narrows to it. */
  const [readinessFilter, setReadinessFilter] = useState<VehicleReadiness | null>(null);
  /** The vehicle picked from the fleet; until one is, the side panel shows the most pressing. */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [vehicleFilter, setVehicleFilter] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [view, setView] = useState<View>('open');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MaintenanceForm | null>(null);
  const [mode, setMode] = useState<FormMode>('edit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const board = useMemo(() => buildFleetBoard(vehicles, items, odometers, tripUse, today), [vehicles, items, odometers, tripUse, today]);

  const counts = useMemo(() => {
    const tally = Object.fromEntries(READINESS_ORDER.map((r) => [r, 0])) as Record<VehicleReadiness, number>;
    for (const row of board) tally[row.readiness] += 1;
    return tally;
  }, [board]);

  const fleetRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return board.filter((row) => {
      if (readinessFilter && row.readiness !== readinessFilter) return false;
      if (!q) return true;
      return [row.vehicle.registration, row.vehicle.make, row.vehicle.model, row.reason, ...row.trips.map((t) => t.reference)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [board, readinessFilter, search]);

  const panelRow = (selectedId !== null ? board.find((row) => row.vehicle.id === selectedId) : null) ?? board[0] ?? null;
  const picked = selectedId !== null && panelRow?.vehicle.id === selectedId;

  // --- Jobs tab ---------------------------------------------------------------

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

  // --- Form -------------------------------------------------------------------

  const blankForm = (vehicleId: number | null): MaintenanceForm => ({
    vehicleId: vehicleId !== null ? String(vehicleId) : vehicles.length === 1 ? String(vehicles[0]!.id) : '',
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

  const openCreate = (nextMode: FormMode, vehicleId: number | null, prefill: Partial<MaintenanceForm> = {}) => {
    setEditingId(null);
    setError(null);
    setMode(nextMode);
    setForm({ ...blankForm(vehicleId), ...prefill });
  };

  /** Plan upkeep for a date: the vehicle stays on the road until then. */
  const scheduleFor = (vehicleId: number | null) => openCreate('schedule', vehicleId);
  /** Something broke: by default the vehicle is in the garage from today. */
  const logRepairFor = (vehicleId: number | null) =>
    openCreate('repair', vehicleId, {
      kind: 'Unscheduled',
      category: 'Repair',
      status: 'In progress',
      scheduledFor: today,
      reminderDays: '',
      kindTouched: true,
      reminderTouched: true,
    });

  const formOf = (item: MaintenanceDto): MaintenanceForm => ({
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
  });

  const openEdit = (item: MaintenanceDto) => {
    setEditingId(item.id);
    setError(null);
    setMode('edit');
    setForm(formOf(item));
  };

  /** The work is finished: the vehicle is back on the road. Asks only what is known now. */
  const complete = (item: MaintenanceDto) => {
    setEditingId(item.id);
    setError(null);
    setMode('complete');
    setForm({ ...formOf(item), status: 'Completed', completedAt: today });
  };

  /** Book the next one from a completed job's next-due date or km. */
  const book = (item: MaintenanceDto) =>
    openCreate('schedule', item.vehicle.id, {
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

  // --- What needs a decision --------------------------------------------------

  const dueAction = (due: UpcomingDue): { actionLabel: string; run: () => void } =>
    due.basis === 'planned'
      ? { actionLabel: 'Mark done', run: () => complete(due.item) }
      : { actionLabel: 'Book it', run: () => book(due.item) };

  const attention: Attention[] = [];
  for (const row of board) {
    const clashed = new Set<number>();
    for (const clash of row.clashes) {
      clashed.add(clash.job.id);
      const inGarage = clash.job.status === 'In progress';
      attention.push({
        key: `clash:${clash.job.id}:${clash.trip.tripId}`,
        tone: 'clash',
        row,
        text: clash.message,
        actionLabel: inGarage ? 'Back on the road' : 'Reschedule',
        run: () => (inGarage ? complete(clash.job) : openEdit(clash.job)),
      });
    }
    for (const job of row.inGarage) {
      if (clashed.has(job.id)) continue;
      attention.push({
        key: `garage:${job.id}`,
        tone: 'off-road',
        row,
        text: `In the garage${job.scheduledFor ? ` since ${formatDateKey(job.scheduledFor)}` : ''}: ${job.title}${job.provider ? ` · ${job.provider}` : ''}`,
        actionLabel: 'Back on the road',
        run: () => complete(job),
      });
    }
    for (const due of row.dues) {
      if (due.state === 'later' || clashed.has(due.item.id)) continue;
      attention.push({
        key: `due:${due.basis}:${due.item.id}`,
        tone: due.state,
        row,
        text: dueSentence(due, row.odometerKm),
        ...dueAction(due),
      });
    }
  }

  const shows = (field: FormField) => MODE_FIELDS[mode].includes(field);
  const editingItem = editingId !== null ? (items.find((item) => item.id === editingId) ?? null) : null;
  const formTitle =
    mode === 'schedule'
      ? 'Schedule maintenance'
      : mode === 'repair'
        ? 'Log a repair'
        : mode === 'complete'
          ? editingItem?.status === 'In progress'
            ? 'Back on the road'
            : 'Mark done'
          : editingId
            ? 'Edit maintenance'
            : form?.kind === 'Unscheduled'
              ? 'Log a repair'
              : 'Schedule maintenance';

  // --- Render -----------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px]">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-900">Car Maintenance</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Which of our vehicles can go out, what is keeping the others in, and what is coming due.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => logRepairFor(picked ? selectedId : null)}
              disabled={vehicles.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              Log a repair
            </button>
            <button
              onClick={() => scheduleFor(picked ? selectedId : null)}
              disabled={vehicles.length === 0}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95 disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Schedule maintenance
            </button>
          </div>
        </div>

        {vehicles.length === 0 && (
          <NoVehiclesNotice message="There are no internal vehicles yet. Maintenance is kept for our own fleet: mark vehicles as Internal in the Vehicles module, then record them here." />
        )}

        {/* Readiness at a glance; each tile narrows the fleet below to it. */}
        <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {READINESS_ORDER.map((readiness) => {
            const active = readinessFilter === readiness;
            return (
              <button
                key={readiness}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setReadinessFilter(active ? null : readiness);
                  setTab('fleet');
                }}
                className={`rounded-xl border bg-white px-3.5 py-2.5 text-left transition-colors ${
                  active ? 'border-[#03458f] ring-2 ring-[#03458f]/15' : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: READINESS[readiness].dot }} />
                    {READINESS_LABEL[readiness]}
                  </span>
                  <span className={`text-xl font-semibold tabular-nums ${counts[readiness] > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                    {counts[readiness]}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-400">{READINESS[readiness].hint}</span>
              </button>
            );
          })}
        </div>

        {error && !form && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_27rem]">
          {/* ── Fleet and jobs ─────────────────────────────────────────────── */}
          <section className="min-w-0 overflow-hidden rounded-2xl border border-gray-100 bg-white">
            <div className="flex flex-col gap-2.5 border-b border-gray-100 p-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="View">
                {(
                  [
                    ['fleet', `Fleet · ${board.length}`],
                    ['jobs', `Jobs · ${items.length}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                      tab === value ? 'bg-white text-[#03458f] shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={tab === 'fleet' ? 'Search registration, model, trip…' : 'Search work, garage, vehicle…'}
              />
              {tab === 'jobs' && <VehicleFilter vehicles={vehicles} value={vehicleFilter} onChange={setVehicleFilter} />}
            </div>

            {tab === 'fleet' ? (
              <>
                {readinessFilter && (
                  <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2 text-xs text-gray-600">
                    <span>
                      Showing <span className="font-semibold">{READINESS_LABEL[readinessFilter].toLowerCase()}</span> vehicles only.
                    </span>
                    <button onClick={() => setReadinessFilter(null)} className="font-semibold text-[#03458f] hover:underline">
                      Show all
                    </button>
                  </div>
                )}
                <div className="hidden gap-x-4 border-b border-gray-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 md:grid md:grid-cols-[minmax(8rem,1.1fr)_minmax(13rem,2.1fr)_minmax(11rem,1.5fr)_6rem_minmax(7rem,1fr)]">
                  <span>Vehicle</span>
                  <span>Readiness</span>
                  <span>Trips</span>
                  <span className="text-right">Odometer</span>
                  <span>Last done</span>
                </div>
                {fleetRows.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-gray-500">
                    {board.length === 0 ? 'No internal vehicles to show yet.' : 'No vehicle matches. Try a different search or clear the filter.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-50">
                    {fleetRows.map((row) => {
                      const trip = tripLine(row);
                      const active = panelRow?.vehicle.id === row.vehicle.id;
                      return (
                        <li key={row.vehicle.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedId(row.vehicle.id)}
                            aria-current={active ? 'true' : undefined}
                            className={`block w-full gap-x-4 px-4 py-3 text-left transition-colors md:grid md:grid-cols-[minmax(8rem,1.1fr)_minmax(13rem,2.1fr)_minmax(11rem,1.5fr)_6rem_minmax(7rem,1fr)] md:items-center ${
                              active ? 'bg-[#03458f]/5' : 'hover:bg-gray-50/70'
                            }`}
                          >
                            <span className="block min-w-0">
                              <span className="block truncate font-semibold text-gray-900">{row.vehicle.registration}</span>
                              <span className="block truncate text-xs text-gray-500">
                                {[row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ') || '—'}
                              </span>
                            </span>
                            <span className="mt-1.5 block min-w-0 md:mt-0">
                              <span className="flex flex-wrap items-center gap-1.5">
                                <ReadinessPill readiness={row.readiness} />
                                {row.clashes.length > 0 && (
                                  <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                    Clashes with a trip
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 block truncate text-xs text-gray-500" title={row.reason}>
                                {row.reason}
                              </span>
                            </span>
                            <span className="mt-1.5 block min-w-0 text-xs md:mt-0">
                              {trip ? (
                                <>
                                  <span className={`block truncate font-medium ${trip.now ? 'text-[#03458f]' : 'text-gray-700'}`} title={trip.title}>
                                    {trip.title}
                                  </span>
                                  <span className="block truncate text-gray-500">
                                    {trip.days}
                                    {row.trips.length > 1 && <span className="text-gray-400"> · +{row.trips.length - 1} more</span>}
                                  </span>
                                </>
                              ) : (
                                <span className="text-gray-300">No trips booked</span>
                              )}
                            </span>
                            <span className="hidden text-xs tabular-nums text-gray-700 md:block md:text-right">
                              {row.odometerKm != null ? `${formatNumber(row.odometerKm)} km` : <span className="text-gray-300">—</span>}
                            </span>
                            <span className="hidden min-w-0 text-xs text-gray-500 md:block">
                              {row.lastDone ? (
                                <>
                                  <span className="block truncate text-gray-700">{row.lastDone.title}</span>
                                  <span className="block">{formatDateKey(row.lastDone.completedAt)}</span>
                                </>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {outsideFleet > 0 && (
                  <p className="border-t border-gray-100 bg-gray-50/60 px-4 py-2.5 text-xs leading-relaxed text-gray-500">
                    Our own fleet only: {board.length === 1 ? '1 vehicle is' : `${formatNumber(board.length)} vehicles are`} marked Internal.{' '}
                    {outsideFleet === 1 ? '1 other vehicle' : `${formatNumber(outsideFleet)} other vehicles`} in the register{' '}
                    {outsideFleet === 1 ? 'is' : 'are'} external or not classified yet.{' '}
                    <Link href="/modules/vehicles" className="font-semibold text-[#03458f] hover:underline">
                      Classify them in Vehicles
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 border-b border-gray-100 p-3">
                  <ChipFilter options={VIEWS} value={view} onChange={setView} />
                  <ChipFilter options={KIND_FILTERS} value={kindFilter} onChange={setKindFilter} />
                </div>
                {filtered.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-gray-500">
                    {items.length === 0
                      ? 'No jobs yet. Schedule a service or log a repair to start the history.'
                      : 'No job matches. Try a different search, vehicle, type or view.'}
                  </p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {visible.map((item) => {
                      const display = maintenanceDisplayStatus(item, today);
                      const open = isOpenMaintenance(item);
                      return (
                        <div
                          key={item.id}
                          onClick={() => openEdit(item)}
                          className="flex cursor-pointer flex-col gap-3 px-4 py-3 hover:bg-gray-50/70 sm:flex-row sm:items-center"
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
                                  {item.status === 'Planned' && <span className="block text-gray-400">{dueText(item.scheduledFor, today)}</span>}
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
                                  complete(item);
                                }}
                                className={smallAction}
                              >
                                {item.status === 'In progress' ? 'Back on the road' : 'Mark done'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="px-4 empty:hidden">
                  <ShowMoreButton hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} noun="records" />
                </div>
              </>
            )}
          </section>

          {/* ── What needs a decision, then the vehicle in focus ───────────── */}
          <aside className="order-first min-w-0 space-y-4 lg:order-none lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto">
            <section className="rounded-2xl border border-gray-100 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-gray-900">Needs attention</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${attention.length > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  {attention.length}
                </span>
              </div>
              {attention.length === 0 ? (
                <p className="px-4 py-4 text-sm text-gray-500">
                  {board.length === 0 ? 'Nothing to watch yet.' : 'Nothing is overdue, due soon, in the garage or clashing with a trip.'}
                </p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {attention.map((entry) => (
                    <li key={entry.key} className="flex items-start gap-3 px-4 py-2.5">
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: entry.tone === 'clash' ? '#e11d48' : READINESS[entry.tone].dot }}
                      />
                      <div className="min-w-0 flex-1">
                        <button onClick={() => setSelectedId(entry.row.vehicle.id)} className="text-sm font-semibold text-gray-900 hover:text-[#03458f]">
                          {entry.row.vehicle.registration}
                        </button>
                        <p className={`text-xs leading-relaxed ${entry.tone === 'clash' ? 'text-rose-700' : 'text-gray-600'}`}>{entry.text}</p>
                      </div>
                      <button onClick={entry.run} className={smallAction}>
                        {entry.actionLabel}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {panelRow && (
              <>
                {picked && (
                  <button type="button" aria-label="Close" onClick={() => setSelectedId(null)} className="fixed inset-0 z-[220] cursor-default bg-gray-900/20 backdrop-blur-sm lg:hidden" />
                )}
                <section
                  aria-label={`${panelRow.vehicle.registration} details`}
                  className={
                    picked
                      ? 'fixed inset-y-0 right-0 z-[230] w-full max-w-md overflow-y-auto bg-white shadow-2xl lg:static lg:z-auto lg:w-auto lg:max-w-none lg:overflow-visible lg:rounded-2xl lg:border lg:border-gray-100 lg:shadow-none'
                      : 'hidden rounded-2xl border border-gray-100 bg-white lg:block'
                  }
                >
                  <VehiclePanel
                    row={panelRow}
                    today={today}
                    onClose={picked ? () => setSelectedId(null) : null}
                    onSchedule={() => scheduleFor(panelRow.vehicle.id)}
                    onRepair={() => logRepairFor(panelRow.vehicle.id)}
                    onComplete={complete}
                    onEdit={openEdit}
                    onBook={book}
                  />
                </section>
              </>
            )}
          </aside>
        </div>
      </div>

      {form && (
        <FleetModal
          title={formTitle}
          onClose={closeForm}
          error={error}
          onSubmit={submit}
          footer={
            <>
              {editingId && mode === 'edit' ? (
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
                {busy ? 'Saving…' : mode === 'complete' ? formTitle : editingId ? 'Save changes' : 'Save'}
              </button>
            </>
          }
        >
          {mode === 'complete' && editingItem && (
            <div className="rounded-xl bg-gray-50 px-3.5 py-2.5">
              <p className="text-sm font-semibold text-gray-900">{editingItem.title}</p>
              <p className="text-xs text-gray-500">
                {vehicleLabel(editingItem.vehicle)} · {editingItem.category}
              </p>
            </div>
          )}

          {shows('kind') && (
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
          )}

          {shows('vehicle') && (
            <div>
              <Label>Vehicle *</Label>
              <VehicleSelect vehicles={vehicles} value={form.vehicleId} onChange={(vehicleId) => setForm({ ...form, vehicleId })} />
            </div>
          )}

          {(shows('category') || shows('status')) && (
            <div className={`grid gap-3 ${shows('category') && shows('status') ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {shows('category') && (
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
              )}
              {shows('status') && (
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
              )}
            </div>
          )}

          {shows('work') && (
            <div>
              <Label>{mode === 'repair' ? 'What happened *' : 'Work *'}</Label>
              <input
                className={inputClass}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={form.kind === 'Unscheduled' ? 'e.g. Flat battery, cracked windscreen' : 'e.g. 10,000 km service, annual inspection'}
                autoFocus={!editingId}
              />
            </div>
          )}

          {shows('garageState') && (
            <div>
              <Label>Where is the vehicle now?</Label>
              <div className="grid grid-cols-2 gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1" role="radiogroup" aria-label="Where is the vehicle now?">
                {(
                  [
                    ['In progress', 'In the garage'],
                    ['Planned', 'Still on the road'],
                  ] as const
                ).map(([status, label]) => (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={form.status === status}
                    onClick={() => setForm({ ...form, status })}
                    className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
                      form.status === status ? 'text-white shadow-sm' : 'text-gray-500 hover:bg-white'
                    }`}
                    style={form.status === status ? { backgroundColor: status === 'In progress' ? '#111827' : BRAND } : undefined}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                {form.status === 'In progress'
                  ? 'It is off the road until this is marked done, and shows as in maintenance wherever vehicles are picked.'
                  : 'It can still go out; the repair is booked for the date below.'}
              </p>
            </div>
          )}

          {(shows('planned') || (shows('completed') && form.status === 'Completed')) && (
            <div className="grid grid-cols-2 gap-3">
              {shows('planned') && (
                <div>
                  <Label>
                    {mode === 'repair'
                      ? form.status === 'In progress'
                        ? 'In the garage since'
                        : 'Booked in for'
                      : form.kind === 'Unscheduled'
                        ? 'Booked in for'
                        : 'Planned date'}
                  </Label>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.scheduledFor}
                    onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })}
                  />
                </div>
              )}
              {shows('completed') && form.status === 'Completed' && (
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
              {shows('odometer') && !shows('planned') && (
                <div>
                  <Label>Odometer (km)</Label>
                  <OdometerInput form={form} setForm={setForm} last={odometers[Number(form.vehicleId)]} />
                </div>
              )}
            </div>
          )}

          {((shows('odometer') && shows('planned')) || shows('provider')) && (
            <div className={`grid gap-3 ${shows('odometer') && shows('planned') && shows('provider') ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {shows('odometer') && shows('planned') && (
                <div>
                  <Label>Odometer (km)</Label>
                  <OdometerInput form={form} setForm={setForm} last={odometers[Number(form.vehicleId)]} />
                </div>
              )}
              {shows('provider') && (
                <div>
                  <Label>Garage / provider</Label>
                  <input
                    className={inputClass}
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
              )}
            </div>
          )}

          {shows('cost') && (
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
          )}

          {shows('nextDue') && (
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
          )}

          {shows('reminder') && (mode !== 'complete' || form.nextDueAt !== '' || form.nextDueKm !== '') && (
            <div>
              <Label>{mode === 'complete' ? 'Remind before the next due' : 'Reminder'}</Label>
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
          )}

          {shows('notes') && (
            <div>
              <Label>Notes</Label>
              <textarea
                rows={mode === 'edit' ? 3 : 2}
                className={inputClass}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Parts replaced, findings, invoice number…"
              />
            </div>
          )}

          {mode !== 'edit' && (
            <button type="button" onClick={() => setMode('edit')} className="text-xs font-semibold text-[#03458f] hover:underline">
              Show every field
            </button>
          )}
        </FleetModal>
      )}
    </div>
  );
}

function OdometerInput({
  form,
  setForm,
  last,
}: {
  form: MaintenanceForm;
  setForm: (form: MaintenanceForm) => void;
  /** The highest reading on file for the vehicle. */
  last: number | undefined;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      step="1"
      className={inputClass}
      value={form.odometerKm}
      onChange={(e) => setForm({ ...form, odometerKm: e.target.value })}
      placeholder={last != null ? `Last: ${formatNumber(last)}` : 'Optional'}
    />
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="truncate text-sm font-medium text-gray-900">{children}</p>
    </div>
  );
}

/**
 * One vehicle, as someone deciding whether to send it out needs it: can it
 * go, what is it on, what is open, what is coming, and what was done before.
 */
function VehiclePanel({
  row,
  today,
  onClose,
  onSchedule,
  onRepair,
  onComplete,
  onEdit,
  onBook,
}: {
  row: FleetBoardRow;
  today: string;
  /** Set when the panel was opened from the fleet list (and is a drawer on small screens). */
  onClose: (() => void) | null;
  onSchedule: () => void;
  onRepair: () => void;
  onComplete: (item: MaintenanceDto) => void;
  onEdit: (item: MaintenanceDto) => void;
  onBook: (item: MaintenanceDto) => void;
}) {
  const [allHistory, setAllHistory] = useState(false);
  const planned = row.dues.filter((due) => due.basis === 'planned');
  const coming = row.dues.filter((due) => due.basis !== 'planned');
  const history = allHistory ? row.closed : row.closed.slice(0, 5);
  const nextTrip = row.trips[0] ?? null;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">{row.vehicle.registration}</h2>
            <ReadinessPill readiness={row.readiness} />
          </div>
          <p className="truncate text-xs text-gray-500">{[row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ') || 'No make / model on file'}</p>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        <p className="text-sm text-gray-700">{row.reason}</p>

        {row.clashes.map((clash) => (
          <div key={`${clash.job.id}:${clash.trip.tripId}`} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
            {clash.message}.
          </div>
        ))}

        <div className="grid grid-cols-2 gap-2">
          <Fact label="Odometer">{row.odometerKm != null ? `${formatNumber(row.odometerKm)} km` : 'No reading yet'}</Fact>
          <Fact label="Last done">{row.lastDone ? formatDateKey(row.lastDone.completedAt) : 'Nothing yet'}</Fact>
          <Fact label={row.onTripToday ? 'On trip now' : 'Next trip'}>
            {row.onTripToday ? row.onTripToday.reference : nextTrip ? nextTrip.reference : 'None booked'}
          </Fact>
          <Fact label="Trip days">{row.onTripToday ? tripDays(row.onTripToday) : nextTrip ? tripDays(nextTrip) : '—'}</Fact>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onRepair} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Log a repair
          </button>
          <button onClick={onSchedule} className="rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-95" style={{ backgroundColor: BRAND }}>
            Schedule
          </button>
        </div>

        {(row.inGarage.length > 0 || planned.length > 0) && (
          <div>
            <p className={sectionTitle}>Open work</p>
            <ul className="mt-1.5 divide-y divide-gray-50 rounded-xl border border-gray-100">
              {row.inGarage.map((job) => (
                <li key={job.id} className="flex items-start gap-3 px-3 py-2">
                  <button onClick={() => onEdit(job)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium text-gray-900">{job.title}</span>
                    <span className="block text-xs text-gray-500">
                      In the garage{job.scheduledFor ? ` since ${formatDateKey(job.scheduledFor)}` : ''}
                      {job.provider ? ` · ${job.provider}` : ''}
                    </span>
                  </button>
                  <button onClick={() => onComplete(job)} className={smallAction}>
                    Back on the road
                  </button>
                </li>
              ))}
              {planned.map((due) => (
                <li key={due.item.id} className="flex items-start gap-3 px-3 py-2">
                  <button onClick={() => onEdit(due.item)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium text-gray-900">{due.item.title}</span>
                    <span className={`block text-xs ${due.state === 'overdue' ? 'text-rose-600' : due.state === 'due-soon' ? 'text-amber-700' : 'text-gray-500'}`}>
                      {due.dueDate ? `${formatDateKey(due.dueDate)} · ${dueText(due.dueDate, today)}` : 'No date yet'}
                      {due.item.provider ? ` · ${due.item.provider}` : ''}
                    </span>
                  </button>
                  <button onClick={() => onComplete(due.item)} className={smallAction}>
                    Mark done
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {coming.length > 0 && (
          <div>
            <p className={sectionTitle}>Coming due</p>
            <ul className="mt-1.5 divide-y divide-gray-50 rounded-xl border border-gray-100">
              {coming.map((due) => (
                <li key={`${due.basis}:${due.item.id}`} className="flex items-start gap-3 px-3 py-2">
                  <p className={`min-w-0 flex-1 text-xs leading-relaxed ${due.state === 'overdue' ? 'text-rose-600' : due.state === 'due-soon' ? 'text-amber-700' : 'text-gray-600'}`}>
                    {dueSentence(due, row.odometerKm)}
                  </p>
                  <button onClick={() => onBook(due.item)} className={smallAction}>
                    Book it
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {row.trips.length > 1 && (
          <div>
            <p className={sectionTitle}>Trips booked</p>
            <ul className="mt-1.5 space-y-1 text-xs text-gray-600">
              {row.trips.slice(0, 6).map((trip) => (
                <li key={trip.tripId} className="flex justify-between gap-3">
                  <span className="font-medium text-gray-800">{trip.reference}</span>
                  <span className="text-gray-500">{tripDays(trip)}</span>
                </li>
              ))}
              {row.trips.length > 6 && <li className="text-gray-400">+{row.trips.length - 6} more</li>}
            </ul>
          </div>
        )}

        <div>
          <p className={sectionTitle}>History</p>
          {row.closed.length === 0 ? (
            <p className="mt-1.5 text-xs text-gray-500">No finished work on record for this vehicle.</p>
          ) : (
            <ul className="mt-1.5 divide-y divide-gray-50 rounded-xl border border-gray-100">
              {history.map((job) => (
                <li key={job.id}>
                  <button onClick={() => onEdit(job)} className="block w-full px-3 py-2 text-left hover:bg-gray-50/70">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`truncate text-sm font-medium ${job.status === 'Cancelled' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{job.title}</span>
                      <span className="shrink-0 text-xs text-gray-500">{formatDateKey(job.completedAt ?? job.scheduledFor)}</span>
                    </span>
                    <span className="block truncate text-xs text-gray-500">
                      {[
                        job.status === 'Cancelled' ? 'Cancelled' : job.category,
                        job.provider,
                        job.odometerKm != null ? `${formatNumber(job.odometerKm)} km` : null,
                        job.cost != null ? formatMoney(job.cost, job.currency) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {row.closed.length > 5 && (
            <button onClick={() => setAllHistory((value) => !value)} className="mt-1.5 text-xs font-semibold text-[#03458f] hover:underline">
              {allHistory ? 'Show fewer' : `Show all ${row.closed.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
