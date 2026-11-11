import 'server-only';

import { notifyNotificationsChanged } from './notification-events';
import { prisma } from './prisma';
import { ADMIN_ROLE_NAME } from './rbac';
import { plainText } from './rich-text';
import { getRules } from './shift-planning';
import { type IncomingShift, incomingShift, isAbsent, isRecordStatus, monthOf } from './shift-rules';

/**
 * Telling the incoming shift that a handover is waiting for them.
 *
 * Who that is comes from the Shift Planning roster: the people rostered on
 * the console shift that starts next (or has just started). When the roster
 * can't say — the month isn't published, or nobody on that shift has a login
 * — everyone who can open Handover is told instead, so a handover never goes
 * unannounced. The writer is never told about their own.
 */

export interface HandoverRecipient {
  id: number;
  name: string;
}

/** Who a handover goes to, and how that was worked out. */
export interface HandoverAudience {
  /** `roster`: the next shift's people. `access`: everyone with Handover. `none`: nobody else to tell. */
  via: 'roster' | 'access' | 'none';
  /** The shift the roster points at, when it has one, whoever ends up being told. */
  shift: IncomingShift | null;
  recipients: HandoverRecipient[];
}

/** What the writer is shown after saving. */
export interface HandoverNotified {
  via: HandoverAudience['via'];
  shiftName: string | null;
  names: string[];
}

export interface HandoverNotificationSummary {
  id: number;
  handoverId: number;
  type: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

const EXCERPT = 140;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat;
}

/** The people rostered on a shift who can be reached: on duty (not sick, on leave or absent) and with an active login. */
async function rosteredOn(shift: IncomingShift, exceptUserId: number): Promise<HandoverRecipient[]> {
  // A draft month is still being moved around; staff can't see it either.
  const month = await prisma.shiftMonth.findUnique({ where: { month: monthOf(shift.date) }, select: { status: true } });
  if (month?.status !== 'published') return [];

  const records = await prisma.shiftRecord.findMany({
    where: { date: shift.date, line: { active: true, userId: { not: null } } },
    select: {
      plannedCode: true,
      workedCode: true,
      status: true,
      line: { select: { sortOrder: true, user: { select: { id: true, name: true, status: true } } } },
    },
    orderBy: [{ line: { sortOrder: 'asc' } }],
  });
  return records
    .filter((record) => {
      // A call-in works a different shift from the one planned.
      if ((record.workedCode ?? record.plannedCode) !== shift.code) return false;
      if (isRecordStatus(record.status) && isAbsent(record.status)) return false;
      const user = record.line.user;
      return Boolean(user && user.status === 'active' && user.id !== exceptUserId);
    })
    .map((record) => ({ id: record.line.user!.id, name: record.line.user!.name }));
}

/** Everyone who can open the Handover module: by their own grant, through a role, or as an admin. */
async function everyoneWithAccess(exceptUserId: number): Promise<HandoverRecipient[]> {
  const handover = { module: { slug: 'handover' } };
  return prisma.user.findMany({
    where: {
      status: 'active',
      id: { not: exceptUserId },
      OR: [
        { userModules: { some: handover } },
        { userRoles: { some: { role: { OR: [{ name: ADMIN_ROLE_NAME }, { roleModules: { some: handover } }] } } } },
      ],
    },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }],
  });
}

/** Who a handover written now, by this person, should reach. */
export async function handoverAudience(writerId: number, nowMs: number = Date.now()): Promise<HandoverAudience> {
  const shift = incomingShift(await getRules(), nowMs);
  if (shift) {
    const rostered = await rosteredOn(shift, writerId);
    if (rostered.length > 0) return { via: 'roster', shift, recipients: rostered };
  }
  const everyone = await everyoneWithAccess(writerId);
  return { via: everyone.length > 0 ? 'access' : 'none', shift, recipients: everyone };
}

/** The line the bell shows: who handed over which shift, and the start of what they wrote. */
export function handoverMessage(
  handover: { shiftPeriod: string; status: string; summary: string },
  writerName: string,
): string {
  const flag = handover.status === 'Urgent' || handover.status === 'Attention' ? `${handover.status}: ` : '';
  return `${flag}${writerName} handed over the ${handover.shiftPeriod} shift: ${excerpt(plainText(handover.summary))}`;
}

/**
 * Puts a new handover in the incoming shift's bell. Never throws: the
 * handover is already saved, and failing to announce it must not lose it.
 */
export async function notifyIncomingShift(params: {
  handover: { id: number; shiftPeriod: string; status: string; summary: string };
  writer: { id: number; name: string };
  nowMs?: number;
}): Promise<HandoverNotified> {
  try {
    const audience = await handoverAudience(params.writer.id, params.nowMs);
    if (audience.recipients.length > 0) {
      const message = handoverMessage(params.handover, params.writer.name);
      await prisma.handoverNotification.createMany({
        data: audience.recipients.map((recipient) => ({
          userId: recipient.id,
          handoverId: params.handover.id,
          type: 'handover.new',
          message,
        })),
      });
      notifyNotificationsChanged(audience.recipients.map((recipient) => recipient.id));
    }
    return {
      via: audience.via,
      shiftName: audience.shift?.name ?? null,
      names: audience.recipients.map((recipient) => recipient.name),
    };
  } catch (error) {
    console.error('[handover-notifications] notifying failed:', error);
    return { via: 'none', shiftName: null, names: [] };
  }
}

export async function listHandoverNotifications(userId: number): Promise<HandoverNotificationSummary[]> {
  const rows = await prisma.handoverNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, handoverId: true, type: true, message: true, createdAt: true, readAt: true },
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }));
}

export async function markHandoverNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const wanted = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (wanted.length === 0) return 0;
  const { count } = await prisma.handoverNotification.updateMany({
    where: { userId, id: { in: wanted }, readAt: null },
    data: { readAt: new Date() },
  });
  if (count > 0) notifyNotificationsChanged(userId);
  return count;
}

/**
 * A handover someone has acknowledged no longer needs anyone's attention:
 * it leaves every bell it was still unread in. Never throws.
 */
export async function settleHandoverNotifications(handoverId: number): Promise<void> {
  try {
    const open = await prisma.handoverNotification.findMany({
      where: { handoverId, readAt: null },
      select: { userId: true },
    });
    if (open.length === 0) return;
    await prisma.handoverNotification.updateMany({ where: { handoverId, readAt: null }, data: { readAt: new Date() } });
    notifyNotificationsChanged(open.map((row) => row.userId));
  } catch (error) {
    console.error('[handover-notifications] settling failed:', error);
  }
}
