'use client';

import Link from 'next/link';
import { type FormEvent, useMemo, useRef, useState } from 'react';

import {
  BRAND,
  CODE_STYLE,
  Card,
  Label,
  Legend,
  MonthNav,
  MonthStatusPill,
  Pill,
  RosterGrid,
  Tabs,
  codeTimes,
  formatDay,
  formatHours,
  formatMonth,
  formatSpan,
  inputClass,
  primaryButton,
} from '@/app/modules/_components/shift-ui';
import { useNow } from '@/app/ui/use-client';
import { useLiveRefresh } from '@/app/ui/use-live-refresh';
import {
  type Duty,
  type ShiftCode,
  type ShiftRules,
  absoluteMinutes,
  addDays,
  currentAndNext,
  datesBetween,
  dutyOf,
  isoWeekday,
  monthDates,
  timeOfAbsolute,
  zonedNow,
} from '@/lib/shift-rules';
import { type LeaveView, type MyShifts, type RecordView, SHIFT_SOURCES, type TeamRoster, cellOfRecord, indexRecords } from '@/lib/shift-types';

type View = 'mine' | 'everyone';

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || 'Something went wrong. Please try again.');
  return body;
}

const LEAVE_TONE: Record<LeaveView['status'], 'ok' | 'warn' | 'danger' | 'muted'> = {
  pending: 'warn',
  approved: 'ok',
  declined: 'danger',
  cancelled: 'muted',
};

/** What a record shows on the day: the shift actually worked, else the plan. */
const shownCode = (record: RecordView): ShiftCode => record.workedCode ?? record.plannedCode;

export default function MyShiftsClient({ initial, canManage, userName }: { initial: MyShifts; canManage: boolean; userName: string }) {
  const [data, setData] = useState<MyShifts>(initial);
  const [team, setTeam] = useState<TeamRoster | null>(null);
  const [view, setView] = useState<View>('mine');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const month = data.month.month;
  const { rules, line } = data;

  // Only the newest request may land, so a slow answer never overwrites a later one.
  const latestLoad = useRef(0);

  /** `silent` is a background refresh: no dimming, and a failure is left for the next one. */
  const load = async (target: string, which: View = view, silent = false) => {
    const id = (latestLoad.current += 1);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [mine, everyone] = await Promise.all([
        readJson<MyShifts>(await fetch(`/api/shift-planning/me?month=${target}`, { cache: 'no-store' })),
        canManage && which === 'everyone'
          ? readJson<TeamRoster>(await fetch(`/api/shift-planning/roster?month=${target}`, { cache: 'no-store' }))
          : Promise.resolve(null),
      ]);
      if (id !== latestLoad.current) return;
      setData(mine);
      if (everyone) setTeam(everyone);
    } catch (e) {
      if (!silent && id === latestLoad.current) setError(e instanceof Error ? e.message : 'Could not load the roster.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // The roster changed somewhere (a publish, a swap, a leave decision): show it without a reload.
  useLiveRefresh(SHIFT_SOURCES, () => void load(month, view, true));

  const switchView = (next: View) => {
    setView(next);
    if (next === 'everyone' && team?.month.month !== month) void load(month, next);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{view === 'everyone' ? 'Shift roster' : 'My shifts'}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {view === 'everyone'
                ? 'Everyone on the roster this month.'
                : line
                  ? `${userName} · ${line.code} · times in ${rules.timeZone.replace('_', ' ')}`
                  : 'Your rota, your next shift and your leave in one place.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canManage && (
              <Tabs
                tabs={[
                  { id: 'mine', label: 'My shifts' },
                  { id: 'everyone', label: 'Everyone' },
                ]}
                value={view}
                onChange={switchView}
              />
            )}
            <MonthNav month={month} onChange={(m) => void load(m)} disabled={loading} />
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {view === 'everyone' && canManage ? (
          <EveryoneView team={team} loading={loading} highlightLineId={line?.id ?? null} />
        ) : !line ? (
          <NotOnRoster canManage={canManage} />
        ) : (
          <MineView data={data} loading={loading} onChanged={() => void load(month)} />
        )}
      </div>
    </div>
  );
}

// --- Not on the roster -----------------------------------------------------------

function NotOnRoster({ canManage }: { canManage: boolean }) {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#03458f]/10 text-[#03458f]">
        <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-900">You are not on the roster yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
        Your shifts will appear here once a scheduler adds you to the rotation and publishes the month.
      </p>
      {canManage && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/modules/shift-planning-admin" className={primaryButton}>
            Open Shift Planning Admin
          </Link>
        </div>
      )}
    </Card>
  );
}

// --- Everyone (admins and schedulers) ---------------------------------------------

function EveryoneView({ team, loading, highlightLineId }: { team: TeamRoster | null; loading: boolean; highlightLineId: number | null }) {
  const records = useMemo(() => indexRecords(team?.records ?? []), [team]);
  if (!team) {
    return <Card className="p-10 text-center text-sm text-gray-400">{loading ? 'Loading the roster…' : 'No roster to show.'}</Card>;
  }
  return (
    <Card className={`p-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-900">{formatMonth(team.month.month)}</h2>
          <MonthStatusPill month={team.month} today={team.today} />
        </div>
        <Link href="/modules/shift-planning-admin" className="text-sm font-semibold text-[#03458f] hover:underline">
          Manage in Shift Planning Admin →
        </Link>
      </div>
      {team.month.status === 'none' ? (
        <p className="py-10 text-center text-sm text-gray-400">This month has not been generated yet.</p>
      ) : (
        <>
          <RosterGrid
            rules={team.rules}
            lines={team.lines}
            dates={monthDates(team.month.month)}
            records={records}
            holidays={team.holidays}
            today={team.today}
            highlightLineId={highlightLineId}
          />
          <Legend rules={team.rules} className="mt-4 border-t border-gray-100 pt-4" />
        </>
      )}
    </Card>
  );
}

// --- My shifts ------------------------------------------------------------------

function MineView({ data, loading, onChanged }: { data: MyShifts; loading: boolean; onChanged: () => void }) {
  const { rules, month, records, upcoming, holidays, totals } = data;
  // Null on the server and during hydration, so the first paint is the same on both.
  const now = useNow(30_000);
  const clock = now === null ? null : zonedNow(rules.timeZone, now);
  const today = clock?.date ?? data.today;
  const holidayByDate = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);
  const byDate = useMemo(() => new Map(records.map((r) => [r.date, r])), [records]);
  const upcomingByDate = useMemo(() => new Map(upcoming.map((r) => [r.date, r])), [upcoming]);

  return (
    <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <Hero rules={rules} upcoming={upcoming} clock={clock} today={today} />

      <WeekStrip rules={rules} today={today} upcomingByDate={upcomingByDate} holidayByDate={holidayByDate} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">{formatMonth(month.month)}</h2>
              {month.status === 'published' && (
                <span className="text-xs text-gray-400">
                  {totals.shifts} shift{totals.shifts === 1 ? '' : 's'} · {formatHours(totals.hours)} h
                </span>
              )}
            </div>
            {month.status === 'published' ? (
              <MonthCalendar rules={rules} month={month.month} byDate={byDate} holidayByDate={holidayByDate} today={today} />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 px-6 py-12 text-center">
                <p className="text-sm font-semibold text-gray-700">The roster for {formatMonth(month.month)} is not published yet</p>
                <p className="mt-1 text-sm text-gray-400">It is due by {formatDay(month.publishDue)}. You will see your shifts here as soon as it is out.</p>
              </div>
            )}
            <Legend rules={rules} className="mt-4 border-t border-gray-100 pt-4" />
          </Card>

          {month.status === 'published' && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat label="Shifts" value={String(totals.shifts)} />
              <Stat label="Hours" value={formatHours(totals.hours)} />
              <Stat label="Nights" value={String(totals.nights)} />
              <Stat label="On call" value={String(totals.codes.OC)} hint="days" />
              <Stat label="Days off" value={String(totals.codes.X + totals.codes.LV)} />
            </div>
          )}
        </div>

        <div className="space-y-6">
          <LeaveCard data={data} onChanged={onChanged} />
          <HolidayCard holidays={holidays.filter((h) => h.date >= today).slice(0, 5)} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-gray-400">{hint}</span>}
      </p>
    </Card>
  );
}

// --- Hero: now and next -----------------------------------------------------------

function Hero({
  rules,
  upcoming,
  clock,
  today,
}: {
  rules: ShiftRules;
  upcoming: RecordView[];
  clock: { date: string; minutes: number } | null;
  today: string;
}) {
  const duties = useMemo(
    () => upcoming.map((r) => dutyOf(rules, cellOfRecord(r), r.date)).filter((d): d is Duty => d !== null),
    [upcoming, rules],
  );
  const nowAbs = clock ? absoluteMinutes(clock.date, clock.minutes) : absoluteMinutes(today, 0);
  const { current, next } = currentAndNext(duties, nowAbs);
  const todayRecord = upcoming.find((r) => r.date === today);
  const todayCode = todayRecord ? shownCode(todayRecord) : null;

  let eyebrow = 'Next shift';
  let title = 'Nothing published yet';
  let detail = 'Your next shift will show here once the roster is published.';
  let progress: number | null = null;

  if (clock && current) {
    eyebrow = 'On shift now';
    title = `${rules.codes[current.code].name} shift`;
    detail = `${timeOfAbsolute(current.start).time} – ${timeOfAbsolute(current.end).time} · ends in ${formatSpan(current.end - nowAbs)}`;
    progress = (nowAbs - current.start) / (current.end - current.start);
  } else if (todayCode === 'OC') {
    eyebrow = 'Today';
    title = 'On call';
    detail = 'Held in reserve. Keep your phone on: you may be called in.';
  } else if (todayCode === 'LV') {
    eyebrow = 'Today';
    title = 'On leave';
    detail = next ? `Back on ${formatDay(next.date)}.` : 'Enjoy the break.';
  } else if (todayCode === 'X') {
    eyebrow = 'Today';
    title = 'Day off';
    detail = next ? `Back on ${formatDay(next.date)}.` : 'Rest day.';
  } else if (next) {
    title = `${rules.codes[next.code].name} shift`;
    detail = `${formatDay(next.date)} · ${timeOfAbsolute(next.start).time} – ${timeOfAbsolute(next.end).time}${clock ? ` · starts in ${formatSpan(next.start - nowAbs)}` : ''}`;
  }

  const showNext = next && (current || todayCode === 'OC' || todayCode === 'LV' || todayCode === 'X');

  return (
    <div className="overflow-hidden rounded-3xl shadow-sm" style={{ background: `linear-gradient(135deg, ${BRAND} 0%, #0a5cb8 60%, #1273d4 100%)` }}>
      <div className="flex flex-col gap-6 p-6 text-white md:flex-row md:items-center md:justify-between md:p-8">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/70">
            {clock && current && <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#f9b232] opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[#f9b232]" /></span>}
            {eyebrow}
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{title}</h2>
          <p className="mt-2 text-sm text-white/80">{detail}</p>
          {progress !== null && (
            <div className="mt-5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-[#f9b232]" style={{ width: `${Math.min(100, Math.max(2, progress * 100))}%` }} />
            </div>
          )}
        </div>
        {showNext && next && (
          <div className="shrink-0 rounded-2xl bg-white/10 px-5 py-4 backdrop-blur">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/60">Next up</p>
            <p className="mt-1 text-lg font-semibold">{rules.codes[next.code].name}</p>
            <p className="text-sm text-white/80">
              {formatDay(next.date)} · {timeOfAbsolute(next.start).time}
            </p>
            {clock && <p className="mt-1 text-xs text-[#f9b232]">in {formatSpan(next.start - nowAbs)}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// --- The week ahead -----------------------------------------------------------------

function WeekStrip({
  rules,
  today,
  upcomingByDate,
  holidayByDate,
}: {
  rules: ShiftRules;
  today: string;
  upcomingByDate: Map<string, RecordView>;
  holidayByDate: Map<string, string>;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">The week ahead</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {datesBetween(today, addDays(today, 6)).map((date) => {
          const record = upcomingByDate.get(date);
          const code = record ? shownCode(record) : null;
          const isToday = date === today;
          return (
            <div
              key={date}
              className={`rounded-2xl border bg-white p-3 shadow-sm ${isToday ? 'border-[#03458f] ring-2 ring-[#03458f]/15' : 'border-gray-100'}`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-xs font-semibold ${isToday ? 'text-[#03458f]' : 'text-gray-400'}`}>{isToday ? 'Today' : formatDay(date, { weekday: 'short' })}</span>
                <span className="text-xs tabular-nums text-gray-400">{formatDay(date, { day: 'numeric', month: 'short' })}</span>
              </div>
              {code ? (
                <div className={`mt-2 rounded-xl border px-2.5 py-2 ${CODE_STYLE[code].soft}`}>
                  <p className="text-sm font-semibold">{rules.codes[code].name}</p>
                  <p className="text-[11px] opacity-75">{codeTimes(rules, code) || (code === 'OC' ? 'In reserve' : code === 'LV' ? 'Approved leave' : 'Rest day')}</p>
                </div>
              ) : (
                <div className="mt-2 rounded-xl border border-dashed border-gray-200 px-2.5 py-2">
                  <p className="text-sm font-medium text-gray-300">Not published</p>
                  <p className="text-[11px] text-gray-300">—</p>
                </div>
              )}
              {holidayByDate.has(date) && <p className="mt-1.5 truncate text-[10px] font-semibold text-rose-600" title={holidayByDate.get(date)}>{holidayByDate.get(date)}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- The month ------------------------------------------------------------------------

function MonthCalendar({
  rules,
  month,
  byDate,
  holidayByDate,
  today,
}: {
  rules: ShiftRules;
  month: string;
  byDate: Map<string, RecordView>;
  holidayByDate: Map<string, string>;
  today: string;
}) {
  const dates = monthDates(month);
  const lead = isoWeekday(dates[0] as string) - 1;
  const cells: Array<string | null> = [...Array.from({ length: lead }, () => null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} className="min-h-[4.75rem] rounded-xl bg-gray-50/60" />;
          const record = byDate.get(date);
          const code = record ? shownCode(record) : null;
          const holiday = holidayByDate.get(date);
          const isToday = date === today;
          const absent = record?.status === 'sick' || record?.status === 'no-show';
          return (
            <div
              key={date}
              title={holiday}
              className={`flex min-h-[4.75rem] flex-col rounded-xl border p-1.5 ${
                code ? CODE_STYLE[code].soft : 'border-gray-100 bg-white text-gray-300'
              } ${isToday ? 'ring-2 ring-[#03458f] ring-offset-1' : ''} ${absent ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between">
                <span className={`text-xs font-semibold tabular-nums ${isToday ? 'rounded-md bg-[#03458f] px-1.5 text-white' : ''}`}>{Number(date.slice(8))}</span>
                {holiday && <span className="rounded bg-rose-500 px-1 text-[9px] font-bold text-white">PH</span>}
              </div>
              {code && record && (
                <div className="mt-auto">
                  <p className="truncate text-[13px] font-semibold leading-tight">{rules.codes[code].name}</p>
                  <p className="truncate text-[10px] leading-tight opacity-70">
                    {record.status === 'sick'
                      ? 'Sick'
                      : record.status === 'no-show'
                        ? 'No-show'
                        : record.workedCode
                          ? 'Called in'
                          : record.actualStart && record.actualEnd
                            ? `${record.actualStart} – ${record.actualEnd}`
                            : codeTimes(rules, code)}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Leave ----------------------------------------------------------------------------

function LeaveCard({ data, onChanged }: { data: MyShifts; onChanged: () => void }) {
  const { balance, leaves, today } = data;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ type: 'annual', startDate: '', endDate: '', note: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await readJson(await fetch('/api/shift-planning/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }));
      setOpen(false);
      setForm({ type: 'annual', startDate: '', endDate: '', note: '' });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await readJson(await fetch(`/api/shift-planning/leave/${id}`, { method: 'DELETE' }));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Leave</h2>
        <button type="button" className="text-xs font-semibold text-[#03458f] hover:underline" onClick={() => { setOpen((v) => !v); setError(null); }}>
          {open ? 'Cancel' : 'Request leave'}
        </button>
      </div>

      {balance && (
        <div className="mt-4">
          <p className="text-3xl font-semibold tabular-nums text-gray-900">
            {formatHours(balance.balance)}
            <span className="ml-1.5 text-sm font-normal text-gray-400">days available</span>
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              ['Accrued', balance.accrued + balance.opening],
              ['Taken', balance.taken],
              ['Pending', balance.pending],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl bg-gray-50 px-2 py-2">
                <dd className="text-sm font-semibold tabular-nums text-gray-900">{formatHours(value as number)}</dd>
                <dt className="text-[11px] text-gray-400">{label}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-gray-400">
            {formatHours(balance.entitlement)} days a year, earned monthly. Leave is charged per rostered shift; on-call and rest days are never charged.
          </p>
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-gray-100 p-3">
          <div>
            <Label>Type</Label>
            <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="annual">Annual leave</option>
              <option value="sick">Sick leave</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First day</Label>
              <input type="date" required min={today} className={inputClass} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate && form.endDate >= e.target.value ? form.endDate : e.target.value })} />
            </div>
            <div>
              <Label>Last day</Label>
              <input type="date" required min={form.startDate || today} className={inputClass} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Note (optional)</Label>
            <input className={inputClass} value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Anything the scheduler should know" />
          </div>
          <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </form>
      )}

      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

      <div className="mt-4 space-y-2">
        {leaves.length === 0 ? (
          <p className="text-sm text-gray-300">No leave requests yet.</p>
        ) : (
          leaves.slice(0, 6).map((leave) => (
            <div key={leave.id} className="rounded-xl border border-gray-100 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {formatDay(leave.startDate, { day: 'numeric', month: 'short' })}
                  {leave.endDate !== leave.startDate && ` – ${formatDay(leave.endDate, { day: 'numeric', month: 'short' })}`}
                </span>
                <Pill tone={LEAVE_TONE[leave.status]}>{leave.status}</Pill>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                <span>
                  <span className="capitalize">{leave.type}</span> · {leave.shiftsCharged} shift{leave.shiftsCharged === 1 ? '' : 's'} charged
                </span>
                {leave.status === 'pending' && (
                  <button type="button" disabled={busy} onClick={() => void withdraw(leave.id)} className="font-semibold text-rose-600 hover:underline disabled:opacity-50">
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function HolidayCard({ holidays }: { holidays: Array<{ id: string; date: string; name: string }> }) {
  if (holidays.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-gray-900">Public holidays</h2>
      <ul className="mt-3 space-y-2">
        {holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-gray-700">{h.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-gray-400">{formatDay(h.date)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-gray-400">Shifts worked on a public holiday are flagged for double pay.</p>
    </Card>
  );
}

