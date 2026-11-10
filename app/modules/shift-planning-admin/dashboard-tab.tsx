'use client';

import { type ReactNode, useEffect, useState } from 'react';

import { CODE_STYLE, Card, MonthStatusPill, Pill, formatDay, formatHours, formatMonth, ghostButton } from '@/app/modules/_components/shift-ui';
import { useLiveRefresh } from '@/app/ui/use-live-refresh';
import { TRIGGER_LABEL } from '@/lib/shift-rules';
import { type Dashboard, type DashboardLine, SHIFT_SOURCES } from '@/lib/shift-types';

import { getJson, message } from './api';
import { ViolationList } from './roster-tab';

const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

function Section({ title, hint, children, aside }: { title: string; hint?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-gray-500">{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </Card>
  );
}

function Tile({ label, value, hint, tone = 'ok' }: { label: string; value: string; hint?: string; tone?: 'ok' | 'warn' | 'danger' }) {
  const colour = tone === 'danger' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-gray-900';
  return (
    <Card className="px-5 py-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${colour}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-gray-400">{hint}</p>}
    </Card>
  );
}

const th = 'px-3 py-2 text-left text-xs font-medium text-gray-400';
const td = 'px-3 py-2 tabular-nums text-gray-600';

function Person({ line }: { line: DashboardLine }) {
  return (
    <td className="px-3 py-2">
      <span className="font-bold text-gray-900">{line.code}</span>
      {line.name !== line.code && <span className="ml-2 text-gray-500">{line.name}</span>}
    </td>
  );
}

export default function DashboardTab({ onOpenLeave }: { onOpenLeave: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the roster changes (and once a minute, so "now" stays current).
  const [version, setVersion] = useState(0);
  useLiveRefresh(SHIFT_SOURCES, () => setVersion((v) => v + 1));

  useEffect(() => {
    let cancelled = false;
    getJson<Dashboard>('/api/shift-planning/admin/dashboard')
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(message(e, 'Could not load the dashboard.'));
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (error && !data) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  if (!data) return <Card className="p-10 text-center text-sm text-gray-400">Loading the dashboard…</Card>;
  return <DashboardView data={data} onOpenLeave={onOpenLeave} />;
}

export function DashboardView({ data, onOpenLeave }: { data: Dashboard; onOpenLeave: () => void }) {
  const { rules, now, coverage, lines, reliability } = data;
  const max = rules.maxHours7d;
  const covered = reliability.slots - reliability.unconfirmed;
  const share = (n: number) => (reliability.slots ? `${Math.round((n / reliability.slots) * 100)}%` : '—');
  const unused = lines.reduce((sum, l) => sum + Math.max(0, l.capacityAvailable - l.capacityUsed), 0);
  const unconfirmed = lines.reduce((sum, l) => sum + l.payroll.unconfirmed, 0);

  if (lines.length === 0) {
    return <Card className="p-10 text-center text-sm text-gray-400">Add people to the roster and generate a month to see the dashboard.</Card>;
  }

  return (
    <div className="space-y-4">
      {/* Now */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {now.consoles.map((shift) => {
          const short = shift.people.length === 0;
          return (
            <Card key={shift.code} className={`border p-4 ${short ? 'border-rose-200 bg-rose-50 text-rose-700' : CODE_STYLE[shift.code].soft} ${shift.active ? 'ring-2 ring-[#03458f]/25' : ''}`}>
              <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-widest opacity-70">
                {shift.name} console
                {shift.active && <span className="rounded bg-[#03458f] px-1.5 py-0.5 text-[9px] tracking-wide text-white opacity-100">On now</span>}
              </p>
              <p className="mt-1 truncate text-lg font-semibold">{short ? (shift.active ? 'Nobody on' : 'Nobody rostered') : shift.people.join(', ')}</p>
              <p className="text-xs opacity-70">{shift.active ? `until ${shift.end}` : `${shift.start} – ${shift.end} today`}</p>
            </Card>
          );
        })}
        <Card className={`border p-4 ${CODE_STYLE.OC.soft}`}>
          <p className="text-[11px] font-semibold uppercase tracking-widest opacity-70">On call today</p>
          <p className="mt-1 truncate text-lg font-semibold">{now.onCall.length ? now.onCall.join(', ') : 'Nobody'}</p>
          <p className="text-xs opacity-70">held in reserve</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Next handover</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{now.nextHandover?.time ?? '—'}</p>
          <p className="text-xs text-gray-400">{now.nextHandover ? formatDay(now.nextHandover.date) : 'nothing rostered'} · {rules.timeZone.replace('_', ' ')}</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Coverage, next 14 days" hint="Any date with a gap, a double, or nobody on call.">
          {coverage.issues.length === 0 ? (
            <p className="text-sm text-emerald-700">Every generated day is covered.</p>
          ) : (
            <ViolationList items={coverage.issues} />
          )}
          {coverage.ungenerated.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {coverage.ungenerated.length} of the next 14 days are not generated yet, from {formatDay(coverage.ungenerated[0] as string)}.
            </p>
          )}
        </Section>

        <Section
          title="Requests"
          hint="Leave waiting for a decision."
          aside={
            <button type="button" className={ghostButton} onClick={onOpenLeave}>
              Open leave
            </button>
          }
        >
          {data.requests.length === 0 ? (
            <p className="text-sm text-gray-400">Nothing is waiting.</p>
          ) : (
            <ul className="space-y-2">
              {data.requests.map(({ leave, breaksCoverage }) => (
                <li key={leave.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2">
                  <span className="text-sm text-gray-800">
                    <span className="font-semibold">{leave.personName}</span> · {formatDay(leave.startDate)}
                    {leave.endDate !== leave.startDate && ` – ${formatDay(leave.endDate)}`}
                  </span>
                  {breaksCoverage.length > 0 ? (
                    <Pill tone="danger">leaves {breaksCoverage.length} shift{breaksCoverage.length === 1 ? '' : 's'} uncovered</Pill>
                  ) : (
                    <Pill tone="ok">no coverage impact</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Hours and rest" hint={`Rolling seven days per person. Amber from ${rules.targetHours7d} hours, red above ${max}. The limit is a line, never capacity.`}>
        <div className="space-y-2.5">
          {lines.map((line) => {
            const scale = max * 1.25;
            return (
              <div key={line.lineId} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3">
                <div className="truncate text-sm">
                  <span className="font-bold text-gray-900">{line.code}</span>
                  {line.name !== line.code && <span className="ml-2 text-gray-500">{line.name}</span>}
                </div>
                <div className="relative h-5 rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${line.last7 > max ? 'bg-rose-500' : line.last7 >= rules.targetHours7d ? 'bg-amber-400' : 'bg-[#03458f]'}`}
                    style={{ width: `${Math.min(100, (line.last7 / scale) * 100)}%` }}
                  />
                  <span className="absolute inset-y-0 w-px bg-amber-500" style={{ left: `${(rules.targetHours7d / scale) * 100}%` }} title={`Target ${rules.targetHours7d} h`} />
                  <span className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: `${(max / scale) * 100}%` }} title={`Limit ${max} h`} />
                </div>
                <div className="flex items-center gap-2 text-xs tabular-nums text-gray-600">
                  <span className="w-28 text-right">{formatHours(line.last7)} h · next peak {formatHours(line.next7)}</span>
                  <Pill tone={line.tone}>{line.tone === 'danger' ? 'over limit' : line.tone === 'warn' ? 'at target' : 'ok'}</Pill>
                </div>
              </div>
            );
          })}
        </div>
        {data.restWarnings.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <ViolationList title="Coming up" items={data.restWarnings} />
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Call-ins this cycle"
          hint={`${formatDay(data.cycle.from)} – ${formatDay(data.cycle.to)}. Above one per person per cycle for two months is a hiring signal.`}
          aside={<Pill tone={data.callInRate !== null && data.callInRate > 1 ? 'danger' : 'info'}>{data.callInRate ?? 0} per person</Pill>}
        >
          {data.callIns.length === 0 ? (
            <p className="text-sm text-gray-400">No call-ins in this cycle.</p>
          ) : (
            <ul className="space-y-2">
              {data.callIns.map((c) => (
                <li key={`${c.lineCode}-${c.date}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-gray-800">
                    <span className="font-semibold">{c.lineCode}</span> · {formatDay(c.date)} · {rules.codes[c.code].name} · {TRIGGER_LABEL[c.trigger]}
                  </span>
                  {c.responseMinutes === null ? (
                    <Pill tone="muted">arrival not recorded</Pill>
                  ) : (
                    <Pill tone={c.late ? 'danger' : 'ok'}>{c.responseMinutes} min</Pill>
                  )}
                </li>
              ))}
            </ul>
          )}
          {lines.some((l) => l.callInsThisCycle >= 2) && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Second call-in this cycle for {lines.filter((l) => l.callInsThisCycle >= 2).map((l) => l.code).join(', ')}.
            </p>
          )}
        </Section>

        <Section title={`Fairness, ${formatDay(data.quarter.from, { month: 'short' })} – ${formatDay(data.quarter.to, { month: 'short', year: 'numeric' })}`} hint="Nights, weekends and public holidays on the roster this quarter. A spread above two shifts is flagged.">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className={th}>Person</th>
                <th className={th}>Nights</th>
                <th className={th}>Weekend shifts</th>
                <th className={th}>Holiday shifts</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.lineId} className="border-b border-gray-50 last:border-0">
                  <Person line={line} />
                  <td className={td}>{line.nights}</td>
                  <td className={td}>{line.weekendShifts}</td>
                  <td className={td}>{line.holidayShifts}</td>
                </tr>
              ))}
              <tr>
                <td className="px-3 pt-3 text-xs font-medium text-gray-400">Spread</td>
                {[data.fairness.nights, data.fairness.weekends, data.fairness.holidays].map((spread, i) => (
                  <td key={i} className="px-3 pt-3">
                    <Pill tone={spread > 2 ? 'warn' : 'ok'}>{spread}</Pill>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </Section>
      </div>

      <Section
        title={`Planned and worked, ${formatMonth(data.month)}`}
        hint="Worked means a shift someone confirmed, or a call-in. Premium hours are flags for payroll; nothing here blocks."
        aside={unconfirmed > 0 ? <Pill tone="warn">{unconfirmed} past shift{unconfirmed === 1 ? '' : 's'} not confirmed</Pill> : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Person', 'Planned h', 'Worked h', 'Variance', 'Sick days', 'No-shows', 'Call-in h', 'Overtime 1.5x', 'Holiday 2x', 'Rest day 2x', 'Leave balance'].map((h) => (
                  <th key={h} className={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const p = line.payroll;
                const off = line.variance !== null && Math.abs(line.variance) > 0.1;
                return (
                  <tr key={line.lineId} className="border-b border-gray-50 last:border-0">
                    <Person line={line} />
                    <td className={td}>{formatHours(p.plannedHours)}</td>
                    <td className={td}>{formatHours(p.workedHours)}</td>
                    <td className="px-3 py-2">{line.variance === null ? <span className="text-gray-300">—</span> : <Pill tone={off ? 'warn' : 'ok'}>{percent(line.variance)}</Pill>}</td>
                    <td className={td}>{p.sickDays}{line.sickEpisodes >= 3 && <span className="ml-1.5 text-xs text-rose-600">{line.sickEpisodes} episodes this quarter</span>}</td>
                    <td className={td}>{p.noShows}</td>
                    <td className={td}>{formatHours(p.callInHours)}</td>
                    <td className={td}>{formatHours(p.overtimeHours)}</td>
                    <td className={td}>{formatHours(p.holidayHours)}</td>
                    <td className={td}>{formatHours(p.restDayHours)}</td>
                    <td className="px-3 py-2">
                      <span className="mr-2 tabular-nums text-gray-600">{formatHours(line.leave.balance)} d</span>
                      {line.leave.balance > rules.leaveCapDays && <Pill tone="warn">above cap</Pill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Utilization, month to date"
          value={percent(data.utilization)}
          hint={`Worked hours as a share of the ${rules.targetHours7d}-hour target.`}
          tone={data.utilization !== null && (data.utilization < 0.6 || data.utilization > 0.9) ? 'warn' : 'ok'}
        />
        <Tile label="Unused capacity this month" value={`${formatHours(Math.round(unused))} h`} hint="Hours people could still work inside the target, less call-in hours used." />
        <Tile label="Gaps this month" value={String(reliability.gaps)} hint="Console shifts nobody covered." tone={reliability.gaps > 0 ? 'danger' : 'ok'} />
        <Tile label="Compliance" value={String(data.compliance.length)} hint="Blocking rules approved through recently." tone={data.compliance.length > 0 ? 'warn' : 'ok'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Coverage reliability" hint={`How ${formatMonth(data.month)} has actually been delivered so far, across ${reliability.slots} console shifts.`}>
          {reliability.slots === 0 ? (
            <p className="text-sm text-gray-400">Nothing to measure yet this month.</p>
          ) : (
            <>
              <div className="flex h-4 overflow-hidden rounded-full bg-gray-100">
                <div className="bg-emerald-500" style={{ width: share(reliability.asPlanned) }} />
                <div className="bg-[#03458f]" style={{ width: share(reliability.callIn) }} />
                <div className="bg-rose-500" style={{ width: share(reliability.gaps) }} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                {[
                  ['Worked as planned', reliability.asPlanned, 'bg-emerald-500'],
                  ['Covered by call-in', reliability.callIn, 'bg-[#03458f]'],
                  ['Gaps', reliability.gaps, 'bg-rose-500'],
                  ['Not confirmed', reliability.unconfirmed, 'bg-gray-300'],
                ].map(([label, count, dot]) => (
                  <div key={label as string}>
                    <dt className="flex items-center gap-1.5 text-xs text-gray-400"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</dt>
                    <dd className="font-semibold tabular-nums text-gray-900">{share(count as number)} <span className="text-xs font-normal text-gray-400">({count})</span></dd>
                  </div>
                ))}
              </dl>
              {covered < reliability.slots && <p className="mt-3 text-[11px] text-gray-400">Use “Confirm past shifts worked” on the roster so unconfirmed shifts count.</p>}
            </>
          )}
        </Section>

        <Section title="Publishing" hint={`A month is due ${rules.publishLeadDays} days before it starts.`}>
          <ul className="space-y-2">
            {data.months.map((m) => (
              <li key={m.month} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-800">{formatMonth(m.month)}</span>
                <span className="flex items-center gap-2">
                  {m.status !== 'published' && <span className="text-xs text-gray-400">due {formatDay(m.publishDue)}</span>}
                  {m.status === 'none' && data.today > m.publishDue ? <Pill tone="danger">Not generated · overdue</Pill> : <MonthStatusPill month={m} today={data.today} />}
                </span>
              </li>
            ))}
          </ul>
          {data.compliance.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">Blocks approved through</p>
              <ul className="space-y-1.5">
                {data.compliance.map((entry) => (
                  <li key={entry.id} className="text-sm text-gray-700">
                    {entry.summary} <span className="text-xs text-gray-400">· {entry.actorName}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
