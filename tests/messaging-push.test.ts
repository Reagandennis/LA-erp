import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { create, upsert } = vi.hoisted(() => ({ create: vi.fn(), upsert: vi.fn() }));
vi.mock('../lib/prisma', () => ({
  prisma: {
    messagingMessage: { create, findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    messagingChat: { upsert, findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  },
}));

/**
 * The push path, with the REAL chat-bus rather than a mock: ingesting a message
 * must reach a subscribed SSE controller. This is what replaced the 4s/8s poll,
 * so it needs to be proven end to end rather than asserted against a spy.
 */
describe('ingest → chat-bus → SSE', () => {
  beforeEach(() => {
    create.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({});
    vi.resetModules();
  });

  function subscribeCapture(userId: number, bus: typeof import('../lib/chat-bus')) {
    const frames: string[] = [];
    const controller = {
      enqueue: (chunk: Uint8Array) => frames.push(new TextDecoder().decode(chunk)),
      close: () => {},
    } as unknown as ReadableStreamDefaultController<Uint8Array>;
    bus.subscribe(userId, controller);
    return { frames, controller };
  }

  const message = {
    chatId: 'chat-1',
    chatName: 'Ada',
    chatKind: 'dm' as const,
    messageId: 'm-1',
    senderName: 'Ada',
    fromMe: false,
    text: 'ping',
    at: new Date('2026-08-26T10:00:00Z'),
  };

  it('pushes an SSE frame naming the affected chat', async () => {
    create.mockResolvedValue({
      messageId: 'm-1',
      chatId: 'chat-1',
      senderName: 'Ada',
      fromMe: false,
      text: 'ping',
      at: message.at,
      mediaKind: null,
      mediaRef: null,
      mediaMime: null,
      mediaName: null,
      mediaSize: null,
    });

    const bus = await import('../lib/chat-bus');
    const { frames } = subscribeCapture(42, bus);
    const { ingestMessages } = await import('../lib/messaging-repo');

    await ingestMessages(9, 42, [message]);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain('event: messaging');
    const payload = JSON.parse(frames[0]!.split('data: ')[1]!.trim());
    expect(payload.chatIds).toEqual(['chat-1']);
    expect(payload.count).toBe(1);
  });

  it('does not push to a different user', async () => {
    create.mockResolvedValue({
      messageId: 'm-2',
      chatId: 'chat-1',
      senderName: 'Ada',
      fromMe: false,
      text: 'ping',
      at: message.at,
      mediaKind: null,
      mediaRef: null,
      mediaMime: null,
      mediaName: null,
      mediaSize: null,
    });

    const bus = await import('../lib/chat-bus');
    const other = subscribeCapture(99, bus);
    const { ingestMessages } = await import('../lib/messaging-repo');

    await ingestMessages(9, 42, [{ ...message, messageId: 'm-2' }]);

    expect(other.frames).toHaveLength(0);
  });

  it('stays silent when every message is a duplicate', async () => {
    // The unique constraint on (accountId, chatId, messageId) makes re-ingest a
    // no-op, so a webhook retry must not wake the console.
    create.mockRejectedValue(new Error('Unique constraint failed'));

    const bus = await import('../lib/chat-bus');
    const { frames } = subscribeCapture(42, bus);
    const { ingestMessages } = await import('../lib/messaging-repo');

    const fresh = await ingestMessages(9, 42, [message]);

    expect(fresh).toEqual([]);
    expect(frames).toHaveLength(0);
  });

  it('coalesces a batch into one push', async () => {
    let n = 0;
    create.mockImplementation(async () => ({
      messageId: `m-${++n}`,
      chatId: n === 1 ? 'chat-1' : 'chat-2',
      senderName: 'Ada',
      fromMe: false,
      text: 'ping',
      at: message.at,
      mediaKind: null,
      mediaRef: null,
      mediaMime: null,
      mediaName: null,
      mediaSize: null,
    }));

    const bus = await import('../lib/chat-bus');
    const { frames } = subscribeCapture(42, bus);
    const { ingestMessages } = await import('../lib/messaging-repo');

    await ingestMessages(9, 42, [message, { ...message, messageId: 'm-2', chatId: 'chat-2' }]);

    expect(frames).toHaveLength(1);
    const payload = JSON.parse(frames[0]!.split('data: ')[1]!.trim());
    expect(payload.chatIds.sort()).toEqual(['chat-1', 'chat-2']);
    expect(payload.count).toBe(2);
  });
});
