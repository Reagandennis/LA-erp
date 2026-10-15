import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const cp = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('child_process', () => cp);

const ORIGINAL_ENV = { ...process.env };

/** Reload the module with the given env so its top-level constants pick it up. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  for (const key of ['WACLI_CONTAINER', 'WACLI_BIN', 'DOCKER_BIN', 'WACLI_WEBHOOK_BASE', 'APP_INTERNAL_URL']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  return import('../lib/wacli-runtime');
}

/** A fake child whose stdout/stderr can be driven by the test. */
function fakeChild(pid = 4242) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    written: Buffer[];
  };
  child.pid = pid;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.written = [];
  child.stdin.on('data', (chunk: Buffer) => child.written.push(chunk));
  return child;
}

beforeEach(() => {
  cp.execFile.mockReset();
  cp.execFileSync.mockReset();
  cp.spawn.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('native mode', () => {
  it('runs the binary directly and reports it', async () => {
    const rt = await load({ WACLI_BIN: '/opt/wacli' });
    expect(rt.wacliInDocker()).toBe(false);
    expect(rt.wacliCommand(['--json', 'doctor'])).toEqual({ bin: '/opt/wacli', args: ['--json', 'doctor'] });
    expect(rt.describeWacliRuntime()).toContain('/opt/wacli');
  });

  it('terminates with a plain signal', async () => {
    const rt = await load({});
    const child = fakeChild();
    rt.terminateWacli(child as never, ['--account', 'a', 'sync']);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(cp.execFileSync).not.toHaveBeenCalled();
  });

  it('uses APP_INTERNAL_URL for the webhook', async () => {
    const rt = await load({ APP_INTERNAL_URL: 'http://127.0.0.1:4000/' });
    expect(rt.webhookBase()).toBe('http://127.0.0.1:4000');
  });

  it('kills strays found by pgrep, skipping its own children', async () => {
    const rt = await load({});
    cp.execFile.mockImplementation((_bin: string, _args: string[], _o: unknown, cb: (e: null, out: string) => void) => {
      cb(null, '111\n222\n333\n');
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const reaped = await rt.killStrayWacli(rt.wacliProcessPattern('laerp-user-1', 'sync'), new Set([222]));
    expect(reaped).toEqual([111, 333]);
    expect(cp.execFile.mock.calls[0]![0]).toBe('pgrep');
    expect(cp.execFile.mock.calls[0]![1]).toEqual(['-f', '(^|/)wacli --account laerp-user-1 sync( |$)']);
    kill.mockRestore();
  });

  it('never matches a user\'s other accounts, which share the name as a prefix', async () => {
    const rt = await load({});
    const pattern = new RegExp(rt.wacliProcessPattern('laerp-user-1', 'sync'));
    expect(pattern.test('wacli --account laerp-user-1 sync --follow')).toBe(true);
    expect(pattern.test('wacli --account laerp-user-1-0a1b2c3d sync --follow')).toBe(false);
    expect(pattern.test('wacli --account laerp-user-10 sync --follow')).toBe(false);
  });
});

describe('docker mode', () => {
  it('wraps every command in docker exec', async () => {
    const rt = await load({ WACLI_CONTAINER: 'la-erp-wacli' });
    expect(rt.wacliInDocker()).toBe(true);
    expect(rt.wacliCommand(['--json', 'doctor'])).toEqual({
      bin: 'docker',
      args: ['exec', 'la-erp-wacli', 'wacli', '--json', 'doctor'],
    });
    expect(rt.wacliCommand(['x'], { stdin: true }).args).toEqual(['exec', '-i', 'la-erp-wacli', 'wacli', 'x']);
  });

  it('runWacli resolves stdout, stderr and the error together', async () => {
    const rt = await load({ WACLI_CONTAINER: 'c', DOCKER_BIN: '/usr/local/bin/docker' });
    cp.execFile.mockImplementation(
      (bin: string, args: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => {
        expect(bin).toBe('/usr/local/bin/docker');
        expect(args).toEqual(['exec', 'c', 'wacli', '--json', 'doctor']);
        cb(Object.assign(new Error('boom'), { code: 1 }), '{"ok":1}', 'warn');
      },
    );
    const result = await rt.runWacli(['--json', 'doctor'], { timeoutMs: 1000 });
    expect(result).toMatchObject({ stdout: '{"ok":1}', stderr: 'warn' });
    expect(result.error?.message).toBe('boom');
  });

  it('terminates by exact command line inside the container, then the client', async () => {
    const rt = await load({ WACLI_CONTAINER: 'c' });
    const child = fakeChild();
    const args = ['--account', 'laerp-user-3', 'sync', '--follow', '--webhook', 'http://h:3000/x?token=a.b&user=3'];
    rt.terminateWacli(child as never, args);

    expect(cp.execFileSync).toHaveBeenCalledTimes(1);
    const [bin, pkillArgs] = cp.execFileSync.mock.calls[0]!;
    expect(bin).toBe('docker');
    expect(pkillArgs).toEqual([
      'exec',
      'c',
      'pkill',
      '-TERM',
      '-f',
      '^wacli --account laerp-user-3 sync --follow --webhook http://h:3000/x\\?token=a\\.b&user=3$',
    ]);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('still signals the client when the container is gone', async () => {
    const rt = await load({ WACLI_CONTAINER: 'c' });
    cp.execFileSync.mockImplementation(() => {
      throw new Error('container not running');
    });
    const child = fakeChild();
    rt.terminateWacli(child as never, ['--account', 'a', 'auth']);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('reaps strays with pgrep and kill inside the container', async () => {
    const rt = await load({ WACLI_CONTAINER: 'c' });
    const calls: string[][] = [];
    cp.execFile.mockImplementation((_bin: string, args: string[], _o: unknown, cb: (e: null, out: string) => void) => {
      calls.push(args);
      cb(null, args[2] === 'pgrep' ? '10\n20\n' : '');
    });
    const reaped = await rt.killStrayWacli(rt.wacliProcessPattern('laerp-user-1', 'sync'), new Set());
    expect(reaped).toEqual([10, 20]);
    expect(calls).toEqual([
      ['exec', 'c', 'pgrep', '-f', '(^|/)wacli --account laerp-user-1 sync( |$)'],
      ['exec', 'c', 'kill', '-TERM', '10', '20'],
    ]);
  });

  it('points the webhook at the docker host gateway, keeping the port', async () => {
    expect((await load({ WACLI_CONTAINER: 'c' })).webhookBase()).toBe('http://host.docker.internal:3000');
    expect((await load({ WACLI_CONTAINER: 'c', APP_INTERNAL_URL: 'http://localhost:3100' })).webhookBase()).toBe(
      'http://host.docker.internal:3100',
    );
    expect((await load({ WACLI_CONTAINER: 'c', APP_INTERNAL_URL: 'http://10.0.0.5:3000' })).webhookBase()).toBe(
      'http://10.0.0.5:3000',
    );
    expect((await load({ WACLI_CONTAINER: 'c', WACLI_WEBHOOK_BASE: 'http://127.0.0.1:3000/' })).webhookBase()).toBe(
      'http://127.0.0.1:3000',
    );
  });

  it('streams scratch files through docker exec instead of a shared directory', async () => {
    const rt = await load({ WACLI_CONTAINER: 'c' });
    const spawned: { args: string[]; child: ReturnType<typeof fakeChild> }[] = [];
    cp.spawn.mockImplementation((_bin: string, args: string[]) => {
      const child = fakeChild();
      spawned.push({ args, child });
      // Reply on the next tick so the caller has attached its listeners.
      setImmediate(() => {
        if (args[2] === 'mktemp') child.stdout.write('/tmp/laerp-wa-AbC123\n');
        if (args[2] === 'ls') child.stdout.write('photo.jpg\n');
        if (args[2] === 'cat') child.stdout.write(Buffer.from([0xff, 0xd8, 0x00]));
        child.stdout.end();
        child.emit('close', 0);
      });
      return child;
    });

    const scratch = rt.wacliScratch();
    const dir = await scratch.mkdtemp('laerp-wa-');
    expect(dir).toBe('/tmp/laerp-wa-AbC123');
    expect(spawned[0]!.args).toEqual(['exec', 'c', 'mktemp', '-d', '/tmp/laerp-wa-XXXXXX']);

    const path = scratch.join(dir, 'up load.bin');
    expect(path).toBe('/tmp/laerp-wa-AbC123/up load.bin');
    await scratch.writeFile(path, Buffer.from('hello'));
    expect(spawned[1]!.args).toEqual(['exec', '-i', 'c', 'sh', '-c', 'umask 077 && cat > "$1"', 'sh', path]);
    expect(Buffer.concat(spawned[1]!.child.written).toString()).toBe('hello');

    expect(await scratch.readdir(dir)).toEqual(['photo.jpg']);
    expect(spawned[2]!.args).toEqual(['exec', 'c', 'ls', '-1A', '--', dir]);

    const bytes = await scratch.readFile(scratch.join(dir, 'photo.jpg'));
    expect([...bytes]).toEqual([0xff, 0xd8, 0x00]);

    await scratch.remove(dir);
    expect(spawned[4]!.args).toEqual(['exec', 'c', 'rm', '-rf', '--', dir]);
  });

  it('surfaces a failing exec as an error with its stderr', async () => {
    const rt = await load({ WACLI_CONTAINER: 'c' });
    cp.spawn.mockImplementation(() => {
      const child = fakeChild();
      setImmediate(() => {
        child.stderr.write('Error response from daemon: No such container: c');
        child.emit('close', 1);
      });
      return child;
    });
    await expect(rt.wacliScratch().mkdtemp('x-')).rejects.toThrow('No such container');
  });

  it('ensureWacliContainer starts a stopped container and leaves a running one alone', async () => {
    const rt = await load({ WACLI_CONTAINER: 'c' });
    const calls: string[][] = [];
    let running = 'false';
    cp.execFile.mockImplementation((_bin: string, args: string[], _o: unknown, cb: (e: null, out: string) => void) => {
      calls.push(args);
      if (args[0] === 'start') running = 'true';
      cb(null, args[0] === 'inspect' ? `${running}\n` : '');
    });
    expect(await rt.ensureWacliContainer()).toBe('started');
    expect(calls).toEqual([['inspect', '-f', '{{.State.Running}}', 'c'], ['start', 'c']]);
    expect(await rt.ensureWacliContainer()).toBe('running');
  });

  it('ensureWacliContainer is a no-op in native mode', async () => {
    const rt = await load({});
    expect(await rt.ensureWacliContainer()).toBe('native');
    expect(cp.execFile).not.toHaveBeenCalled();
  });
});
