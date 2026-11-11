'use client';

import { type FormEvent, useState } from 'react';

import { CODE_STYLE, Card, Label, formatDay, inputClass, primaryButton } from '@/app/modules/_components/shift-ui';
import { useConfirm } from '@/app/ui/confirm-dialog';
import { EXTRA_CODE_LENGTH, type ExtraCode, MAX_EXTRA_CODES, SHIFT_CODES, type ShiftCode, type ShiftRules, isConsole, isWorking, spanHours } from '@/lib/shift-rules';
import type { AdminOverview } from '@/lib/shift-types';

import { message, sendJson } from './api';

interface Props {
  data: AdminOverview;
  reload: () => Promise<void>;
}

const PATTERN_CODES: ShiftCode[] = ['D', 'S', 'N', 'OC', 'X'];

/** What one of the roster's own codes can count as, in the words a scheduler would use. */
const COUNTS_AS: Record<ShiftCode, string> = {
  D: 'Day shift',
  S: 'Swing shift',
  N: 'Night shift',
  W: 'A working day',
  OC: 'On call',
  X: 'Off',
  LV: 'Leave',
};
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type Limit = 'targetHours7d' | 'maxHours7d' | 'maxHours14d' | 'minRestHours' | 'maxConsecutiveDuties' | 'responseMinutes' | 'leaveCapDays' | 'publishLeadDays';

const LIMITS: Array<{ key: Limit; label: string; hint: string }> = [
  { key: 'targetHours7d', label: 'Weekly target (hours)', hint: 'Warn when any 7 days go above this.' },
  { key: 'maxHours7d', label: 'Weekly limit (hours)', hint: 'Block above this; hours beyond it are overtime at 1.5x.' },
  { key: 'maxHours14d', label: 'Two-week cap (hours)', hint: 'Warn when any 14 days go above this.' },
  { key: 'minRestHours', label: 'Rest between duties (hours)', hint: 'Block a duty that starts sooner.' },
  { key: 'maxConsecutiveDuties', label: 'Consecutive duties (days)', hint: 'Warn on more days running than this.' },
  { key: 'responseMinutes', label: 'Call-in response (minutes)', hint: 'A slower arrival is flagged.' },
  { key: 'leaveCapDays', label: 'Leave balance cap (days)', hint: 'A higher balance is flagged.' },
  { key: 'publishLeadDays', label: 'Publish ahead (days)', hint: 'A month is due this long before it starts.' },
];

export default function SettingsTab({ data, reload }: Props) {
  const { confirm, dialog } = useConfirm();
  const [rules, setRules] = useState<ShiftRules>(data.rules);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [holiday, setHoliday] = useState({ date: '', name: '' });
  const [holidayError, setHolidayError] = useState<string | null>(null);

  const dirty = JSON.stringify(rules) !== JSON.stringify(data.rules);
  const consoleDays = rules.pattern.filter(isConsole).length;
  const onCallDays = rules.pattern.filter((c) => c === 'OC').length;
  const cycleHours = rules.pattern.reduce((sum, code) => sum + (isConsole(code) ? rules.codes[code].hours : 0), 0);

  const setPattern = (pattern: ShiftCode[]) => setRules({ ...rules, pattern });
  const setCode = (code: ShiftCode, patch: Partial<ShiftRules['codes'][ShiftCode]>) => {
    const next = { ...rules.codes[code], ...patch };
    // Hours follow the times unless someone has typed a different figure.
    if ((patch.start !== undefined || patch.end !== undefined) && next.start && next.end) next.hours = spanHours(next.start, next.end);
    setRules({ ...rules, codes: { ...rules.codes, [code]: next } });
  };

  const setExtra = (index: number, patch: Partial<ExtraCode>) => {
    setRules({
      ...rules,
      extra: rules.extra.map((extra, i) => {
        if (i !== index) return extra;
        const next = { ...extra, ...patch };
        // Only a working code keeps hours of its own.
        return isWorking(next.as) ? next : { ...next, start: null, end: null, hours: null };
      }),
    });
  };
  const addExtra = () => setRules({ ...rules, extra: [...rules.extra, { code: '', name: '', as: 'W', start: null, end: null, hours: null }] });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await sendJson('/api/shift-planning/admin/config', 'PUT', rules);
      await reload();
      setNote({ tone: 'ok', text: 'Rules saved. Months already generated keep their shifts; reset a draft month to rebuild it from the new pattern.' });
    } catch (err) {
      setNote({ tone: 'danger', text: message(err, 'Could not save the rules.') });
    } finally {
      setBusy(false);
    }
  };

  const addHoliday = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setHolidayError(null);
    try {
      await sendJson('/api/shift-planning/admin/holidays', 'POST', holiday);
      setHoliday({ date: '', name: '' });
      await reload();
    } catch (err) {
      setHolidayError(message(err, 'Could not add the holiday.'));
    } finally {
      setBusy(false);
    }
  };

  const removeHoliday = async (id: string, name: string) => {
    if (!(await confirm({ title: `Remove ${name}?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    setBusy(true);
    setHolidayError(null);
    try {
      await sendJson(`/api/shift-planning/admin/holidays/${id}`, 'DELETE');
      await reload();
    } catch (err) {
      setHolidayError(message(err, 'Could not remove the holiday.'));
    } finally {
      setBusy(false);
    }
  };

  const years = [...new Set(data.holidays.map((h) => h.date.slice(0, 4)))].sort().reverse();

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {dialog}

      <form onSubmit={save} className="space-y-4 xl:col-span-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Rotation pattern</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            The shift each person works on each day of the cycle. A {rules.pattern.length}-day cycle with {consoleDays} console shift{consoleDays === 1 ? '' : 's'} ({cycleHours} hours) and {onCallDays} on-call day{onCallDays === 1 ? '' : 's'}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {rules.pattern.map((code, i) => (
              <div key={i} className="text-center">
                <p className="mb-1 text-[10px] font-semibold text-gray-400">{i + 1}</p>
                <select
                  aria-label={`Cycle day ${i + 1}`}
                  className={`h-9 w-14 cursor-pointer appearance-none rounded-lg text-center text-xs font-bold outline-none focus:ring-2 focus:ring-[#03458f] ${CODE_STYLE[code].chip}`}
                  value={code}
                  onChange={(e) => setPattern(rules.pattern.map((c, j) => (j === i ? (e.target.value as ShiftCode) : c)))}
                >
                  {PATTERN_CODES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ))}
            <div className="flex items-end gap-1 pb-0.5">
              <button type="button" className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50" onClick={() => setPattern([...rules.pattern, 'X'])}>
                + Day
              </button>
              <button type="button" disabled={rules.pattern.length <= 2} className="h-9 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40" onClick={() => setPattern(rules.pattern.slice(0, -1))}>
                − Day
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Rotation start (cycle day 1)</Label>
              <input type="date" required className={inputClass} value={rules.rotationStart} onChange={(e) => setRules({ ...rules, rotationStart: e.target.value })} />
            </div>
            <div>
              <Label>Roster time zone</Label>
              <input className={inputClass} required value={rules.timeZone} onChange={(e) => setRules({ ...rules, timeZone: e.target.value })} placeholder="Africa/Nairobi" />
            </div>
            <div>
              <Label>Payroll week starts on</Label>
              <select className={inputClass} value={rules.weekStart} onChange={(e) => setRules({ ...rules, weekStart: Number(e.target.value) })}>
                {WEEKDAYS.map((day, i) => (
                  <option key={day} value={i + 1}>{day}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-gray-400">The rotation runs continuously from the start date. A new month carries on from the previous one; it never restarts.</p>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Shift times</h2>
          <p className="mt-0.5 text-sm text-gray-500">A finish at or before the start runs into the next day. A night shift is dated, and its hours booked, on the day it starts. W is a working day away from the console.</p>
          <div className="mt-4 space-y-3">
            {SHIFT_CODES.filter(isWorking).map((code) => (
              <div key={code} className="grid grid-cols-[2.5rem_1fr_1fr_1fr_5rem] items-end gap-3">
                <span className={`flex h-9 items-center justify-center rounded-lg text-xs font-bold ${CODE_STYLE[code].chip}`}>{code}</span>
                <div>
                  <Label>Name</Label>
                  <input className={inputClass} maxLength={30} value={rules.codes[code].name} onChange={(e) => setCode(code, { name: e.target.value })} />
                </div>
                <div>
                  <Label>Start</Label>
                  <input type="time" required className={inputClass} value={rules.codes[code].start ?? ''} onChange={(e) => setCode(code, { start: e.target.value })} />
                </div>
                <div>
                  <Label>Finish</Label>
                  <input type="time" required className={inputClass} value={rules.codes[code].end ?? ''} onChange={(e) => setCode(code, { end: e.target.value })} />
                </div>
                <div>
                  <Label>Hours</Label>
                  <input type="number" step="0.25" min="0.25" max="24" className={inputClass} value={rules.codes[code].hours} onChange={(e) => setCode(code, { hours: Number(e.target.value) })} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Your own codes</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Codes your roster uses beside the built-in ones, such as SOC-D or INT. Each shows on the roster as written and follows the rules of what it counts as. Leave the times empty to use the times of that shift.
          </p>
          <div className="mt-4 space-y-3">
            {rules.extra.length === 0 && <p className="text-sm text-gray-300">None yet. Uploading a roster adds the codes it uses.</p>}
            {rules.extra.map((extra, i) => {
              const saved = data.rules.extra.some((old) => old.code === extra.code);
              const working = isWorking(extra.as);
              return (
                <div key={i} className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[6rem_1fr_9.5rem_6.5rem_6.5rem_4.5rem_auto]">
                  <div>
                    <Label>Code</Label>
                    {saved ? (
                      <span className={`flex h-[2.375rem] items-center justify-center rounded-lg px-2 text-xs font-bold ${CODE_STYLE[extra.as].chip}`}>{extra.code}</span>
                    ) : (
                      <input aria-label="Code" required className={`${inputClass} uppercase`} maxLength={EXTRA_CODE_LENGTH} value={extra.code} onChange={(e) => setExtra(i, { code: e.target.value.toUpperCase().trim() })} placeholder="e.g. WT" />
                    )}
                  </div>
                  <div>
                    <Label>Name</Label>
                    <input aria-label={`Name of ${extra.code || 'the code'}`} className={inputClass} maxLength={30} value={extra.name} onChange={(e) => setExtra(i, { name: e.target.value })} placeholder={extra.code || 'What it stands for'} />
                  </div>
                  <div>
                    <Label>Counts as</Label>
                    <select aria-label={`What ${extra.code || 'the code'} counts as`} className={inputClass} value={extra.as} onChange={(e) => setExtra(i, { as: e.target.value as ShiftCode })}>
                      {SHIFT_CODES.map((code) => (
                        <option key={code} value={code}>{COUNTS_AS[code]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Start</Label>
                    <input type="time" aria-label={`Start of ${extra.code}`} disabled={!working} className={inputClass} value={extra.start ?? ''} onChange={(e) => setExtra(i, { start: e.target.value || null })} />
                  </div>
                  <div>
                    <Label>Finish</Label>
                    <input type="time" aria-label={`Finish of ${extra.code}`} disabled={!working} className={inputClass} value={extra.end ?? ''} onChange={(e) => setExtra(i, { end: e.target.value || null })} />
                  </div>
                  <div>
                    <Label>Hours</Label>
                    <input
                      type="number"
                      step="0.25"
                      min="0.25"
                      max="24"
                      aria-label={`Hours of ${extra.code}`}
                      disabled={!working}
                      className={inputClass}
                      value={extra.hours ?? ''}
                      placeholder={working ? String(extra.start && extra.end ? spanHours(extra.start, extra.end) : rules.codes[extra.as].hours) : ''}
                      onChange={(e) => setExtra(i, { hours: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </div>
                  <button type="button" aria-label={`Remove ${extra.code || 'this code'}`} className="h-[2.375rem] rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50" onClick={() => setRules({ ...rules, extra: rules.extra.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" disabled={rules.extra.length >= MAX_EXTRA_CODES} className="mt-4 h-9 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40" onClick={addExtra}>
            + Add a code
          </button>
          <p className="mt-3 text-[11px] text-gray-400">A day shift, swing shift or night shift code covers that console shift. A working day counts hours and rest without covering the console. A code that is on the roster cannot be removed.</p>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-gray-900">Limits</h2>
          <p className="mt-0.5 text-sm text-gray-500">Every check on the roster reads these. Confirm statutory figures with counsel or payroll before changing them.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LIMITS.map(({ key, label, hint }) => (
              <div key={key}>
                <Label>{label}</Label>
                <input type="number" min="0" required className={inputClass} value={rules[key]} onChange={(e) => setRules({ ...rules, [key]: Number(e.target.value) })} />
                <p className="mt-1 text-[11px] leading-snug text-gray-400">{hint}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {note && <p className={`mr-auto text-sm ${note.tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>{note.text}</p>}
          {dirty && (
            <button type="button" className="text-sm font-semibold text-gray-500 hover:underline" onClick={() => setRules(data.rules)}>
              Undo changes
            </button>
          )}
          <button type="submit" className={primaryButton} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save rules'}
          </button>
        </div>
      </form>

      <Card className="h-fit p-5">
        <h2 className="text-sm font-semibold text-gray-900">Public holidays</h2>
        <p className="mt-0.5 text-sm text-gray-500">Hours worked on these dates are flagged for payroll at 2x. A holiday falling on a Sunday is observed on the Monday: add the Monday.</p>
        <form onSubmit={addHoliday} className="mt-4 space-y-2">
          <div className="grid grid-cols-[9.5rem_1fr] gap-2">
            <input type="date" required aria-label="Holiday date" className={inputClass} value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} />
            <input required aria-label="Holiday name" maxLength={80} className={inputClass} value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} placeholder="e.g. Jamhuri Day" />
          </div>
          <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
            Add holiday
          </button>
          {holidayError && <p className="text-xs text-rose-600">{holidayError}</p>}
        </form>
        <div className="mt-5 space-y-4">
          {years.length === 0 && <p className="text-sm text-gray-300">No holidays yet.</p>}
          {years.map((year) => (
            <div key={year}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{year}</p>
              <ul className="space-y-1">
                {data.holidays
                  .filter((h) => h.date.startsWith(year))
                  .map((h) => (
                    <li key={h.id} className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                      <span className="min-w-0">
                        <span className="block truncate text-gray-800">{h.name}</span>
                        <span className="text-xs text-gray-400">{formatDay(h.date)}</span>
                      </span>
                      <button type="button" disabled={busy} aria-label={`Remove ${h.name}`} className="text-xs font-semibold text-rose-600 opacity-0 transition group-hover:opacity-100 focus:opacity-100" onClick={() => void removeHoliday(h.id, h.name)}>
                        Remove
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
