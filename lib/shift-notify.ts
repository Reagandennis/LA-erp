import 'server-only';

import { Prisma } from '@prisma/client';

import { APP_LOCALE } from './locale';
import { EmailError, escapeEmailHtml, isEmailConfigured, renderEmailLayout, sendEmail } from './email';
import { getOrganizationSettings } from './organization';
import { prisma } from './prisma';
import {
  type CalendarShift,
  type SentMap,
  type SentShift,
  type ShiftDiff,
  buildShiftCalendar,
  diffShifts,
  isEmptyDiff,
} from './shift-calendar';
import { getRules } from './shift-planning';
import { POSITION_LABEL, type ShiftRules, baseOf, codeDef, isPosition, isWorking, monthOf, zonedNow } from './shift-rules';

/**
 * Emails staff about their shifts.
 *
 * Diff-based, so it is safe to run after any roster change: each person linked
 * to a login account gets a welcome the first time, and afterwards an email
 * only when their upcoming published shifts differ from what they were last
 * sent: a month published, a shift changed, added or taken away. Every email
 * carries their upcoming shifts as an .ics file with stable event ids, so
 * opening it updates the calendar rather than adding copies.
 */

const SHIFTS_PATH = '/modules/shift-planning';
const UID_DOMAIN = 'shift-planning.la-erp';

export interface NoticeResult {
  configured: boolean;
  welcomed: string[];
  updated: string[];
  failed: Array<{ person: string; error: string }>;
}

interface Person {
  lineId: number;
  code: string;
  position: string;
  userId: number;
  name: string;
  email: string;
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(APP_LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function timeLabel(shift: CalendarShift): string {
  return shift.start && shift.end ? `${shift.start}–${shift.end}` : 'All day';
}

function shiftLabel(shift: CalendarShift): string {
  return shift.name && shift.name !== shift.code ? `${shift.name} (${shift.code})` : shift.code;
}

/** A roster day as a calendar entry; null for a rest day. */
function calendarShift(rules: ShiftRules, row: { date: string; plannedCode: string; workedCode: string | null; status: string }): CalendarShift | null {
  const written = row.workedCode ?? row.plannedCode;
  const base = baseOf(rules, written);
  if (!base || base === 'X') return null;
  const def = codeDef(rules, base, written);
  const calledIn = row.workedCode !== null && (row.status === 'call-in' || row.status === 'cover');
  return {
    date: row.date,
    code: written,
    name: calledIn ? `Called in: ${def.name}` : def.name,
    start: isWorking(base) ? def.start : null,
    end: isWorking(base) ? def.end : null,
  };
}

function readSent(value: Prisma.JsonValue): SentMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as unknown as SentMap) : {};
}

// --- Email bodies --------------------------------------------------------------

const CELL = 'padding:6px 12px 6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;vertical-align:top;';

function shiftTable(shifts: CalendarShift[]): string {
  if (shifts.length === 0) return '';
  const rows = shifts
    .map(
      (s) =>
        `<tr><td style="${CELL}white-space:nowrap;color:#6b7280;">${escapeEmailHtml(dayLabel(s.date))}</td><td style="${CELL}font-weight:600;">${escapeEmailHtml(shiftLabel(s))}</td><td style="${CELL}white-space:nowrap;">${escapeEmailHtml(timeLabel(s))}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 16px;border-collapse:collapse;color:#374151;">${rows}</table>`;
}

function changeTable(diff: ShiftDiff): string {
  const rows = [
    ...diff.changed.map((c) => ({ date: c.after.date, before: `${shiftLabel(c.before)}, ${timeLabel(c.before)}`, after: `${shiftLabel(c.after)}, ${timeLabel(c.after)}` })),
    ...diff.added.map((s) => ({ date: s.date, before: 'Nothing rostered', after: `${shiftLabel(s)}, ${timeLabel(s)}` })),
    ...diff.removed.map((s) => ({ date: s.date, before: `${shiftLabel(s)}, ${timeLabel(s)}`, after: 'Rest day / removed' })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return '';
  const body = rows
    .map(
      (r) =>
        `<tr><td style="${CELL}white-space:nowrap;color:#6b7280;">${escapeEmailHtml(dayLabel(r.date))}</td><td style="${CELL}color:#9ca3af;text-decoration:line-through;">${escapeEmailHtml(r.before)}</td><td style="${CELL}font-weight:600;">${escapeEmailHtml(r.after)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 16px;border-collapse:collapse;color:#374151;"><tr><td style="${CELL}color:#6b7280;">Date</td><td style="${CELL}color:#6b7280;">Was</td><td style="${CELL}color:#6b7280;">Now</td></tr>${body}</table>`;
}

const CALENDAR_NOTE =
  '<p style="font-size:13px;color:#6b7280;">The attached <strong>shifts.ics</strong> holds your upcoming shifts. Open it to add them to Google Calendar, Outlook or Apple Calendar. Each shift keeps the same calendar id, so opening a newer file from us updates your existing events instead of adding duplicates.</p>';

function months(shifts: CalendarShift[]): string[] {
  return [...new Set(shifts.map((s) => monthOf(s.date)))].sort();
}

function joinMonths(list: string[]): string {
  const labels = list.map(monthLabel);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// --- Sending -------------------------------------------------------------------

async function sendTo(
  person: Person,
  content: { subject: string; title: string; bodyHtml: string },
  calendar: SentShift[],
  ctx: { orgName: string; rules: ShiftRules; url: string },
): Promise<void> {
  const html = renderEmailLayout({
    title: content.title,
    bodyHtml: content.bodyHtml,
    organizationName: ctx.orgName,
    cta: { label: 'View my shifts', url: ctx.url },
  });
  const ics =
    calendar.length > 0
      ? buildShiftCalendar(calendar, {
          uidPrefix: String(person.lineId),
          uidDomain: UID_DOMAIN,
          timeZone: ctx.rules.timeZone,
          calendarName: `${ctx.orgName} shifts`,
          personLabel: `${person.name} (${person.code})`,
          url: ctx.url,
        })
      : null;
  await sendEmail({
    to: person.email,
    subject: content.subject,
    html,
    attachments: ics ? [{ filename: 'shifts.ics', content: Buffer.from(ics, 'utf8'), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : undefined,
  });
}

function welcomeContent(person: Person, shifts: CalendarShift[], orgName: string) {
  const position = isPosition(person.position) ? POSITION_LABEL[person.position] : 'Team member';
  const published = months(shifts);
  const roster = shifts.length
    ? `<p>Your published shifts for ${escapeEmailHtml(joinMonths(published))}:</p>${shiftTable(shifts)}${CALENDAR_NOTE}`
    : '<p>No roster month has been published for you yet. You will get an email with your shifts and a calendar file as soon as one is.</p>';
  return {
    subject: `Welcome to ${orgName} shift planning`,
    title: `Welcome, ${person.name}`,
    bodyHtml: `
      <p>Hi ${escapeEmailHtml(person.name)},</p>
      <p>Welcome to the ${escapeEmailHtml(orgName)} platform. You are on the shift roster as <strong>${escapeEmailHtml(person.code)}</strong> (${escapeEmailHtml(position)}).</p>
      <p>Sign in with <strong>${escapeEmailHtml(person.email)}</strong> to see your shifts and request leave. From now on we will email you whenever a roster month is published, and whenever one of your published shifts changes, with a calendar file to keep your calendar up to date.</p>
      ${roster}`,
  };
}

function updateContent(person: Person, diff: ShiftDiff) {
  const publishedMonths = months(diff.published);
  const changes = diff.changed.length + diff.added.length + diff.removed.length;
  const parts: string[] = [`<p>Hi ${escapeEmailHtml(person.name)},</p>`];
  if (diff.published.length > 0) {
    parts.push(`<p>Your roster for <strong>${escapeEmailHtml(joinMonths(publishedMonths))}</strong> has been published:</p>${shiftTable(diff.published)}`);
  }
  if (changes > 0) {
    parts.push(`<p>${diff.published.length > 0 ? 'Your other published shifts have also changed' : 'Your published shifts have changed'}:</p>${changeTable(diff)}`);
  }
  parts.push(CALENDAR_NOTE);
  const subject =
    diff.published.length > 0
      ? `Your ${joinMonths(publishedMonths)} shifts are published`
      : `Shift change: ${changes} ${changes === 1 ? 'shift' : 'shifts'} updated`;
  return { subject: `${subject} (${person.code})`, title: diff.published.length > 0 ? 'Your shifts are published' : 'Your shifts have changed', bodyHtml: parts.join('\n') };
}

/** Checks every linked person and emails those with something new. */
async function run(origin: string): Promise<NoticeResult> {
  const result: NoticeResult = { configured: isEmailConfigured(), welcomed: [], updated: [], failed: [] };
  if (!result.configured) return result;

  const rules = await getRules();
  const today = zonedNow(rules.timeZone, Date.now()).date;
  const [lineRows, monthRows, notices, organization] = await Promise.all([
    prisma.shiftLine.findMany({
      where: { active: true, userId: { not: null } },
      include: { user: { select: { id: true, name: true, email: true, status: true } } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.shiftMonth.findMany({ where: { status: 'published', month: { gte: monthOf(today) } }, select: { month: true } }),
    prisma.shiftNotice.findMany(),
    getOrganizationSettings(),
  ]);
  const orgName = organization.companyName || 'GeoSecure';
  const url = new URL(SHIFTS_PATH, origin).toString();
  const published = new Set(monthRows.map((m) => m.month));
  const inScope = (date: string) => published.has(monthOf(date));

  const people: Person[] = lineRows
    .filter((row) => row.user && row.user.status === 'active' && row.user.email?.includes('@'))
    .map((row) => ({
      lineId: row.id,
      code: row.code,
      position: row.position,
      userId: row.user!.id,
      name: row.user!.name,
      email: row.user!.email.trim(),
    }));
  if (people.length === 0) return result;

  const records = await prisma.shiftRecord.findMany({
    where: { lineId: { in: people.map((p) => p.lineId) }, date: { gte: today } },
    select: { lineId: true, date: true, plannedCode: true, workedCode: true, status: true },
    orderBy: { date: 'asc' },
  });
  const noticeOf = new Map(notices.map((n) => [n.lineId, n]));

  for (const person of people) {
    const current = records
      .filter((r) => r.lineId === person.lineId && inScope(r.date))
      .map((r) => calendarShift(rules, r))
      .filter((s): s is CalendarShift => s !== null);
    const notice = noticeOf.get(person.lineId);
    const fresh = !notice || notice.userId !== person.userId || notice.email.toLowerCase() !== person.email.toLowerCase();
    const ctx = { orgName, rules, url };
    try {
      if (fresh) {
        const sent: SentMap = Object.fromEntries(current.map((s) => [s.date, { ...s, seq: 0 }]));
        await sendTo(person, welcomeContent(person, current, orgName), Object.values(sent), ctx);
        const data = { userId: person.userId, email: person.email, welcomedAt: new Date(), sent: sent as unknown as Prisma.InputJsonValue, lastSentAt: new Date() };
        await prisma.shiftNotice.upsert({ where: { lineId: person.lineId }, create: { lineId: person.lineId, ...data }, update: data });
        result.welcomed.push(`${person.code} ${person.name}`);
        continue;
      }
      const { diff, next } = diffShifts(readSent(notice.sent), current, inScope, today);
      if (isEmptyDiff(diff)) continue;
      // The file carries every upcoming shift this email speaks for, and the ones it cancels.
      const calendar = Object.values(next).filter((s) => inScope(s.date));
      await sendTo(person, updateContent(person, diff), calendar, ctx);
      await prisma.shiftNotice.update({
        where: { lineId: person.lineId },
        data: { sent: next as unknown as Prisma.InputJsonValue, lastSentAt: new Date() },
      });
      result.updated.push(`${person.code} ${person.name}`);
    } catch (error) {
      const message = error instanceof EmailError || error instanceof Error ? error.message : 'Unknown error';
      result.failed.push({ person: `${person.code} ${person.name}`, error: message });
      console.error('[shift-notify]', person.code, message);
    }
  }
  if (result.welcomed.length || result.updated.length) {
    console.log('[shift-notify]', `welcomed ${result.welcomed.length}, updated ${result.updated.length}, failed ${result.failed.length}`);
  }
  return result;
}

let chain: Promise<unknown> = Promise.resolve();

/**
 * Runs the check after whatever is already queued, so two saves in quick
 * succession never email the same change twice.
 */
export function sendShiftNotices(origin: string): Promise<NoticeResult> {
  const next = chain.then(() => run(origin));
  chain = next.catch((error) => console.error('[shift-notify]', error));
  return next;
}

export interface NoticeStatus {
  configured: boolean;
  people: Array<{ lineId: number; code: string; name: string; email: string | null; welcomedAt: string | null; lastSentAt: string | null }>;
}

/** Who is linked and when they were last emailed, for the People tab. */
export async function noticeStatus(): Promise<NoticeStatus> {
  const [lines, notices] = await Promise.all([
    prisma.shiftLine.findMany({
      where: { active: true, userId: { not: null } },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.shiftNotice.findMany(),
  ]);
  const noticeOf = new Map(notices.map((n) => [n.lineId, n]));
  return {
    configured: isEmailConfigured(),
    people: lines.map((line) => {
      const notice = noticeOf.get(line.id);
      const current = notice && notice.userId === line.userId && notice.email.toLowerCase() === (line.user?.email ?? '').trim().toLowerCase();
      return {
        lineId: line.id,
        code: line.code,
        name: line.user?.name ?? line.code,
        email: line.user?.email ?? null,
        welcomedAt: current ? notice.welcomedAt.toISOString() : null,
        lastSentAt: current ? (notice.lastSentAt?.toISOString() ?? null) : null,
      };
    }),
  };
}
