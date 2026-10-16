'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminFetch, errorMessage } from '@/app/admin/_components/admin-api';
import {
  Card,
  dangerButton,
  formatDateTime,
  inputClass,
  primaryButton,
  relativeTime,
  secondaryButton,
  StatTile,
} from '@/app/admin/_components/admin-ui';
import { useBanner } from '@/app/ui/banner';
import type { BackupOverview } from '@/lib/backup/overview';

type Settings = BackupOverview['settings'];
type Run = BackupOverview['runs'][number];

type EditableSettings = Pick<
  Settings,
  | 'enabled'
  | 'scheduleTime'
  | 'timezone'
  | 'keepDaily'
  | 'keepWeekly'
  | 'keepMonthly'
  | 'includeDatabase'
  | 'includeWhatsapp'
  | 'includeWhatsappMedia'
  | 'includeSignal'
  | 'includeMediaCache'
  | 'includeConfig'
  | 'lockMonthly'
  | 'alertEmails'
>;

function editable(s: Settings): EditableSettings {
  const {
    enabled, scheduleTime, timezone, keepDaily, keepWeekly, keepMonthly, includeDatabase, includeWhatsapp,
    includeWhatsappMedia, includeSignal, includeMediaCache, includeConfig, lockMonthly, alertEmails,
  } = s;
  return {
    enabled, scheduleTime, timezone, keepDaily, keepWeekly, keepMonthly, includeDatabase, includeWhatsapp,
    includeWhatsappMedia, includeSignal, includeMediaCache, includeConfig, lockMonthly, alertEmails,
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
}

function duration(run: Run): string {
  if (!run.finishedAt) return '';
  const seconds = Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
  return seconds < 90 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
}

const STATUS: Record<string, { label: string; className: string }> = {
  success: { label: 'Complete', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' },
  partial: { label: 'Incomplete', className: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
  failed: { label: 'Failed', className: 'bg-rose-50 text-rose-700 ring-rose-600/15' },
  running: { label: 'Running…', className: 'bg-blue-50 text-[#03458f] ring-[#03458f]/15' },
};

const KEEP_LABELS: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', pinned: 'Kept forever', latest: 'Latest' };

const COMPONENTS: Array<{ key: keyof EditableSettings; label: string; detail: string; source?: string }> = [
  { key: 'includeDatabase', label: 'Database', detail: 'All records, users, roles, uploaded files and photos, chat history, Telegram logins.', source: 'database' },
  { key: 'includeWhatsapp', label: 'WhatsApp sessions', detail: 'Linked numbers and their message stores — without these every user re-scans the QR code.', source: 'whatsapp' },
  { key: 'includeWhatsappMedia', label: 'WhatsApp downloaded media', detail: 'Attachments wacli downloaded itself. Can be many gigabytes.', source: 'whatsapp' },
  { key: 'includeSignal', label: 'Signal', detail: 'Linked Signal devices.', source: 'signal' },
  { key: 'includeMediaCache', label: 'Chat media cache', detail: 'Photos and videos WhatsApp no longer serves — often the only copy.', source: 'mediaCache' },
  { key: 'includeConfig', label: 'Server configuration', detail: 'The .env secrets and service files needed to rebuild the server.', source: 'config' },
];

function Toggle({ checked, onChange, label, detail, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; detail?: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 text-left transition hover:bg-gray-50 disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {detail && <span className="mt-0.5 block text-xs text-gray-500">{detail}</span>}
      </span>
      <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? 'bg-[#03458f]' : 'bg-gray-300'}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

function NumberField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max: number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))))}
        className={`${inputClass} mt-1 tabular-nums`}
      />
    </label>
  );
}

export default function BackupsClient({
  initial,
  timeZones,
  emailConfigured,
  renderedAt,
}: {
  initial: BackupOverview;
  timeZones: string[];
  emailConfigured: boolean;
  renderedAt: string;
}) {
  const banner = useBanner();
  const [overview, setOverview] = useState(initial);
  const [draft, setDraft] = useState<EditableSettings>(() => editable(initial.settings));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.parse(renderedAt));
  const settings = overview.settings;

  // Connection form
  const [editingConnection, setEditingConnection] = useState(!initial.settings.connected);
  const [keyFile, setKeyFile] = useState<{ name: string; json: string } | null>(null);
  const [driveLink, setDriveLink] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Recovery key
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  const apply = useCallback((next: BackupOverview) => setOverview(next), []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // While a backup runs, follow its progress.
  useEffect(() => {
    if (!overview.running) return;
    const id = setInterval(() => {
      adminFetch<BackupOverview>('/api/admin/backups')
        .then((next) => {
          setOverview(next);
          if (!next.running) {
            const latest = next.runs[0];
            if (latest?.status === 'success') banner.success('Backup complete', `${formatBytes(latest.sizeBytes)} saved to Google Drive.`);
            else if (latest) banner.error(latest.status === 'partial' ? 'Backup incomplete' : 'Backup failed', latest.error ?? undefined);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [overview.running, banner]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(editable(settings));

  const saveSettings = async () => {
    setSaving(true);
    try {
      const next = await adminFetch<BackupOverview>('/api/admin/backups', { method: 'PUT', body: JSON.stringify(draft) });
      apply(next);
      setDraft(editable(next.settings));
      banner.success('Backup settings saved');
    } catch (error) {
      banner.error(errorMessage(error, 'Could not save the settings.'));
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const next = await adminFetch<BackupOverview>('/api/admin/backups/connection', {
        method: 'PUT',
        body: JSON.stringify({ serviceAccountJson: keyFile?.json, driveLink }),
      });
      apply(next);
      setDraft(editable(next.settings));
      setEditingConnection(false);
      setKeyFile(null);
      setDriveLink('');
      banner.success('Google Drive connected', `Backups will be saved to ${next.settings.driveName ?? 'the Shared Drive'}.`);
    } catch (error) {
      banner.error('Could not connect', errorMessage(error, 'Check the key and the link.'));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive? Scheduled backups stop. Existing backups stay in Drive.')) return;
    setBusy('disconnect');
    try {
      const next = await adminFetch<BackupOverview>('/api/admin/backups/connection', { method: 'DELETE' });
      apply(next);
      setDraft(editable(next.settings));
      setEditingConnection(true);
    } catch (error) {
      banner.error(errorMessage(error, 'Could not disconnect.'));
    } finally {
      setBusy(null);
    }
  };

  const backUpNow = async () => {
    setBusy('run');
    try {
      apply(await adminFetch<BackupOverview>('/api/admin/backups/run', { method: 'POST' }));
      banner.success('Backup started', 'Progress shows below.');
    } catch (error) {
      banner.error(errorMessage(error, 'Could not start the backup.'));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (run: Run) => {
    setBusy(`verify-${run.id}`);
    try {
      const result = await adminFetch<{ ok: boolean; problems: string[]; overview: BackupOverview }>(`/api/admin/backups/${run.id}/verify`, { method: 'POST' });
      apply(result.overview);
      if (result.ok) banner.success('Snapshot verified', 'Every file is intact in Drive and decrypts with your key.');
      else banner.error('Snapshot has problems', result.problems.join(' '));
    } catch (error) {
      banner.error(errorMessage(error, 'Could not verify the snapshot.'));
    } finally {
      setBusy(null);
    }
  };

  const setPinned = async (run: Run, pinned: boolean) => {
    setBusy(`pin-${run.id}`);
    try {
      apply(await adminFetch<BackupOverview>(`/api/admin/backups/${run.id}`, { method: 'PATCH', body: JSON.stringify({ pinned }) }));
    } catch (error) {
      banner.error(errorMessage(error, 'Could not update the snapshot.'));
    } finally {
      setBusy(null);
    }
  };

  const revealKey = async () => {
    setBusy('key');
    try {
      const { key } = await adminFetch<{ key: string }>('/api/admin/backups/key', { method: 'POST' });
      setRevealedKey(key);
    } catch (error) {
      banner.error(errorMessage(error, 'Could not show the key.'));
    } finally {
      setBusy(null);
    }
  };

  const readKeyFile = async (file: File | undefined) => {
    if (!file) return;
    const json = await file.text();
    setKeyFile({ name: file.name, json });
  };

  const latest = overview.runs[0];
  const set = <K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Last good backup"
          value={overview.lastSuccessAt ? relativeTime(overview.lastSuccessAt, now) : 'None yet'}
          hint={overview.lastSuccessAt ? formatDateTime(overview.lastSuccessAt) : 'Run one to check everything works'}
        />
        <StatTile
          label="Next scheduled"
          value={overview.nextRunAt ? formatDateTime(overview.nextRunAt).split(',').slice(0, 1).join('') : 'Off'}
          hint={overview.nextRunAt ? `${settings.scheduleTime} ${settings.timezone}` : 'Turn on the daily schedule below'}
        />
        <StatTile label="In Google Drive" value={formatBytes(overview.storedBytes)} hint={`${overview.snapshotCount} snapshot${overview.snapshotCount === 1 ? '' : 's'}`} />
        <StatTile label="Encryption key" value={<span className="font-mono text-base">{settings.keyFingerprint ?? '—'}</span>} hint="Fingerprint — keep the key safe" />
      </div>

      {latest?.status === 'failed' && !overview.running && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="font-semibold">The last backup failed</span> ({relativeTime(latest.startedAt, now)}): {latest.error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void backUpNow()} disabled={!settings.connected || overview.running || busy === 'run'} className={primaryButton}>
          {overview.running ? 'Backing up…' : 'Back up now'}
        </button>
        {settings.folderUrl && (
          <a href={settings.folderUrl} target="_blank" rel="noreferrer" className={secondaryButton}>
            Open in Google Drive ↗
          </a>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Connection */}
        <Card
          title="Google Drive"
          description="A Google Cloud service account writes to one Shared Drive. It needs no one to be signed in, and the backups survive any person leaving."
          action={
            settings.connected && !editingConnection ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
              </span>
            ) : undefined
          }
        >
          {settings.connected && !editingConnection ? (
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-gray-500">Shared Drive</dt>
                <dd className="truncate font-medium text-gray-900">{settings.driveName}</dd>
                <dt className="text-gray-500">Account</dt>
                <dd className="truncate font-mono text-xs text-gray-700">{settings.serviceAccountEmail}</dd>
              </dl>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={() => setEditingConnection(true)} className={secondaryButton}>Change</button>
                <button type="button" onClick={() => void disconnect()} disabled={busy === 'disconnect'} className={dangerButton}>Disconnect</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <ol className="list-decimal space-y-1.5 pl-5 text-xs text-gray-600">
                <li>In Google Cloud Console, enable the <b>Google Drive API</b>, create a <b>service account</b>, and download a <b>JSON key</b> for it.</li>
                <li>
                  Create a Shared Drive (or pick one) and add the service account’s email as a <b>Content manager</b>
                  {settings.serviceAccountEmail ? (
                    <> — <span className="font-mono">{settings.serviceAccountEmail}</span></>
                  ) : null}
                  .
                </li>
                <li>Upload the key and paste the Shared Drive’s link (or a folder inside it). The connection is tested before it’s saved.</li>
              </ol>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Service account key (.json){settings.serviceAccountEmail ? ' — leave empty to keep the current one' : ''}</span>
                <input type="file" accept="application/json,.json" onChange={(e) => void readKeyFile(e.target.files?.[0])} className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200" />
                {keyFile && <span className="mt-1 block text-xs text-gray-500">{keyFile.name}</span>}
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Shared Drive or folder link</span>
                <input value={driveLink} onChange={(e) => setDriveLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" className={`${inputClass} mt-1`} />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => void connect()} disabled={connecting || !driveLink.trim() || (!keyFile && !settings.serviceAccountEmail)} className={primaryButton}>
                  {connecting ? 'Testing…' : 'Connect & test'}
                </button>
                {settings.connected && (
                  <button type="button" onClick={() => setEditingConnection(false)} className={secondaryButton}>Cancel</button>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Recovery key */}
        <Card
          title="Recovery key"
          description="Every backup is encrypted before it leaves the server. Restoring needs this key — store it in your company password manager now. If the server is lost, the copy inside it is lost too."
        >
          {settings.keyFingerprint ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Fingerprint <span className="font-mono text-gray-800">{settings.keyFingerprint}</span> — each snapshot records the fingerprint of the key that opens it.
              </p>
              {revealedKey ? (
                <div className="space-y-2">
                  <code className="block break-all rounded-xl bg-gray-900 px-3 py-2.5 font-mono text-xs text-emerald-300">{revealedKey}</code>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void navigator.clipboard.writeText(revealedKey).then(() => banner.success('Key copied'))} className={secondaryButton}>Copy</button>
                    <button type="button" onClick={() => setRevealedKey(null)} className={secondaryButton}>Hide</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => void revealKey()} disabled={busy === 'key'} className={secondaryButton}>
                  Show recovery key
                </button>
              )}
              <p className="text-[11px] text-gray-400">Showing the key is recorded in the audit log.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Created when Google Drive is connected.</p>
          )}
        </Card>
      </div>

      {/* Schedule, retention, alerts */}
      <Card title="Schedule & versions" description="One snapshot a day. Older ones thin out: the newest of each day, then one per week, then one per month. Removed snapshots go to the Drive trash, where they can be recovered for 30 days.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Toggle checked={draft.enabled} onChange={(v) => set('enabled', v)} disabled={!settings.connected} label="Daily backup" detail={settings.connected ? 'Runs every day at the time below; a missed run is caught up when the server is back.' : 'Connect Google Drive first.'} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Time</span>
                <input type="time" value={draft.scheduleTime} onChange={(e) => set('scheduleTime', e.target.value)} className={`${inputClass} mt-1`} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Time zone</span>
                <select value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} className={`${inputClass} mt-1`}>
                  {timeZones.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </label>
            </div>
            <Toggle checked={draft.lockMonthly} onChange={(v) => set('lockMonthly', v)} label="Lock monthly snapshots" detail="Each month’s first snapshot is made read-only in Drive, so it can’t be changed by accident." />
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Days" value={draft.keepDaily} onChange={(v) => set('keepDaily', v)} max={90} />
              <NumberField label="Weeks" value={draft.keepWeekly} onChange={(v) => set('keepWeekly', v)} max={104} />
              <NumberField label="Months" value={draft.keepMonthly} onChange={(v) => set('keepMonthly', v)} max={120} />
            </div>
            <p className="text-xs text-gray-500">
              Keeps up to {draft.keepDaily + draft.keepWeekly + draft.keepMonthly} snapshots, reaching back about {draft.keepMonthly > 0 ? `${draft.keepMonthly} month${draft.keepMonthly === 1 ? '' : 's'}` : draft.keepWeekly > 0 ? `${draft.keepWeekly} weeks` : `${draft.keepDaily} days`}. Pin any snapshot below to keep it forever.
            </p>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Email alerts when a backup fails</span>
              <input value={draft.alertEmails} onChange={(e) => set('alertEmails', e.target.value)} placeholder="it@company.com, owner@company.com" className={`${inputClass} mt-1`} />
              {!emailConfigured && <span className="mt-1 block text-xs text-amber-700">Email isn’t configured on this server, so alerts can’t be sent yet (Admin → Settings → Email).</span>}
            </label>
          </div>
        </div>

        <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">What’s backed up</h4>
        <div className="grid gap-2.5 md:grid-cols-2">
          {COMPONENTS.map((c) => (
            <Toggle
              key={c.key}
              checked={Boolean(draft[c.key])}
              onChange={(v) => set(c.key, v as never)}
              label={c.label}
              detail={
                <>
                  {c.detail}
                  {c.source && overview.sources[c.source] && <span className="mt-0.5 block font-mono text-[10px] text-gray-400">{overview.sources[c.source]}</span>}
                  {c.key === 'includeMediaCache' && overview.sources.mediaCacheIsTemporary === 'true' && (
                    <span className="mt-1 block text-[11px] text-amber-700">This folder is in the system temp directory and can be wiped on reboot — set MESSAGING_MEDIA_CACHE_DIR to a permanent path.</span>
                  )}
                </>
              }
            />
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => void saveSettings()} disabled={!dirty || saving} className={primaryButton}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </Card>

      {/* History */}
      <Card title="Snapshots" description="Each run is a dated folder in the Shared Drive with a readable manifest.json describing it.">
        {overview.runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No backups yet.</p>
        ) : (
          <div className="-mx-5 divide-y divide-gray-100">
            {overview.runs.map((run) => {
              const status = STATUS[run.status] ?? STATUS.failed;
              const live = (run.status === 'success' || run.status === 'partial') && !run.prunedAt;
              const open = expandedRun === run.id;
              return (
                <div key={run.id} className={`px-5 py-3 ${run.prunedAt ? 'opacity-50' : ''}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <button type="button" onClick={() => setExpandedRun(open ? null : run.id)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                      <span className="block text-sm font-medium text-gray-900">
                        {formatDateTime(run.startedAt)}
                        <span className="ml-2 text-xs font-normal text-gray-500">{run.trigger === 'schedule' ? 'scheduled' : 'manual'}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${status.className}`}>{status.label}</span>
                        {run.sizeBytes > 0 && <span>{formatBytes(run.sizeBytes)}</span>}
                        {duration(run) && <span>· {duration(run)}</span>}
                        {run.keptAs.filter((k) => k !== 'latest').map((k) => (
                          <span key={k} className="rounded-md bg-blue-50 px-1.5 py-0.5 font-medium text-[#03458f]">{KEEP_LABELS[k]}</span>
                        ))}
                        {run.locked && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">🔒 Locked</span>}
                        {run.verifiedAt && !run.verifyError && <span className="text-emerald-700">✓ Verified {relativeTime(run.verifiedAt, now)}</span>}
                        {run.verifyError && <span className="text-rose-700">⚠ {run.verifyError}</span>}
                        {run.prunedAt && <span>Removed {relativeTime(run.prunedAt, now)} (in Drive trash for 30 days)</span>}
                      </span>
                    </button>
                    {live && (
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {run.folderUrl && (
                          <a href={run.folderUrl} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#03458f] hover:bg-blue-50">Open ↗</a>
                        )}
                        <button type="button" onClick={() => void verify(run)} disabled={busy === `verify-${run.id}`} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                          {busy === `verify-${run.id}` ? 'Verifying…' : 'Verify'}
                        </button>
                        <button type="button" onClick={() => void setPinned(run, !run.pinned)} disabled={busy === `pin-${run.id}`} className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                          {run.pinned ? 'Unpin' : 'Keep forever'}
                        </button>
                      </div>
                    )}
                  </div>
                  {open && (
                    <ul className="mt-2 space-y-1 rounded-xl bg-gray-50 p-3 text-xs">
                      {run.files.length === 0 && <li className="text-gray-500">{run.error ?? 'No files.'}</li>}
                      {run.files.map((f) => (
                        <li key={f.name} className="flex items-start justify-between gap-3">
                          <span className="font-mono text-gray-700">{f.name}</span>
                          <span className={`text-right ${f.ok ? 'text-gray-500' : f.skipped ? 'text-gray-400' : 'text-rose-700'}`}>
                            {f.ok ? formatBytes(f.bytes ?? 0) : f.skipped ? `skipped — ${f.error}` : f.error}
                          </span>
                        </li>
                      ))}
                      {run.keyFingerprint && <li className="pt-1 text-gray-400">Key {run.keyFingerprint}</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Restore */}
      <Card title="Restoring" description="Restores are done on the server by an administrator, never from this page — they replace live data.">
        <ol className="list-decimal space-y-2 pl-5 text-xs text-gray-600">
          <li>Download the snapshot folder from Google Drive (Open ↗ → Download).</li>
          <li>
            Decrypt it with the recovery key (needs only Node):
            <code className="mt-1 block overflow-x-auto rounded-lg bg-gray-900 px-3 py-2 font-mono text-[11px] text-gray-100">node scripts/backup-decrypt.mjs --key-file key.txt &quot;2026-10-16 02.00 (scheduled)&quot; restored/</code>
          </li>
          <li>
            Database:
            <code className="mt-1 block overflow-x-auto rounded-lg bg-gray-900 px-3 py-2 font-mono text-[11px] text-gray-100">pg_restore --clean --if-exists --no-owner -d &quot;$DATABASE_URL&quot; restored/database.dump</code>
          </li>
          <li>WhatsApp, Signal, media and config: stop the app, extract each <span className="font-mono">.tar</span> back to its place, start the app. The full steps are in README.md → Backups.</li>
        </ol>
      </Card>
    </div>
  );
}
