'use client';

import { useState } from 'react';

import { formatMoney, formatNumber, formatTotals, readNumber } from '@/app/modules/_components/fleet-ui';
import { useNow } from '@/app/ui/use-client';
import {
  FUEL_TYPES,
  MAINTENANCE_CATEGORIES,
  type FleetVehicleRef,
  type MaintenanceDisplayStatus,
  SUGGESTED_KIND,
  formatDateKey,
  localDateKey,
  vehicleLabel,
} from '@/lib/fleet';
import type { OpsFuel, OpsJob, OpsMaintenance, OpsReference } from '@/lib/ops-dashboard';

import {
  Empty,
  HeaderButton,
  Panel,
  type PanelFrame,
  Pill,
  RowButton,
  StackedBar,
  type Tone,
  ago,
  fieldClass,
  formClass,
  mono,
  primaryButton,
  rowClass,
  send,
  subClass,
} from './ops-ui';

/** The registration at the head of a fleet row, as the mono ID on a tracker list. */
const plateClass = `${mono} w-24 shrink-0 truncate text-xs text-gray-500`;

const labelClass = 'text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400';

function VehiclePicker({ vehicles, value, onChange }: Readonly<{ vehicles: FleetVehicleRef[]; value: string; onChange: (id: string) => void }>) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Vehicle" className={`${fieldClass} col-span-2`}>
      <option value="">Pick a vehicle…</option>
      {vehicles.map((v) => (
        <option key={v.id} value={v.id}>
          {vehicleLabel(v)}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- fuel

type FuelForm = { vehicleId: string; litres: string; cost: string; currency: string; odometerKm: string; fuelType: string };

/** This month's fuel, the latest fill-ups, and a quick way to log one. */
export function FuelPanel({
  data,
  reference,
  frame,
  onChanged,
}: Readonly<{ data: OpsFuel; reference: OpsReference; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const now = useNow(60_000);
  const { vehicles } = reference;
  const blankForm = (): FuelForm => ({
    vehicleId: vehicles.length === 1 ? String(vehicles[0]!.id) : '',
    litres: '',
    cost: '',
    currency: data.recent[0]?.currency ?? reference.defaultCurrency,
    odometerKm: '',
    fuelType: 'Petrol',
  });
  const [form, setForm] = useState<FuelForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form) return;
    let body: Record<string, unknown>;
    try {
      if (!form.vehicleId) throw new Error('Pick a vehicle.');
      const litres = readNumber(form.litres, 'Litres');
      if (litres === null) throw new Error('Enter how many litres went in.');
      body = {
        vehicleId: Number(form.vehicleId),
        // Logged as it happens; the Car Fuel page can back-date one.
        filledAt: new Date().toISOString(),
        litres,
        cost: readNumber(form.cost, 'Cost'),
        currency: form.currency,
        odometerKm: readNumber(form.odometerKm, 'Odometer'),
        fuelType: form.fuelType,
        fullTank: true,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the form.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (await send('/api/fleet/fuel', 'POST', body)) {
        setForm(null);
        await onChanged();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      id="ops-fuel"
      title="Car fuel"
      summary={`${data.month.fills} fill-ups this month`}
      href="/modules/car-fuel"
      moduleName="Car Fuel"
      frame={frame}
      actions={
        vehicles.length > 0 && (
          <HeaderButton
            active={form !== null}
            onClick={() => {
              setError(null);
              setForm((f) => (f ? null : blankForm()));
            }}
          >
            {form ? 'Close' : '+ Fill-up'}
          </HeaderButton>
        )
      }
    >
      {form && (
        <form
          className={`${formClass} grid grid-cols-2 gap-2`}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <VehiclePicker vehicles={vehicles} value={form.vehicleId} onChange={(vehicleId) => setForm({ ...form, vehicleId })} />
          <input inputMode="decimal" placeholder="Litres" aria-label="Litres" value={form.litres} onChange={(e) => setForm({ ...form, litres: e.target.value })} className={fieldClass} />
          <select value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })} aria-label="Fuel type" className={fieldClass}>
            {FUEL_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <input inputMode="decimal" placeholder="Cost" aria-label="Cost" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className={fieldClass} />
            <input
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase().slice(0, 3) })}
              aria-label="Currency"
              className={`${fieldClass} w-16 shrink-0 text-center uppercase`}
            />
          </div>
          <input inputMode="numeric" placeholder="Odometer km" aria-label="Odometer km" value={form.odometerKm} onChange={(e) => setForm({ ...form, odometerKm: e.target.value })} className={fieldClass} />
          {error && <p className="col-span-2 text-xs text-rose-600">{error}</p>}
          <button type="submit" disabled={saving} className={`${primaryButton} col-span-2`}>
            {saving ? 'Saving…' : 'Log fill-up now'}
          </button>
        </form>
      )}

      <div className="grid grid-cols-3 gap-2 py-3">
        {[
          ['Fill-ups', formatNumber(data.month.fills)],
          ['Litres', formatNumber(data.month.litres, 1)],
          ['Spend', formatTotals(data.month.spend)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-xl bg-gray-50 px-3 py-2.5">
            <p className={labelClass}>{label}</p>
            <p className="mt-0.5 truncate text-sm font-bold tabular-nums text-primary" title={value}>
              {value}
            </p>
          </div>
        ))}
      </div>
      <p className={`${labelClass} border-b border-gray-100 pb-2`}>Latest fill-ups</p>

      {data.recent.length === 0 ? (
        <Empty>No fill-ups logged yet.</Empty>
      ) : (
        <ul>
          {data.recent.map((log) => (
            <li key={log.id} className={rowClass}>
              <span className={plateClass} title={log.vehicle}>
                {log.vehicle}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{formatNumber(log.litres, 2)} L</span>
                <span className={subClass}>{[log.station, ago(log.filledAt, now)].filter(Boolean).join(' · ')}</span>
              </span>
              {log.cost !== null && <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{formatMoney(log.cost, log.currency)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- maintenance

const DISPLAY_TONE: Record<MaintenanceDisplayStatus, Tone> = {
  Overdue: 'danger',
  'Due soon': 'warn',
  'In progress': 'info',
  Planned: 'neutral',
  Completed: 'good',
  Cancelled: 'neutral',
};

type WorkForm = { vehicleId: string; category: string; title: string; when: string; status: 'Planned' | 'In progress' };

/** Open work by urgency (start it, finish it), the next services coming due, and new work reported from the desk. */
export function MaintenancePanel({
  data,
  reference,
  frame,
  onChanged,
}: Readonly<{ data: OpsMaintenance; reference: OpsReference; frame: PanelFrame; onChanged: () => Promise<void> }>) {
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<WorkForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { vehicles } = reference;

  const setStatus = async (job: OpsJob, status: 'In progress' | 'Completed') => {
    setBusy(job.id);
    try {
      if (await send(`/api/fleet/maintenance/${job.id}`, 'PATCH', { status })) await onChanged();
    } finally {
      setBusy(null);
    }
  };

  // A breakdown under way is the usual reason to reach for this from the desk.
  const blankForm = (): WorkForm => ({
    vehicleId: vehicles.length === 1 ? String(vehicles[0]!.id) : '',
    category: 'Breakdown',
    title: '',
    when: localDateKey(),
    status: 'In progress',
  });

  const save = async () => {
    if (!form) return;
    if (!form.vehicleId) return setError('Pick a vehicle.');
    if (!form.title.trim()) return setError('Describe the work.');
    setError(null);
    setBusy('new');
    try {
      const ok = await send('/api/fleet/maintenance', 'POST', {
        vehicleId: Number(form.vehicleId),
        category: form.category,
        kind: SUGGESTED_KIND[form.category] ?? 'Scheduled',
        title: form.title.trim(),
        status: form.status,
        scheduledFor: form.when || null,
      });
      if (ok) {
        setForm(null);
        await onChanged();
      }
    } finally {
      setBusy(null);
    }
  };

  const attention = data.overdue + data.dueSoon + data.inProgress;
  const summary =
    data.overdue > 0 ? (
      <>
        <span className="text-rose-600">{data.overdue} overdue</span>
        {data.dueSoon > 0 && ` · ${data.dueSoon} due soon`}
      </>
    ) : data.dueSoon > 0 ? (
      <span className="text-amber-600">{data.dueSoon} due soon</span>
    ) : data.inProgress > 0 ? (
      `${data.inProgress} in progress`
    ) : (
      'Nothing due'
    );

  return (
    <Panel
      id="ops-maintenance"
      title="Car maintenance"
      summary={summary}
      href="/modules/car-maintenance"
      moduleName="Car Maintenance"
      frame={frame}
      actions={
        vehicles.length > 0 && (
          <HeaderButton
            active={form !== null}
            onClick={() => {
              setError(null);
              setForm((f) => (f ? null : blankForm()));
            }}
          >
            {form ? 'Close' : '+ Report'}
          </HeaderButton>
        )
      }
    >
      {form && (
        <form
          className={`${formClass} grid grid-cols-2 gap-2`}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <VehiclePicker vehicles={vehicles} value={form.vehicleId} onChange={(vehicleId) => setForm({ ...form, vehicleId })} />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} aria-label="Category" className={fieldClass}>
            {MAINTENANCE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as WorkForm['status'] })}
            aria-label="Status"
            className={fieldClass}
          >
            <option value="In progress">Happening now</option>
            <option value="Planned">Book for a date</option>
          </select>
          <input
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={200}
            placeholder={form.category === 'Breakdown' ? 'What happened, and where' : 'What needs doing'}
            aria-label="Work"
            className={`${fieldClass} col-span-2`}
          />
          <input type="date" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} aria-label="Date" className={fieldClass} />
          <button type="submit" disabled={busy === 'new'} className={primaryButton}>
            {form.status === 'In progress' ? 'Report' : 'Book'}
          </button>
          {error && <p className="col-span-2 text-xs text-rose-600">{error}</p>}
        </form>
      )}

      {attention > 0 && (
        <div className="border-b border-gray-100 py-4">
          <StackedBar
            segments={[
              { label: 'overdue', value: data.overdue, tone: 'danger' },
              { label: 'due soon', value: data.dueSoon, tone: 'warn' },
              { label: 'in progress', value: data.inProgress, tone: 'info' },
            ]}
          />
        </div>
      )}

      {data.jobs.length === 0 ? (
        <Empty>No open maintenance.</Empty>
      ) : (
        <ul>
          {data.jobs.map((job) => (
            <li key={job.id} className={rowClass}>
              <span className={plateClass} title={job.vehicle}>
                {job.vehicle}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">{job.title}</span>
                <span className={subClass}>
                  {job.category} · {job.kind}
                  {job.scheduledFor && ` · ${formatDateKey(job.scheduledFor)}`}
                </span>
              </span>
              <Pill tone={DISPLAY_TONE[job.display]}>{job.display}</Pill>
              {job.status === 'Planned' && (
                <RowButton onClick={() => void setStatus(job, 'In progress')} disabled={busy === job.id}>
                  Start
                </RowButton>
              )}
              <RowButton tone="good" onClick={() => void setStatus(job, 'Completed')} disabled={busy === job.id}>
                Done
              </RowButton>
            </li>
          ))}
        </ul>
      )}

      {data.comingDue.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className={`${labelClass} mb-1.5`}>Coming due</p>
          <ul className="space-y-1 pb-1">
            {data.comingDue.map((r) => (
              <li key={r.key} className={`text-xs ${r.overdue ? 'text-rose-600' : 'text-amber-700'}`}>
                {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
