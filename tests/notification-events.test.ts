import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The push path for the notifications bell, with the REAL chat bus: a
 * notification write must reach that user's open SSE controllers and nobody
 * else's. This replaced the bell's 10s poll, so it is proven end to end.
 */
describe('notifyNotificationsChanged → chat-bus → SSE', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function capture(userId: number, bus: typeof import('../lib/chat-bus')) {
    const frames: string[] = [];
    const controller = {
      enqueue: (chunk: Uint8Array) => frames.push(new TextDecoder().decode(chunk)),
      close: () => {},
    } as unknown as ReadableStreamDefaultController<Uint8Array>;
    bus.subscribe(userId, controller);
    return { frames, controller };
  }

  it('sends a `notifications` event to every listed user, once each, and to nobody else', async () => {
    const bus = await import('../lib/chat-bus');
    const { notifyNotificationsChanged, NOTIFICATIONS_EVENT } = await import('../lib/notification-events');
    const alice = capture(7, bus);
    const bob = capture(9, bus);
    const carol = capture(11, bus);

    notifyNotificationsChanged([7, 9, 9]);

    expect(alice.frames).toHaveLength(1);
    expect(alice.frames[0]).toMatch(new RegExp(`^event: ${NOTIFICATIONS_EVENT}\\ndata: \\{"at":\\d+\\}\\n\\n$`));
    expect(bob.frames).toHaveLength(1);
    expect(carol.frames).toHaveLength(0);

    bus.unsubscribe(7, alice.controller);
    bus.unsubscribe(9, bob.controller);
    bus.unsubscribe(11, carol.controller);
  });

  it('accepts a single id and ignores ids that are not users', async () => {
    const bus = await import('../lib/chat-bus');
    const { notifyNotificationsChanged } = await import('../lib/notification-events');
    const alice = capture(7, bus);

    notifyNotificationsChanged(7);
    notifyNotificationsChanged([0, -1, Number.NaN]);

    expect(alice.frames).toHaveLength(1);
    bus.unsubscribe(7, alice.controller);
  });

  it('never throws when a subscriber is gone', async () => {
    const bus = await import('../lib/chat-bus');
    const { notifyNotificationsChanged } = await import('../lib/notification-events');
    const dead = {
      enqueue: () => {
        throw new Error('closed');
      },
      close: () => {},
    } as unknown as ReadableStreamDefaultController<Uint8Array>;
    bus.subscribe(7, dead);

    expect(() => notifyNotificationsChanged(7)).not.toThrow();
    bus.unsubscribe(7, dead);
  });
});

describe('notification writers publish the change', () => {
  const mocks = { notify: vi.fn(), updateMany: vi.fn() };

  // doMock (not hoisted): the bus tests above must see the real emitter.
  beforeEach(() => {
    mocks.notify.mockReset();
    mocks.updateMany.mockReset();
    vi.resetModules();
    vi.doMock('../lib/notification-events', () => ({ notifyNotificationsChanged: mocks.notify }));
    vi.doMock('../lib/prisma', () => ({
      prisma: {
        fileNotification: { updateMany: mocks.updateMany },
      },
    }));
  });

  it('marking file notifications read tells the user’s other tabs', async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 });
    const { markFileNotificationsRead } = await import('../lib/files');

    await expect(markFileNotificationsRead(7, [1, 2, 2])).resolves.toBe(2);
    expect(mocks.notify).toHaveBeenCalledWith(7);
  });

  it('stays quiet when nothing changed', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const { markFileNotificationsRead } = await import('../lib/files');

    await expect(markFileNotificationsRead(7, [99])).resolves.toBe(0);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
