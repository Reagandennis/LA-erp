'use client';

import { type FormEvent, useMemo, useState } from 'react';

import {
  CODE_STYLE,
  Card,
  Label,
  Legend,
  MonthStatusPill,
  Pill,
  RosterGrid,
  codeTimes,
  formatDay,
  formatMonth,
  ghostButton,
  inputClass,
  primaryButton,
} from '@/app/modules/_components/shift-ui';
import { useConfirm } from '@/app/ui/confirm-dialog';
import {
  CALL_IN_TRIGGERS,
  CODE_KIND,
  CONSOLE_CODES,
  RULE_LABEL,
  SHIFT_CODES,
  TRIGGER_LABEL,
  type CallInTrigger,
  type RosterCell,
  type Severity,
  type ShiftCode,
  type Violation,
  isConsole,
  monthDates,
  monthOf,
  newViolations,
  validateRoster,
} from '@/lib/shift-rules';
import { type AdminOverview, type LineView, type RecordView, type SaveResult, buildLookup, indexRecords, recordKey } from '@/lib/shift-types';

import { message, saveChecked, sendJson } from './api';

interface Props {
  data: AdminOverview;
  reload: (month?: string) => Promise<void>;
  onOpenPeople: () => void;
}

interface CellRef {
  lineId: number;
  date: string;
}

type Notice = { tone: 'ok' | 'danger'; text: string } | null;

const hasActuals = (record: RecordView) => Boolean(record.callIn) || ['worked', 'sick', 'no-show', 'call-in'].includes(record.status);

export default function RosterTab({ data, reload, onOpenPeople }: Props) {
  const { rules, lines, month, today, holidays } = data;
  const dates = useMemo(() => monthDates(month.month), [month.month]);
  const index = useMemo(() => indexRecords(data.records), [data.records]);
  const { confirm, dialog } = useConfirm();

  const [draft, setDraft] = useState<Map<string, ShiftCode>>(new Map());
  const [draftKind, setDraftKind] = useState<'override' | 'swap'>('override');
  const [menu, setMenu] = useState<(CellRef & { x: number; y: number }) | null>(null);
  const [callIn, setCallIn] = useState<CellRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [reason, setReason] = useState('');
  const [forceReason, setForceReason] = useState('');
  /** What the server said when it stopped a save or a publish. */
  const [conflict, setConflict] = useState<SaveResult | null>(null);
  const [publishStop, setPublishStop] = useState<SaveResult | null>(null);

  const gridLines = useMemo(
    () => lines.filter((line) => line.active || dates.some((date) => index.has(recordKey(line.id, date)))),
    [lines, dates, index],
  );
  const rotationLines = lines.filter((line) => line.active && line.cycleOffset !== null);

  // The same rules the server saves through, run live on the saved roster and on the draft.
  const { current, fresh } = useMemo(() => {
    if (month.status === 'none') return { current: [] as Violation[], fresh: [] as Violation[] };
    const from = dates[0] as string;
    const to = dates[dates.length - 1] as string;
    const generated = new Set(data.generatedMonths);
    const isGenerated = (date: string) => generated.has(monthOf(date));
    const saved = validateRoster(rules, lines, buildLookup(index), from, to, isGenerated);
    if (draft.size === 0) return { current: saved, fresh: [] as Violation[] };
    const patches = new Map<string, Partial<RosterCell>>([...draft].map(([key, code]) => [key, { planned: code }]));
    const drafted = validateRoster(rules, lines, buildLookup(index, patches), from, to, isGenerated);
    return { current: drafted, fresh: newViolations(saved, drafted) };
  }, [month.status, dates, data.generatedMonths, rules, lines, index, draft]);

  const { flaggedDates, flaggedCells } = useMemo(() => {
    const byDate = new Map<string, Severity>();
    const byCell = new Map<string, Severity>();
    const put = (map: Map<string, Severity>, key: string, severity: Severity) => {
      if (map.get(key) !== 'block') map.set(key, severity);
    };
    for (const v of current) {
      if (v.lineId === null) put(byDate, v.date, v.severity);
      else put(byCell, recordKey(v.lineId, v.date), v.severity);
    }
    return { flaggedDates: byDate, flaggedCells: byCell };
  }, [current]);

  const blocks = current.filter((v) => v.severity === 'block');
  const warnings = current.filter((v) => v.severity === 'warn');
  const trayBlocks = conflict?.blocks ?? fresh.filter((v) => v.severity === 'block');
  const trayWarnings = conflict?.warnings ?? fresh.filter((v) => v.severity === 'warn');

  // --- Draft ---

  const editDraft = (edit: (next: Map<string, ShiftCode>) => void, kind: 'override' | 'swap' = 'override') => {
    const next = new Map(draft);
    edit(next);
    setDraftKind(draft.size === 0 ? kind : kind === 'swap' && draftKind === 'swap' ? 'swap' : 'override');
    setDraft(next);
    setConflict(null);
    setNotice(null);
  };

  const setCode = (cell: CellRef, code: ShiftCode) => {
    const key = recordKey(cell.lineId, cell.date);
    const record = index.get(key);
    if (!record) return;
    editDraft((next) => {
      if (code === record.plannedCode) next.delete(key);
      else next.set(key, code);
    });
    setMenu(null);
  };

  const swap = (cell: CellRef, otherLineId: number) => {
    const a = recordKey(cell.lineId, cell.date);
    const b = recordKey(otherLineId, cell.date);
    const recordA = index.get(a);
    const recordB = index.get(b);
    if (!recordA || !recordB) return;
    const codeA = draft.get(a) ?? recordA.plannedCode;
    const codeB = draft.get(b) ?? recordB.plannedCode;
    editDraft((next) => {
      for (const [key, record, code] of [[a, recordA, codeB], [b, recordB, codeA]] as const) {
        if (code === record.plannedCode) next.delete(key);
        else next.set(key, code);
      }
    }, 'swap');
    setMenu(null);
  };

  const discard = () => {
    setDraft(new Map());
    setConflict(null);
    setReason('');
    setForceReason('');
  };

  const run = async (work: () => Promise<Notice | void>, failure: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      if (result) setNotice(result);
    } catch (e) {
      setNotice({ tone: 'danger', text: message(e, failure) });
    } finally {
      setBusy(false);
    }
  };

  const save = (force: boolean) =>
    run(async () => {
      const changes = [...draft].map(([key, code]) => {
        const [lineId, date] = key.split('|') as [string, string];
        return { lineId: Number(lineId), date, code };
      });
      const result = await saveChecked('/api/shift-planning/admin/changes', {
        changes,
        reason,
        kind: draftKind,
        // The tray lists every warning beside the Save button, so saving confirms them.
        confirmWarnings: true,
        forceReason: force ? forceReason : null,
      });
      if (!result.saved) {
        setConflict(result);
        return;
      }
      discard();
      await reload();
      return { tone: 'ok', text: `Saved ${changes.length} change${changes.length === 1 ? '' : 's'}.` };
    }, 'Could not save the changes.');

  // --- Month actions ---

  const monthAction = (action: string, extra: Record<string, unknown> = {}) =>
    sendJson<{ confirmed?: number }>('/api/shift-planning/admin/months', 'POST', { month: month.month, action, ...extra });

  const generate = () =>
    run(async () => {
      await monthAction('generate');
      await reload();
      return { tone: 'ok', text: `${formatMonth(month.month)} is generated from the rotation. Review it, then publish.` };
    }, 'Could not generate the month.');

  const reset = async () => {
    const ok = await confirm({
      title: `Reset ${formatMonth(month.month)} to the rotation?`,
      message: 'Every manual change in this month is discarded and the roster is rebuilt from the pattern. Approved leave is applied again.',
      confirmLabel: 'Reset month',
      tone: 'danger',
    });
    if (!ok) return;
    await run(async () => {
      await monthAction('reset');
      discard();
      await reload();
      return { tone: 'ok', text: 'The month was rebuilt from the rotation.' };
    }, 'Could not reset the month.');
  };

  const publish = (force: boolean) =>
    run(async () => {
      const result = await saveChecked('/api/shift-planning/admin/months', {
        month: month.month,
        action: 'publish',
        forceReason: force ? forceReason : null,
      });
      if (!result.saved) {
        setPublishStop(result);
        return;
      }
      setPublishStop(null);
      setForceReason('');
      await reload();
      return { tone: 'ok', text: `${formatMonth(month.month)} is published. Staff can see it now.` };
    }, 'Could not publish the month.');

  const unpublish = async () => {
    const ok = await confirm({
      title: `Unpublish ${formatMonth(month.month)}?`,
      message: 'Staff will no longer see this month until it is published again.',
      confirmLabel: 'Unpublish',
      tone: 'danger',
    });
    if (!ok) return;
    await run(async () => {
      await monthAction('unpublish');
      await reload();
    }, 'Could not unpublish the month.');
  };

  const confirmWorked = () =>
    run(async () => {
      const { confirmed = 0 } = await monthAction('confirm-worked');
      await reload();
      return {
        tone: 'ok',
        text: confirmed ? `Confirmed ${confirmed} past shift${confirmed === 1 ? '' : 's'} as worked to plan.` : 'There were no unconfirmed past shifts.',
      };
    }, 'Could not confirm the shifts.');

  // --- Actuals and call-ins (saved at once, not drafted) ---

  const recordActual = (cell: CellRef, status: string, times?: { actualStart: string; actualEnd: string }) =>
    run(async () => {
      await sendJson('/api/shift-planning/admin/actuals', 'POST', { ...cell, status, ...times });
      setMenu(null);
      await reload();
    }, 'Could not record that.');

  const cancelCallIn = (cell: CellRef) =>
    run(async () => {
      await sendJson(`/api/shift-planning/admin/call-ins?lineId=${cell.lineId}&date=${cell.date}`, 'DELETE');
      setMenu(null);
      await reload();
    }, 'Could not cancel the call-in.');

  // --- Render ---

  if (rotationLines.length === 0 && month.status === 'none') {
    return (
      <Card className="p-10 text-center">
        <h2 className="text-lg font-semibold text-gray-900">Add people to the rotation first</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
          The roster is generated from the rotation pattern, one line per person. Add each person and the cycle day they start on, then come back to generate the month.
        </p>
        <button type="button" className={`${primaryButton} mt-6`} onClick={onOpenPeople}>
          Add people
        </button>
      </Card>
    );
  }

  const menuRecord = menu ? index.get(recordKey(menu.lineId, menu.date)) : undefined;
  const menuLine = menu ? lines.find((l) => l.id === menu.lineId) : undefined;
  const callInRecord = callIn ? index.get(recordKey(callIn.lineId, callIn.date)) : undefined;
  const callInLine = callIn ? lines.find((l) => l.id === callIn.lineId) : undefined;

  return (
    <div className="space-y-4 pb-28">
      {dialog}

      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-900">{formatMonth(month.month)}</h2>
          <MonthStatusPill month={month} today={today} />
          {month.status !== 'published' && (
            <span className="text-xs text-gray-400">Publish by {formatDay(month.publishDue)} ({rules.publishLeadDays} days before the month starts)</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {month.status === 'none' && (
            <button type="button" className={primaryButton} disabled={busy} onClick={() => void generate()}>
              Generate from rotation
            </button>
          )}
          {month.status !== 'none' && (
            <>
              <button type="button" className={ghostButton} disabled={busy} onClick={() => void confirmWorked()} title="Marks every past shift nobody has touched as worked to plan">
                Confirm past shifts worked
              </button>
              <button type="button" className={ghostButton} disabled={busy} onClick={() => void generate()} title="Adds anyone who joined the rotation since this month was generated">
                Fill missing
              </button>
            </>
          )}
          {month.status === 'draft' && (
            <>
              <button type="button" className={ghostButton} disabled={busy} onClick={() => void reset()}>
                Reset to rotation
              </button>
              <button type="button" className={primaryButton} disabled={busy || draft.size > 0} onClick={() => void publish(false)} title={draft.size > 0 ? 'Save or discard your changes first' : undefined}>
                Publish to staff
              </button>
            </>
          )}
          {month.status === 'published' && (
            <button type="button" className={ghostButton} disabled={busy} onClick={() => void unpublish()}>
              Unpublish
            </button>
          )}
        </div>
      </Card>

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
          {notice.text}
        </div>
      )}

      {publishStop && (
        <Card className="border-rose-200 p-5">
          <h3 className="text-sm font-semibold text-rose-700">This month cannot be published yet</h3>
          <p className="mt-1 text-sm text-gray-500">Fix these on the roster, or approve them with a reason. An approval is recorded in the compliance log.</p>
          <ViolationList items={publishStop.blocks} />
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <Label>Reason for publishing anyway</Label>
              <input className={inputClass} value={forceReason} onChange={(e) => setForceReason(e.target.value)} placeholder="e.g. One line vacant until the new hire starts" />
            </div>
            <button type="button" className={ghostButton} onClick={() => { setPublishStop(null); setForceReason(''); }}>
              Go back and fix
            </button>
            <button type="button" className={`${primaryButton} !bg-rose-600`} disabled={busy || !forceReason.trim()} onClick={() => void publish(true)}>
              Approve and publish
            </button>
          </div>
        </Card>
      )}

      {month.status === 'none' ? (
        <Card className="px-6 py-16 text-center">
          <h3 className="text-base font-semibold text-gray-900">{formatMonth(month.month)} has not been generated</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500">
            Generating builds every shift from the rotation for {rotationLines.length} {rotationLines.length === 1 ? 'person' : 'people'}, carrying on from where the previous month ended. Nothing is visible to staff until you publish.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <RosterGrid
              rules={rules}
              lines={gridLines}
              dates={dates}
              records={index}
              holidays={holidays}
              today={today}
              draft={draft}
              flaggedCells={flaggedCells}
              flaggedDates={flaggedDates}
              activeKey={menu ? recordKey(menu.lineId, menu.date) : null}
              onCellClick={(line, date, anchor) => {
                const rect = anchor.getBoundingClientRect();
                const width = 304;
                const height = 440;
                setMenu({
                  lineId: line.id,
                  date,
                  x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                  y: rect.bottom + height > window.innerHeight ? Math.max(8, rect.top - height) : rect.bottom + 6,
                });
              }}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <Legend rules={rules} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#f9b232]" /> changed from rotation</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> called in</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-emerald-500" /> worked</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded ring-2 ring-rose-400" /> rule broken</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-gray-900">Checks</h3>
              {blocks.length === 0 && warnings.length === 0 ? (
                <Pill tone="ok">All rules pass</Pill>
              ) : (
                <>
                  {blocks.length > 0 && <Pill tone="danger">{blocks.length} blocking</Pill>}
                  {warnings.length > 0 && <Pill tone="warn">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</Pill>}
                </>
              )}
              {draft.size > 0 && <span className="text-xs text-gray-400">including your unsaved changes</span>}
            </div>
            {blocks.length === 0 && warnings.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">
                One person on each console shift every day, someone on call, at least {rules.minRestHours} hours between duties, no more than {rules.maxHours7d} hours in any seven days, and a full day off every week.
              </p>
            ) : (
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {blocks.length > 0 && <ViolationList title="Blocking" items={blocks} />}
                {warnings.length > 0 && <ViolationList title="Warnings" items={warnings} />}
              </div>
            )}
          </Card>
        </>
      )}

      {menu && menuRecord && menuLine && (
        <CellMenu
          key={recordKey(menu.lineId, menu.date)}
          x={menu.x}
          y={menu.y}
          line={menuLine}
          date={menu.date}
          record={menuRecord}
          drafted={draft.get(recordKey(menu.lineId, menu.date)) ?? null}
          rules={rules}
          others={gridLines.filter((l) => l.id !== menu.lineId && index.has(recordKey(l.id, menu.date)))}
          busy={busy}
          onClose={() => setMenu(null)}
          onSet={(code) => setCode(menu, code)}
          onSwap={(otherId) => swap(menu, otherId)}
          onActual={(status, times) => void recordActual(menu, status, times)}
          onCallIn={() => { setCallIn({ lineId: menu.lineId, date: menu.date }); setMenu(null); }}
          onCancelCallIn={() => void cancelCallIn(menu)}
        />
      )}

      {callIn && callInRecord && callInLine && (
        <CallInDialog
          line={callInLine}
          date={callIn.date}
          record={callInRecord}
          data={data}
          onClose={() => setCallIn(null)}
          onSaved={async () => {
            setCallIn(null);
            await reload();
            setNotice({ tone: 'ok', text: `Call-in recorded for ${callInLine.code} on ${formatDay(callIn.date)}.` });
          }}
        />
      )}

      {draft.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 shadow-[0_-8px_24px_rgba(3,69,143,0.08)] backdrop-blur lg:left-72">
          <div className="mx-auto max-w-[96rem] space-y-3 px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">
                {draft.size} unsaved change{draft.size === 1 ? '' : 's'}
              </span>
              {[...draft].slice(0, 8).map(([key, code]) => {
                const [lineId, date] = key.split('|') as [string, string];
                const record = index.get(key);
                const line = lines.find((l) => l.id === Number(lineId));
                return (
                  <span key={key} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
                    <span className="font-semibold">{line?.code}</span> {formatDay(date, { day: 'numeric', month: 'short' })}
                    <span className={`rounded px-1 text-[10px] font-bold ${record ? CODE_STYLE[record.plannedCode].chip : ''}`}>{record?.plannedCode}</span>→
                    <span className={`rounded px-1 text-[10px] font-bold ${CODE_STYLE[code].chip}`}>{code}</span>
                    <button type="button" aria-label="Undo this change" className="text-gray-400 hover:text-rose-600" onClick={() => editDraft((next) => next.delete(key))}>
                      ×
                    </button>
                  </span>
                );
              })}
              {draft.size > 8 && <span className="text-xs text-gray-400">+{draft.size - 8} more</span>}
            </div>

            {(trayBlocks.length > 0 || trayWarnings.length > 0) && (
              <div className="grid max-h-40 gap-3 overflow-y-auto lg:grid-cols-2">
                {trayBlocks.length > 0 && <ViolationList title="These changes would break a rule" items={trayBlocks} compact />}
                {trayWarnings.length > 0 && <ViolationList title="Worth a look" items={trayWarnings} compact />}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (leave, sickness, swap…)" maxLength={200} />
              </div>
              {trayBlocks.length > 0 && (
                <div className="min-w-[14rem] flex-1">
                  <input className={`${inputClass} !border-rose-300`} value={forceReason} onChange={(e) => setForceReason(e.target.value)} placeholder="To save anyway: why is the rule being overridden?" />
                </div>
              )}
              <button type="button" className={ghostButton} disabled={busy} onClick={discard}>
                Discard
              </button>
              {trayBlocks.length > 0 ? (
                <button type="button" className={`${primaryButton} !bg-rose-600`} disabled={busy || !forceReason.trim()} onClick={() => void save(true)}>
                  Approve and save
                </button>
              ) : (
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void save(false)}>
                  {busy ? 'Saving…' : trayWarnings.length > 0 ? `Save with ${trayWarnings.length} warning${trayWarnings.length === 1 ? '' : 's'}` : 'Save changes'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Rule hits -----------------------------------------------------------------------

export function ViolationList({ title, items, compact }: { title?: string; items: Violation[]; compact?: boolean }) {
  return (
    <div>
      {title && <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>}
      <ul className={`space-y-1 ${compact ? '' : 'max-h-64 overflow-y-auto pr-1'}`}>
        {items.map((v) => (
          <li key={v.key} className="flex items-start gap-2 text-sm text-gray-700">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${v.severity === 'block' ? 'bg-rose-500' : 'bg-amber-400'}`} />
            <span>
              <span className="font-medium text-gray-900">{RULE_LABEL[v.rule]}.</span> {v.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- The menu on a cell ---------------------------------------------------------------

function CellMenu({
  x,
  y,
  line,
  date,
  record,
  drafted,
  rules,
  others,
  busy,
  onClose,
  onSet,
  onSwap,
  onActual,
  onCallIn,
  onCancelCallIn,
}: {
  x: number;
  y: number;
  line: LineView;
  date: string;
  record: RecordView;
  drafted: ShiftCode | null;
  rules: AdminOverview['rules'];
  others: LineView[];
  busy: boolean;
  onClose: () => void;
  onSet: (code: ShiftCode) => void;
  onSwap: (otherLineId: number) => void;
  onActual: (status: string, times?: { actualStart: string; actualEnd: string }) => void;
  onCallIn: () => void;
  onCancelCallIn: () => void;
}) {
  const locked = hasActuals(record);
  const planned = drafted ?? record.plannedCode;
  const kind = CODE_KIND[record.plannedCode];
  const [times, setTimes] = useState<{ actualStart: string; actualEnd: string } | null>(null);
  const section = 'border-t border-gray-100 px-4 py-3';
  const action = 'rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-40';

  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
      <div className="fixed z-50 w-[19rem] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl" style={{ left: x, top: y }}>
        <div className="px-4 py-3">
          <p className="text-sm font-semibold text-gray-900">
            {line.code} · {formatDay(date)}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            {line.name !== line.code && `${line.name} · `}
            Rotation gives {rules.codes[record.generatedCode].name}
            {record.plannedCode !== record.generatedCode && `, rostered ${rules.codes[record.plannedCode].name}`}
            {record.reasonCode && ` (${record.reasonCode})`}
          </p>
        </div>

        <div className={section}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Roster as</p>
          <div className="grid grid-cols-6 gap-1.5">
            {SHIFT_CODES.map((code) => (
              <button
                key={code}
                type="button"
                disabled={locked}
                title={`${rules.codes[code].name} ${codeTimes(rules, code)}`}
                onClick={() => onSet(code)}
                className={`flex h-9 items-center justify-center rounded-lg text-xs font-bold transition disabled:opacity-30 ${CODE_STYLE[code].chip} ${planned === code ? 'ring-2 ring-[#03458f] ring-offset-1' : 'hover:brightness-95'}`}
              >
                {code}
              </button>
            ))}
          </div>
          {locked ? (
            <p className="mt-2 text-[11px] text-gray-400">Clear what was recorded for this day before changing the plan.</p>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <select className={`${inputClass} !py-1.5 text-xs`} value="" onChange={(e) => e.target.value && onSwap(Number(e.target.value))}>
                <option value="">Swap with…</option>
                {others.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.code}{other.name !== other.code ? ` · ${other.name}` : ''}
                  </option>
                ))}
              </select>
              {record.plannedCode !== record.generatedCode && !drafted && (
                <button type="button" className={`${action} shrink-0`} onClick={() => onSet(record.generatedCode)}>
                  Revert
                </button>
              )}
            </div>
          )}
        </div>

        {isConsole(record.plannedCode) && !record.callIn && (
          <div className={section}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              What happened <span className="font-normal normal-case text-gray-300">· now: {record.status}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={busy || Boolean(drafted)} className={action} onClick={() => onActual('worked', times ?? undefined)}>
                Worked
              </button>
              <button type="button" disabled={busy || Boolean(drafted)} className={action} onClick={() => onActual('sick')}>
                Sick
              </button>
              <button type="button" disabled={busy || Boolean(drafted)} className={action} onClick={() => onActual('no-show')}>
                No-show
              </button>
              {record.status !== 'planned' && record.status !== 'swapped' && (
                <button type="button" disabled={busy} className={`${action} text-rose-600`} onClick={() => onActual('planned')}>
                  Clear
                </button>
              )}
            </div>
            {times ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="time" aria-label="Actual start" className={`${inputClass} !py-1.5 text-xs`} value={times.actualStart} onChange={(e) => setTimes({ ...times, actualStart: e.target.value })} />
                <input type="time" aria-label="Actual finish" className={`${inputClass} !py-1.5 text-xs`} value={times.actualEnd} onChange={(e) => setTimes({ ...times, actualEnd: e.target.value })} />
              </div>
            ) : (
              <button
                type="button"
                className="mt-2 text-[11px] font-semibold text-[#03458f] hover:underline"
                onClick={() => setTimes({ actualStart: record.actualStart ?? rules.codes[record.plannedCode].start ?? '', actualEnd: record.actualEnd ?? rules.codes[record.plannedCode].end ?? '' })}
              >
                Worked different hours
              </button>
            )}
            {drafted && <p className="mt-2 text-[11px] text-gray-400">Save or undo the unsaved change first.</p>}
          </div>
        )}

        {(kind === 'on_call' || kind === 'off') && (
          <div className={section}>
            {record.callIn ? (
              <div>
                <p className="text-xs text-gray-600">
                  Called in to <span className="font-semibold">{record.workedCode ? rules.codes[record.workedCode].name : ''}</span> · {TRIGGER_LABEL[record.callIn.trigger]}
                  {record.callIn.responseMinutes !== null && ` · arrived in ${record.callIn.responseMinutes} min`}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className={action} onClick={onCallIn}>
                    Edit call-in
                  </button>
                  <button type="button" disabled={busy} className={`${action} text-rose-600`} onClick={onCancelCallIn}>
                    Cancel call-in
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={Boolean(drafted)} className={`${primaryButton} w-full !py-1.5 text-xs`} onClick={onCallIn}>
                {kind === 'off' ? 'Call in from rest day…' : 'Call in…'}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// --- Call-in ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** A Date as the value of a datetime-local input, in the browser's own zone. */
function toLocalInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function CallInDialog({
  line,
  date,
  record,
  data,
  onClose,
  onSaved,
}: {
  line: LineView;
  date: string;
  record: RecordView;
  data: AdminOverview;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { rules } = data;
  const fromRest = CODE_KIND[record.plannedCode] === 'off';
  const existing = record.callIn;
  const [form, setForm] = useState(() => {
    const code = (record.workedCode && isConsole(record.workedCode) ? record.workedCode : CONSOLE_CODES.find((c) => rules.pattern.includes(c))) ?? 'D';
    return {
      code,
      trigger: (existing?.trigger ?? 'absence') as CallInTrigger,
      calledAt: toLocalInput(existing?.calledAt ?? new Date()),
      acknowledgedAt: toLocalInput(existing?.acknowledgedAt),
      arrivedAt: toLocalInput(existing?.arrivedAt),
      releasedAt: toLocalInput(existing?.releasedAt),
      actualStart: record.actualStart ?? '',
      actualEnd: record.actualEnd ?? '',
      escalationApproved: Boolean(existing?.escalation),
      note: existing?.note ?? '',
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<SaveResult | null>(null);
  const [forceReason, setForceReason] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await saveChecked('/api/shift-planning/admin/call-ins', {
        lineId: line.id,
        date,
        code: form.code,
        trigger: form.trigger,
        calledAt: toIso(form.calledAt),
        acknowledgedAt: toIso(form.acknowledgedAt),
        arrivedAt: toIso(form.arrivedAt),
        releasedAt: toIso(form.releasedAt),
        actualStart: form.actualStart || null,
        actualEnd: form.actualEnd || null,
        escalationApproved: form.escalationApproved,
        note: form.note,
        // Shown below once the server lists them; a second submit confirms.
        confirmWarnings: Boolean(stopped),
        forceReason: stopped?.blocks.length ? forceReason : null,
      });
      if (!result.saved) {
        setStopped(result);
        return;
      }
      await onSaved();
    } catch (err) {
      setError(message(err, 'Could not record the call-in.'));
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm({ ...form, [key]: value });
    setStopped(null);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 sm:items-center">
      <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-base font-semibold text-gray-900">
            {existing ? 'Edit call-in' : 'Call in'} · {line.code} · {formatDay(date)}
          </h3>
          <p className="mt-0.5 text-sm text-gray-500">
            {line.name !== line.code && `${line.name} is `}
            {fromRest ? 'on a rest day. Calling in is an overtime escalation, paid at 2x.' : 'on call. The hours count as worked.'}
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <Label>Shift covered</Label>
            <div className="grid grid-cols-3 gap-2">
              {CONSOLE_CODES.filter((c) => rules.pattern.includes(c)).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => set('code', code)}
                  className={`rounded-xl border px-3 py-2 text-left transition ${form.code === code ? 'border-[#03458f] ring-2 ring-[#03458f]/15' : 'border-gray-200 hover:bg-gray-50'}`}
                >
                  <span className="block text-sm font-semibold text-gray-900">{rules.codes[code].name}</span>
                  <span className="block text-[11px] text-gray-400">{codeTimes(rules, code)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Reason</Label>
              <select className={inputClass} value={form.trigger} onChange={(e) => set('trigger', e.target.value as CallInTrigger)}>
                {CALL_IN_TRIGGERS.map((t) => (
                  <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Called at</Label>
              <input type="datetime-local" required className={inputClass} value={form.calledAt} onChange={(e) => set('calledAt', e.target.value)} />
            </div>
            <div>
              <Label>Acknowledged</Label>
              <input type="datetime-local" className={inputClass} value={form.acknowledgedAt} onChange={(e) => set('acknowledgedAt', e.target.value)} />
            </div>
            <div>
              <Label>Arrived (target {rules.responseMinutes} min)</Label>
              <input type="datetime-local" className={inputClass} value={form.arrivedAt} onChange={(e) => set('arrivedAt', e.target.value)} />
            </div>
            <div>
              <Label>Released</Label>
              <input type="datetime-local" className={inputClass} value={form.releasedAt} onChange={(e) => set('releasedAt', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Worked from</Label>
                <input type="time" className={inputClass} value={form.actualStart} onChange={(e) => set('actualStart', e.target.value)} />
              </div>
              <div>
                <Label>to</Label>
                <input type="time" className={inputClass} value={form.actualEnd} onChange={(e) => set('actualEnd', e.target.value)} />
              </div>
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-gray-400">Leave the worked times empty to count the full {rules.codes[form.code].hours} hours of the shift.</p>

          <div>
            <Label>Note</Label>
            <input className={inputClass} value={form.note} maxLength={300} onChange={(e) => set('note', e.target.value)} placeholder="Who is being covered, incident reference…" />
          </div>

          {fromRest && (
            <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <input type="checkbox" className="mt-0.5" checked={form.escalationApproved} onChange={(e) => set('escalationApproved', e.target.checked)} />
              <span>I approve this overtime escalation. It is recorded against my name.</span>
            </label>
          )}

          {stopped && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
              <ViolationList items={[...stopped.blocks, ...stopped.warnings]} compact />
              {stopped.blocks.length > 0 ? (
                <div className="mt-3">
                  <Label>Reason for approving this anyway</Label>
                  <input className={inputClass} value={forceReason} onChange={(e) => setForceReason(e.target.value)} />
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">Save again to go ahead with these warnings.</p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button type="button" className={ghostButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={primaryButton}
            disabled={busy || (fromRest && !form.escalationApproved) || Boolean(stopped?.blocks.length && !forceReason.trim())}
          >
            {busy ? 'Saving…' : stopped ? (stopped.blocks.length ? 'Approve and save' : 'Save anyway') : existing ? 'Save call-in' : 'Record call-in'}
          </button>
        </div>
      </form>
    </div>
  );
}

