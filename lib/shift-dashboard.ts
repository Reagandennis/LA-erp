import 'server-only';

import { prisma } from './prisma';
import { chargeableDates, generatedCheck, generatedMonths, getRules, leaveBalances, listAudit, listHolidays, listLeaves, listLines, listMonths, loadRecords } from './shift-planning';
import {
  CONSOLE_CODES,
  type Duty,
  type RosterCell,
  type Violation,
  absoluteMinutes,
  addDays,
  cycleRange,
  datesBetween,
  dutyOf,
  isAbsent,
  codeDef,
  isWorking,
  lineTotals,
  minutesOf,
  monthEnd,
  monthOf,
  monthStart,
  newViolations,
  payrollTotals,
  timeOfAbsolute,
  validateRoster,
  zonedNow,
} from './shift-rules';
import {
  type Dashboard,
  type DashboardCallIn,
  type DashboardLine,
  type DashboardRequest,
  type Tone,
  buildLookup,
  indexRecords,
  recordKey,
} from './shift-types';

/**
 * The scheduler's dashboard: who is on now, where coverage is thin, hours and
 * rest, call-ins, requests, and the month's planned-against-worked figures.
 *
 * The roster is the plan; "worked" here means a shift someone confirmed (or a
 * call-in). Past shifts nobody has confirmed are counted separately rather
 * than assumed, so a figure is never better than the records behind it.
 */

function quarterOf(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  const first = `${year}-${String(quarter * 3 + 1).padStart(2, '0')}`;
  const last = `${year}-${String(quarter * 3 + 3).padStart(2, '0')}`;
  return { from: monthStart(first), to: monthEnd(last) };
}

const round = (value: number) => Math.round(value * 100) / 100;

export async function loadDashboard(nowMs: number = Date.now()): Promise<Dashboard> {
  const rules = await getRules();
  const clock = zonedNow(rules.timeZone, nowMs);
  const today = clock.date;
  const month = monthOf(today);
  const quarter = quarterOf(today);
  const cycle = cycleRange(rules, today);
  const horizon = addDays(today, 13);

  const from = addDays([quarter.from, cycle.from].sort()[0] as string, -14);
  const to = [monthEnd(month), addDays(today, 21), cycle.to].sort().pop() as string;

  const [allLines, records, holidays, leaves, months, compliance, generatedList] = await Promise.all([
    listLines(),
    loadRecords(prisma, from, to),
    listHolidays(from, to),
    listLeaves({ from: today }),
    listMonths(rules, month, 0, 3),
    listAudit({ compliance: true, limit: 8 }),
    generatedMonths(prisma, from, to),
  ]);
  const isGenerated = generatedCheck(generatedList);
  const lines = allLines.filter((line) => line.active);
  const index = indexRecords(records);
  const lookup = buildLookup(index);
  const holidaySet = new Set(holidays.map((h) => h.date));
  const needed = CONSOLE_CODES.filter((code) => rules.pattern.includes(code));
  const balances = await leaveBalances(lines, today);

  // --- Now ---
  const nowAbs = absoluteMinutes(today, clock.minutes);
  const current: Array<{ name: string; duty: Duty }> = [];
  let nextStart: number | null = null;
  for (const line of lines) {
    for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
      const duty = dutyOf(rules, lookup(line.id, date), date);
      if (!duty) continue;
      if (duty.start <= nowAbs && nowAbs < duty.end) current.push({ name: line.name, duty });
      else if (duty.start > nowAbs && (nextStart === null || duty.start < nextStart)) nextStart = duty.start;
    }
  }
  const handover = current.length ? Math.min(...current.map((c) => c.duty.end)) : nextStart;
  const now: Dashboard['now'] = {
    consoles: needed.map((code) => {
      const def = rules.codes[code];
      const on = current.filter((c) => c.duty.code === code);
      // Running now if the shift that started yesterday or today spans this minute.
      const active =
        on.length > 0 ||
        [addDays(today, -1), today].some((date) => {
          if (!def.start || !def.end) return false;
          const start = absoluteMinutes(date, minutesOf(def.start));
          const end = start + def.hours * 60;
          return start <= nowAbs && nowAbs < end;
        });
      const rostered = lines.filter((line) => dutyOf(rules, lookup(line.id, today), today)?.code === code).map((line) => line.name);
      return { code, name: def.name, active, people: active ? on.map((c) => c.name) : rostered, start: def.start, end: def.end };
    }),
    onCall: lines
      .filter((line) => {
        const cell = lookup(line.id, today);
        return cell?.planned === 'OC' && cell.worked === null;
      })
      .map((line) => line.name),
    nextHandover: handover === null ? null : timeOfAbsolute(handover),
  };

  // --- The next 14 days ---
  const aheadDates = datesBetween(today, horizon);
  const generated = new Set(records.map((r) => r.date));
  const ahead = validateRoster(rules, lines, lookup, today, horizon, isGenerated).filter((v) => generated.has(v.date));
  const coverage = {
    issues: ahead.filter((v) => v.lineId === null),
    ungenerated: aheadDates.filter((date) => !generated.has(date)),
  };
  const restWarnings = ahead.filter((v) => v.lineId !== null);

  // --- Per person ---
  const monthFrom = monthStart(month);
  const monthTo = monthEnd(month);
  const elapsed = datesBetween(monthFrom, monthTo).filter((date) => date < today);
  const weeksElapsed = elapsed.length / 7;
  const weeksInMonth = datesBetween(monthFrom, monthTo).length / 7;
  const quarterDates = datesBetween(quarter.from, quarter.to);
  const cycleDates = new Set(datesBetween(cycle.from, cycle.to));

  const hoursOver = (lineId: number, end: string, days: number) => {
    let total = 0;
    for (const date of datesBetween(addDays(end, -(days - 1)), end)) total += dutyOf(rules, lookup(lineId, date), date)?.hours ?? 0;
    return total;
  };

  const callIns: DashboardCallIn[] = [];
  const dashboardLines: DashboardLine[] = lines.map((line) => {
    const last7 = hoursOver(line.id, today, 7);
    const next7 = Math.max(0, ...datesBetween(addDays(today, 1), addDays(today, 7)).map((end) => hoursOver(line.id, end, 7)));
    const tone: Tone = Math.max(last7, next7) > rules.maxHours7d ? 'danger' : last7 >= rules.targetHours7d ? 'warn' : 'ok';

    const payroll = payrollTotals(rules, line, lookup, monthFrom, monthTo, holidaySet, today);
    let plannedToDate = 0;
    for (const date of elapsed) {
      const cell = lookup(line.id, date);
      if (cell && isWorking(cell.planned)) plannedToDate += codeDef(rules, cell.planned, cell.label).hours;
    }

    let callInsThisCycle = 0;
    let sickEpisodes = 0;
    let sickRun = false;
    for (const record of records) {
      if (record.lineId !== line.id) continue;
      if (record.callIn && record.workedCode && cycleDates.has(record.date)) {
        callInsThisCycle += 1;
        callIns.push({
          date: record.date,
          lineCode: line.code,
          name: line.name,
          code: record.workedCode,
          trigger: record.callIn.trigger,
          responseMinutes: record.callIn.responseMinutes,
          late: record.callIn.responseMinutes !== null && record.callIn.responseMinutes > rules.responseMinutes,
        });
      }
      if (record.date < quarter.from || record.date > quarter.to) continue;
      if (record.status === 'sick') {
        if (!sickRun) sickEpisodes += 1;
        sickRun = true;
      } else {
        sickRun = false;
      }
    }

    const quarterTotals = lineTotals(
      rules,
      quarterDates.map((date) => ({ date, cell: lookup(line.id, date) })),
      holidaySet,
    );

    return {
      lineId: line.id,
      code: line.code,
      name: line.name,
      last7,
      next7,
      tone,
      payroll,
      variance: plannedToDate > 0 ? round((payroll.workedHours - plannedToDate) / plannedToDate) : null,
      utilization: weeksElapsed > 0 ? round(payroll.workedHours / (rules.targetHours7d * weeksElapsed)) : null,
      capacityAvailable: Math.max(0, round(rules.targetHours7d * weeksInMonth - payroll.plannedHours)),
      capacityUsed: payroll.callInHours,
      callInsThisCycle,
      sickEpisodes,
      nights: quarterTotals.nights,
      weekendShifts: quarterTotals.weekendShifts,
      holidayShifts: quarterTotals.holidayShifts,
      leave: balances[line.id] ?? { entitlement: 0, opening: 0, accrued: 0, taken: 0, pending: 0, balance: 0 },
    };
  });
  callIns.sort((a, b) => b.date.localeCompare(a.date));

  // --- Requests: would granting this leave a shift uncovered? ---
  const requests: DashboardRequest[] = [];
  for (const leave of leaves.filter((l) => l.status === 'pending')) {
    const line = lines.find((l) => l.id === leave.lineId);
    let breaksCoverage: string[] = [];
    if (line) {
      const charged = (await chargeableDates(prisma, rules, line, leave.startDate, leave.endDate, null)).filter((date) =>
        index.has(recordKey(line.id, date)),
      );
      if (charged.length) {
        const patches = new Map<string, Partial<RosterCell>>(charged.map((date) => [recordKey(line.id, date), { planned: 'LV' }]));
        const before = validateRoster(rules, lines, lookup, leave.startDate, leave.endDate, isGenerated);
        const after = validateRoster(rules, lines, buildLookup(index, patches), leave.startDate, leave.endDate, isGenerated);
        breaksCoverage = [...new Set(newViolations(before, after).filter((v: Violation) => v.rule === 'coverage_gap').map((v) => v.date))];
      }
    }
    requests.push({ leave, breaksCoverage });
  }

  // --- Coverage reliability, month to date ---
  const reliability = { slots: 0, asPlanned: 0, callIn: 0, gaps: 0, unconfirmed: 0 };
  for (const date of elapsed) {
    const cells = lines.map((line) => lookup(line.id, date)).filter((cell): cell is RosterCell => cell !== null);
    if (cells.length === 0) continue;
    for (const code of needed) {
      reliability.slots += 1;
      const planned = cells.find((c) => c.planned === code && !isAbsent(c.status));
      if (planned?.status === 'worked') reliability.asPlanned += 1;
      else if (planned) reliability.unconfirmed += 1;
      else if (cells.some((c) => c.worked === code && c.planned !== code)) reliability.callIn += 1;
      else reliability.gaps += 1;
    }
  }

  const rotation = dashboardLines.filter((d) => lines.find((l) => l.id === d.lineId)?.cycleOffset !== null);
  const spread = (pick: (d: DashboardLine) => number) =>
    rotation.length ? Math.max(...rotation.map(pick)) - Math.min(...rotation.map(pick)) : 0;
  const worked = dashboardLines.reduce((sum, d) => sum + d.payroll.workedHours, 0);

  return {
    today,
    month,
    quarter,
    cycle,
    rules,
    now,
    coverage,
    restWarnings,
    lines: dashboardLines,
    callIns,
    callInRate: rotation.length ? round(callIns.length / rotation.length) : null,
    requests,
    reliability,
    utilization: weeksElapsed > 0 && lines.length ? round(worked / (rules.targetHours7d * weeksElapsed * lines.length)) : null,
    fairness: { nights: spread((d) => d.nights), weekends: spread((d) => d.weekendShifts), holidays: spread((d) => d.holidayShifts) },
    months,
    compliance,
  };
}
