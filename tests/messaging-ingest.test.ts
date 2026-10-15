import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('child_process', () => ({ execFile }));

const { ingestMessages, latestMessageAt, upsertChats } = vi.hoisted(() => ({
  ingestMessages: vi.fn(),
  latestMessageAt: vi.fn(),
  upsertChats: vi.fn(),
}));
vi.mock('../lib/messaging-repo', () => ({ ingestMessages, latestMessageAt, upsertChats }));

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

describe('signal ingest', () => {
  beforeEach(() => {
    execFile.mockReset();
    ingestMessages.mockReset();
    latestMessageAt.mockReset();
    upsertChats.mockReset();
    listAccountsForProvider.mockReset();
    ingestMessages.mockResolvedValue([]);
    latestMessageAt.mockResolvedValue(null);
    listAccountsForProvider.mockResolvedValue([]);
    vi.resetModules();
    // Schedules live on globalThis so they survive a module reset — clear them
    // or the second test's drain is skipped as "already scheduled".
    const g = globalThis as { messagingIngestTimersGlobal?: Map<string, NodeJS.Timeout>; messagingIngestBusyGlobal?: Set<string> };
    for (const timer of g.messagingIngestTimersGlobal?.values() ?? []) clearInterval(timer);
    g.messagingIngestTimersGlobal = undefined;
    g.messagingIngestBusyGlobal = undefined;
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
