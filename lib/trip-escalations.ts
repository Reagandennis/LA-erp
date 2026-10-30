import 'server-only';

import { isEmailConfigured } from './email';
import { notifyNotificationsChanged } from './notification-events';
import { getOrganizationSettings } from './organization';
import { prisma } from './prisma';
import { emailTripEscalation } from './transactional-email';
import type { TripLogEntryDto } from './trip-log';

/**
 * Escalations on the trip log. An admin chooses who is told (Admin →
 * Organization); each of them gets a notification in the bell and one email
 * when an entry is escalated, except whoever escalated it.
 */

/** What came of telling people; the log panel reports it. */
export interface EscalationOutcome {
  /** People on the list, besides whoever escalated. */
  recipients: number;
  notified: number;
  emailed: number;
  /** Why the email didn't go, when it didn't. */
  emailError: string | null;
}

export interface EscalationRecipient {
  id: number;
  name: string;
  email: string;
}

export interface TripEscalationNotificationSummary {
  id: number;
  entryId: number;
  tripId: number;
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

/** The users an admin chose, still active, in the order they were chosen. */
export async function listEscalationRecipients(): Promise<EscalationRecipient[]> {
  const { escalationRecipientIds } = await getOrganizationSettings();
  if (escalationRecipientIds.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: escalationRecipientIds }, status: 'active' },
    select: { id: true, name: true, email: true },
  });
  return users.sort((a, b) => escalationRecipientIds.indexOf(a.id) - escalationRecipientIds.indexOf(b.id));
}

/** Tell the escalation list about an escalated entry. Never throws: the entry is already saved. */
export async function notifyTripEscalation(params: {
  tripId: number;
  entry: TripLogEntryDto;
  actor: { id: number; name: string };
  /** The trip's page, for the email's button. */
  tripUrl: string;
}): Promise<EscalationOutcome> {
  const outcome: EscalationOutcome = { recipients: 0, notified: 0, emailed: 0, emailError: null };
  try {
    const recipients = (await listEscalationRecipients()).filter((r) => r.id !== params.actor.id);
    outcome.recipients = recipients.length;
    if (recipients.length === 0) return outcome;

    const trip = await prisma.trip.findUnique({
      where: { id: params.tripId },
      select: { reference: true, title: true, country: true, customer: { select: { name: true } } },
    });
    if (!trip) return outcome;

    const message = `${trip.reference} escalated by ${params.actor.name}: ${excerpt(params.entry.detail)}`;
    const created = await prisma.tripLogNotification.createMany({
      data: recipients.map((r) => ({ userId: r.id, entryId: params.entry.id, type: 'trip.escalated', message })),
    });
    outcome.notified = created.count;
    notifyNotificationsChanged(recipients.map((r) => r.id));

    if (!isEmailConfigured()) {
      outcome.emailError = 'Email is not set up on the server.';
      return outcome;
    }
    try {
      await emailTripEscalation({
        recipients,
        trip: { reference: trip.reference, title: trip.title, customer: trip.customer.name, country: trip.country },
        entry: params.entry,
        escalatedBy: params.actor.name,
        tripUrl: params.tripUrl,
      });
      outcome.emailed = recipients.length;
    } catch (error) {
      outcome.emailError = error instanceof Error ? error.message : 'The email could not be sent.';
      console.error('[trip-escalations] email failed:', error);
    }
  } catch (error) {
    console.error('[trip-escalations] notifying failed:', error);
    if (!outcome.emailError) outcome.emailError = 'The escalation could not be sent on.';
  }
  return outcome;
}

export async function listTripEscalationNotifications(userId: number): Promise<TripEscalationNotificationSummary[]> {
  const rows = await prisma.tripLogNotification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, entryId: true, type: true, message: true, createdAt: true, readAt: true, entry: { select: { tripId: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    entryId: row.entryId,
    tripId: row.entry.tripId,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }));
}

export async function markTripEscalationNotificationsRead(userId: number, ids: number[]): Promise<number> {
  const wanted = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (wanted.length === 0) return 0;
  const { count } = await prisma.tripLogNotification.updateMany({
    where: { userId, id: { in: wanted }, readAt: null },
    data: { readAt: new Date() },
  });
  if (count > 0) notifyNotificationsChanged(userId);
  return count;
}
