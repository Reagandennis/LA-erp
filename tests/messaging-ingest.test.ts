import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('child_process', () => ({ execFile }));

const { ingestMessages, existingMessageIds, messageCountsByChat, upsertChats, applyProviderUnread } = vi.hoisted(
  () => ({
    ingestMessages: vi.fn(),
    existingMessageIds: vi.fn(),
    messageCountsByChat: vi.fn(),
    upsertChats: vi.fn(),
    applyProviderUnread: vi.fn(),
  }),
);
vi.mock('../lib/messaging-repo', () => ({
  ingestMessages,
  existingMessageIds,
  messageCountsByChat,
  upsertChats,
  applyProviderUnread,
}));

const { listAccountsForProvider } = vi.hoisted(() => ({ listAccountsForProvider: vi.fn() }));
vi.mock('../lib/messaging-accounts', () => ({ listAccountsForProvider }));

const ACCOUNT = { id: 7, userId: 3, provider: 'signal' as const, handle: '+15551110000', label: null, session: null };

/** Drive execFile per subcommand so each test controls what the CLI "returns". */
function respond(handler: (args: string[]) => string) {
  execFile.mockImplementation(
    (_bin: string, args: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
      cb(null, handler(args), '');
      return undefined;
    },
  );
}

function envelope(body: Record<string, unknown>) {
  return JSON.stringify({ envelope: body });
}

/**
 * Schedules live on globalThis so they survive a module reset — clear them or
 * the next run is skipped as "already scheduled".
 */
function clearSchedules() {
  const g = globalThis as { messagingIngestTimersGlobal?: Map<string, NodeJS.Timeout>; messagingIngestBusyGlobal?: Set<string> };
  for (const timer of g.messagingIngestTimersGlobal?.values() ?? []) clearInterval(timer);
  g.messagingIngestTimersGlobal = undefined;
  g.messagingIngestBusyGlobal = undefined;
}

describe('signal ingest', () => {
  beforeEach(() => {
    execFile.mockReset();
    ingestMessages.mockReset();
    upsertChats.mockReset();
    listAccountsForProvider.mockReset();
    ingestMessages.mockResolvedValue([]);
    listAccountsForProvider.mockResolvedValue([]);
    vi.resetModules();
    clearSchedules();
  });

  it('writes received messages straight to the mirror', async () => {
    respond((args) =>
      args.includes('receive')
        ? envelope({
            sourceNumber: '+15559990001',
            sourceName: 'Ada',
            timestamp: 1_700_000_000_000,
            dataMessage: { message: 'hello there', timestamp: 1_700_000_000_000 },
          })
        : '[]',
    );

    const { reconcileIngest } = await import('../lib/messaging-ingest');
    listAccountsForProvider.mockImplementation(async (p: string) => (p === 'signal' ? [ACCOUNT] : []));
    await reconcileIngest();
    await new Promise((r) => setTimeout(r, 30));

    expect(ingestMessages).toHaveBeenCalled();
    const [accountId, userId, batch] = ingestMessages.mock.calls[0]!;
    expect(accountId).toBe(7);
    expect(userId).toBe(3);
    expect(batch[0]).toMatchObject({
      chatId: '+15559990001',
      text: 'hello there',
      fromMe: false,
      chatKind: 'dm',
    });
  });

  it('keeps an attachment-only message and maps its kind', async () => {
    respond((args) =>
      args.includes('receive')
        ? envelope({
            sourceNumber: '+1999',
            timestamp: 5,
            dataMessage: {
              message: null,
              timestamp: 5,
              attachments: [{ id: 'att-9', contentType: 'image/jpeg', filename: 'p.jpg', size: 42 }],
            },
          })
        : '[]',
    );

    const { reconcileIngest } = await import('../lib/messaging-ingest');
    listAccountsForProvider.mockImplementation(async (p: string) => (p === 'signal' ? [ACCOUNT] : []));
    await reconcileIngest();
    await new Promise((r) => setTimeout(r, 30));

    const batch = ingestMessages.mock.calls[0]![2];
    expect(batch).toHaveLength(1);
    expect(batch[0].text).toBe('');
    expect(batch[0].media).toEqual({
      kind: 'image',
      ref: 'att-9',
      mimeType: 'image/jpeg',
      fileName: 'p.jpg',
      sizeBytes: 42,
    });
  });

  it('records a sync-sent message as outbound', async () => {
    respond((args) =>
      args.includes('receive')
        ? envelope({
            sourceNumber: '+15551110000',
            timestamp: 9,
            syncMessage: {
              sentMessage: { message: 'sent from my phone', timestamp: 9, destination: '+15559990002' },
            },
          })
        : '[]',
    );

    const { reconcileIngest } = await import('../lib/messaging-ingest');
    listAccountsForProvider.mockImplementation(async (p: string) => (p === 'signal' ? [ACCOUNT] : []));
    await reconcileIngest();
    await new Promise((r) => setTimeout(r, 30));

    const batch = ingestMessages.mock.calls[0]![2];
    expect(batch[0]).toMatchObject({
      chatId: '+15559990002',
      fromMe: true,
      senderName: 'You',
      text: 'sent from my phone',
    });
  });

  it('resolves group names and namespaces group chat ids', async () => {
    respond((args) => {
      if (args.includes('listGroups')) return JSON.stringify([{ id: 'grp1', name: 'Ops Team' }]);
      if (args.includes('receive'))
        return envelope({
          sourceNumber: '+1999',
          timestamp: 3,
          dataMessage: { message: 'in group', timestamp: 3, groupInfo: { groupId: 'grp1' } },
        });
      return '';
    });

    const { reconcileIngest } = await import('../lib/messaging-ingest');
    listAccountsForProvider.mockImplementation(async (p: string) => (p === 'signal' ? [ACCOUNT] : []));
    await reconcileIngest();
    await new Promise((r) => setTimeout(r, 30));

    const batch = ingestMessages.mock.calls[0]![2];
    expect(batch[0]).toMatchObject({
      chatId: 'group:grp1',
      chatName: 'Ops Team',
      chatKind: 'group',
    });
  });

  it('ignores receipts and typing indicators', async () => {
    respond((args) =>
      args.includes('receive')
        ? [
            envelope({ sourceNumber: '+1', timestamp: 1, dataMessage: { message: '', timestamp: 1 } }),
            envelope({ sourceNumber: '+1', timestamp: 2 }),
            'not json at all',
          ].join('\n')
        : '[]',
    );

    const { reconcileIngest } = await import('../lib/messaging-ingest');
    listAccountsForProvider.mockImplementation(async (p: string) => (p === 'signal' ? [ACCOUNT] : []));
    await reconcileIngest();
    await new Promise((r) => setTimeout(r, 30));

    expect(ingestMessages.mock.calls[0]![2]).toEqual([]);
  });
});

describe('wacliToIngest', () => {
  beforeEach(() => vi.resetModules());

  it('accepts the live webhook shape, which names its fields differently from the store', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    // `wacli sync --webhook` posts `Chat`/`ID` and a nested `Media` object;
    // `messages list` returns `ChatJID`/`MsgID` and flat `MediaType` fields.
    const out = wacliToIngest({
      Chat: '254712345678@s.whatsapp.net',
      ID: '3EB0LIVE',
      SenderJID: '254712345678@s.whatsapp.net',
      Timestamp: '2026-07-25T10:00:00Z',
      FromMe: false,
      Text: '',
      ChatName: 'Alice',
      Media: { Type: 'image', Caption: 'look', Filename: 'a.jpg', MimeType: 'image/jpeg', FileLength: 1234 },
    });
    expect(out).toMatchObject({
      chatId: '254712345678@s.whatsapp.net',
      chatName: 'Alice',
      messageId: '3EB0LIVE',
      text: 'look',
      media: { kind: 'image', ref: '3EB0LIVE', mimeType: 'image/jpeg', fileName: 'a.jpg', sizeBytes: 1234 },
    });

    // Receipt and presence events must never be mirrored as messages.
    expect(
      wacliToIngest({ EventType: 'receipt', Chat: '1@s.whatsapp.net', ID: 'R', MessageIDs: ['x'] } as never),
    ).toBeNull();
  });

  it('names a direct chat after the contact, never after ourselves', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    const base = { ChatJID: '254712345678@s.whatsapp.net', MsgID: 'M', Timestamp: '2026-01-01T00:00:00Z' };

    // wacli's ChatName is the saved contact name when there is one…
    expect(
      wacliToIngest({ ...base, ChatName: 'Jane', SenderName: 'Me', FromMe: true, Text: 'hi' })?.chatName,
    ).toBe('Jane');
    // …and the bare JID when there isn't, which must not be shown as-is.
    expect(
      wacliToIngest({ ...base, ChatName: base.ChatJID, SenderName: 'Me', FromMe: true, Text: 'hi' })?.chatName,
    ).toBe('+254712345678');
    // An inbound message from an unsaved number can still use the sender's push name.
    expect(
      wacliToIngest({ ...base, ChatName: base.ChatJID, SenderName: 'Jane', FromMe: false, Text: 'hi' })?.chatName,
    ).toBe('Jane');
    // A group member's name is never the group's name.
    expect(
      wacliToIngest({ ...base, ChatJID: '1@g.us', ChatName: '1@g.us', SenderName: 'Jane', Text: 'hi' })?.chatName,
    ).toBe('1');
  });

  it('maps a wacli message onto the shared shape', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    const out = wacliToIngest({
      ChatJID: '254712345678@s.whatsapp.net',
      MsgID: 'ABC123',
      SenderName: 'Ada',
      Timestamp: '2026-08-26T10:00:00Z',
      FromMe: false,
      Text: 'hi there',
    });

    expect(out).toMatchObject({
      chatId: '254712345678@s.whatsapp.net',
      chatKind: 'dm',
      messageId: 'ABC123',
      senderName: 'Ada',
      fromMe: false,
      text: 'hi there',
    });
  });

  it('detects group chats from the JID suffix', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    const out = wacliToIngest({
      ChatJID: '12345-6789@g.us',
      MsgID: 'G1',
      Timestamp: '2026-08-26T10:00:00Z',
      Text: 'group msg',
    });
    expect(out?.chatKind).toBe('group');
  });

  it('carries media with the message id as the download ref', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    const out = wacliToIngest({
      ChatJID: '1@s.whatsapp.net',
      MsgID: 'M9',
      Timestamp: '2026-08-26T10:00:00Z',
      MediaType: 'image',
      MediaCaption: 'look',
    });
    expect(out?.media).toMatchObject({ kind: 'image', ref: 'M9' });
    expect(out?.text).toBe('look');
  });

  it('drops deleted-for-me and id-less rows', async () => {
    const { wacliToIngest } = await import('../lib/messaging-ingest');
    expect(wacliToIngest({ ChatJID: '1@s.whatsapp.net', MsgID: 'X', DeletedForMe: true })).toBeNull();
    expect(wacliToIngest({ ChatJID: '1@s.whatsapp.net', Text: 'no id' })).toBeNull();
  });
});

describe('whatsapp catch-up', () => {
  const WA = { id: 3, userId: 1, provider: 'whatsapp' as const, handle: 'laerp-user-1', label: null, session: null };
  const CHAT = '254700000001@s.whatsapp.net';

  beforeEach(() => {
    execFile.mockReset();
    ingestMessages.mockReset();
    existingMessageIds.mockReset();
    messageCountsByChat.mockReset();
    upsertChats.mockReset();
    applyProviderUnread.mockReset();
    listAccountsForProvider.mockReset();
    ingestMessages.mockResolvedValue([]);
    existingMessageIds.mockResolvedValue(new Set());
    messageCountsByChat.mockResolvedValue(new Map());
    listAccountsForProvider.mockImplementation(async (p: string) => (p === 'whatsapp' ? [WA] : []));
    vi.resetModules();
    clearSchedules();
    const g = globalThis as { whatsappUnmirroredGlobal?: unknown; whatsappReadInAppGlobal?: unknown };
    g.whatsappUnmirroredGlobal = undefined;
    g.whatsappReadInAppGlobal = undefined;
  });

  /** Answer each wacli query with a success envelope around `handler`'s data. */
  function wacli(handler: (args: string[]) => unknown) {
    respond((args) => JSON.stringify({ success: true, data: handler(args), error: null }));
  }

  const listCalls = () =>
    execFile.mock.calls.map((c) => c[1] as string[]).filter((args) => args.includes('messages'));

  async function pass() {
    clearSchedules();
    const { reconcileIngest } = await import('../lib/messaging-ingest');
    await reconcileIngest();
    await new Promise((r) => setTimeout(r, 30));
  }

  it('mirrors history that lands behind a message already mirrored', async () => {
    // The newest message reached Postgres live; history sync then delivered
    // two older ones. A time cursor would skip them forever.
    wacli((args) => {
      if (args.includes('coverage')) return { coverage: [{ chat_jid: CHAT, kind: 'dm', message_count: 3 }] };
      if (args.includes('chats')) return [];
      return {
        messages: [
          { ChatJID: CHAT, MsgID: 'NEW', Timestamp: '2026-10-06T10:00:00Z', Text: 'newest' },
          { ChatJID: CHAT, MsgID: 'OLD2', Timestamp: '2026-08-21T10:00:01Z', Text: 'older' },
          {
            ChatJID: CHAT,
            MsgID: 'OLD1',
            Timestamp: '2026-08-21T10:00:00Z',
            MediaType: 'document',
            MimeType: 'application/pdf',
            Filename: 'quote.pdf',
          },
        ],
      };
    });
    messageCountsByChat.mockResolvedValue(new Map([[CHAT, 1]]));
    existingMessageIds.mockResolvedValue(new Set(['NEW']));

    await pass();

    const [accountId, userId, batch, options] = ingestMessages.mock.calls[0]!;
    expect([accountId, userId, options]).toEqual([3, 1, { history: true }]);
    expect(batch.map((m: { messageId: string }) => m.messageId)).toEqual(['OLD2', 'OLD1']);
    expect(batch[1].media).toMatchObject({ kind: 'document', mimeType: 'application/pdf', fileName: 'quote.pdf' });
    // Reads never contend with the lock held by `sync --follow`.
    expect(listCalls()[0]).toContain('--read-only');
  });

  it('leaves a chat alone when its counts already balance', async () => {
    wacli((args) => {
      if (args.includes('coverage')) return { coverage: [{ chat_jid: CHAT, kind: 'dm', message_count: 40 }] };
      return [];
    });
    messageCountsByChat.mockResolvedValue(new Map([[CHAT, 40]]));

    await pass();

    expect(listCalls()).toHaveLength(0);
    expect(ingestMessages).not.toHaveBeenCalled();
  });

  it('remembers rows that are not messages, so a later pass skips the chat', async () => {
    wacli((args) => {
      if (args.includes('coverage')) return { coverage: [{ chat_jid: CHAT, kind: 'dm', message_count: 2 }] };
      if (args.includes('chats')) return [];
      return {
        messages: [
          { ChatJID: CHAT, MsgID: 'REAL', Timestamp: '2026-10-06T10:00:00Z', Text: 'hi' },
          // A protocol entry: no text, no media. Never mirrored.
          { ChatJID: CHAT, MsgID: 'PROTO', Timestamp: '2026-10-06T09:00:00Z' },
        ],
      };
    });
    messageCountsByChat.mockResolvedValue(new Map([[CHAT, 1]]));
    existingMessageIds.mockResolvedValue(new Set(['REAL']));

    await pass();
    expect(listCalls()).toHaveLength(1);

    await pass();
    expect(listCalls()).toHaveLength(1);
  });

  it('pages back with a one-second overlap so a boundary second is never split', async () => {
    // 500 messages fill the first page; its oldest second is shared with one
    // more message that only the next page returns.
    const base = Date.parse('2026-10-01T00:00:00Z');
    const page1 = Array.from({ length: 500 }, (_, i) => ({
      ChatJID: CHAT,
      MsgID: `P1-${i}`,
      Timestamp: new Date(base + (500 - i) * 1000).toISOString(),
      Text: 'x',
    }));
    const boundary = page1[499]!.Timestamp;
    const page2 = [
      page1[499]!,
      { ChatJID: CHAT, MsgID: 'TWIN', Timestamp: boundary, Text: 'same second' },
      { ChatJID: CHAT, MsgID: 'OLDER', Timestamp: new Date(base).toISOString(), Text: 'older' },
    ];
    wacli((args) => {
      if (args.includes('coverage')) return { coverage: [{ chat_jid: CHAT, kind: 'group', message_count: 502 }] };
      if (args.includes('chats')) return [];
      return { messages: args.includes('--before') ? page2 : page1 };
    });

    await pass();

    const second = listCalls()[1]!;
    expect(second[second.indexOf('--before') + 1]).toBe(new Date(Date.parse(boundary) + 1000).toISOString());
    const ingested = ingestMessages.mock.calls.flatMap((c) => c[2] as Array<{ messageId: string }>);
    expect(ingested.map((m) => m.messageId)).toEqual(expect.arrayContaining(['TWIN', 'OLDER']));
    expect(ingested).toHaveLength(502);
  });

  it("adopts the phone's unread state, counting a hand-marked chat as one", async () => {
    wacli((args) => {
      if (args.includes('coverage')) return { coverage: [] };
      return [
        { jid: CHAT, kind: 'dm', name: 'Ada', unread: true, unread_count: 3 },
        { jid: '2@s.whatsapp.net', kind: 'dm', name: 'Bo', unread: true, unread_count: 0 },
        { jid: '3@g.us', kind: 'group', name: 'Ops', unread: false, unread_count: 0 },
        { jid: 'status@broadcast', kind: 'broadcast', unread: true, unread_count: 9 },
      ];
    });

    await pass();

    const [accountId, userId, counts, observedAt, options] = applyProviderUnread.mock.calls[0]!;
    expect([accountId, userId]).toEqual([3, 1]);
    expect(Object.fromEntries(counts)).toEqual({ [CHAT]: 3, '2@s.whatsapp.net': 1, '3@g.us': 0 });
    expect(observedAt).toBeInstanceOf(Date);
    expect([...options.skip]).toEqual([]);
    // Archived chats are refreshed too: their messages are mirrored.
    const list = execFile.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes('chats'))!;
    expect(list).not.toContain('--no-archived');
  });

  it('keeps a chat just read in the app from being re-marked unread by a stale count', async () => {
    wacli((args) => {
      if (args.includes('coverage')) return { coverage: [] };
      if (args.includes('mark-read')) return null;
      return [{ jid: CHAT, kind: 'dm', name: 'Ada', unread: true, unread_count: 2 }];
    });
    const { syncReadToPhone } = await import('../lib/messaging-ingest');
    syncReadToPhone(WA, CHAT);

    await pass();

    // The phone is told, as an app-state patch only: no read receipts.
    const markRead = execFile.mock.calls.map((c) => c[1] as string[]).find((a) => a.includes('mark-read'))!;
    expect(markRead).toEqual(expect.arrayContaining(['chats', 'mark-read', '--chat', CHAT]));
    expect(markRead).not.toContain('--receipts');
    expect([...applyProviderUnread.mock.calls[0]![4].skip]).toEqual([CHAT]);
  });
});
