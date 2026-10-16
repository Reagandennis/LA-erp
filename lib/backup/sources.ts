import 'server-only';

import { execFile, spawn } from 'child_process';
import { access, constants, readdir, stat } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';
import { PassThrough, type Readable } from 'stream';

import { wacliInDocker } from '../wacli-runtime';

/**
 * What a backup contains, and how each part is captured while the platform
 * keeps running.
 *
 * Every part is a stream from a child process (pg_dump, tar, sqlite3), so
 * nothing is staged on disk and size is no concern. A part's stream ends only
 * once its process has exited cleanly; a failure mid-way errors the stream,
 * which abandons that upload rather than saving a truncated file.
 */

export type BackupComponent =
  | 'database'
  | 'whatsapp'
  | 'whatsapp-media'
  | 'signal'
  | 'media-cache'
  | 'config';

export interface BackupPart {
  component: BackupComponent;
  /** File name in the snapshot, before `.enc`. */
  fileName: string;
  /** Compress before encrypting (pointless for dumps and media that already are). */
  gzip: boolean;
  open(): Readable;
}

export interface BackupComponentOptions {
  includeDatabase: boolean;
  includeWhatsapp: boolean;
  includeWhatsappMedia: boolean;
  includeSignal: boolean;
  includeMediaCache: boolean;
  includeConfig: boolean;
}

const DOCKER = (process.env.DOCKER_BIN ?? '').trim() || 'docker';
const WACLI_CONTAINER = (process.env.WACLI_CONTAINER ?? '').trim();

/**
 * Run a command and stream its stdout. The stream errors (with the end of
 * stderr) if the command fails, and destroying it stops the command.
 */
export function commandStream(
  bin: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; okCodes?: number[] } = {},
): Readable {
  const env = options.env ?? process.env;
  const okCodes = options.okCodes ?? [0];
  const out = new PassThrough();
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let exited = false;
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });
  child.stdout.pipe(out, { end: false });
  child.on('error', (error) => out.destroy(new Error(`${bin} could not start: ${error.message}`)));
  child.on('close', (code, signal) => {
    exited = true;
    if (code !== null && okCodes.includes(code)) out.end();
    else out.destroy(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `${bin} exited with ${code ?? signal}`));
  });
  out.on('close', () => {
    if (!exited) child.kill('SIGTERM');
  });
  return out;
}

function run(bin: string, args: string[], timeoutMs = 15_000): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((done) => {
    execFile(bin, args, { timeout: timeoutMs }, (error, stdout) => done({ ok: !error, stdout: stdout ?? '' }));
  });
}

// --- Database ----------------------------------------------------------------

interface PgTarget {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  sslmode: string | null;
}

function pgTarget(): PgTarget {
  const raw = (process.env.DATABASE_URL ?? '').trim();
  if (!raw) throw new Error('DATABASE_URL is not set.');
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    sslmode: url.searchParams.get('sslmode'),
  };
}

/**
 * How pg_dump is reached. `BACKUP_PG_CONTAINER` names a Postgres container
 * to run it inside (always the server's own version); otherwise pg_dump on
 * the host (or `PG_DUMP_BIN`) is used, falling back to the bundled
 * `la-erp-postgres` container when the host has none.
 */
async function pgDumpRunner(): Promise<{ bin: string; args: string[]; env: NodeJS.ProcessEnv; where: string }> {
  const target = pgTarget();
  const dumpArgs = ['--format=custom', '--no-owner', '--no-acl', '--username', target.user, '--dbname', target.database];
  // The password travels in the environment, never on a command line.
  const env = { ...process.env, PGPASSWORD: target.password, ...(target.sslmode ? { PGSSLMODE: target.sslmode } : {}) };

  const explicitContainer = (process.env.BACKUP_PG_CONTAINER ?? '').trim();
  const nativeBin = (process.env.PG_DUMP_BIN ?? '').trim() || 'pg_dump';
  let container = explicitContainer;
  if (!container && !(await run(nativeBin, ['--version'])).ok) {
    const bundled = await run(DOCKER, ['inspect', '-f', '{{.State.Running}}', 'la-erp-postgres']);
    if (bundled.stdout.trim() === 'true') container = 'la-erp-postgres';
  }

  if (container) {
    // `-e PGPASSWORD` with no value copies it from our environment.
    return {
      bin: DOCKER,
      args: ['exec', '-e', 'PGPASSWORD', container, 'pg_dump', ...dumpArgs],
      env,
      where: `container ${container}`,
    };
  }
  return {
    bin: nativeBin,
    args: [...dumpArgs, '--host', target.host, '--port', target.port],
    env,
    where: nativeBin,
  };
}

// --- WhatsApp (wacli container) ----------------------------------------------

/**
 * GNU tar exits 1 when a file changed while it was read (a log line, a media
 * download finishing). The archive is still valid — that file is simply as
 * it was a moment earlier — so a live backup accepts it.
 */
const TAR_OK = [0, 1];

/**
 * Consistent copies of every SQLite store under /data, made with sqlite3's
 * online backup while sync keeps writing — a plain file copy of a live
 * database can come out corrupt.
 */
const WACLI_STORES_SCRIPT = `
set -eu
command -v sqlite3 >/dev/null || { echo "sqlite3 is missing: rebuild the wacli image (docker compose build wacli)" >&2; exit 3; }
out=$(mktemp -d /tmp/laerp-backup-XXXXXX)
trap 'rm -rf "$out"' EXIT
cd /data
find . -type f -name '*.db' | while IFS= read -r db; do
  mkdir -p "$out/$(dirname "$db")"
  sqlite3 "$db" ".timeout 30000" ".backup '$out/$db'"
done
tar -C "$out" -cf - .
`;

function wacliExec(script: string, okCodes = [0]): Readable {
  return commandStream(DOCKER, ['exec', WACLI_CONTAINER, 'sh', '-c', script], { okCodes });
}

// --- Paths -------------------------------------------------------------------

export function mediaCacheDir(): string {
  return (process.env.MESSAGING_MEDIA_CACHE_DIR ?? '').trim() || join(tmpdir(), 'la-erp-media');
}

export function signalDataDir(): string {
  return (process.env.SIGNAL_CLI_DATA_DIR ?? '').trim() || join(homedir(), '.local', 'share', 'signal-cli');
}

async function isDir(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isDirectory(), () => false);
}

async function readable(path: string): Promise<boolean> {
  return access(path, constants.R_OK).then(() => true, () => false);
}

/** `.env` plus this app's systemd units, when the process can read them. */
async function configFiles(): Promise<string[]> {
  const files: string[] = [];
  const env = resolve(process.cwd(), '.env');
  if (await readable(env)) files.push(env);
  const unitDir = '/etc/systemd/system';
  const units = await readdir(unitDir).catch(() => [] as string[]);
  for (const name of units) {
    if (/^la-erp.*\.(service|timer)$/.test(name) && (await readable(join(unitDir, name)))) files.push(join(unitDir, name));
  }
  return files;
}

// --- Plan --------------------------------------------------------------------

export interface BackupPlan {
  parts: BackupPart[];
  /** Components that were asked for but can't be taken here, and why. */
  skipped: Array<{ component: BackupComponent; reason: string }>;
}

export async function planBackup(options: BackupComponentOptions): Promise<BackupPlan> {
  const parts: BackupPart[] = [];
  const skipped: BackupPlan['skipped'] = [];

  if (options.includeDatabase) {
    const runner = await pgDumpRunner();
    parts.push({
      component: 'database',
      fileName: 'database.dump',
      gzip: false, // pg_dump's custom format is already compressed.
      open: () => commandStream(runner.bin, runner.args, { env: runner.env }),
    });
  }

  if (options.includeWhatsapp || options.includeWhatsappMedia) {
    if (!wacliInDocker()) {
      skipped.push({ component: 'whatsapp', reason: 'WhatsApp backups need wacli in its container (WACLI_CONTAINER).' });
    } else {
      if (options.includeWhatsapp) {
        parts.push({ component: 'whatsapp', fileName: 'whatsapp-stores.tar', gzip: true, open: () => wacliExec(WACLI_STORES_SCRIPT) });
        parts.push({
          component: 'whatsapp',
          fileName: 'whatsapp-files.tar',
          gzip: true,
          // Everything else: config, keys, state. Live databases come from the
          // consistent copies above; locks, heartbeats and sockets are runtime-only.
          open: () =>
            wacliExec(
              "tar -C /data --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' --exclude='*.sock' --exclude=LOCK --exclude=HEARTBEAT --exclude=media -cf - .",
              TAR_OK,
            ),
        });
      }
      if (options.includeWhatsappMedia) {
        parts.push({
          component: 'whatsapp-media',
          fileName: 'whatsapp-media.tar',
          gzip: false, // Photos and videos are already compressed.
          open: () => wacliExec('cd /data && find . -type d -name media -prune -print | tar -cf - -T -', TAR_OK),
        });
      }
    }
  }

  if (options.includeSignal) {
    const dir = signalDataDir();
    if (await isDir(dir)) {
      parts.push({ component: 'signal', fileName: 'signal.tar', gzip: true, open: () => commandStream('tar', ['-C', dir, '-cf', '-', '.'], { okCodes: TAR_OK }) });
    } else {
      skipped.push({ component: 'signal', reason: `No Signal data at ${dir}.` });
    }
  }

  if (options.includeMediaCache) {
    const dir = mediaCacheDir();
    if (await isDir(dir)) {
      parts.push({ component: 'media-cache', fileName: 'media-cache.tar', gzip: false, open: () => commandStream('tar', ['-C', dir, '-cf', '-', '.'], { okCodes: TAR_OK }) });
    } else {
      skipped.push({ component: 'media-cache', reason: `No media cache at ${dir} yet.` });
    }
  }

  if (options.includeConfig) {
    const files = await configFiles();
    if (files.length > 0) {
      // Archived relative to "/", so they restore to the same place.
      const relative = files.map((f) => f.replace(/^\/+/, ''));
      parts.push({ component: 'config', fileName: 'config.tar', gzip: true, open: () => commandStream('tar', ['-C', '/', '-cf', '-', ...relative]) });
    } else {
      skipped.push({ component: 'config', reason: 'No readable .env or service files.' });
    }
  }

  return { parts, skipped };
}

/** Where each component comes from, for the admin page. */
export async function describeSources(): Promise<Record<string, string>> {
  let database = 'pg_dump';
  try {
    database = `pg_dump via ${(await pgDumpRunner()).where}`;
  } catch (error) {
    database = (error as Error).message;
  }
  return {
    database,
    whatsapp: wacliInDocker() ? `container ${WACLI_CONTAINER}, /data` : 'wacli is not in a container',
    signal: signalDataDir(),
    mediaCache: mediaCacheDir(),
    mediaCacheIsTemporary: String(mediaCacheDir().startsWith(tmpdir())),
    config: '.env and /etc/systemd/system/la-erp*',
  };
}
