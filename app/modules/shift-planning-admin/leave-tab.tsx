'use client';

import { type FormEvent, useState } from 'react';

import { Card, Label, Pill, formatDay, formatHours, ghostButton, inputClass, primaryButton } from '@/app/modules/_components/shift-ui';
import { useConfirm } from '@/app/ui/confirm-dialog';
import { type Violation, monthOf } from '@/lib/shift-rules';
import type { AdminOverview, LeaveView } from '@/lib/shift-types';

import { message, sendJson } from './api';
import { ViolationList } from './roster-tab';

interface Props {
  data: AdminOverview;
  reload: () => Promise<void>;
  onOpenRoster: (month: string) => void;
}

const STATUS_TONE: Record<LeaveView['status'], 'ok' | 'warn' | 'danger' | 'muted'> = {
  pending: 'warn',
  approved: 'ok',
  declined: 'danger',
  cancelled: 'muted',
};

const range = (leave: LeaveView) =>
  leave.startDate === leave.endDate ? formatDay(leave.startDate) : `${formatDay(leave.startDate)} – ${formatDay(leave.endDate)}`;

export default function LeaveTab({ data, reload, onOpenRoster }: Props) {
  const { lines, leaves, balances, rules, today } = data;
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cover, setCover] = useState<{ leave: LeaveView; needsCover: Violation[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ lineId: '', type: 'annual', startDate: '', endDate: '', note: '', approve: true });

  const pending = leaves.filter((l) => l.status === 'pending');
  const active = lines.filter((l) => l.active);

  const decide = async (leave: LeaveView, decision: 'approve' | 'decline' | 'cancel') => {
    if (decision === 'cancel') {
      const ok = await confirm({
        title: `Cancel ${leave.personName}'s leave?`,
        message: leave.status === 'approved' ? 'The shifts go back on the roster as the rotation produced them.' : undefined,
        confirmLabel: 'Cancel leave',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await sendJson<{ leave: LeaveView; needsCover: Violation[] }>(`/api/shift-planning/admin/leave/${leave.id}`, 'PATCH', { decision });
      setCover(decision === 'approve' ? result : null);
      await reload();
    } catch (e) {
      setError(message(e, 'Could not update the request.'));
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await sendJson<{ leave: LeaveView; needsCover: Violation[] }>('/api/shift-planning/admin/leave', 'POST', { ...form, lineId: Number(form.lineId) });
      setCover(form.approve ? result : null);
      setAdding(false);
      setForm({ lineId: '', type: 'annual', startDate: '', endDate: '', note: '', approve: true });
      await reload();
    } catch (err) {
      setError(message(err, 'Could not add the leave.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {dialog}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {cover && (
        <Card className={`p-5 ${cover.needsCover.length ? 'border-amber-200' : 'border-emerald-200'}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Leave approved for {cover.leave.personName}: {cover.leave.shiftsCharged} shift{cover.leave.shiftsCharged === 1 ? '' : 's'} charged
              </h3>
              <p className="mt-0.5 text-sm text-gray-500">
                {cover.needsCover.length
                  ? 'These shifts now have nobody on them. Assign cover on the roster, usually the person on call that day.'
                  : 'Nothing on the generated roster is left uncovered.'}
              </p>
            </div>
            <div className="flex gap-2">
              {cover.needsCover.length > 0 && (
                <button type="button" className={primaryButton} onClick={() => onOpenRoster(monthOf(cover.needsCover[0]?.date ?? cover.leave.startDate))}>
                  Open the roster
                </button>
              )}
              <button type="button" className={ghostButton} onClick={() => setCover(null)}>
                Dismiss
              </button>
            </div>
          </div>
          {cover.needsCover.length > 0 && <div className="mt-3"><ViolationList items={cover.needsCover} /></div>}
        </Card>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Requests waiting for a decision</h2>
            <p className="mt-0.5 text-sm text-gray-500">Leave is charged per rostered shift. On-call and rest days inside the dates are never charged.</p>
          </div>
          <button type="button" className={adding ? ghostButton : primaryButton} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : 'Add leave'}
          </button>
        </div>

        {adding && (
          <form onSubmit={add} className="mt-4 grid gap-3 rounded-xl border border-gray-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <Label>Person</Label>
              <select required className={inputClass} value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })}>
                <option value="">Choose…</option>
                {active.map((line) => (
                  <option key={line.id} value={line.id}>{line.code}{line.name !== line.code ? ` · ${line.name}` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Type</Label>
              <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="annual">Annual</option>
                <option value="sick">Sick</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <Label>First day</Label>
              <input type="date" required className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate && form.endDate >= e.target.value ? form.endDate : e.target.value })} />
            </div>
            <div>
              <Label>Last day</Label>
              <input type="date" required min={form.startDate || undefined} className={inputClass} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
            <div>
              <Label>Note</Label>
              <input className={inputClass} maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="flex items-center justify-between gap-3 sm:col-span-2 lg:col-span-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.approve} onChange={(e) => setForm({ ...form, approve: e.target.checked })} />
                Approve it now
              </label>
              <button type="submit" disabled={busy} className={primaryButton}>
                {busy ? 'Saving…' : 'Save leave'}
              </button>
            </div>
          </form>
        )}

        <div className="mt-4 space-y-2">
          {pending.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">No requests are waiting.</p>
          ) : (
            pending.map((leave) => (
              <div key={leave.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {leave.personName} <span className="font-normal text-gray-400">· {leave.lineCode}</span>
                  </p>
                  <p className="text-sm text-gray-600">
                    {range(leave)} · <span className="capitalize">{leave.type}</span> · {leave.shiftsCharged} shift{leave.shiftsCharged === 1 ? '' : 's'} would be charged
                  </p>
                  {leave.note && <p className="mt-0.5 text-xs text-gray-400">“{leave.note}”</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className={ghostButton} onClick={() => void decide(leave, 'decline')}>
                    Decline
                  </button>
                  <button type="button" disabled={busy} className={primaryButton} onClick={() => void decide(leave, 'approve')}>
                    Approve
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Leave balances, {today.slice(0, 4)}</h2>
          <p className="mt-0.5 text-sm text-gray-500">Earned a twelfth of the entitlement for each completed month. A balance above {rules.leaveCapDays} days is flagged.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50/60 text-left text-xs text-gray-400">
                {['Person', 'Entitlement', 'Opening', 'Accrued', 'Taken', 'Pending', 'Balance'].map((h) => (
                  <th key={h} className="px-5 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((line) => {
                const b = balances[line.id];
                if (!b) return null;
                return (
                  <tr key={line.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="font-bold text-gray-900">{line.code}</span>
                      {line.name !== line.code && <span className="ml-2 text-gray-500">{line.name}</span>}
                    </td>
                    <td className="px-5 py-2.5 tabular-nums text-gray-600">{formatHours(b.entitlement)}</td>
                    <td className="px-5 py-2.5 tabular-nums text-gray-600">{formatHours(b.opening)}</td>
                    <td className="px-5 py-2.5 tabular-nums text-gray-600">{formatHours(b.accrued)}</td>
                    <td className="px-5 py-2.5 tabular-nums text-gray-600">{formatHours(b.taken)}</td>
                    <td className="px-5 py-2.5 tabular-nums text-gray-600">{formatHours(b.pending)}</td>
                    <td className="px-5 py-2.5">
                      <span className="mr-2 font-semibold tabular-nums text-gray-900">{formatHours(b.balance)}</span>
                      {b.balance > rules.leaveCapDays && <Pill tone="warn">above the {rules.leaveCapDays}-day cap</Pill>}
                      {b.balance < 0 && <Pill tone="danger">overdrawn</Pill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">All leave</h2>
        </div>
        {leaves.length === 0 ? (
          <p className="px-5 pb-8 text-center text-sm text-gray-400">Nothing recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50/60 text-left text-xs text-gray-400">
                  {['Person', 'Dates', 'Type', 'Shifts charged', 'Status', 'Decided by', ''].map((h) => (
                    <th key={h} className="px-5 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaves.map((leave) => (
                  <tr key={leave.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="font-bold text-gray-900">{leave.lineCode}</span>
                      {leave.personName !== leave.lineCode && <span className="ml-2 text-gray-500">{leave.personName}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-gray-600">{range(leave)}</td>
                    <td className="px-5 py-2.5 capitalize text-gray-600">{leave.type}</td>
                    <td className="px-5 py-2.5 tabular-nums text-gray-600">{leave.shiftsCharged}</td>
                    <td className="px-5 py-2.5"><Pill tone={STATUS_TONE[leave.status]}>{leave.status}</Pill></td>
                    <td className="px-5 py-2.5 text-gray-500">{leave.decidedByName ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      {(leave.status === 'approved' || leave.status === 'pending') && (
                        <button type="button" disabled={busy} className="text-sm font-semibold text-rose-600 hover:underline disabled:opacity-50" onClick={() => void decide(leave, 'cancel')}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
