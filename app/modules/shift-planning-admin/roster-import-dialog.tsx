'use client';

import { type DragEvent, useEffect, useRef, useState } from 'react';

import { CODE_STYLE, CodeChip, Label, Pill, formatMonth, ghostButton, inputClass, primaryButton } from '@/app/modules/_components/shift-ui';
import type { ImportCodeChoices, ImportCodeView, ImportPersonView, ImportPreview, ImportResult, ImportTarget } from '@/lib/shift-import';
import { RULE_LABEL, SHIFT_CODES, type ShiftCode, type ShiftRules, type Violation, isMonthKey } from '@/lib/shift-rules';
import type { LineView } from '@/lib/shift-types';

interface Props {
  /** The month the roster is showing; the upload starts on it. */
  month: string;
  rules: ShiftRules;
  lines: LineView[];
  onClose: () => void;
  /** The month was filled: `summary` says what was done. */
  onImported: (month: string, summary: string) => void | Promise<void>;
}

interface Request {
  file: File;
  month: string;
  sheet: string | null;
  blankAsOff: boolean;
  mapping: Record<string, ImportTarget>;
  /** What each code the roster does not know counts as, where the scheduler has chosen. */
  codes: ImportCodeChoices;
}

/** What a code of the roster's own can count as, in the order a scheduler would look for it. */
const COUNTS_AS: Array<{ value: ShiftCode | 'skip'; label: string }> = [
  { value: 'D', label: 'Day shift' },
  { value: 'S', label: 'Swing shift' },
  { value: 'N', label: 'Night shift' },
  { value: 'W', label: 'A working day (not on the console)' },
  { value: 'OC', label: 'On call' },
  { value: 'X', label: 'Off' },
  { value: 'LV', label: 'Leave' },
  { value: 'skip', label: 'Do not use this code' },
];

const ACCEPT = '.xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
const SHOWN_VIOLATIONS = 5;

async function send(request: Request, extra: { apply?: boolean; forceReason?: string } = {}): Promise<ImportResult> {
  const body = new FormData();
  body.set('file', request.file);
  body.set('month', request.month);
  if (request.sheet) body.set('sheet', request.sheet);
  if (request.blankAsOff) body.set('blankAsOff', '1');
  body.set('mapping', JSON.stringify(request.mapping));
  body.set('codes', JSON.stringify(request.codes));
  if (extra.apply) body.set('apply', '1');
  if (extra.forceReason) body.set('forceReason', extra.forceReason);
  const response = await fetch('/api/shift-planning/admin/import', { method: 'POST', body });
  const result = (await response.json().catch(() => null)) as (ImportResult & { error?: string }) | null;
  if (!response.ok || !result?.preview) throw new Error(result?.error || 'Could not read that file. Please try again.');
  return result;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Fills a month from a spreadsheet. Choosing a file shows what it would do
 * (who each row is, how many shifts change, what the rules make of it);
 * nothing is saved until the scheduler confirms.
 */
export default function RosterImportDialog({ month: initialMonth, rules, lines, onClose, onImported }: Props) {
  const [month, setMonth] = useState(initialMonth);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [blankAsOff, setBlankAsOff] = useState(false);
  const [mapping, setMapping] = useState<Record<string, ImportTarget>>({});
  const [codes, setCodes] = useState<ImportCodeChoices>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  // Only the newest read may land, so a slow answer never replaces a later one.
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Reads the file again with the choices as they now stand. */
  const read = async (next: Request) => {
    const id = (latest.current += 1);
    setReading(true);
    setError(null);
    try {
      const result = await send(next);
      if (id !== latest.current) return;
      setPreview(result.preview);
      setSheet(result.preview.sheet);
    } catch (e) {
      if (id !== latest.current) return;
      setPreview(null);
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      if (id === latest.current) setReading(false);
    }
  };

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    setFile(chosen);
    setSheet(null);
    setMapping({});
    setCodes({});
    setForceReason('');
    void read({ file: chosen, month, sheet: null, blankAsOff, mapping: {}, codes: {} });
  };

  const change = (patch: Partial<Omit<Request, 'file'>>) => {
    const next = { month, sheet, blankAsOff, mapping, codes, ...patch };
    setMonth(next.month);
    setSheet(next.sheet);
    setBlankAsOff(next.blankAsOff);
    setMapping(next.mapping);
    setCodes(next.codes);
    if (file && isMonthKey(next.month)) void read({ file, ...next });
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    choose(event.dataTransfer.files[0]);
  };

  const save = async () => {
    if (!file || !preview) return;
    setSaving(true);
    setError(null);
    try {
      // What was shown is what is saved: a guess the scheduler left standing goes in as their choice.
      const shown = Object.fromEntries(preview.newCodes.map((entry) => [entry.code, entry.as]));
      const result = await send({ file, month, sheet, blankAsOff, mapping, codes: { ...shown, ...codes } }, { apply: true, forceReason });
      await onImported(month, result.summary ?? `${formatMonth(month)} was filled from ${file.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the roster.');
      setSaving(false);
    }
  };

  const monthName = isMonthKey(month) ? formatMonth(month) : 'the month';
  const totals = preview?.totals;
  const skipped = totals ? totals.locked + totals.outside + totals.unreadable : 0;
  const ready = Boolean(preview && totals && totals.set > 0 && !reading && (!preview.needsReason || forceReason.trim()));

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-gray-900/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label="Upload a roster" className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Upload a roster</h3>
            <p className="mt-0.5 text-sm text-gray-500">Fill a month from an Excel or CSV file. You see what it will do before anything is saved.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-[15rem_1fr]">
            <div>
              <Label>Month to fill</Label>
              <input type="month" aria-label="Month to fill" className={inputClass} value={month} onChange={(e) => change({ month: e.target.value })} />
              {isMonthKey(month) && (
                <a href={`/api/shift-planning/admin/import?month=${month}`} className="mt-2 inline-block text-xs font-semibold text-[#03458f] hover:underline">
                  Download {monthName} as a template
                </a>
              )}
            </div>

            <div>
              <Label>Roster file</Label>
              <input ref={picker} type="file" accept={ACCEPT} className="hidden" aria-label="Roster file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
              <button
                type="button"
                onClick={() => picker.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
                className={`flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left transition ${dragging ? 'border-[#03458f] bg-[#03458f]/5' : 'border-gray-300 hover:border-[#03458f]/50 hover:bg-gray-50'}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#03458f]/10 text-[#03458f]">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-gray-900">{file ? file.name : 'Choose a file, or drop it here'}</span>
                  <span className="block text-xs text-gray-400">{file ? 'Click to choose a different file' : 'Excel (.xlsx) or CSV'}</span>
                </span>
              </button>
            </div>
          </div>

          {!file && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm text-gray-600">
              <p>
                One row per person, one column per day of the month. The people can be named by roster code, name or email, and the days headed 1, 2, 3… or with dates.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {SHIFT_CODES.map((code) => (
                  <span key={code} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <CodeChip rules={rules} code={code} />
                    {rules.codes[code].name}
                  </span>
                ))}
                {rules.extra.map((extra) => (
                  <span key={extra.code} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                    <CodeChip rules={rules} code={extra.code} />
                    {extra.name !== extra.code && extra.name}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-400">The words work too: “Off”, “Night”, “On call”, “Leave”. Codes of your own (such as SOC-D) are picked up from the file.</p>
            </div>
          )}

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
          {reading && !preview && <p className="text-sm text-gray-400">Reading the file…</p>}

          {preview && totals && (
            <div className={`space-y-4 ${reading ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-600">
                  Found <span className="font-semibold text-gray-900">{plural(preview.people.length, 'person', 'people')}</span> and{' '}
                  <span className="font-semibold text-gray-900">
                    {preview.days} of {preview.daysInMonth} days
                  </span>{' '}
                  of {formatMonth(preview.month)}
                  {preview.turned && ' (days down the side)'}.
                </p>
                {preview.sheets.length > 1 && (
                  <select aria-label="Sheet" className={`${inputClass} !w-auto !py-1.5 text-xs`} value={preview.sheet} onChange={(e) => change({ sheet: e.target.value })}>
                    {preview.sheets.map((name) => (
                      <option key={name} value={name}>
                        Sheet: {name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Shifts to fill" value={totals.set} strong />
                <Stat label="Already the same" value={totals.unchanged} />
                <Stat label="Left alone" value={skipped + totals.blank} hint={skipped + totals.blank > 0 ? leftAlone(totals) : undefined} />
              </div>

              {preview.newCodes.length > 0 && (
                <NewCodes codes={preview.newCodes} onChange={(code, as) => change({ codes: { ...codes, [code]: as } })} rules={rules} />
              )}

              {preview.monthStatus === 'published' && (
                <Banner tone="warn">
                  {formatMonth(preview.month)} is published. Staff see these changes as soon as you fill it.
                </Banner>
              )}
              {preview.monthStatus === 'none' && (
                <Banner tone="info">
                  {formatMonth(preview.month)} has not been generated. Filling it creates the month as a draft; staff see nothing until you publish.
                </Banner>
              )}

              <div className="overflow-hidden rounded-xl border border-gray-100 text-sm">
                <div className={`hidden bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 sm:grid ${PERSON_GRID}`}>
                  <span>In the file</span>
                  <span>On the roster</span>
                  <span className="text-right">Shifts</span>
                </div>
                <ul>
                  {preview.people.map((person) => (
                    <PersonRow
                      key={person.key}
                      person={person}
                      lines={lines}
                      onChange={(target) => change({ mapping: { ...mapping, [person.key]: target } })}
                    />
                  ))}
                </ul>
              </div>

              {(totals.blank > 0 || blankAsOff) && (
                <label className="flex items-start gap-2.5 text-sm text-gray-700">
                  <input type="checkbox" className="mt-0.5" checked={blankAsOff} onChange={(e) => change({ blankAsOff: e.target.checked })} />
                  <span>
                    Roster empty cells as Off
                    <span className="block text-xs text-gray-400">
                      {blankAsOff ? 'Every empty cell in the file becomes a rest day.' : `${plural(totals.blank, 'empty cell')} in the file ${totals.blank === 1 ? 'is' : 'are'} left as the roster has ${totals.blank === 1 ? 'it' : 'them'}.`}
                    </span>
                  </span>
                </label>
              )}

              {preview.notInFile.length > 0 && (
                <p className="text-xs text-gray-500">
                  <span className="font-semibold text-gray-700">Not in the file:</span> {preview.notInFile.join(', ')}.{' '}
                  {preview.monthStatus === 'none'
                    ? `They will have no shifts in ${formatMonth(preview.month)} until you roster them; “Fill missing” adds them from the rotation.`
                    : 'Their shifts stay as they are.'}
                </p>
              )}
              {preview.onLeave > 0 && (
                <p className="text-xs text-gray-500">
                  {plural(preview.onLeave, 'shift')} in the file {preview.onLeave === 1 ? 'falls' : 'fall'} on approved leave and will show as Leave.
                </p>
              )}

              {preview.notes.length > 0 && (
                <details className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3" open={preview.notes.length <= 4}>
                  <summary className="cursor-pointer text-sm font-semibold text-amber-900">
                    {plural(preview.notes.length + preview.moreNotes, 'thing')} in the file could not be used
                  </summary>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-amber-900">
                    {preview.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                    {preview.moreNotes > 0 && <li className="text-amber-700">…and {preview.moreNotes} more.</li>}
                  </ul>
                </details>
              )}

              <Checks preview={preview} />

              {preview.needsReason && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3">
                  <Label>
                    This adds {plural(preview.newBlocks, 'blocking problem')} to a published month. Reason for going ahead (recorded in the compliance log)
                  </Label>
                  <input className={inputClass} value={forceReason} maxLength={300} onChange={(e) => setForceReason(e.target.value)} placeholder="e.g. Agreed cover while one line is vacant" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
          <p className="text-xs text-gray-400">
            {preview && totals && totals.set === 0 ? `Nothing in this file changes ${formatMonth(preview.month)}.` : preview ? 'The upload is recorded in the audit log.' : ''}
          </p>
          <div className="flex gap-3">
            <button type="button" className={ghostButton} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={`${primaryButton} ${preview?.needsReason ? '!bg-rose-600' : ''}`} disabled={!ready || saving} onClick={() => void save()}>
              {saving ? 'Filling…' : preview?.needsReason ? `Approve and fill ${monthName}` : `Fill ${monthName}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function leftAlone(totals: ImportPreview['totals']): string {
  return [
    totals.blank > 0 && `${totals.blank} empty`,
    totals.locked > 0 && `${totals.locked} already worked`,
    totals.unreadable > 0 && `${totals.unreadable} not a shift code`,
    totals.outside > 0 && `${totals.outside} outside service dates`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Stat({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${strong ? 'border-[#03458f]/20 bg-[#03458f]/[0.04]' : 'border-gray-100 bg-white'}`}>
      <p className="text-[11px] font-medium text-gray-400">{label}</p>
      <p className={`text-xl font-semibold ${strong ? 'text-[#03458f]' : 'text-gray-900'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-gray-400">{hint}</p>}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'info'; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border px-4 py-2.5 text-sm ${tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-100 bg-blue-50/60 text-[#03458f]'}`}>
      {children}
    </div>
  );
}

/** File name, who they are on the roster, shifts: three columns, stacked on a phone. */
const PERSON_GRID = 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_7.5rem] sm:gap-4';

/**
 * Codes the file uses that the roster has not met. They are added to the
 * roster and shown as written; what each counts as decides its colour and
 * which rules apply to it.
 */
function NewCodes({ codes, rules, onChange }: { codes: ImportCodeView[]; rules: ShiftRules; onChange: (code: string, as: ShiftCode | 'skip') => void }) {
  return (
    <div className="rounded-xl border border-[#03458f]/20 bg-[#03458f]/[0.03] px-4 py-3">
      <p className="text-sm font-semibold text-gray-900">
        {codes.length === 1 ? 'This file uses a code' : `This file uses ${codes.length} codes`} the roster has not seen before
      </p>
      <p className="mt-0.5 text-xs text-gray-500">
        {codes.length === 1 ? 'It is' : 'They are'} added to the roster and shown exactly as written. Check what each one counts as: that sets its colour, and whether its hours and rest are counted. You can name them and set their times later under Rules &amp; holidays.
      </p>
      <ul className="mt-3 space-y-2">
        {codes.map((entry) => (
          <li key={entry.code} className="grid grid-cols-[5.5rem_1fr] items-center gap-3 sm:grid-cols-[5.5rem_6rem_1fr]">
            <span className={`flex h-8 items-center justify-center whitespace-nowrap rounded-lg px-2 text-xs font-bold ${entry.as === 'skip' ? 'bg-gray-100 text-gray-400 line-through' : CODE_STYLE[entry.as].chip}`}>{entry.code}</span>
            <span className="hidden text-xs text-gray-400 sm:block">
              {entry.count} {entry.count === 1 ? 'cell' : 'cells'}
            </span>
            <select aria-label={`What ${entry.code} counts as`} className={`${inputClass} !py-1.5 text-xs`} value={entry.as} onChange={(e) => onChange(entry.code, e.target.value as ShiftCode | 'skip')}>
              {COUNTS_AS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.value !== 'skip' && option.value !== 'W' && rules.codes[option.value].name !== option.label.replace(/ shift$/, '') ? ` (${rules.codes[option.value].name})` : ''}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonRow({ person, lines, onChange }: { person: ImportPersonView; lines: LineView[]; onChange: (target: ImportTarget) => void }) {
  const options = lines.filter((line) => line.active || line.id === person.target);
  const left = person.blank + person.locked + person.outside + person.unreadable;
  return (
    <li className={`grid gap-2 border-t border-gray-100 px-3 py-2.5 first:border-t-0 sm:border-t ${PERSON_GRID}`}>
      <div className="min-w-0">
        <p className="break-words font-medium text-gray-900">{person.label}</p>
        <p className="text-[11px] text-gray-400">Row {person.row}</p>
      </div>
      <div className="min-w-0">
        <select
          aria-label={`Who ${person.label} is on the roster`}
          className={`${inputClass} !py-1.5 text-xs`}
          value={String(person.target)}
          onChange={(e) => onChange(e.target.value === 'new' || e.target.value === 'skip' ? e.target.value : Number(e.target.value))}
        >
          {options.map((line) => (
            <option key={line.id} value={line.id}>
              {line.code}
              {line.name !== line.code ? ` · ${line.name}` : ''}
              {line.active ? '' : ' (inactive)'}
            </option>
          ))}
          <option value="new">Add as a new person</option>
          <option value="skip">Skip this row</option>
        </select>
        <p className="mt-1 text-[11px] text-gray-400">
          {person.target === 'new'
            ? `Not on the roster yet. Added to People, outside the rotation${person.account ? `, and linked to ${person.account}'s login` : ''}.`
            : person.target === 'skip'
              ? 'Nothing in this row is used.'
              : person.inactive
                ? 'This person is inactive on the roster.'
                : person.matched
                  ? 'Matched from the file.'
                  : 'Chosen by you.'}
        </p>
      </div>
      <div className="flex items-baseline gap-2 sm:block sm:text-right">
        {person.target === 'skip' ? (
          <Pill tone="muted">Skipped</Pill>
        ) : (
          <>
            <p className="font-semibold text-gray-900">{person.set} to fill</p>
            <p className="text-[11px] text-gray-400">{[person.unchanged > 0 && `${person.unchanged} the same`, left > 0 && `${left} left alone`].filter(Boolean).join(' · ')}</p>
          </>
        )}
      </div>
    </li>
  );
}

function Checks({ preview }: { preview: ImportPreview }) {
  const blocks = preview.blocks.length + preview.moreBlocks;
  const warnings = preview.warnings.length + preview.moreWarnings;
  if (blocks === 0 && warnings === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <Pill tone="ok">All rules pass</Pill> {formatMonth(preview.month)} would have every shift covered and no rule broken.
      </div>
    );
  }
  const shown: Violation[] = [...preview.blocks, ...preview.warnings].slice(0, SHOWN_VIOLATIONS);
  return (
    <div className="rounded-xl border border-gray-100 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">After the upload</span>
        {blocks > 0 && <Pill tone="danger">{blocks} blocking</Pill>}
        {warnings > 0 && <Pill tone="warn">{plural(warnings, 'warning')}</Pill>}
      </div>
      <ul className="mt-2 space-y-1">
        {shown.map((v) => (
          <li key={v.key} className="flex items-start gap-2 text-xs text-gray-700">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${v.severity === 'block' ? 'bg-rose-500' : 'bg-amber-400'}`} />
            <span>
              <span className="font-medium text-gray-900">{RULE_LABEL[v.rule]}.</span> {v.message}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-400">
        {blocks + warnings > shown.length && `…and ${blocks + warnings - shown.length} more. `}
        The roster lists them all under Checks, where you can fix them before publishing.
      </p>
    </div>
  );
}
