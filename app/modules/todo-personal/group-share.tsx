'use client';

import { useEffect, useState } from 'react';

interface GroupOption {
  id: number;
  name: string;
  memberCount: number;
}

/**
 * Share a task with whole groups (set up in Admin → Groups). Each chip saves
 * at once. Shown only to the task's owner who belongs to at least one group.
 */
export default function TaskGroupShare({ taskId }: { taskId: number }) {
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [shared, setShared] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/planning/tasks/${taskId}/share`, { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { groups: GroupOption[]; sharedGroupIds: number[] } | null) => {
        if (!live || !body) return;
        setGroups(body.groups);
        setShared(new Set(body.sharedGroupIds));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [taskId]);

  if (groups.length === 0) return null;

  const toggle = async (group: GroupOption) => {
    const on = shared.has(group.id);
    setBusy(group.id);
    try {
      const res = on
        ? await fetch(`/api/planning/tasks/${taskId}/share?groupId=${group.id}`, { method: 'DELETE', credentials: 'include' })
        : await fetch(`/api/planning/tasks/${taskId}/share`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupIds: [group.id] }),
          });
      if (res.ok) {
        setShared((current) => {
          const next = new Set(current);
          if (on) next.delete(group.id);
          else next.add(group.id);
          return next;
        });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold text-gray-500">Share with a group</p>
      <div className="flex flex-wrap gap-2">
        {groups.map((group) => {
          const on = shared.has(group.id);
          return (
            <button
              key={group.id}
              type="button"
              disabled={busy === group.id}
              onClick={() => void toggle(group)}
              title={on ? 'Shared: every member of this group sees the task' : `Share with all ${group.memberCount} members`}
              className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 ${
                on ? 'border-primary/30 bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary/20'
              }`}
            >
              {group.name}
              <span className="font-normal text-gray-400">{group.memberCount}</span>
              {on && (
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
