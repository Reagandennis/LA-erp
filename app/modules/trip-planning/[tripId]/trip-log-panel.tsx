'use client';

import { APP_LOCALE } from '@/lib/locale';
import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from '@/app/ui/confirm-dialog';

export interface TripLogEntry {
  id: number;
  loggedAt: string;
  detail: string;
  receivedFrom: string | null;
  actionItem: string | null;
  dutyController: string | null;
  comments: string | null;
  escalated: boolean;
  createdBy: { id: number; name: string } | null;
  createdAt: string;
}

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15';

function dayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(APP_LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' });
}

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The trip's operations log (newest first) and its notes. FileMaker's task log
 * was imported here; the team keeps adding to it as the trip runs.
 */
interface EscalationOutcome {
  recipients: number;
  notified: number;
  emailed: number;
  emailError: string | null;
}

/** "Escalation sent to 3 people and emailed", or why it wasn't. */
function escalationNotice(outcome: EscalationOutcome): { text: string; warn: boolean } {
  if (outcome.recipients === 0) {
    return { text: 'Escalated, but no one is set to receive escalations yet. An admin chooses them under Admin → Organization.', warn: true };
  }
  const people = `${outcome.notified} ${outcome.notified === 1 ? 'person' : 'people'}`;
  if (outcome.emailed > 0) return { text: `Escalation sent to ${people} and emailed.`, warn: false };
  return { text: `Escalation sent to ${people} in the app. Email didn’t go: ${outcome.emailError ?? 'unknown reason'}.`, warn: true };
}

export default function TripLogPanel({
  tripId,
  description,
  notes,
  currentUserId,
  isAdmin,
  onCountChange,
}: {
  tripId: number;
  description: string | null;
  notes: string | null;
  currentUserId: number;
  isAdmin: boolean;
  onCountChange: (count: number) => void;
}) {
  const [entries, setEntries] = useState<TripLogEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [receivedFrom, setReceivedFrom] = useState('');
  const [actionItem, setActionItem] = useState('');
  const [escalated, setEscalated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [escalation, setEscalation] = useState<{ text: string; warn: boolean } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    let active = true;
    fetch(`/api/trips/${tripId}/log`, { credentials: 'include' })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as { entries?: TripLogEntry[]; error?: string } | null;
        if (!active) return;
        if (!response.ok || !data?.entries) {
          setLoadError(data?.error ?? 'Could not load the log');
          return;
        }
        setEntries(data.entries);
      })
      .catch(() => {
        if (active) setLoadError('Could not load the log');
      });
    return () => {
      active = false;
    };
  }, [tripId]);

  // Newest first, grouped by the viewer's calendar day.
  const groups = useMemo(() => {
    const sorted = [...(entries ?? [])].sort(
      (a, b) => Date.parse(b.loggedAt) - Date.parse(a.loggedAt) || b.id - a.id,
    );
    const result: Array<{ key: string; label: string; entries: TripLogEntry[] }> = [];
    for (const entry of sorted) {
      const key = localDayKey(entry.loggedAt);
      const last = result.at(-1);
      if (last?.key === key) last.entries.push(entry);
      else result.push({ key, label: dayHeading(entry.loggedAt), entries: [entry] });
    }
    return result;
  }, [entries]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!detail.trim()) {
      setFormError('Describe what happened');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/log`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detail: detail.trim(),
          receivedFrom: receivedFrom.trim() || null,
          actionItem: actionItem.trim() || null,
          escalated,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { entry?: TripLogEntry; escalation?: EscalationOutcome | null; error?: string }
        | null;
      if (!response.ok || !data?.entry) {
        setFormError(data?.error ?? 'Could not add the entry');
        return;
      }
      const next = [...(entries ?? []), data.entry];
      setEntries(next);
      onCountChange(next.length);
      setEscalation(data.escalation ? escalationNotice(data.escalation) : null);
      setDetail('');
      setReceivedFrom('');
      setActionItem('');
      setEscalated(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: TripLogEntry) => {
    const ok = await confirm({
      title: 'Remove this log entry?',
      message: `“${entry.detail.length > 80 ? `${entry.detail.slice(0, 79)}…` : entry.detail}” will be gone from the trip log.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    const response = await fetch(`/api/trips/${tripId}/log/${entry.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      window.alert(data?.error ?? 'Could not remove the entry');
      return;
    }
    const next = (entries ?? []).filter((e) => e.id !== entry.id);
    setEntries(next);
    onCountChange(next.length);
  };

  const notesText = [description, notes].filter((part) => part?.trim()).join('\n\n');
  const longNotes = notesText.split('\n').length > 8;

  return (
    <div>
      {dialog}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Trip log</h2>
        <p className="mt-1 text-xs text-gray-500">What was reported, who reported it, and what was done.</p>
      </div>

      {notesText && (
        <section className="mb-6 rounded-xl border border-gray-100 bg-white p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Trip notes</p>
          <p
            className={`whitespace-pre-line text-sm leading-relaxed text-gray-700 ${
              longNotes && !notesOpen ? 'line-clamp-[8]' : ''
            }`}
          >
            {notesText}
          </p>
          {longNotes && (
            <button
              type="button"
              onClick={() => setNotesOpen((open) => !open)}
              className="mt-2 text-xs font-semibold text-primary hover:underline"
            >
              {notesOpen ? 'Show less' : 'Show all'}
            </button>
          )}
        </section>
      )}

      <form onSubmit={submit} className="mb-8 rounded-xl border border-gray-100 bg-white p-4">
        <label className="block">
          <span className="sr-only">What happened</span>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={2}
            placeholder="What happened? e.g. Arrival instructions sent"
            className={`${inputClass} resize-y`}
          />
        </label>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            value={receivedFrom}
            onChange={(e) => setReceivedFrom(e.target.value)}
            placeholder="Reported by"
            aria-label="Reported by"
            className={inputClass}
          />
          <input
            value={actionItem}
            onChange={(e) => setActionItem(e.target.value)}
            placeholder="Action, e.g. Driver informed"
            aria-label="Action"
            className={inputClass}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={escalated}
              onChange={(e) => setEscalated(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
            />
            Escalate
          </label>
          <div className="flex items-center gap-3">
            {escalation && (
              <span className={`text-xs ${escalation.warn ? 'text-amber-700' : 'text-emerald-700'}`}>{escalation.text}</span>
            )}
            {formError && <span className="text-xs text-rose-600">{formError}</span>}
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add to log'}
            </button>
          </div>
        </div>
      </form>

      {loadError && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</p>}
      {!loadError && entries === null && <p className="text-sm text-gray-400">Loading the log…</p>}
      {entries?.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
          Nothing logged yet.
        </p>
      )}

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.key}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">{group.label}</p>
            <ol className="overflow-hidden rounded-xl border border-gray-100 bg-white">
              {group.entries.map((entry) => {
                const canRemove = isAdmin || entry.createdBy?.id === currentUserId;
                return (
                  <li
                    key={entry.id}
                    className={`grid grid-cols-[3.5rem_minmax(0,1fr)_auto] gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0 ${
                      entry.escalated ? 'bg-rose-50/60' : ''
                    }`}
                  >
                    <time dateTime={entry.loggedAt} className="pt-0.5 text-xs font-semibold tabular-nums text-gray-500">
                      {timeOf(entry.loggedAt)}
                    </time>
                    <div className="min-w-0">
                      <p className="whitespace-pre-line text-sm text-gray-900">
                        {entry.escalated && (
                          <span className="mr-2 inline-flex rounded-full bg-rose-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-rose-700">
                            Escalated
                          </span>
                        )}
                        {entry.detail}
                      </p>
                      {entry.actionItem && (
                        <p className="mt-1 text-sm text-gray-600">
                          <span className="text-gray-400">Action: </span>
                          {entry.actionItem}
                        </p>
                      )}
                      {entry.comments && <p className="mt-1 text-sm italic text-gray-500">{entry.comments}</p>}
                      <p className="mt-1 text-xs text-gray-400">
                        {[
                          entry.receivedFrom && `Reported by ${entry.receivedFrom}`,
                          entry.dutyController && `Duty controller ${entry.dutyController}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => void remove(entry)}
                        aria-label="Remove entry"
                        title="Remove entry"
                        className="h-7 w-7 rounded-md text-gray-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        <svg className="mx-auto h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    ) : (
                      <span />
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
