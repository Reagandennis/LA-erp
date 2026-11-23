'use client';

import { useEffect, useRef, useState } from 'react';

interface GroupOption {
  id: number;
  name: string;
  memberCount: number;
}

/**
 * The owner's control for sharing a WhatsApp number with their groups
 * (Admin → Groups). Members of a group it is shared with can read its chats
 * and reply from it. Hidden when the owner is in no group.
 */
export default function AccountGroupShare({ accountId }: { accountId: number }) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [shared, setShared] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/whatsapp/sharing?account=${accountId}`, { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { owner: boolean; groups: GroupOption[]; sharedGroupIds: number[] } | null) => {
        if (!live || !body?.owner) return;
        setGroups(body.groups);
        setShared(body.sharedGroupIds);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountId]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (groups.length === 0) return null;

  const toggle = async (group: GroupOption) => {
    const on = shared.includes(group.id);
    setBusy(group.id);
    setError(null);
    try {
      const res = await fetch(`/api/whatsapp/sharing?account=${accountId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, shared: !on }),
      });
      const body = (await res.json().catch(() => null)) as { sharedGroupIds?: number[]; error?: string } | null;
      if (!res.ok || !body?.sharedGroupIds) setError(body?.error ?? 'Could not change the sharing.');
      else setShared(body.sharedGroupIds);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
      >
        {shared.length > 0 ? `Shared with ${shared.length} ${shared.length === 1 ? 'group' : 'groups'}` : 'Share with a group'}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs text-gray-500">Members of a group you tick can read this number&apos;s chats and reply from it. Only you can unlink it.</p>
          <ul className="space-y-1">
            {groups.map((group) => (
              <li key={group.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-gray-50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={shared.includes(group.id)}
                    disabled={busy === group.id}
                    onChange={() => void toggle(group)}
                  />
                  <span className="flex-1 truncate text-gray-800">{group.name}</span>
                  <span className="text-xs text-gray-400">{group.memberCount}</span>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
