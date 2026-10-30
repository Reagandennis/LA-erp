import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, getOrganizationSettings, emailTripEscalation, isEmailConfigured, notifyNotificationsChanged } = vi.hoisted(() => ({
  db: {
    user: { findMany: vi.fn() },
    trip: { findUnique: vi.fn() },
    tripLogNotification: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  },
  getOrganizationSettings: vi.fn(),
  emailTripEscalation: vi.fn(),
  isEmailConfigured: vi.fn(),
  notifyNotificationsChanged: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('../lib/organization', () => ({ getOrganizationSettings }));
vi.mock('../lib/transactional-email', () => ({ emailTripEscalation }));
vi.mock('../lib/email', () => ({ isEmailConfigured }));
vi.mock('../lib/notification-events', () => ({ notifyNotificationsChanged }));

import { listEscalationRecipients, markTripEscalationNotificationsRead, notifyTripEscalation } from '../lib/trip-escalations';

const entry = {
  id: 7,
  loggedAt: '2026-10-30T09:00:00.000Z',
  detail: 'Road closed on Mombasa Rd, rerouting via the Southern bypass. Client informed.',
  receivedFrom: 'Driver Peter',
  actionItem: 'Reroute',
  dutyController: 'Amina',
  comments: null,
  escalated: true,
  createdBy: { id: 1, name: 'Amina' },
  createdAt: '2026-10-30T09:00:00.000Z',
};
const amina = { id: 1, name: 'Amina' };

describe('trip escalations', () => {
  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
    getOrganizationSettings.mockReset();
    emailTripEscalation.mockReset();
    isEmailConfigured.mockReset();
    notifyNotificationsChanged.mockReset();
    getOrganizationSettings.mockResolvedValue({ escalationRecipientIds: [3, 1, 2] });
    db.user.findMany.mockResolvedValue([
      { id: 1, name: 'Amina', email: 'amina@example.com' },
      { id: 2, name: 'Reagan', email: 'reagan@example.com' },
      { id: 3, name: 'Kevin', email: 'kevin@example.com' },
    ]);
    db.trip.findUnique.mockResolvedValue({ reference: 'MCF-KEN-OCT-2661', title: 'Nairobi visit', country: 'Kenya', customer: { name: 'MCF' } });
    db.tripLogNotification.createMany.mockResolvedValue({ count: 2 });
    isEmailConfigured.mockReturnValue(true);
    emailTripEscalation.mockResolvedValue({ to: ['kevin@example.com', 'reagan@example.com'] });
  });

  it('lists the chosen people in the order they were chosen, active ones only', async () => {
    db.user.findMany.mockResolvedValue([{ id: 2, name: 'Reagan', email: 'r' }, { id: 3, name: 'Kevin', email: 'k' }]);
    expect((await listEscalationRecipients()).map((r) => r.id)).toEqual([3, 2]);
    expect(db.user.findMany.mock.calls[0]![0]).toMatchObject({ where: { id: { in: [3, 1, 2] }, status: 'active' } });
  });

  it('notifies and emails everyone on the list except whoever escalated', async () => {
    const outcome = await notifyTripEscalation({ tripId: 11, entry, actor: amina, tripUrl: 'https://erp.example/modules/trip-planning/11' });

    expect(outcome).toEqual({ recipients: 2, notified: 2, emailed: 2, emailError: null });
    const created = db.tripLogNotification.createMany.mock.calls[0]![0];
    expect(created.data.map((n: { userId: number }) => n.userId)).toEqual([3, 2]);
    expect(created.data[0]).toMatchObject({ entryId: 7, type: 'trip.escalated' });
    expect(created.data[0].message).toContain('MCF-KEN-OCT-2661 escalated by Amina: Road closed');
    expect(notifyNotificationsChanged).toHaveBeenCalledWith([3, 2]);
    expect(emailTripEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: [expect.objectContaining({ id: 3 }), expect.objectContaining({ id: 2 })],
        trip: { reference: 'MCF-KEN-OCT-2661', title: 'Nairobi visit', customer: 'MCF', country: 'Kenya' },
        escalatedBy: 'Amina',
        tripUrl: 'https://erp.example/modules/trip-planning/11',
      }),
    );
  });

  it('says so when no one is on the list, without touching the database', async () => {
    getOrganizationSettings.mockResolvedValue({ escalationRecipientIds: [] });
    expect(await notifyTripEscalation({ tripId: 11, entry, actor: amina, tripUrl: 'x' })).toEqual({ recipients: 0, notified: 0, emailed: 0, emailError: null });
    expect(db.tripLogNotification.createMany).not.toHaveBeenCalled();
    expect(emailTripEscalation).not.toHaveBeenCalled();
  });

  it('keeps the in-app notifications when email is off or fails', async () => {
    isEmailConfigured.mockReturnValue(false);
    expect(await notifyTripEscalation({ tripId: 11, entry, actor: amina, tripUrl: 'x' })).toMatchObject({ notified: 2, emailed: 0, emailError: 'Email is not set up on the server.' });

    isEmailConfigured.mockReturnValue(true);
    emailTripEscalation.mockRejectedValue(new Error('SMTP down'));
    expect(await notifyTripEscalation({ tripId: 11, entry, actor: amina, tripUrl: 'x' })).toMatchObject({ notified: 2, emailed: 0, emailError: 'SMTP down' });
  });

  it('marks only the viewer’s own unread notifications read', async () => {
    db.tripLogNotification.updateMany.mockResolvedValue({ count: 1 });
    expect(await markTripEscalationNotificationsRead(2, [5, 5, -1, 8])).toBe(1);
    expect(db.tripLogNotification.updateMany.mock.calls[0]![0]).toMatchObject({ where: { userId: 2, id: { in: [5, 8] }, readAt: null } });
    expect(notifyNotificationsChanged).toHaveBeenCalledWith(2);
    expect(await markTripEscalationNotificationsRead(2, [])).toBe(0);
  });
});
