'use client';

import { useMemo, useState } from 'react';

import type { AdminSession } from './admin-types';
import { Avatar, EmptyState, SearchInput, describeDevice, formatDateTime, formatIp, relativeTime } from './admin-ui';

export default function SessionsPanel({
  sessions,
  now,
  onRevoke,
  onOpenUser,
}: {
  sessions: AdminSession[];
  now: number;
  onRevoke: (sessionId: string) => Promise<void>;
  onOpenUser: (userId: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.user.name.toLowerCase().includes(q) ||
        s.user.email.toLowerCase().includes(q) ||
        (s.ipAddress ?? '').includes(q) ||
        describeDevice(s.userAgent).toLowerCase().includes(q),
    );
  }, [sessions, search]);

  const people = new Set(sessions.map((s) => s.user.id)).size;

  const revoke = async (session: AdminSession) => {
    if (!window.confirm(`Sign ${session.user.name} out of ${describeDevice(session.userAgent)}?`)) return;
    setBusy(session.id);
    try {
      await onRevoke(session.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by person, device or IP…" className="sm:w-80" />
        <p className="text-xs text-gray-500">
          {sessions.length} signed-in session{sessions.length === 1 ? '' : 's'} · {people} {people === 1 ? 'person' : 'people'}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white">
        {filtered.length === 0 ? (
          <EmptyState title={search ? 'No sessions match' : 'Nobody is signed in'} />
        ) : (
          <ul className="divide-y divide-gray-50">
            {filtered.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                <button type="button" onClick={() => onOpenUser(s.user.id)} className="flex min-w-0 items-center gap-3 text-left sm:w-64">
                  <Avatar name={s.user.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{s.user.name}</span>
                    <span className="block truncate text-xs text-gray-500">{s.user.email}</span>
                  </span>
                </button>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate text-gray-900">
                    {describeDevice(s.userAgent)}
                    {s.current && (
                      <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">This device</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {formatIp(s.ipAddress)} · signed in {formatDateTime(s.createdAt)}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="text-xs text-gray-500 sm:w-28 sm:text-right">Active {relativeTime(s.lastSeenAt, now).toLowerCase()}</span>
                  {s.current ? (
                    <span className="w-20 text-right text-xs text-gray-400">—</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void revoke(s)}
                      disabled={busy !== null}
                      className="w-20 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                    >
                      {busy === s.id ? 'Signing out…' : 'Sign out'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
