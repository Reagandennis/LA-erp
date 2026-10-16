import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../lib/chat-bus', () => ({ publish }));

const { create, upsert, updateMany, findMany } = vi.hoisted(() => ({
  create: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock('../lib/prisma', () => ({
  prisma: {
    messagingMessage: { create },
    messagingChat: { upsert, updateMany, findMany },
  },
}));

import {
  applyProviderUnread,
  ingestMessages,
  markRead,
  upsertChats,
  type IngestMessage,
} from '../lib/messaging-repo';

function message(overrides: Partial<IngestMessage>): IngestMessage {
  return {
    chatId: 'chat-1',
    chatName: 'Ada',
    chatKind: 'dm',
    messageId: 'm',
    senderName: 'Ada',
    fromMe: false,
    text: 'hi',
    at: new Date(),
    ...overrides,
  };
}

/** Echo whatever was inserted back, the way Prisma returns the created row. */
function insertSucceeds() {
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    mediaKind: null,
    mediaRef: null,
    mediaMime: null,
    mediaName: null,
    mediaSize: null,
    ...data,
  }));
}

describe('ingestMessages', () => {
  beforeEach(() => {
    for (const fn of [create, upsert, updateMany, findMany, publish]) fn.mockReset();
    insertSucceeds();
    upsert.mockResolvedValue({});
    updateMany.mockResolvedValue({ count: 0 });
  });

  it('never counts history as unread or alerts on it — the phone says what is unread', async () => {
    await ingestMessages(9, 42, [message({ messageId: 'a' }), message({ messageId: 'b' })], { history: true });

    expect(upsert.mock.calls[0]![0].create.unreadCount).toBe(0);
    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty('unreadCount');
    expect(publish.mock.calls[0]![2]).toMatchObject({ live: false, preview: null });
  });

  it('counts every inbound live message as unread and previews the newest', async () => {
    await ingestMessages(9, 42, [
      message({ messageId: 'a', text: 'first', at: new Date('2026-10-16T10:00:00Z') }),
      message({ messageId: 'b', text: 'second', at: new Date('2026-10-16T10:00:05Z') }),
      message({ messageId: 'c', text: 'my reply', fromMe: true, at: new Date('2026-10-16T10:00:09Z') }),
    ]);

    expect(upsert.mock.calls[0]![0].update.unreadCount).toEqual({ increment: 2 });
    expect(publish.mock.calls[0]![2]).toMatchObject({
      live: true,
      preview: { messageId: 'b', chatId: 'chat-1', chatName: 'Ada', text: 'second', mediaKind: null },
    });
  });

  it('sends no preview when only our own messages arrived', async () => {
    await ingestMessages(9, 42, [message({ fromMe: true })]);

    expect(publish.mock.calls[0]![2]).toMatchObject({ live: true, preview: null });
  });

  it('only ever moves last activity forward', async () => {
    const at = new Date('2026-08-21T10:00:00Z');
    await ingestMessages(9, 42, [message({ at })], { history: true });

    // Never in the upsert's update, which would overwrite unconditionally…
    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty('lastMessageAt');
    // …only in a write guarded on the stored value being older.
    expect(updateMany).toHaveBeenCalledWith({
      where: { accountId: 9, chatId: 'chat-1', lastMessageAt: { lt: at } },
      data: { lastMessageAt: at },
    });
  });

  it('keeps a real chat name when a message only knows the number', async () => {
    await ingestMessages(9, 42, [message({ chatName: '+254700000001', chatNameIsFallback: true, fromMe: true })]);

    const call = upsert.mock.calls[0]![0];
    expect(call.update).not.toHaveProperty('name');
    // A brand-new chat still needs a label.
    expect(call.create.name).toBe('+254700000001');
  });
});

describe('upsertChats', () => {
  beforeEach(() => {
    for (const fn of [upsert, findMany]) fn.mockReset();
    upsert.mockResolvedValue({});
  });

  it('writes only chats that changed, and never moves last activity back', async () => {
    const stored = new Date('2026-10-06T10:00:00Z');
    findMany.mockResolvedValue([
      { chatId: 'same', name: 'Ada', kind: 'dm', lastMessageAt: stored },
      { chatId: 'renamed', name: 'Old', kind: 'dm', lastMessageAt: stored },
    ]);

    await upsertChats(9, [
      { chatId: 'same', name: 'Ada', kind: 'dm', lastMessageAt: new Date('2026-10-01T00:00:00Z') },
      { chatId: 'renamed', name: 'New', kind: 'dm', lastMessageAt: new Date('2026-10-01T00:00:00Z') },
    ]);

    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0]![0];
    expect(call.where.accountId_chatId.chatId).toBe('renamed');
    expect(call.update).toEqual({ name: 'New', kind: 'dm' });
  });
});

describe("adopting the phone's unread state", () => {
  beforeEach(() => {
    for (const fn of [updateMany, findMany, publish]) fn.mockReset();
  });

  it('only rewrites chats untouched since the phone was asked, and announces the change', async () => {
    const observedAt = new Date('2026-10-16T10:00:00Z');
    findMany.mockResolvedValue([
      { chatId: 'read-on-phone', unreadCount: 2 },
      { chatId: 'same', unreadCount: 1 },
      { chatId: 'read-here', unreadCount: 0 },
    ]);
    updateMany.mockResolvedValue({ count: 1 });

    await applyProviderUnread(
      9,
      42,
      new Map([
        ['read-on-phone', 0],
        ['same', 1],
        ['read-here', 3],
      ]),
      observedAt,
      { skip: new Set(['read-here']) },
    );

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      // A message or a read written after `observedAt` wins over the count.
      where: { accountId: 9, chatId: 'read-on-phone', updatedAt: { lt: observedAt } },
      data: { unreadCount: 0 },
    });
    expect(publish).toHaveBeenCalledWith(42, 'messaging', expect.objectContaining({ chatIds: ['read-on-phone'], live: false }));
  });

  it('stays quiet when the guard skipped every write', async () => {
    findMany.mockResolvedValue([{ chatId: 'busy', unreadCount: 1 }]);
    updateMany.mockResolvedValue({ count: 0 });

    await applyProviderUnread(9, 42, new Map([['busy', 0]]), new Date());

    expect(publish).not.toHaveBeenCalled();
  });
});

describe('markRead', () => {
  beforeEach(() => {
    for (const fn of [updateMany, publish]) fn.mockReset();
  });

  it('tells other tabs and badges when it cleared something, and only then', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await markRead(9, 'chat-1', 42)).toBe(true);
    expect(publish).toHaveBeenCalledWith(42, 'messaging', expect.objectContaining({ chatIds: ['chat-1'], live: false }));

    updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await markRead(9, 'chat-1', 42)).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
