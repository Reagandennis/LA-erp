'use client';

import { useEffect, useState } from 'react';

import { Card, Pill, primaryButton } from '@/app/modules/_components/shift-ui';
import type { NoticeResult, NoticeStatus } from '@/lib/shift-notify';

import { getJson, message, sendJson } from './api';

const URL = '/api/shift-planning/admin/notify';

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Shift emails: who is linked to an account, when each was welcomed and last
 * emailed, and a button to send what is due now.
 */
export default function NotifyCard({ refreshKey }: { refreshKey: unknown }) {
  const [status, setStatus] = useState<NoticeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getJson<NoticeStatus>(URL).then(
      (next) => live && setStatus(next),
      (err: unknown) => live && setError(message(err, 'Could not load the email status.')),
    );
    return () => {
      live = false;
    };
  }, [refreshKey]);

  const send = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const { result, status: next } = await sendJson<{ result: NoticeResult; status: NoticeStatus }>(URL, 'POST');
      setStatus(next);
      const parts = [
        result.welcomed.length ? `Welcomed ${result.welcomed.length}` : null,
        result.updated.length ? `sent shift updates to ${result.updated.length}` : null,
      ].filter(Boolean);
      setNote(parts.length ? `${parts.join(', ')}.` : 'Everyone is up to date; nothing to send.');
      if (result.failed.length) setError(`Could not email ${result.failed.map((f) => `${f.person} (${f.error})`).join('; ')}`);
    } catch (err) {
      setError(message(err, 'Could not send.'));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const pending = status.people.filter((p) => !p.welcomedAt).length;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold text-gray-900">Shift emails</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Everyone linked to a login gets a welcome email. After that, they get an email with a calendar file (.ics) whenever a month is published, and whenever one of their published shifts changes.
          </p>
        </div>
        {status.configured ? (
          <button type="button" className={primaryButton} onClick={() => void send()} disabled={busy || status.people.length === 0}>
            {busy ? 'Sending…' : pending > 0 ? `Send welcome emails (${pending})` : 'Send any updates now'}
          </button>
        ) : (
          <Pill tone="danger">Email is not set up (SMTP)</Pill>
        )}
      </div>
      {note && <p className="mt-3 text-sm text-emerald-700">{note}</p>}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {status.people.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50/60 text-left text-xs text-gray-400">
                {['Billet', 'Person', 'Email', 'Welcomed', 'Last emailed'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {status.people.map((p) => (
                <tr key={p.lineId} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-2 font-bold text-gray-900">{p.code}</td>
                  <td className="px-3 py-2 text-gray-700">{p.name}</td>
                  <td className="px-3 py-2 text-gray-500">{p.email ?? '—'}</td>
                  <td className="px-3 py-2">{p.welcomedAt ? when(p.welcomedAt) : <span className="text-amber-600">Not yet</span>}</td>
                  <td className="px-3 py-2 text-gray-500">{when(p.lastSentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
