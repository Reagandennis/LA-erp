'use client';

import { type ReactNode, useMemo } from 'react';

import { APP_LOCALE } from '@/lib/locale';
import {
  type Severity,
  type ShiftCode,
  type ShiftRules,
  SHIFT_CODES,
  isConsole,
  isoWeekday,
  lineTotals,
} from '@/lib/shift-rules';
import { type HolidayView, type LineView, type MonthView, type RecordView, cellOfRecord, recordKey } from '@/lib/shift-types';

/**
 * Shared pieces of the two shift modules: how a shift code looks, how dates
 * read, and the month grid (people down, days across) both of them draw.
 */

export const BRAND = '#03458f';

export const CODE_STYLE: Record<ShiftCode, { chip: string; soft: string; dot: string }> = {
  D: { chip: 'bg-amber-100 text-amber-900', soft: 'bg-amber-50 border-amber-200 text-amber-900', dot: 'bg-amber-400' },
  S: { chip: 'bg-violet-100 text-violet-900', soft: 'bg-violet-50 border-violet-200 text-violet-900', dot: 'bg-violet-400' },
  N: { chip: 'bg-[#03458f] text-white', soft: 'bg-[#03458f]/5 border-[#03458f]/20 text-[#03458f]', dot: 'bg-[#03458f]' },
  OC: { chip: 'bg-emerald-100 text-emerald-800', soft: 'bg-emerald-50 border-emerald-200 text-emerald-800', dot: 'bg-emerald-400' },
  X: { chip: 'bg-gray-100 text-gray-400', soft: 'bg-gray-50 border-gray-200 text-gray-500', dot: 'bg-gray-300' },
  LV: { chip: 'bg-rose-100 text-rose-700', soft: 'bg-rose-50 border-rose-200 text-rose-700', dot: 'bg-rose-400' },
};

export const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#03458f] focus:ring-2 focus:ring-[#03458f]/15 disabled:bg-gray-50 disabled:text-gray-400';

export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#03458f] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50';

export const ghostButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50';

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-gray-500">{children}</label>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-gray-100 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted'; children: ReactNode }) {
  const tones = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-blue-50 text-[#03458f] border-blue-200',
    muted: 'bg-gray-50 text-gray-500 border-gray-200',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

// --- Dates ---------------------------------------------------------------------

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function formatDay(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return utc(date).toLocaleDateString(APP_LOCALE, { ...options, timeZone: 'UTC' });
}

export function formatMonth(month: string): string {
  return utc(`${month}-01`).toLocaleDateString(APP_LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function weekdayLetter(date: string): string {
  return utc(date).toLocaleDateString(APP_LOCALE, { weekday: 'short', timeZone: 'UTC' }).slice(0, 2);
}

/** Hours or days to at most two decimals: 8, 7.5, 19.25. */
export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}

/** "3 h 20 min", "1 d 4 h", "25 min". */
export function formatSpan(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

/** The hours a code runs, e.g. "07:00 – 15:00"; empty for on call, rest and leave. */
export function codeTimes(rules: ShiftRules, code: ShiftCode): string {
  const def = rules.codes[code];
  return def.start && def.end ? `${def.start} – ${def.end}` : '';
}

// --- Small parts ---------------------------------------------------------------

export function MonthNav({ month, onChange, disabled }: { month: string; onChange: (month: string) => void; disabled?: boolean }) {
  const shift = (by: number) => {
    const [year, m] = month.split('-').map(Number) as [number, number];
    onChange(new Date(Date.UTC(year, m - 1 + by, 1)).toISOString().slice(0, 7));
  };
  const arrow = 'flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:opacity-50';
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Previous month" className={arrow} onClick={() => shift(-1)} disabled={disabled}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <div className="min-w-[9.5rem] text-center text-sm font-semibold text-gray-900">{formatMonth(month)}</div>
      <button type="button" aria-label="Next month" className={arrow} onClick={() => shift(1)} disabled={disabled}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  );
}

export function MonthStatusPill({ month, today }: { month: MonthView; today: string }) {
  if (month.status === 'published') return <Pill tone="ok">Published</Pill>;
  if (month.status === 'draft') {
    return today > month.publishDue ? <Pill tone="danger">Draft · publishing overdue</Pill> : <Pill tone="warn">Draft · not visible to staff</Pill>;
  }
  return <Pill tone="muted">Not generated</Pill>;
}

export function Legend({ rules, className = '' }: { rules: ShiftRules; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 ${className}`}>
      {SHIFT_CODES.map((code) => (
        <span key={code} className="inline-flex items-center gap-1.5">
          <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-bold ${CODE_STYLE[code].chip}`}>{code}</span>
          {rules.codes[code].name}
          {isConsole(code) && <span className="text-gray-400">{codeTimes(rules, code)}</span>}
        </span>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; badge?: number }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
            value === tab.id ? 'bg-[#03458f] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {tab.label}
          {tab.badge ? (
            <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-bold leading-5 ${value === tab.id ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700'}`}>
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// --- The month grid ------------------------------------------------------------

export interface RosterGridProps {
  rules: ShiftRules;
  lines: LineView[];
  dates: string[];
  records: Map<string, RecordView>;
  holidays: HolidayView[];
  today: string;
  /** Unsaved changes, drawn over the saved code. */
  draft?: ReadonlyMap<string, ShiftCode>;
  /** Cells and dates a rule has flagged. */
  flaggedCells?: ReadonlyMap<string, Severity>;
  flaggedDates?: ReadonlyMap<string, Severity>;
  activeKey?: string | null;
  onCellClick?: (line: LineView, date: string, anchor: HTMLElement) => void;
  /** The row to pick out, e.g. the person looking at it. */
  highlightLineId?: number | null;
}

/** People down, days across, coloured by shift code — the roster as the sample sheet draws it. */
export function RosterGrid({
  rules,
  lines,
  dates,
  records,
  holidays,
  today,
  draft,
  flaggedCells,
  flaggedDates,
  activeKey,
  onCellClick,
  highlightLineId,
}: RosterGridProps) {
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);
  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.date)), [holidays]);

  const totals = useMemo(
    () =>
      new Map(
        lines.map((line) => [
          line.id,
          lineTotals(
            rules,
            dates.map((date) => {
              const record = records.get(recordKey(line.id, date));
              if (!record) return { date, cell: null };
              const cell = cellOfRecord(record);
              const drafted = draft?.get(recordKey(line.id, date));
              return { date, cell: drafted ? { ...cell, planned: drafted } : cell };
            }),
            holidaySet,
          ),
        ]),
      ),
    [lines, dates, records, draft, rules, holidaySet],
  );

  const onCall = (date: string) =>
    lines
      .filter((line) => {
        const key = recordKey(line.id, date);
        const record = records.get(key);
        return record && (draft?.get(key) ?? record.plannedCode) === 'OC' && !record.workedCode;
      })
      .map((line) => line.code);

  const head = 'border-b border-gray-100 px-0 py-1 text-center text-[10px] font-semibold';
  const dayTone = (date: string) =>
    date === today ? 'bg-[#03458f] text-white' : holidaySet.has(date) ? 'bg-rose-50 text-rose-600' : isoWeekday(date) >= 6 ? 'bg-gray-50 text-gray-500' : 'text-gray-500';

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-[10.5rem] border-b border-gray-100 bg-white px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-400" rowSpan={2}>
              Person
            </th>
            {dates.map((date) => (
              <th key={date} className={`${head} ${dayTone(date)} ${date === today ? 'rounded-t-md' : ''}`} title={holidayByDate.get(date)}>
                {weekdayLetter(date)}
              </th>
            ))}
            {SHIFT_CODES.map((code) => (
              <th key={code} rowSpan={2} className="border-b border-gray-100 px-1.5 py-1 text-center text-[10px] font-semibold text-gray-400 first-of-type:pl-4">
                {code}
              </th>
            ))}
            <th rowSpan={2} className="border-b border-gray-100 px-2 py-1 text-center text-[10px] font-semibold text-gray-400">Shifts</th>
            <th rowSpan={2} className="border-b border-gray-100 px-2 py-1 text-center text-[10px] font-semibold text-gray-400">Hours</th>
          </tr>
          <tr>
            {dates.map((date) => {
              const flag = flaggedDates?.get(date);
              return (
                <th key={date} className={`${head} ${dayTone(date)}`} title={holidayByDate.get(date)}>
                  <span className="relative inline-block w-8">
                    {Number(date.slice(8))}
                    {holidaySet.has(date) && date !== today && <span className="absolute -right-0 -top-0.5 h-1 w-1 rounded-full bg-rose-500" />}
                    {flag && <span className={`absolute -bottom-1 left-1/2 h-1 w-4 -translate-x-1/2 rounded-full ${flag === 'block' ? 'bg-rose-500' : 'bg-amber-400'}`} />}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const total = totals.get(line.id);
            const mine = highlightLineId === line.id;
            return (
              <tr key={line.id} className={mine ? 'bg-[#03458f]/[0.03]' : ''}>
                <td className={`sticky left-0 z-10 border-b border-gray-50 px-3 py-1.5 ${mine ? 'bg-[#f5f8fc]' : 'bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-900">{line.code}</span>
                    {!line.active && <span className="rounded bg-gray-100 px-1 text-[9px] font-semibold uppercase text-gray-400">Inactive</span>}
                  </div>
                  <div className="max-w-[9.5rem] truncate text-[11px] text-gray-400">{line.name === line.code ? (line.userId ? '' : 'Vacant') : line.name}</div>
                </td>
                {dates.map((date) => {
                  const key = recordKey(line.id, date);
                  const record = records.get(key);
                  if (!record) {
                    return <td key={date} className="border-b border-gray-50 p-0.5 text-center text-gray-200">·</td>;
                  }
                  const drafted = draft?.get(key);
                  const shown = record.workedCode ?? drafted ?? record.plannedCode;
                  const flag = flaggedCells?.get(key);
                  const absent = record.status === 'sick' || record.status === 'no-show';
                  const overridden = !drafted && record.plannedCode !== record.generatedCode;
                  const title = [
                    `${line.code} · ${formatDay(date)}`,
                    `${rules.codes[shown].name}${codeTimes(rules, shown) ? ` ${codeTimes(rules, shown)}` : ''}`,
                    drafted ? `Unsaved change from ${record.plannedCode}` : '',
                    overridden ? `Changed from ${record.generatedCode}` : '',
                    record.workedCode ? `Called in from ${record.plannedCode}` : '',
                    absent ? (record.status === 'sick' ? 'Sick' : 'No-show') : '',
                    record.status === 'worked' ? 'Worked' : '',
                  ]
                    .filter(Boolean)
                    .join('\n');
                  const ring = drafted
                    ? 'ring-2 ring-[#f9b232]'
                    : activeKey === key
                      ? 'ring-2 ring-[#03458f]'
                      : flag === 'block'
                        ? 'ring-2 ring-rose-400'
                        : flag === 'warn'
                          ? 'ring-2 ring-amber-300'
                          : '';
                  const chip = (
                    <span
                      className={`relative flex h-7 w-8 items-center justify-center rounded-md text-[11px] font-bold ${CODE_STYLE[shown].chip} ${ring} ${absent ? 'opacity-40 line-through' : ''}`}
                    >
                      {shown}
                      {record.workedCode && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500" />}
                      {overridden && !record.workedCode && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[#f9b232]" />}
                      {record.status === 'worked' && <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-3 -translate-x-1/2 rounded-full bg-emerald-500" />}
                    </span>
                  );
                  return (
                    <td key={date} className={`border-b border-gray-50 p-0.5 ${date === today ? 'bg-[#03458f]/5' : ''}`} title={title}>
                      {onCellClick ? (
                        <button type="button" className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[#03458f]" onClick={(e) => onCellClick(line, date, e.currentTarget)}>
                          {chip}
                        </button>
                      ) : (
                        chip
                      )}
                    </td>
                  );
                })}
                {SHIFT_CODES.map((code) => (
                  <td key={code} className="border-b border-gray-50 px-1.5 text-center tabular-nums text-gray-600 first-of-type:pl-4">
                    {total?.codes[code] ?? 0}
                  </td>
                ))}
                <td className="border-b border-gray-50 px-2 text-center font-semibold tabular-nums text-gray-900">{total?.shifts ?? 0}</td>
                <td className="border-b border-gray-50 px-2 text-center font-semibold tabular-nums text-gray-900">{formatHours(total?.hours ?? 0)}</td>
              </tr>
            );
          })}
          <tr>
            <td className="sticky left-0 z-10 bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">On call</td>
            {dates.map((date) => {
              const codes = onCall(date);
              return (
                <td key={date} className="px-0 py-2 text-center text-[9px] font-semibold leading-tight text-emerald-700" title={codes.join(', ')}>
                  {codes.length === 0 ? <span className="text-gray-200">–</span> : codes.map((c) => c.replace(/^\D+/, '') || c).join(',')}
                </td>
              );
            })}
            <td colSpan={SHIFT_CODES.length + 2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
