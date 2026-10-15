import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { runWacli } = vi.hoisted(() => ({ runWacli: vi.fn() }));
vi.mock('../lib/wacli-runtime', () => ({
  runWacli,
  wacliScratch: () => {
    throw new Error('not used here');
  },
}));

const { syncStatus } = vi.hoisted(() => ({ syncStatus: vi.fn() }));
vi.mock('../lib/whatsapp-sync', () => ({ syncStatus }));

function reply(body: unknown, error: Error | null = null) {
  runWacli.mockResolvedValueOnce({ stdout: JSON.stringify(body), stderr: '', error });
}

describe('wacli sendText', () => {
  beforeEach(() => {
    runWacli.mockReset();
    syncStatus.mockReset();
    syncStatus.mockReturnValue({ account: 'a', running: true, restarts: 0, uptimeMs: 1 });
  });

  it('never waits for the store lock and skips the post-send wait while sync is up', async () => {
    const { sendText } = await import('../lib/wacli');
    reply({ success: true, data: { id: '3EB0ABC', sent: true, to: '1@lid' }, error: null });

    const result = await sendText('laerp-user-1', '254712345678@s.whatsapp.net', 'hello');

    expect(result).toEqual({ ok: true, messageId: '3EB0ABC' });
    expect(runWacli).toHaveBeenCalledTimes(1);
    const [args] = runWacli.mock.calls[0]!;
    expect(args).toEqual([
      '--json',
      '--account',
      'laerp-user-1',
      'send',
      'text',
      '--to',
      '254712345678@s.whatsapp.net',
      '--message',
      'hello',
      '--post-send-wait',
      '0',
    ]);
    expect(args).not.toContain('--lock-wait');
  });

  it('keeps the default post-send wait when no sync is following', async () => {
    syncStatus.mockReturnValue({ account: 'a', running: false, restarts: 0, uptimeMs: 0 });
    const { sendText } = await import('../lib/wacli');
    reply({ success: true, data: { id: 'X', sent: true }, error: null });

    await sendText('laerp-user-1', '1@s.whatsapp.net', 'hi');
    expect(runWacli.mock.calls[0]![0]).not.toContain('--post-send-wait');
  });

  it('retries once when the store is momentarily locked', async () => {
    vi.useFakeTimers();
    const { sendText } = await import('../lib/wacli');
    reply({ success: false, data: null, error: 'store is locked (another wacli is running?)' });
    reply({ success: true, data: { id: 'Y', sent: true }, error: null });

    const pending = sendText('laerp-user-1', '1@s.whatsapp.net', 'hi');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toEqual({ ok: true, messageId: 'Y' });
    expect(runWacli).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('reports other failures without retrying', async () => {
    const { sendText } = await import('../lib/wacli');
    reply({ success: false, data: null, error: 'recipient not on WhatsApp' });

    expect(await sendText('laerp-user-1', '1@s.whatsapp.net', 'hi')).toEqual({
      ok: false,
      error: 'recipient not on WhatsApp',
    });
    expect(runWacli).toHaveBeenCalledTimes(1);
  });
});
