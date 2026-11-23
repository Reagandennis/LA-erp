import 'server-only';

import { prisma } from './prisma';
import { generatedCheck, generatedMonths, getRules, leaveBalances, leaveDates, listAudit, listHolidays, listLeaves, listLines, listMonths, loadRecords } from './shift-planning';
import {
  CONSOLE_CODES,
  type Duty,
  type RosterCell,
  type Violation,
  absoluteMinutes,
  addDays,
  addMonths,
  cycleRange,
  datesBetween,
  dutyOf,
  isAbsent,
  codeDef,
  isWorkday,
  isWorking,
  lineTotals,
  minutesOf,
  monthEnd,
  monthOf,
  monthStart,
  newViolations,
  payrollTotals,
  tagOf,
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
  EMPTY_LEAVE_BALANCE,
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

  // Three months back for the hiring signal, whichever quarter they fall in.
  const from = addDays([quarter.from, cycle.from, monthStart(addMonths(month, -2))].sort()[0] as string, -14);
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
        return line.position === 'trc' && cell?.planned === 'OC' && cell.worked === null;
      })
      .map((line) => line.name),
    fallback: isWorkday(today, holidaySet)
      ? lines
          .filter((line) => {
            const cell = lookup(line.id, today);
            return line.position === 'pc' && cell !== null && cell.worked === null && !isAbsent(cell.status) && tagOf(rules, cell.label) === 'pc';
          })
          .map((line) => line.name)
      : [],
    drivers: lines
      .filter((line) => line.position === 'driver')
      .flatMap((line) => {
        // Last night's shift may still be running this morning.
        const running = current.find((c) => c.name === line.name);
        const cell = lookup(line.id, running ? running.duty.date : today);
        const duty = running?.duty ?? dutyOf(rules, cell, today);
        if (!cell || !duty) return [];
        const def = codeDef(rules, cell.planned, cell.label);
        return [{ name: line.name, code: cell.label ?? cell.planned, start: cell.start ?? def.start, end: cell.end ?? def.end, active: Boolean(running) }];
      }),
    nextHandover: handover === null ? null : timeOfAbsolute(handover),
  };

  // --- The next 14 days ---
  const aheadDates = datesBetween(today, horizon);
  const generated = new Set(records.map((r) => r.date));
  const ahead = validateRoster(rules, lines, lookup, today, horizon, isGenerated, holidaySet).filter((v) => generated.has(v.date));
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
    const workDays7 = datesBetween(addDays(today, -6), today).filter((date) => dutyOf(rules, lookup(line.id, date), date) !== null).length;
    // Amber at the 48-hour target is the TRCs'; seven work days running is red for anyone.
    const tone: Tone =
      Math.max(last7, next7) > rules.maxHours7d || workDays7 >= 7 ? 'danger' : line.position === 'trc' && last7 >= rules.targetHours7d ? 'warn' : 'ok';

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
          position: line.position,
          code: record.workedCode,
          trigger: record.callIn.trigger,
          source: record.callIn.source,
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

    const monthTotals = lineTotals(
      rules,
      datesBetween(monthFrom, monthTo).map((date) => ({ date, cell: lookup(line.id, date) })),
      holidaySet,
    );

    return {
      lineId: line.id,
      code: line.code,
      name: line.name,
      position: line.position,
      workDays7,
      awayMonth: monthTotals.away,
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
      leave: balances[line.id] ?? EMPTY_LEAVE_BALANCE,
    };
  });
  callIns.sort((a, b) => b.date.localeCompare(a.date));

  // --- Requests: would granting this leave a shift uncovered? ---
  const requests: DashboardRequest[] = [];
  for (const leave of leaves.filter((l) => l.status === 'pending')) {
    const line = lines.find((l) => l.id === leave.lineId);
    let breaksCoverage: string[] = [];
    if (line) {
      const away = leaveDates(line, leave.startDate, leave.endDate).filter((date) => index.has(recordKey(line.id, date)));
      if (away.length) {
        const patches = new Map<string, Partial<RosterCell>>(away.map((date) => [recordKey(line.id, date), { planned: 'LV', label: null, status: 'leave' }]));
        const before = validateRoster(rules, lines, lookup, leave.startDate, leave.endDate, isGenerated, holidaySet);
        const after = validateRoster(rules, lines, buildLookup(index, patches), leave.startDate, leave.endDate, isGenerated, holidaySet);
        breaksCoverage = [
          ...new Set(
            newViolations(before, after)
              .filter((v: Violation) => v.rule === 'coverage_gap' || v.rule === 'driver_coverage')
              .map((v) => v.date),
          ),
        ];
      }
    }
    requests.push({ leave, breaksCoverage });
  }

  // --- Coverage reliability, month to date: how each console shift was delivered ---
  const consoleLines = lines.filter((line) => line.position !== 'driver');
  const reliability = { slots: 0, asPlanned: 0, callIn: 0, cover: 0, overtime: 0, gaps: 0, unconfirmed: 0 };
  for (const date of elapsed) {
    const cells = consoleLines.map((line) => lookup(line.id, date)).filter((cell): cell is RosterCell => cell !== null);
    if (cells.length === 0) continue;
    for (const code of needed) {
      reliability.slots += 1;
      const planned = cells.find((c) => c.planned === code && !isAbsent(c.status));
      const brought = cells.find((c) => c.worked === code && c.planned !== code);
      if (planned?.status === 'worked') reliability.asPlanned += 1;
      else if (planned) reliability.unconfirmed += 1;
      else if (brought?.status === 'cover') reliability.cover += 1;
      else if (brought?.planned === 'X') reliability.overtime += 1;
      else if (brought) reliability.callIn += 1;
      else reliability.gaps += 1;
    }
  }

  // --- Project Coordinators: days as the weekday fallback, covers, and the desk days they cost ---
  const trcLines = lines.filter((line) => line.position === 'trc');
  const pcLines = lines.filter((line) => line.position === 'pc');
  const fallbackLoad = { fallbackDays: 0, covers: 0, deskDaysLost: 0 };
  for (const date of datesBetween(monthFrom, monthTo)) {
    const trcCells = trcLines.map((line) => lookup(line.id, date)).filter((cell): cell is RosterCell => cell !== null);
    const atDesk = pcLines.some((line) => {
      const cell = lookup(line.id, date);
      return cell !== null && cell.worked === null && !isAbsent(cell.status) && tagOf(rules, cell.label) === 'pc';
    });
    if (trcCells.length > 0 && isWorkday(date, holidaySet) && atDesk && !trcCells.some((cell) => cell.planned === 'OC')) fallbackLoad.fallbackDays += 1;
  }
  const coverRecords = records.filter((r) => r.date >= monthFrom && r.date <= monthTo && r.workedCode && pcLines.some((line) => line.id === r.lineId));
  fallbackLoad.covers = coverRecords.length;
  // Each cover takes its own desk day; a Night takes the next one too.
  fallbackLoad.deskDaysLost =
    coverRecords.length + coverRecords.filter((r) => r.workedCode === 'N' && isWorkday(addDays(r.date, 1), holidaySet)).length;

  // --- Drivers: working days with one on days and one on nights ---
  const driverLines = lines.filter((line) => line.position === 'driver');
  const driverCoverage = { met: 0, total: 0 };
  if (driverLines.length > 0) {
    for (const date of elapsed) {
      if (!isWorkday(date, holidaySet)) continue;
      const cells = driverLines.map((line) => lookup(line.id, date)).filter((cell): cell is RosterCell => cell !== null);
      if (cells.length === 0) continue;
      driverCoverage.total += 1;
      const on = (tag: 'driver_day' | 'driver_night') => cells.filter((c) => !isAbsent(c.status) && tagOf(rules, c.label) === tag).length;
      if (on('driver_day') === 1 && on('driver_night') === 1) driverCoverage.met += 1;
    }
  }

  // --- Hiring signal: call-ins per TRC per cycle, month by month ---
  const hiringMonths = [-2, -1, 0].map((back) => {
    const m = addMonths(month, back);
    const inMonth = records.filter((r) => monthOf(r.date) === m && r.callIn && r.workedCode);
    const days = datesBetween(monthStart(m), monthEnd(m)).filter((date) => date <= today).length;
    const cycles = days / rules.pattern.length;
    const trcCallIns = inMonth.filter((r) => trcLines.some((line) => line.id === r.lineId)).length;
    return {
      month: m,
      rate: trcLines.length > 0 && cycles > 0 && records.some((r) => monthOf(r.date) === m) ? round(trcCallIns / (trcLines.length * cycles)) : null,
      pcCovers: inMonth.filter((r) => pcLines.some((line) => line.id === r.lineId)).length,
    };
  });
  const lastTwo = hiringMonths.slice(-2);
  const hiring = { months: hiringMonths, signal: lastTwo.length === 2 && lastTwo.every((m) => m.rate !== null && m.rate > 1) };

  const trc = dashboardLines.filter((d) => d.position === 'trc');
  const spreadOf = (group: DashboardLine[], pick: (d: DashboardLine) => number) =>
    group.length ? Math.max(...group.map(pick)) - Math.min(...group.map(pick)) : 0;
  const trcWorked = trc.reduce((sum, d) => sum + d.payroll.workedHours, 0);
  const trcCycleCallIns = callIns.filter((c) => c.position === 'trc').length;

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
    // Call-ins per TRC in the cycle running now.
    callInRate: trc.length ? round(trcCycleCallIns / trc.length) : null,
    requests,
    reliability,
    utilization: weeksElapsed > 0 && trc.length ? round(trcWorked / (rules.targetHours7d * weeksElapsed * trc.length)) : null,
    fairness: {
      nights: spreadOf(trc, (d) => d.nights),
      weekends: spreadOf(trc, (d) => d.weekendShifts),
      holidays: spreadOf(trc, (d) => d.holidayShifts),
      callIns: spreadOf(trc, (d) => d.callInsThisCycle),
      driverNights: spreadOf(dashboardLines.filter((d) => d.position === 'driver'), (d) => d.nights),
    },
    fallbackLoad,
    driverCoverage,
    hiring,
    months,
    compliance,
  };
}
