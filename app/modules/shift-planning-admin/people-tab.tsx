'use client';

import { type FormEvent, useMemo, useState } from 'react';

import { CODE_STYLE, Card, Label, Pill, formatDay, formatHours, ghostButton, inputClass, primaryButton } from '@/app/modules/_components/shift-ui';
import { useConfirm } from '@/app/ui/confirm-dialog';
import { CONSOLE_CODES, LINE_ROLES, type ShiftCode, addDays, generatedCode } from '@/lib/shift-rules';
import type { AdminOverview, LineView } from '@/lib/shift-types';

import { message, sendJson } from './api';

interface Props {
  data: AdminOverview;
  reload: () => Promise<void>;
}

const ROLE_LABEL: Record<(typeof LINE_ROLES)[number], string> = { line: 'Line', hybrid: 'Hybrid', fallback: 'Fallback' };

interface Form {
  id: number | null;
  code: string;
  userId: string;
  displayName: string;
  role: string;
  cycleOffset: string;
  startDate: string;
  endDate: string;
  contractHoursPerWeek: string;
  leaveEntitlementDays: string;
  leaveOpeningBalance: string;
  active: boolean;
}

function formOf(line: LineView): Form {
  return {
    id: line.id,
    code: line.code,
    userId: line.userId === null ? '' : String(line.userId),
    displayName: line.displayName ?? '',
    role: line.role,
    cycleOffset: line.cycleOffset === null ? '' : String(line.cycleOffset),
    startDate: line.startDate ?? '',
    endDate: line.endDate ?? '',
    contractHoursPerWeek: String(line.contractHoursPerWeek),
    leaveEntitlementDays: String(line.leaveEntitlementDays),
    leaveOpeningBalance: String(line.leaveOpeningBalance),
    active: line.active,
  };
}

export default function PeopleTab({ data, reload }: Props) {
  const { rules, lines, users } = data;
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cycle = rules.pattern.length;
  const rotation = lines.filter((line) => line.active && line.cycleOffset !== null);
  const cycleDates = useMemo(() => Array.from({ length: cycle }, (_, i) => addDays(rules.rotationStart, i)), [cycle, rules.rotationStart]);
  const needed: ShiftCode[] = [...CONSOLE_CODES.filter((c) => rules.pattern.includes(c)), ...(rules.pattern.includes('OC') ? (['OC'] as ShiftCode[]) : [])];

  /** For each cycle day: which needed codes nobody is on, or more than one person is. */
  const cover = cycleDates.map((date) => {
    const codes = rotation.map((line) => generatedCode(rules, line.cycleOffset as number, date));
    return needed
      .map((code) => ({ code, count: codes.filter((c) => c === code).length }))
      .filter((c) => (c.code === 'OC' ? c.count === 0 : c.count !== 1));
  });
  const balanced = cover.every((problems) => problems.length === 0);

  const openNew = () => {
    const last = lines[lines.length - 1]?.code ?? 'TRC-0';
    const number = Number(last.match(/(\d+)$/)?.[1] ?? lines.length) + 1;
    setError(null);
    setForm({
      id: null,
      code: `${last.replace(/\d+$/, '') || 'TRC-'}${number}`,
      userId: '',
      displayName: '',
      role: 'line',
      cycleOffset: String((rotation.length * 2) % cycle),
      startDate: '',
      endDate: '',
      contractHoursPerWeek: String(rules.targetHours7d),
      leaveEntitlementDays: '21',
      leaveOpeningBalance: '0',
      active: true,
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    const body = {
      code: form.code,
      userId: form.userId ? Number(form.userId) : null,
      displayName: form.displayName,
      role: form.role,
      cycleOffset: form.cycleOffset === '' ? null : Number(form.cycleOffset),
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      contractHoursPerWeek: Number(form.contractHoursPerWeek),
      leaveEntitlementDays: Number(form.leaveEntitlementDays),
      leaveOpeningBalance: Number(form.leaveOpeningBalance),
      active: form.active,
    };
    try {
      if (form.id === null) await sendJson('/api/shift-planning/admin/lines', 'POST', body);
      else await sendJson(`/api/shift-planning/admin/lines/${form.id}`, 'PATCH', body);
      setForm(null);
      await reload();
    } catch (err) {
      setError(message(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (line: LineView) => {
    const ok = await confirm({ title: `Remove ${line.code} from the roster?`, message: 'This only works for a line with no roster history.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/shift-planning/admin/lines/${line.id}`, 'DELETE');
      setForm(null);
      await reload();
    } catch (err) {
      setError(message(err, 'Could not remove the line.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {dialog}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">The rotation</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              A {cycle}-day cycle. Each person starts on a different cycle day, so every day has one person on each console shift and one on call.
            </p>
          </div>
          {rotation.length > 0 && (balanced ? <Pill tone="ok">Every cycle day is covered</Pill> : <Pill tone="danger">The stagger leaves gaps</Pill>)}
        </div>

        {rotation.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="min-w-[9rem] px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400">Cycle day</th>
                  {cycleDates.map((date, i) => (
                    <th key={date} className="px-0.5 py-1 text-center text-[10px] font-semibold text-gray-400">{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rotation.map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-1">
                      <span className="font-bold text-gray-900">{line.code}</span>
                      <span className="ml-2 text-gray-400">starts day {(line.cycleOffset as number) + 1}</span>
                    </td>
                    {cycleDates.map((date) => {
                      const code = generatedCode(rules, line.cycleOffset as number, date);
                      return (
                        <td key={date} className="p-0.5">
                          <span className={`flex h-7 w-8 items-center justify-center rounded-md text-[11px] font-bold ${CODE_STYLE[code].chip}`}>{code}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Cover</td>
                  {cover.map((problems, i) => (
                    <td key={i} className="pt-2 text-center text-[10px] font-semibold" title={problems.map((p) => `${p.code}: ${p.count}`).join(', ')}>
                      {problems.length === 0 ? <span className="text-emerald-600">✓</span> : <span className="text-rose-600">{problems.map((p) => (p.count === 0 ? `no ${p.code}` : `${p.count}×${p.code}`)).join(' ')}</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-gray-400">Shown for the first cycle, from {formatDay(rules.rotationStart)}. The rotation carries on from there without restarting.</p>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">People on the roster</h2>
          <button type="button" className={primaryButton} onClick={openNew}>
            Add person
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="px-5 pb-10 pt-4 text-center text-sm text-gray-400">No one is on the roster yet. Add the first person to start the rotation.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50/60 text-left text-xs text-gray-400">
                  {['Line', 'Person', 'Role', 'Rotation', 'On the roster', 'Contract', 'Leave / year', ''].map((h) => (
                    <th key={h} className="px-5 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-3 font-bold text-gray-900">{line.code}</td>
                    <td className="px-5 py-3">
                      {line.userId ? (
                        <>
                          <div className="font-medium text-gray-900">{line.name}</div>
                          <div className="text-xs text-gray-400">{line.email}</div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-gray-900">{line.displayName || 'Vacant'}</div>
                          <div className="text-xs text-amber-600">No login linked, so nobody sees these shifts</div>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{ROLE_LABEL[line.role]}</td>
                    <td className="px-5 py-3 text-gray-600">{line.cycleOffset === null ? <span className="text-gray-400">Not in rotation</span> : `Starts on day ${line.cycleOffset + 1}`}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {!line.active ? (
                        <Pill tone="muted">Inactive</Pill>
                      ) : line.startDate || line.endDate ? (
                        `${line.startDate ? formatDay(line.startDate, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Start'} → ${line.endDate ? formatDay(line.endDate, { day: 'numeric', month: 'short', year: 'numeric' }) : 'open'}`
                      ) : (
                        <Pill tone="ok">Active</Pill>
                      )}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-gray-600">{formatHours(line.contractHoursPerWeek)} h/wk</td>
                    <td className="px-5 py-3 tabular-nums text-gray-600">{formatHours(line.leaveEntitlementDays)} days</td>
                    <td className="px-5 py-3 text-right">
                      <button type="button" className="text-sm font-semibold text-[#03458f] hover:underline" onClick={() => { setError(null); setForm(formOf(line)); }}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {error && !form && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {form && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 sm:items-center">
          <form onSubmit={submit} className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <h3 className="text-base font-semibold text-gray-900">{form.id === null ? 'Add a person to the roster' : `Edit ${form.code}`}</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 px-6 py-5">
              <div>
                <Label>Roster code *</Label>
                <input className={inputClass} required maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="TRC-1" autoFocus />
              </div>
              <div>
                <Label>Role</Label>
                <select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {LINE_ROLES.map((role) => (
                    <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <Label>Login account (sees this line as “My shifts”)</Label>
                <select className={inputClass} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                  <option value="">No account linked</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id} disabled={u.lineId !== null && u.lineId !== form.id}>
                      {u.name} · {u.email}{u.lineId !== null && u.lineId !== form.id ? ' (already on the roster)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {!form.userId && (
                <div className="col-span-2">
                  <Label>Name to show (leave empty for a vacancy)</Label>
                  <input className={inputClass} maxLength={80} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
                </div>
              )}
              <div className="col-span-2">
                <Label>Starts the rotation on</Label>
                <select className={inputClass} value={form.cycleOffset} onChange={(e) => setForm({ ...form, cycleOffset: e.target.value })}>
                  <option value="">Not in the rotation (fallback cover only)</option>
                  {rules.pattern.map((code, i) => (
                    <option key={i} value={i}>
                      Cycle day {i + 1} · {rules.codes[code].name} on {formatDay(rules.rotationStart)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>On the roster from</Label>
                <input type="date" className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <Label>Until (leave empty if open)</Label>
                <input type="date" className={inputClass} value={form.endDate} min={form.startDate || undefined} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div>
                <Label>Contract hours / week</Label>
                <input type="number" step="0.5" min="0" max="168" className={inputClass} value={form.contractHoursPerWeek} onChange={(e) => setForm({ ...form, contractHoursPerWeek: e.target.value })} />
              </div>
              <div>
                <Label>Leave entitlement (days / year)</Label>
                <input type="number" step="0.5" min="0" className={inputClass} value={form.leaveEntitlementDays} onChange={(e) => setForm({ ...form, leaveEntitlementDays: e.target.value })} />
              </div>
              <div>
                <Label>Leave opening balance (days)</Label>
                <input type="number" step="0.5" className={inputClass} value={form.leaveOpeningBalance} onChange={(e) => setForm({ ...form, leaveOpeningBalance: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Active on the roster
              </label>
              {error && <p className="col-span-2 text-sm text-rose-600">{error}</p>}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
              {form.id !== null ? (
                <button type="button" disabled={busy} className="text-sm font-semibold text-rose-600 hover:underline disabled:opacity-50" onClick={() => { const line = lines.find((l) => l.id === form.id); if (line) void remove(line); }}>
                  Remove from roster
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-3">
                <button type="button" className={ghostButton} onClick={() => setForm(null)}>
                  Cancel
                </button>
                <button type="submit" className={primaryButton} disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
