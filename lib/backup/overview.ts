import 'server-only';

import type { BackupRun } from '@prisma/client';

import { prisma } from '../prisma';
import { applyRetention, nextScheduledAt } from './policy';
import type { BackupFileResult } from './run';
import { isBackupRunning } from './run';
import { getBackupSettings, isConnected, publicSettings } from './settings';
import { describeSources } from './sources';

/** What the admin page shows: settings (no secrets), recent runs, what's next. */

export function serializeRun(run: BackupRun, keptAs: string[] = []) {
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    sizeBytes: Number(run.sizeBytes),
    files: (Array.isArray(run.files) ? run.files : []) as unknown as BackupFileResult[],
    error: run.error,
    folderName: run.folderName,
    folderUrl: run.folderId && !run.prunedAt ? `https://drive.google.com/drive/folders/${run.folderId}` : null,
    keyFingerprint: run.keyFingerprint,
    pinned: run.pinned,
    locked: run.locked,
    verifiedAt: run.verifiedAt?.toISOString() ?? null,
    verifyError: run.verifyError,
    prunedAt: run.prunedAt?.toISOString() ?? null,
    keptAs,
  };
}

export type SerializedBackupRun = ReturnType<typeof serializeRun>;

export async function backupOverview() {
  const settings = await getBackupSettings();
  const runs = await prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 60 });

  // Why each live snapshot is being kept, shown as badges.
  const live = runs.filter((r) => (r.status === 'success' || r.status === 'partial') && !r.prunedAt);
  const { keep } = applyRetention(live, {
    keepDaily: settings.keepDaily,
    keepWeekly: settings.keepWeekly,
    keepMonthly: settings.keepMonthly,
    timeZone: settings.timezone,
  });

  const stored = live.reduce((sum, r) => sum + Number(r.sizeBytes), 0);
  const lastGood = live[0] ?? null;

  return {
    settings: publicSettings(settings),
    running: isBackupRunning() || runs.some((r) => r.status === 'running'),
    nextRunAt:
      settings.enabled && isConnected(settings)
        ? nextScheduledAt(new Date(), settings.scheduleTime, settings.timezone).toISOString()
        : null,
    lastSuccessAt: lastGood?.startedAt.toISOString() ?? null,
    storedBytes: stored,
    snapshotCount: live.length,
    sources: await describeSources(),
    runs: runs.map((r) => serializeRun(r, keep.get(r.id) ?? [])),
  };
}

export type BackupOverview = Awaited<ReturnType<typeof backupOverview>>;
