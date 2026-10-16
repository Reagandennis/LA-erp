import 'server-only';

import { execFile } from 'child_process';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { gunzipSync, createGzip } from 'zlib';

import type { BackupRun, BackupSettings } from '@prisma/client';

import { recordAuditEvent } from '../audit';
import { isEmailConfigured, sendEmail } from '../email';
import { prisma } from '../prisma';
import { decryptBuffer, encryptStream, keyFingerprint } from './crypto';
import type { DriveClient } from './drive';
import { applyRetention, isDue, isFirstOfMonth, snapshotName } from './policy';
import { driveClientFor, getBackupSettings, isConnected } from './settings';
import { type BackupComponent, planBackup } from './sources';

/**
 * One backup run: every enabled part streamed — compressed where it helps,
 * encrypted always — into a new dated snapshot folder in the Shared Drive,
 * then checked against Drive's own checksums, locked if it is the month's
 * snapshot, verified, and finally the retention schedule is applied.
 */

export interface BackupFileResult {
  component: BackupComponent | 'manifest';
  name: string;
  ok: boolean;
  /** Asked for, but there is nothing to take on this server (not a failure). */
  skipped?: boolean;
  bytes?: number;
  md5?: string;
  driveFileId?: string;
  error?: string;
}

declare global {
  var backupRunningGlobal: number | null | undefined;
  var backupScheduleTimerGlobal: NodeJS.Timeout | undefined;
}

const MANIFEST_FORMAT = 'la-erp-backup/1';
/** Largest file downloaded in full to prove the key still decrypts a snapshot. */
const VERIFY_DECRYPT_MAX_BYTES = 64 * 1024 * 1024;

export function isBackupRunning(): boolean {
  return Boolean(globalThis.backupRunningGlobal);
}

/**
 * Start a run in the background and return its id at once; the page polls
 * for progress. Only one run at a time.
 */
export async function startBackup(trigger: 'schedule' | 'manual', triggeredById: number | null): Promise<BackupRun> {
  if (globalThis.backupRunningGlobal) throw new Error('A backup is already running.');
  const settings = await getBackupSettings();
  if (!isConnected(settings) || !settings.encryptionKey) throw new Error('Connect Google Drive first.');

  const run = await prisma.backupRun.create({ data: { trigger, triggeredById } });
  globalThis.backupRunningGlobal = run.id;
  void execute(run, settings)
    .catch((error) => console.error('[backup] run failed:', error))
    .finally(() => {
      globalThis.backupRunningGlobal = null;
    });
  return run;
}

async function execute(run: BackupRun, settings: BackupSettings): Promise<void> {
  const client = driveClientFor(settings);
  const key = settings.encryptionKey!;
  const fingerprint = keyFingerprint(key);
  const results: BackupFileResult[] = [];
  let folderId: string | null = null;

  const save = (data: Parameters<typeof prisma.backupRun.update>[0]['data']) =>
    prisma.backupRun.update({ where: { id: run.id }, data });

  try {
    const folderName = snapshotName(run.startedAt, settings.timezone, run.trigger);
    const folder = await client.createFolder(folderName, settings.folderId!, {
      laerpBackup: '1',
      laerpRun: String(run.id),
    });
    folderId = folder.id;
    await save({ folderId, folderName, keyFingerprint: fingerprint });

    const plan = await planBackup(settings);
    for (const skip of plan.skipped) {
      results.push({ component: skip.component, name: skip.component, ok: false, skipped: true, error: skip.reason });
    }

    for (const part of plan.parts) {
      const name = `${part.fileName}${part.gzip ? '.gz' : ''}.enc`;
      try {
        const out = new PassThrough();
        const piping = pipeline([part.open(), ...(part.gzip ? [createGzip({ level: 6 })] : []), encryptStream(key), out]);
        const [file] = await Promise.all([
          client
            .upload(name, folder.id, out, {
              appProperties: { laerpBackup: '1', laerpRun: String(run.id), component: part.component },
            })
            .catch((error: Error) => {
              out.destroy(error);
              throw error;
            }),
          piping,
        ]);
        // Drive computes its own MD5 of what it stored; it must match what we sent.
        if (file.md5Checksum && file.md5Checksum !== file.localMd5) {
          throw new Error(`checksum mismatch after upload (sent ${file.localMd5}, Drive has ${file.md5Checksum})`);
        }
        results.push({ component: part.component, name, ok: true, bytes: file.bytes, md5: file.localMd5, driveFileId: file.id });
      } catch (error) {
        results.push({ component: part.component, name, ok: false, error: (error as Error).message });
      }
      await save({ files: results as never, sizeBytes: BigInt(totalBytes(results)) });
    }

    const manifest = await client.uploadSmall(
      'manifest.json',
      folder.id,
      JSON.stringify(await manifestFor(run, settings, fingerprint, results), null, 2),
      { mimeType: 'application/json', appProperties: { laerpBackup: '1', laerpRun: String(run.id), component: 'manifest' } },
    );
    results.push({ component: 'manifest', name: 'manifest.json', ok: true, bytes: manifest.bytes, md5: manifest.localMd5, driveFileId: manifest.id });

    const attempted = results.filter((r) => !r.skipped && r.component !== 'manifest');
    const databaseFailed = settings.includeDatabase && !results.some((r) => r.component === 'database' && r.ok);
    const status =
      databaseFailed || attempted.every((r) => !r.ok) ? 'failed' : attempted.some((r) => !r.ok) ? 'partial' : 'success';
    const firstError = attempted.find((r) => !r.ok)?.error ?? null;

    if (status === 'failed') {
      // Nothing restorable in it: don't leave a half snapshot to confuse a restore.
      await client.trash(folder.id).catch(() => {});
    }

    const finished = await save({
      status,
      finishedAt: new Date(),
      files: results as never,
      sizeBytes: BigInt(totalBytes(results)),
      error: firstError ? `${attempted.find((r) => !r.ok)?.name}: ${firstError}` : null,
    });

    if (status !== 'failed') {
      if (settings.lockMonthly) await lockIfMonthly(client, finished, settings);
      await verifyRun(finished.id).catch(() => {});
      await applyRetentionSchedule(client, settings);
    }
    await report(finished, settings);
  } catch (error) {
    const message = (error as Error).message;
    if (folderId) await client.trash(folderId).catch(() => {});
    const failed = await save({ status: 'failed', finishedAt: new Date(), error: message, files: results as never });
    await report(failed, settings);
  }
}

function totalBytes(results: BackupFileResult[]): number {
  return results.reduce((sum, r) => sum + (r.ok ? r.bytes ?? 0 : 0), 0);
}

function gitCommit(): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), timeout: 5000 }, (error, stdout) =>
      done(error ? null : stdout.trim() || null),
    );
  });
}

async function manifestFor(run: BackupRun, settings: BackupSettings, fingerprint: string, results: BackupFileResult[]) {
  const migration = await prisma
    .$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`
    .then((rows) => rows[0]?.migration_name ?? null)
    .catch(() => null);
  return {
    format: MANIFEST_FORMAT,
    createdAt: run.startedAt.toISOString(),
    trigger: run.trigger,
    timezone: settings.timezone,
    app: { version: process.env.npm_package_version ?? null, commit: await gitCommit(), lastMigration: migration },
    encryption: {
      cipher: 'AES-256-GCM',
      keyFingerprint: fingerprint,
      layout: '"LAERPBK1" | 12-byte nonce | ciphertext | 16-byte auth tag',
      decrypt: 'node scripts/backup-decrypt.mjs --key <recovery key> <file>.enc <output>',
    },
    files: results.map(({ component, name, ok, skipped, bytes, md5, error }) => ({ component, name, ok, skipped, bytes, md5, error })),
    restore: 'See "Backups → Restoring" in README.md.',
  };
}

/** The month's first snapshot is locked read-only in Drive. */
async function lockIfMonthly(client: DriveClient, run: BackupRun, settings: BackupSettings): Promise<void> {
  const earlier = await prisma.backupRun.findMany({
    where: { status: { in: ['success', 'partial'] }, id: { not: run.id } },
    select: { id: true, startedAt: true, pinned: true },
  });
  if (!isFirstOfMonth({ id: run.id, startedAt: run.startedAt, pinned: run.pinned }, earlier, settings.timezone)) return;
  const ids = filesOf(run).map((f) => f.driveFileId!).filter(Boolean);
  for (const id of ids) await client.setReadOnly(id, true).catch(() => {});
  await prisma.backupRun.update({ where: { id: run.id }, data: { locked: true } });
}

function filesOf(run: Pick<BackupRun, 'files'>): BackupFileResult[] {
  return Array.isArray(run.files) ? (run.files as unknown as BackupFileResult[]) : [];
}

/** Move expired snapshots to the Drive trash (recoverable there for 30 days). */
export async function applyRetentionSchedule(client: DriveClient, settings: BackupSettings): Promise<number[]> {
  const live = await prisma.backupRun.findMany({
    where: { status: { in: ['success', 'partial'] }, prunedAt: null },
  });
  const { prune } = applyRetention(live, {
    keepDaily: settings.keepDaily,
    keepWeekly: settings.keepWeekly,
    keepMonthly: settings.keepMonthly,
    timeZone: settings.timezone,
  });

  const pruned: number[] = [];
  for (const id of prune) {
    const run = live.find((r) => r.id === id)!;
    try {
      if (run.locked) {
        for (const file of filesOf(run)) if (file.driveFileId) await client.setReadOnly(file.driveFileId, false).catch(() => {});
      }
      if (run.folderId) await client.trash(run.folderId);
      await prisma.backupRun.update({ where: { id }, data: { prunedAt: new Date() } });
      pruned.push(id);
    } catch (error) {
      console.error(`[backup] could not prune snapshot ${id}:`, (error as Error).message);
    }
  }
  return pruned;
}

/**
 * Check a snapshot is intact: every file still in Drive with the size and
 * checksum recorded when it was uploaded, and the smallest one downloaded
 * and decrypted in full — proof the current key still opens it.
 */
export async function verifyRun(runId: number): Promise<{ ok: boolean; problems: string[] }> {
  const [run, settings] = await Promise.all([prisma.backupRun.findUniqueOrThrow({ where: { id: runId } }), getBackupSettings()]);
  const client = driveClientFor(settings);
  const problems: string[] = [];

  if (settings.encryptionKey && run.keyFingerprint && run.keyFingerprint !== keyFingerprint(settings.encryptionKey)) {
    problems.push(`Encrypted with a different key (fingerprint ${run.keyFingerprint}).`);
  }

  const files = filesOf(run).filter((f) => f.ok && f.driveFileId);
  for (const file of files) {
    try {
      const meta = await client.getFile(file.driveFileId!, 'id,size,md5Checksum,trashed');
      if (meta.trashed) problems.push(`${file.name} is in the Drive trash.`);
      else if (file.md5 && meta.md5Checksum && meta.md5Checksum !== file.md5) problems.push(`${file.name} has changed since it was uploaded.`);
      else if (file.bytes !== undefined && meta.size !== undefined && Number(meta.size) !== file.bytes) {
        problems.push(`${file.name} is a different size than uploaded.`);
      }
    } catch (error) {
      problems.push(`${file.name}: ${(error as Error).message}`);
    }
  }

  const sample = files
    .filter((f) => f.name.endsWith('.enc') && (f.bytes ?? Infinity) <= VERIFY_DECRYPT_MAX_BYTES)
    .sort((a, b) => (a.bytes ?? 0) - (b.bytes ?? 0))[0];
  if (sample && settings.encryptionKey && problems.length === 0) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of await client.download(sample.driveFileId!)) chunks.push(chunk as Buffer);
      const plain = decryptBuffer(settings.encryptionKey, Buffer.concat(chunks));
      if (sample.name.endsWith('.gz.enc')) gunzipSync(plain);
    } catch (error) {
      problems.push(`${sample.name} could not be decrypted: ${(error as Error).message}`);
    }
  }

  await prisma.backupRun.update({
    where: { id: runId },
    data: problems.length === 0 ? { verifiedAt: new Date(), verifyError: null } : { verifyError: problems.join(' ') },
  });
  return { ok: problems.length === 0, problems };
}

/** Audit every run; email the alert list when one fails or is incomplete. */
async function report(run: BackupRun, settings: BackupSettings): Promise<void> {
  await recordAuditEvent({
    action: run.status === 'failed' ? 'backup.failed' : 'backup.completed',
    entityType: 'backup',
    entityId: String(run.id),
    actorUserId: run.triggeredById,
    metadata: { status: run.status, trigger: run.trigger, sizeBytes: Number(run.sizeBytes), error: run.error },
  }).catch(() => {});

  const to = settings.alertEmails.split(',').map((e) => e.trim()).filter(Boolean);
  if (run.status === 'success' || to.length === 0 || !isEmailConfigured()) return;
  const failed = filesOf(run).filter((f) => !f.ok && !f.skipped);
  const lines = [
    `The ${run.trigger === 'schedule' ? 'scheduled' : 'manual'} backup started ${run.startedAt.toISOString()} ${run.status === 'failed' ? 'failed' : 'finished with errors'}.`,
    run.error ? `Error: ${run.error}` : '',
    ...failed.map((f) => `• ${f.name}: ${f.error}`),
    'Details: Admin → Settings → Backups.',
  ].filter(Boolean);
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  await sendEmail({
    to,
    subject: run.status === 'failed' ? 'LA-ERP backup FAILED' : 'LA-ERP backup incomplete',
    html: lines.map((line) => `<p>${escape(line)}</p>`).join(''),
    text: lines.join('\n\n'),
  }).catch((error) => console.error('[backup] could not send the alert email:', (error as Error).message));
}

// --- Schedule ----------------------------------------------------------------

const CHECK_EVERY_MS = 5 * 60 * 1000;
/** A run still "running" after this long died with the server; it is closed as failed. */
const STALE_RUN_MS = 12 * 60 * 60 * 1000;

async function closeInterruptedRuns(): Promise<void> {
  await prisma.backupRun.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
    data: { status: 'failed', finishedAt: new Date(), error: 'Interrupted: the server stopped during the backup.' },
  });
  if (!globalThis.backupRunningGlobal) {
    // Nothing runs in this process, so a "running" row is from a previous one.
    await prisma.backupRun.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', finishedAt: new Date(), error: 'Interrupted: the server restarted during the backup.' },
    });
  }
}

async function runIfDue(): Promise<void> {
  const settings = await getBackupSettings();
  if (!settings.enabled || !isConnected(settings) || isBackupRunning()) return;
  const last = await prisma.backupRun.findFirst({
    where: { trigger: 'schedule' },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  if (!isDue(new Date(), settings.scheduleTime, settings.timezone, last?.startedAt ?? null)) return;
  await startBackup('schedule', null);
}

/** Check every few minutes whether the daily backup is due (and catch up a missed one). */
export function scheduleBackups(): void {
  if (globalThis.backupScheduleTimerGlobal) return;
  const tick = () =>
    runIfDue().catch((error) => console.error('[backup] scheduler:', (error as Error).message));
  void closeInterruptedRuns().catch(() => {});
  const first = setTimeout(tick, 2 * 60 * 1000);
  first.unref?.();
  globalThis.backupScheduleTimerGlobal = setInterval(tick, CHECK_EVERY_MS);
  globalThis.backupScheduleTimerGlobal.unref?.();
}
