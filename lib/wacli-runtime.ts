import 'server-only';

import {
  type ChildProcess,
  execFile,
  type ExecFileException,
  execFileSync,
  spawn,
  type StdioOptions,
} from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Where `wacli` runs: natively on the host, or inside a Docker container.
 *
 * Every module that shells out to wacli goes through here, so the choice is a
 * single environment variable:
 *
 *   WACLI_CONTAINER   name of a running container with wacli on its PATH (the
 *                     bundled docker-compose service is `la-erp-wacli`). When
 *                     set, each wacli invocation becomes `docker exec <name>
 *                     wacli …`, long-lived processes are stopped with pkill
 *                     *inside* the container, and media is streamed through
 *                     stdin/stdout rather than a shared directory — so nothing
 *                     has to be bind-mounted and the container can run as any
 *                     user.
 *   WACLI_BIN         native mode only: path to the binary (default: on PATH).
 *   DOCKER_BIN        path to the docker CLI (default: "docker" on PATH).
 *   WACLI_WEBHOOK_BASE
 *                     base URL `wacli sync --webhook` posts back to. Defaults
 *                     to APP_INTERNAL_URL, with loopback rewritten to
 *                     host.docker.internal in container mode (the compose file
 *                     maps that alias to the host).
 *
 * The important subtlety of `docker exec` is that killing the client process on
 * the host does NOT kill the command inside the container. Anything we spawn
 * for the long haul (`sync --follow`, `auth`) must therefore be terminated by
 * command line inside the container — `terminateWacli` and `killStrayWacli`
 * do exactly that, and are no-ops beyond a plain signal in native mode.
 */

const CONTAINER = (process.env.WACLI_CONTAINER ?? '').trim();
const BIN = (process.env.WACLI_BIN ?? '').trim() || 'wacli';
const DOCKER = (process.env.DOCKER_BIN ?? '').trim() || 'docker';
/** docker-compose service that provides the container (used only at boot). */
const COMPOSE_SERVICE = 'wacli';

export function wacliInDocker(): boolean {
  return CONTAINER !== '';
}

/** Human-readable description of the runtime, for logs and status output. */
export function describeWacliRuntime(): string {
  return CONTAINER ? `docker container "${CONTAINER}"` : `binary "${BIN}"`;
}

/** Translate a wacli argv into the program and arguments actually executed. */
export function wacliCommand(args: string[], options: { stdin?: boolean } = {}): { bin: string; args: string[] } {
  if (!CONTAINER) return { bin: BIN, args };
  return {
    bin: DOCKER,
    args: ['exec', ...(options.stdin ? ['-i'] : []), CONTAINER, 'wacli', ...args],
  };
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Non-null when the process failed to start, timed out, or exited non-zero. */
  error: ExecFileException | null;
}

/** Run wacli to completion and capture its output (no shell is involved). */
export function runWacli(
  args: string[],
  options: { timeoutMs: number; maxBuffer?: number },
): Promise<RunResult> {
  const cmd = wacliCommand(args);
  return new Promise((resolve) => {
    execFile(
      cmd.bin,
      cmd.args,
      { timeout: options.timeoutMs, maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024, env: process.env },
      (error, stdout, stderr) => {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', error: error ?? null });
      },
    );
  });
}

/** Start a long-lived wacli process. Stop it with `terminateWacli`, never `child.kill` alone. */
export function spawnWacli(args: string[], options: { stdio?: StdioOptions } = {}): ChildProcess {
  const cmd = wacliCommand(args);
  return spawn(cmd.bin, cmd.args, { env: process.env, stdio: options.stdio });
}

/**
 * Stop a process started with `spawnWacli`.
 *
 * Synchronous on purpose: it is also called from the server's exit hooks, where
 * nothing asynchronous would get a chance to run.
 */
export function terminateWacli(child: ChildProcess, args: string[]): void {
  if (CONTAINER) {
    // The client on the host is just a pipe; the real process is inside.
    pkillInContainerSync(`^wacli ${args.map(escapeRegex).join(' ')}$`);
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // Already gone.
  }
}

/**
 * Terminate wacli processes left over from a previous server run whose command
 * line matches `pattern` (an extended regex). `ownPids` are never signalled.
 * Resolves with the number of processes signalled.
 */
export async function killStrayWacli(pattern: string, ownPids: Set<number | undefined>): Promise<number[]> {
  const pgrep = CONTAINER ? [DOCKER, ['exec', CONTAINER, 'pgrep', '-f', pattern]] as const : ['pgrep', ['-f', pattern]] as const;
  const stdout = await new Promise<string>((resolve) => {
    execFile(pgrep[0], [...pgrep[1]], { timeout: 10_000 }, (err, out) => resolve(err ? '' : out));
  });

  const pids = stdout
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid && !ownPids.has(pid));
  if (pids.length === 0) return [];

  if (CONTAINER) {
    await new Promise<void>((resolve) => {
      execFile(DOCKER, ['exec', CONTAINER, 'kill', '-TERM', ...pids.map(String)], { timeout: 10_000 }, () => resolve());
    });
    return pids;
  }

  const signalled: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      signalled.push(pid);
    } catch {
      // Already gone, or not ours to signal.
    }
  }
  return signalled;
}

/** Regex matching `wacli --account <account> <subcommand> …` wherever wacli lives. */
export function wacliProcessPattern(account: string, subcommand: string): string {
  // `(^|/)` accepts both a bare `wacli` and an absolute path to it; the trailing
  // group stops `laerp-user-1` from also matching `laerp-user-10`.
  return `(^|/)wacli --account ${escapeRegex(account)} ${escapeRegex(subcommand)}( |$)`;
}

function pkillInContainerSync(pattern: string): void {
  try {
    execFileSync(DOCKER, ['exec', CONTAINER, 'pkill', '-TERM', '-f', pattern], {
      timeout: 5_000,
      stdio: 'ignore',
    });
  } catch {
    // Exit status 1 means nothing matched; anything else means the container
    // is down, in which case there is nothing left to stop either.
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Webhook -----------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]']);

/** Base URL the `sync --follow --webhook` process posts inbound messages to. */
export function webhookBase(): string {
  const override = (process.env.WACLI_WEBHOOK_BASE ?? '').trim();
  if (override) return override.replace(/\/+$/, '');

  const internal = (process.env.APP_INTERNAL_URL ?? '').trim() || 'http://127.0.0.1:3000';
  if (!CONTAINER) return internal.replace(/\/+$/, '');

  // Inside the container loopback is the container itself; the compose file
  // maps host.docker.internal to the host, so keep the port and swap the host.
  try {
    const url = new URL(internal);
    if (LOOPBACK_HOSTS.has(url.hostname)) url.hostname = 'host.docker.internal';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return 'http://host.docker.internal:3000';
  }
}

// --- Scratch files -----------------------------------------------------------

/**
 * Temporary files exchanged with wacli: uploads to send, downloads to serve.
 *
 * wacli only deals in filesystem paths. In container mode those paths are
 * inside the container, so the bytes are piped through `docker exec` instead
 * of relying on a directory both sides can see.
 */
export interface WacliScratch {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(path: string, bytes: Buffer): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  readFile(path: string): Promise<Buffer>;
  remove(dir: string): Promise<void>;
  /** Join a directory and file name the way the wacli side expects. */
  join(dir: string, name: string): string;
}

const MAX_MEDIA_BYTES = 256 * 1024 * 1024;

const nativeScratch: WacliScratch = {
  async mkdtemp(prefix) {
    const { mkdtemp } = await import('fs/promises');
    const { tmpdir } = await import('os');
    return mkdtemp(join(tmpdir(), prefix));
  },
  async writeFile(path, bytes) {
    const { writeFile } = await import('fs/promises');
    await writeFile(path, bytes, { mode: 0o600 });
  },
  async readdir(dir) {
    const { readdir } = await import('fs/promises');
    return readdir(dir);
  },
  async readFile(path) {
    const { readFile } = await import('fs/promises');
    return readFile(path);
  },
  async remove(dir) {
    const { rm } = await import('fs/promises');
    await rm(dir, { recursive: true, force: true });
  },
  join,
};

const dockerScratch: WacliScratch = {
  async mkdtemp(prefix) {
    const out = await dockerExec(['mktemp', '-d', `/tmp/${prefix}XXXXXX`]);
    const dir = out.toString('utf8').trim();
    if (!dir.startsWith('/tmp/')) throw new Error(`unexpected mktemp output: ${dir}`);
    return dir;
  },
  async writeFile(path, bytes) {
    // The path travels as a positional parameter, never interpolated into the script.
    await dockerExec(['sh', '-c', 'umask 077 && cat > "$1"', 'sh', path], { input: bytes });
  },
  async readdir(dir) {
    const out = await dockerExec(['ls', '-1A', '--', dir]);
    return out.toString('utf8').split('\n').filter((name) => name.length > 0);
  },
  async readFile(path) {
    return dockerExec(['cat', '--', path]);
  },
  async remove(dir) {
    await dockerExec(['rm', '-rf', '--', dir]);
  },
  // Container paths are POSIX regardless of the host.
  join: (dir, name) => `${dir.replace(/\/+$/, '')}/${name}`,
};

export function wacliScratch(): WacliScratch {
  return CONTAINER ? dockerScratch : nativeScratch;
}

/** Run a command inside the container, piping `input` to it, and return its stdout. */
function dockerExec(args: string[], options: { input?: Buffer; timeoutMs?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      DOCKER,
      ['exec', ...(options.input ? ['-i'] : []), CONTAINER, ...args],
      { env: process.env, stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] },
    );
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`docker exec ${args[0]} timed out`));
    }, options.timeoutMs ?? 120_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_MEDIA_BYTES) {
        child.kill('SIGKILL');
        return;
      }
      out.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (outBytes > MAX_MEDIA_BYTES) reject(new Error('output exceeded the media size limit'));
      else if (code !== 0) reject(new Error(stderr.trim() || `docker exec ${args[0]} exited with code ${code}`));
      else resolve(Buffer.concat(out));
    });

    if (options.input && child.stdin) {
      child.stdin.on('error', () => {
        // A short-lived command may close stdin early; the exit code decides.
      });
      child.stdin.end(options.input);
    }
  });
}

// --- Boot --------------------------------------------------------------------

export type ContainerBoot = 'native' | 'running' | 'started' | 'created';

/**
 * Make sure the wacli container is up before anything tries to use it.
 *
 * Tried in order: already running → `docker start` of a stopped container →
 * `docker compose up` of the service from the compose file in the working
 * directory. The image is never built here (that can take minutes and would
 * hold up serving); `deploy.sh` and `docker compose up -d` build it.
 */
export async function ensureWacliContainer(): Promise<ContainerBoot> {
  if (!CONTAINER) return 'native';

  const running = await docker(['inspect', '-f', '{{.State.Running}}', CONTAINER], 10_000).catch(() => null);
  if (running?.trim() === 'true') return 'running';

  if (running?.trim() === 'false') {
    await docker(['start', CONTAINER], 30_000);
    return 'started';
  }

  const composeFile = (process.env.COMPOSE_FILE ?? '').trim() || join(process.cwd(), 'docker-compose.yml');
  if (!existsSync(composeFile)) {
    throw new Error(
      `container "${CONTAINER}" does not exist and there is no compose file at ${composeFile}. ` +
        `Run \`docker compose up -d ${COMPOSE_SERVICE}\` from the project directory.`,
    );
  }
  await docker(['compose', '-f', composeFile, 'up', '-d', '--no-deps', '--no-build', COMPOSE_SERVICE], 60_000);
  return 'created';
}

function docker(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(DOCKER, args, { timeout: timeoutMs, env: process.env, cwd: process.cwd() }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(stdout ?? '');
    });
  });
}
