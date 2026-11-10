'use client';

import { useEffect, useState } from 'react';

import { Card, Pill, ghostButton } from '@/app/modules/_components/shift-ui';
import { useLiveRefresh } from '@/app/ui/use-live-refresh';
import { APP_LOCALE } from '@/lib/locale';
import { type AuditView, SHIFT_SOURCES } from '@/lib/shift-types';

import { getJson, message } from './api';

const ACTION_LABEL: Record<string, string> = {
  generate: 'Generated',
  override: 'Changed',
  swap: 'Swap',
  call_in: 'Call-in',
  actual: 'Actuals',
  publish: 'Published',
  unpublish: 'Unpublished',
  leave: 'Leave',
  line: 'People',
  holiday: 'Holiday',
  config: 'Rules',
};

const PAGE = 100;

function when(iso: string): string {
  return new Date(iso).toLocaleString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** The text worth showing from an entry's detail: the reason and every rule that fired. */
function notes(detail: unknown): string[] {
  if (!detail || typeof detail !== 'object') return [];
  const d = detail as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  return [
    ...(typeof d.reason === 'string' && d.reason ? [`Reason: ${d.reason}`] : []),
    ...(typeof d.forceReason === 'string' && d.forceReason ? [`Approved because: ${d.forceReason}`] : []),
    ...list(d.blocks).map((m) => `Block approved: ${m}`),
    ...list(d.warnings).map((m) => `Warning: ${m}`),
  ];
}

/** Every generate, change, call-in, swap and publish, newest first. Nothing here can be edited. */
export default function AuditTab() {
  const [entries, setEntries] = useState<AuditView[] | null>(null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ entries: AuditView[] }>('/api/shift-planning/admin/audit')
      .then((body) => {
        if (cancelled) return;
        setEntries(body.entries);
        setMore(body.entries.length === PAGE);
      })
      .catch((e) => {
        if (!cancelled) setError(message(e, 'Could not load the audit log.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // New entries slide in at the top; older pages already loaded stay where they are.
  useLiveRefresh(SHIFT_SOURCES, () => {
    getJson<{ entries: AuditView[] }>('/api/shift-planning/admin/audit')
      .then((body) =>
        setEntries((current) => {
          if (!current) return body.entries;
          const newest = current[0]?.id ?? 0;
          return [...body.entries.filter((entry) => entry.id > newest), ...current];
        }),
      )
      .catch(() => {
        // The next change, or the next minute, tries again.
      });
  });

  const older = async () => {
    const last = entries?.[entries.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      const body = await getJson<{ entries: AuditView[] }>(`/api/shift-planning/admin/audit?before=${last.id}`);
      setEntries([...(entries ?? []), ...body.entries]);
      setMore(body.entries.length === PAGE);
    } catch (e) {
      setError(message(e, 'Could not load older entries.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4">
        <h2 className="text-sm font-semibold text-gray-900">Audit log</h2>
        <p className="mt-0.5 text-sm text-gray-500">Who did what and when. Entries are written with every save and cannot be changed or removed.</p>
      </div>
      {error && <p className="px-5 pb-4 text-sm text-rose-600">{error}</p>}
      {entries === null && !error ? (
        <p className="px-5 pb-10 text-center text-sm text-gray-400">Loading…</p>
      ) : entries && entries.length === 0 ? (
        <p className="px-5 pb-10 text-center text-sm text-gray-400">Nothing has been recorded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-50 border-t border-gray-100">
          {(entries ?? []).map((entry) => {
            const extra = notes(entry.detail);
            return (
              <li key={entry.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3">
                <span className="w-40 shrink-0 text-xs tabular-nums text-gray-400">{when(entry.createdAt)}</span>
                <span className="w-24 shrink-0">
                  <Pill tone={entry.blockOverridden ? 'danger' : entry.action === 'publish' ? 'ok' : 'info'}>{ACTION_LABEL[entry.action] ?? entry.action}</Pill>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{entry.summary}</p>
                  {extra.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                      {extra.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <span className="shrink-0 text-xs text-gray-500">{entry.actorName}</span>
              </li>
            );
          })}
        </ul>
      )}
      {more && entries && entries.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3 text-center">
          <button type="button" className={ghostButton} disabled={busy} onClick={() => void older()}>
            {busy ? 'Loading…' : 'Show older entries'}
          </button>
        </div>
      )}
    </Card>
  );
}
