import 'server-only';

import { currentMonth, listLeaves, myShifts, teamRoster } from '@/lib/shift-planning';
import { LEAVE_LABEL, LEAVE_TYPES, POSITION_LABEL, type ShiftRules, codeDef, monthDates } from '@/lib/shift-rules';
import { type LineView, type RecordView, writtenCode } from '@/lib/shift-types';
import { weekdayOf } from '@/lib/zoned-time';

import { asString, type ToolDefinition, ToolRefusal } from '../types';
import { matches, optDate, optEnum, pageOf } from './_shared';

/**
 * Shift Planning, read only. Two levels, as lib/shift-planning-route.ts has
 * them: staff hold Shift Planning and read their own published shifts;
 * a scheduler (Shift Planning Admin, or an admin) reads everyone's.
 */
const SHIFT_MODULE = 'shift-planning';
const SHIFT_ADMIN_MODULE = 'shift-planning-admin';

const PAGE_SIZE = 20;
const LEAVE_STATUSES = ['pending', 'approved', 'declined', 'cancelled'] as const;

const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

/** A month written YYYY-MM; anything else is refused rather than read as "this month". */
function optMonth(args: Record<string, unknown>, key: string): string | undefined {
  const raw = args[key];
  if (raw === undefined || raw === null) return undefined;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new ToolRefusal(`${key} must be a month written YYYY-MM (got "${String(raw).slice(0, 30)}").`);
  }
  return text;
}

/** "D", or the roster's own code with its name and hours: "Day 07:00-15:00". */
function describeCode(rules: ShiftRules, record: Pick<RecordView, 'plannedCode' | 'label'>): string {
  const def = codeDef(rules, record.plannedCode, record.label);
  return def.start && def.end ? `${def.name} ${def.start}-${def.end}` : def.name;
}

/**
 * A month of codes as runs: "1-2:D 3-4:S 5-6:N 7-10:X". A day with nothing
 * saved is "-". A rotation is mostly runs, so this is a fraction of a row per day.
 */
function monthRuns(month: string, codeOn: (date: string) => string | null): string {
  const runs: Array<{ from: number; to: number; code: string }> = [];
  for (const date of monthDates(month)) {
    const day = Number(date.slice(8));
    const code = codeOn(date) ?? '-';
    const last = runs[runs.length - 1];
    if (last && last.code === code) last.to = day;
    else runs.push({ from: day, to: day, code });
  }
  return runs.map((run) => `${run.from === run.to ? run.from : `${run.from}-${run.to}`}:${run.code}`).join(' ');
}

function legend(rules: ShiftRules, records: RecordView[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const record of records) out[writtenCode(record)] ??= describeCode(rules, record);
  return out;
}

/** What someone is rostered for on a day: the code as written, its name and hours, and what came of it. */
function shiftFacts(rules: ShiftRules, record: RecordView) {
  const def = codeDef(rules, record.plannedCode, record.label);
  return {
    shift: writtenCode(record),
    name: def.name,
    ...(def.start && def.end ? { hours: `${def.start}-${def.end}` } : {}),
    ...(record.status !== 'planned' ? { status: record.status } : {}),
    ...(record.callIn ? { calledIn: true } : {}),
    ...(record.note ? { note: clip(record.note, 120) } : {}),
  };
}

function dayRow(rules: ShiftRules, record: RecordView) {
  return { date: record.date, weekday: weekdayOf(record.date, 'en-GB').slice(0, 3), ...shiftFacts(rules, record) };
}

const positionOf = (line: Pick<LineView, 'position'>) => POSITION_LABEL[line.position] ?? line.position;

const myShiftsTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: [SHIFT_MODULE, SHIFT_ADMIN_MODULE],
  functionDeclaration: {
    name: 'get_my_shifts',
    description:
      "The user's own shifts for a month (published months only): the month as runs of codes, the next two weeks day by day, totals, leave balance and leave requests. Never anyone else's.",
    parameters: {
      type: 'object',
      properties: { month: { type: 'string', description: 'YYYY-MM; this month when left out' } },
    },
  },
  async handler(args, ctx) {
    const month = optMonth(args, 'month') ?? (await currentMonth());
    // Always the caller's own id, as /api/shift-planning/me does.
    const mine = await myShifts(ctx.userId, month);
    const href = '/modules/shift-planning';
    if (!mine.line) {
      return { month, onRoster: false, note: 'This user is not on the shift roster, so they have no shifts.', href };
    }
    const published = mine.month.status === 'published';
    const byDate = new Map(mine.records.map((record) => [record.date, record]));
    const balance = mine.balance;
    return {
      month,
      today: mine.today,
      onRoster: true,
      line: mine.line.code,
      position: positionOf(mine.line),
      published,
      ...(published
        ? {
            days: monthRuns(month, (date) => {
              const record = byDate.get(date);
              return record ? writtenCode(record) : null;
            }),
            totals: {
              shifts: mine.totals.shifts,
              hours: mine.totals.hours,
              nights: mine.totals.nights,
              weekendShifts: mine.totals.weekendShifts,
              holidayShifts: mine.totals.holidayShifts,
              callIns: mine.totals.callIns,
            },
          }
        : { note: `The roster for ${month} has not been published to staff yet.` }),
      codes: legend(mine.rules, [...mine.records, ...mine.upcoming]),
      // Yesterday through the next two weeks, from published months only.
      upcoming: mine.upcoming.map((record) => dayRow(mine.rules, record)),
      holidays: mine.holidays.filter((h) => h.date.startsWith(month)).map((h) => ({ date: h.date, name: h.name })),
      ...(balance
        ? {
            leave: {
              annualBalanceDays: balance.balance,
              annualTaken: balance.taken,
              annualPending: balance.pending,
              sickDaysLast12Months: balance.sick12m,
              compensatoryDaysBalance: balance.cto.balance,
            },
          }
        : {}),
      leaveRequests: mine.leaves.slice(0, 6).map((leave) => ({
        id: leave.id,
        type: LEAVE_LABEL[leave.type],
        start: leave.startDate,
        end: leave.endDate,
        days: leave.days,
        status: leave.status,
      })),
      href,
    };
  },
};

const rosterTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  // Everyone's shifts: a scheduler's view, as /api/shift-planning/roster requires.
  requiredModule: SHIFT_ADMIN_MODULE,
  functionDeclaration: {
    name: 'get_shift_roster',
    description:
      "Everyone's roster (schedulers only), drafts included. With `date`: who is on which shift that day. Without: each person's month as runs of codes. 20 people per page.",
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM; this month when left out' },
        date: { type: 'string', description: 'YYYY-MM-DD: one day instead of the month' },
        q: { type: 'string', description: 'Name, billet code (TRC-1) or position' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const date = optDate(args, 'date') ?? undefined;
    const asked = optMonth(args, 'month');
    if (date && asked && !date.startsWith(asked)) throw new ToolRefusal(`date ${date} is not in month ${asked}. Pass one or the other.`);
    const month = date ? date.slice(0, 7) : (asked ?? (await currentMonth()));
    const q = asString(args.q);

    const roster = await teamRoster(month);
    const byLine = new Map<number, Map<string, RecordView>>();
    for (const record of roster.records) {
      let days = byLine.get(record.lineId);
      if (!days) byLine.set(record.lineId, (days = new Map()));
      days.set(record.date, record);
    }
    const lines = roster.lines.filter((line) => matches(q, line.name, line.code, positionOf(line)));
    const head = {
      month,
      today: roster.today,
      // A draft is the scheduler's working copy: staff cannot see it yet.
      status: roster.month.status === 'none' ? 'not generated' : roster.month.status,
      href: '/modules/shift-planning-admin',
    };

    if (date) {
      const onDay = lines.flatMap((line) => {
        const record = byLine.get(line.id)?.get(date);
        return record ? [{ line: line.code, person: line.name, position: positionOf(line), ...shiftFacts(roster.rules, record) }] : [];
      });
      const { rows, page, total, more } = pageOf(onDay, args, PAGE_SIZE);
      return {
        ...head,
        date,
        total,
        page,
        more,
        people: rows,
        holiday: roster.holidays.find((h) => h.date === date)?.name ?? null,
        ...(total === 0 ? { note: q ? `Nobody matching "${q}" has a shift saved for ${date}.` : `Nothing is saved on the roster for ${date}.` } : {}),
      };
    }

    const { rows, page, total, more } = pageOf(lines, args, PAGE_SIZE);
    const shown = rows.flatMap((line) => [...(byLine.get(line.id)?.values() ?? [])]);
    return {
      ...head,
      total,
      page,
      more,
      codes: legend(roster.rules, shown),
      people: rows.map((line) => ({
        line: line.code,
        person: line.name,
        position: positionOf(line),
        days: monthRuns(month, (day) => {
          const record = byLine.get(line.id)?.get(day);
          return record ? writtenCode(record) : null;
        }),
      })),
      holidays: roster.holidays.map((h) => ({ date: h.date, name: h.name })),
      ...(total === 0 && q ? { note: `Nobody on the roster matches "${q}".` } : {}),
    };
  },
};

const leaveTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  // Everyone's leave: read by the scheduler's admin screens only.
  requiredModule: SHIFT_ADMIN_MODULE,
  functionDeclaration: {
    name: 'list_shift_leave',
    description:
      "Leave on the shift roster for everyone (schedulers only): who, type, dates, days, status. Filter by person, type, status, or leave ending on or after a date. Newest first, 20 per page.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Person or billet code' },
        status: { type: 'string', enum: [...LEAVE_STATUSES] },
        type: { type: 'string', enum: [...LEAVE_TYPES] },
        from: { type: 'string', description: 'YYYY-MM-DD: leave that ends on or after this date' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', LEAVE_STATUSES);
    const type = optEnum(args, 'type', LEAVE_TYPES);
    const from = optDate(args, 'from') ?? undefined;
    const leaves = await listLeaves(from ? { from } : {});
    const wanted = leaves.filter(
      (leave) => (!status || leave.status === status) && (!type || leave.type === type) && matches(q, leave.personName, leave.lineCode),
    );
    const { rows, page, total, more } = pageOf(wanted, args, PAGE_SIZE);
    return {
      total,
      page,
      more,
      pending: wanted.filter((leave) => leave.status === 'pending').length,
      leave: rows.map((leave) => ({
        id: leave.id,
        person: leave.personName,
        line: leave.lineCode,
        type: LEAVE_LABEL[leave.type],
        start: leave.startDate,
        end: leave.endDate,
        days: leave.days,
        status: leave.status,
        requestedBy: leave.requestedByName,
        decidedBy: leave.decidedByName,
        ...(leave.note ? { note: clip(leave.note, 160) } : {}),
      })),
      // The lib reads the 300 most recent periods.
      ...(leaves.length >= 300 ? { note: 'Only the 300 most recent leave periods are read; pass `from` to look at a later window.' } : {}),
      href: '/modules/shift-planning-admin',
    };
  },
};

export const shiftTools: ToolDefinition[] = [myShiftsTool, rosterTool, leaveTool];
