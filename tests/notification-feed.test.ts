import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  listQuoteNotifications: vi.fn(),
  listInvoiceNotifications: vi.fn(),
  listTripNotifications: vi.fn(),
  materializeDueTripReminders: vi.fn(),
  listMessageNotifications: vi.fn(),
  listFileNotifications: vi.fn(),
  listCalendarNotifications: vi.fn(),
  materializeDueCalendarReminders: vi.fn(),
  listMaintenanceNotifications: vi.fn(),
  materializeMaintenanceReminders: vi.fn(),
  listTripEscalationNotifications: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: { $queryRaw: mocks.queryRaw } }));
vi.mock('../lib/quotes', () => ({ listQuoteNotifications: mocks.listQuoteNotifications }));
vi.mock('../lib/invoices', () => ({ listInvoiceNotifications: mocks.listInvoiceNotifications }));
vi.mock('../lib/trip-notifications', () => ({
  listTripNotifications: mocks.listTripNotifications,
  materializeDueTripReminders: mocks.materializeDueTripReminders,
}));
vi.mock('../lib/communication', () => ({ listMessageNotifications: mocks.listMessageNotifications }));
vi.mock('../lib/files', () => ({ listFileNotifications: mocks.listFileNotifications }));
vi.mock('../lib/calendar', () => ({
  listCalendarNotifications: mocks.listCalendarNotifications,
  materializeDueCalendarReminders: mocks.materializeDueCalendarReminders,
}));

vi.mock('../lib/fleet-reminders', () => ({
  listMaintenanceNotifications: mocks.listMaintenanceNotifications,
  materializeMaintenanceReminders: mocks.materializeMaintenanceReminders,
}));
vi.mock('../lib/trip-escalations', () => ({ listTripEscalationNotifications: mocks.listTripEscalationNotifications }));

import { listPersonalTodoNotifications, loadNotificationFeed } from '../lib/notification-feed';

describe('notification feed', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.queryRaw.mockResolvedValue([]);
    mocks.listQuoteNotifications.mockResolvedValue([{ id: 1 }]);
    mocks.listInvoiceNotifications.mockResolvedValue([{ id: 2 }]);
    mocks.listTripNotifications.mockResolvedValue([{ id: 3 }]);
    mocks.materializeDueTripReminders.mockResolvedValue(0);
    mocks.listMessageNotifications.mockResolvedValue([{ id: 4 }]);
    mocks.listFileNotifications.mockResolvedValue([{ id: 5 }]);
    mocks.listCalendarNotifications.mockResolvedValue([{ id: 6 }]);
    mocks.materializeDueCalendarReminders.mockResolvedValue(0);
    mocks.listMaintenanceNotifications.mockResolvedValue([{ id: 8 }]);
    mocks.listTripEscalationNotifications.mockResolvedValue([]);
    mocks.materializeMaintenanceReminders.mockResolvedValue(0);
  });

  it('adds maintenance reminders only for those who can open Car Maintenance', async () => {
    expect((await loadNotificationFeed(42)).maintenance).toEqual([]);
    expect(mocks.materializeMaintenanceReminders).not.toHaveBeenCalled();

    expect((await loadNotificationFeed(42, { maintenance: true })).maintenance).toEqual([{ id: 8 }]);
    expect(mocks.materializeMaintenanceReminders).toHaveBeenCalledWith(42);
  });

  it('serialises personal todo notifications with ISO timestamps', async () => {
    mocks.queryRaw.mockResolvedValue([
      {
        id: 7,
        todoId: 70,
        type: 'assigned',
        message: 'hi',
        createdAt: new Date('2026-10-14T10:00:00Z'),
        readAt: null,
      },
    ]);

    await expect(listPersonalTodoNotifications(42)).resolves.toEqual([
      {
        id: 7,
        todoId: 70,
        type: 'assigned',
        message: 'hi',
        createdAt: '2026-10-14T10:00:00.000Z',
        readAt: null,
      },
    ]);
  });

  it('loads every source for the user in one call', async () => {
    const feed = await loadNotificationFeed(42);

    expect(feed).toEqual({
      todo: [],
      quote: [{ id: 1 }],
      invoice: [{ id: 2 }],
      trip: [{ id: 3 }],
      message: [{ id: 4 }],
      file: [{ id: 5 }],
      calendar: [{ id: 6 }],
      maintenance: [],
      escalation: [],
    });
    for (const fn of [
      mocks.listQuoteNotifications,
      mocks.listInvoiceNotifications,
      mocks.listTripNotifications,
      mocks.listMessageNotifications,
      mocks.listFileNotifications,
      mocks.listCalendarNotifications,
    ]) {
      expect(fn).toHaveBeenCalledWith(42);
    }
  });

  it('materialises due reminders before listing trips and calendar events', async () => {
    const order: string[] = [];
    mocks.materializeDueTripReminders.mockImplementation(async () => {
      order.push('trip:materialize');
      return 0;
    });
    mocks.listTripNotifications.mockImplementation(async () => {
      order.push('trip:list');
      return [];
    });
    mocks.materializeDueCalendarReminders.mockImplementation(async () => {
      order.push('calendar:materialize');
      return 0;
    });
    mocks.listCalendarNotifications.mockImplementation(async () => {
      order.push('calendar:list');
      return [];
    });

    await loadNotificationFeed(1);

    expect(order.indexOf('trip:materialize')).toBeLessThan(order.indexOf('trip:list'));
    expect(order.indexOf('calendar:materialize')).toBeLessThan(order.indexOf('calendar:list'));
  });

  it('keeps the other sources when one of them fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.listInvoiceNotifications.mockRejectedValue(new Error('boom'));

    const feed = await loadNotificationFeed(42);

    expect(feed.invoice).toEqual([]);
    expect(feed.quote).toEqual([{ id: 1 }]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
