import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { runWacli, scratch } = vi.hoisted(() => ({
  runWacli: vi.fn(),
  scratch: {
    mkdtemp: vi.fn(async () => '/tmp/laerp-wa-1'),
    writeFile: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    join: (dir: string, name: string) => `${dir}/${name}`,
  },
}));
vi.mock('../lib/wacli-runtime', () => ({ runWacli, wacliScratch: () => scratch }));

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
      // wacli's own deadline sits inside ours (60s), so it answers "not sent"
      // itself rather than being killed mid-send.
      '--timeout',
      '50s',
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

describe('wacli sendMedia', () => {
  const MB = 1024 * 1024;
  /** sendMedia only measures the bytes before spooling them, and spooling is faked. */
  const bytesOf = (size: number) => ({ length: size }) as unknown as Buffer;

  beforeEach(() => {
    runWacli.mockReset();
    syncStatus.mockReset();
    syncStatus.mockReturnValue({ account: 'a', running: true, restarts: 0, uptimeMs: 1 });
  });

  it('leaves type detection to wacli when the browser could not name the file', async () => {
    const { sendMedia } = await import('../lib/wacli');
    reply({ success: true, data: { id: 'F1', sent: true }, error: null });

    await sendMedia('laerp-user-1', '1@s.whatsapp.net', {
      bytes: bytesOf(10),
      mimeType: 'application/octet-stream',
      fileName: 'IMG_0001.HEIC',
    });
    expect(runWacli.mock.calls[0]![0]).not.toContain('--mime');
  });

  it('passes a real type through so photos and videos get their own bubble', async () => {
    const { sendMedia } = await import('../lib/wacli');
    reply({ success: true, data: { id: 'F2', sent: true }, error: null });

    await sendMedia('laerp-user-1', '1@s.whatsapp.net', { bytes: bytesOf(10), mimeType: 'video/mp4', fileName: 'v.mp4' });
    const args = runWacli.mock.calls[0]![0] as string[];
    expect(args[args.indexOf('--mime') + 1]).toBe('video/mp4');
  });

  it('gives a large upload more time, with wacli deciding inside our deadline', async () => {
    const { sendMedia } = await import('../lib/wacli');
    reply({ success: true, data: { id: 'F3', sent: true }, error: null });

    await sendMedia('laerp-user-1', '1@s.whatsapp.net', { bytes: bytesOf(50 * MB), mimeType: 'video/mp4', fileName: 'v.mp4' });
    const [args, options] = runWacli.mock.calls[0]!;
    expect(options.timeoutMs).toBe(270_000);
    expect(args[args.indexOf('--timeout') + 1]).toBe('260s');
  });

  it('refuses a file WhatsApp would reject without spooling it', async () => {
    const { sendMedia } = await import('../lib/wacli');
    scratch.writeFile.mockClear();

    const result = await sendMedia('laerp-user-1', '1@s.whatsapp.net', {
      bytes: bytesOf(101 * MB),
      mimeType: 'video/mp4',
      fileName: 'v.mp4',
    });
    expect(result.ok).toBe(false);
    expect(scratch.writeFile).not.toHaveBeenCalled();
    expect(runWacli).not.toHaveBeenCalled();
  });
});
