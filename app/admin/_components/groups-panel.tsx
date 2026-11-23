'use client';

import { useEffect, useMemo, useState } from 'react';

import type { GroupView } from '@/lib/user-groups';

import { adminFetch, errorMessage } from './admin-api';
import type { AdminUser } from './admin-types';
import { Avatar, Card, EmptyState, Modal, SearchInput, inputClass, primaryButton, secondaryButton } from './admin-ui';

type Editor = { mode: 'create' } | { mode: 'edit'; group: GroupView };

/**
 * Admin → Groups. A group is a team: members see each other's trips and may
 * edit them, and see to-dos shared with the group.
 */
export default function GroupsPanel({
  users,
  onOpenUser,
  notify,
}: {
  users: AdminUser[];
  onOpenUser: (userId: number) => void;
  notify: (message: { error?: string; success?: string }) => void;
}) {
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    adminFetch<{ groups: GroupView[] }>('/api/admin/groups').then(
      (payload) => live && setGroups(payload.groups),
      (err: unknown) => live && notify({ error: errorMessage(err, 'Could not load the groups.') }),
    );
    return () => {
      live = false;
    };
  }, [notify]);

  const remove = async (group: GroupView) => {
    if (!window.confirm(`Delete the "${group.name}" group? Its members stop seeing each other's trips, and the to-dos and WhatsApp numbers shared with it.`)) return;
    setDeletingId(group.id);
    try {
      const payload = await adminFetch<{ groups: GroupView[] }>(`/api/admin/groups/${group.id}`, { method: 'DELETE' });
      setGroups(payload.groups);
      notify({ success: `Deleted the "${group.name}" group.` });
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not delete the group.') });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 sm:flex-row sm:items-center">
        <div className="flex-1 space-y-1 text-sm text-gray-700">
          <p>
            A group is a team. Members see every trip created or owned by anyone in the group, and can edit it as if it were their own.
            A to-do stays private until its owner shares it with a group; then every member sees it, including people who join later.
            The same goes for a WhatsApp number: once its owner shares it with a group (in the WhatsApp module), members can read its chats and reply from it.
          </p>
          <p className="text-xs text-gray-500">
            Clients, CRM and vendors are already visible to everyone who has those modules, so groups don&apos;t change them. Admins see everything.
          </p>
        </div>
        <button type="button" onClick={() => setEditor({ mode: 'create' })} className={`${primaryButton} shrink-0`}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New group
        </button>
      </div>

      {groups === null ? (
        <p className="py-10 text-center text-sm text-gray-400">Loading groups…</p>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState title="No groups yet" detail="Create a group and add people to it so they can work on each other's trips." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className="flex flex-col">
              <h3 className="truncate text-base font-semibold text-gray-900">{group.name}</h3>
              <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">{group.description || 'No description'}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
              </p>
              <ul className="mt-2 flex-1 space-y-1.5">
                {group.members.map((member) => (
                  <li key={member.id}>
                    <button type="button" onClick={() => onOpenUser(member.id)} className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-gray-50">
                      <Avatar name={member.name} size="sm" />
                      <span className="truncate text-sm text-gray-800">{member.name}</span>
                      {member.status !== 'active' && <span className="text-xs text-amber-600">{member.status}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => setEditor({ mode: 'edit', group })}>
                  Edit
                </button>
                <button type="button" className={secondaryButton} disabled={deletingId === group.id} onClick={() => void remove(group)}>
                  {deletingId === group.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editor && (
        <GroupEditor
          editor={editor}
          users={users}
          onClose={() => setEditor(null)}
          onSaved={(next, name) => {
            setGroups(next);
            setEditor(null);
            notify({ success: editor.mode === 'create' ? `Created the "${name}" group.` : `Saved the "${name}" group.` });
          }}
        />
      )}
    </div>
  );
}

function GroupEditor({
  editor,
  users,
  onClose,
  onSaved,
}: {
  editor: Editor;
  users: AdminUser[];
  onClose: () => void;
  onSaved: (groups: GroupView[], name: string) => void;
}) {
  const initial = editor.mode === 'edit' ? editor.group : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [members, setMembers] = useState<Set<number>>(new Set(initial?.members.map((m) => m.id) ?? []));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .sort((a, b) => Number(members.has(b.id)) - Number(members.has(a.id)) || a.name.localeCompare(b.name));
  }, [users, query, members]);

  const toggle = (id: number) =>
    setMembers((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ name, description, memberIds: [...members] });
      const payload =
        editor.mode === 'create'
          ? await adminFetch<{ groups: GroupView[] }>('/api/admin/groups', { method: 'POST', body })
          : await adminFetch<{ groups: GroupView[] }>(`/api/admin/groups/${editor.group.id}`, { method: 'PATCH', body });
      onSaved(payload.groups, name.trim());
    } catch (err) {
      setError(errorMessage(err, 'Could not save the group.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editor.mode === 'create' ? 'New group' : `Edit ${editor.group.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryButton} disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save group'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Name</span>
          <input className={`${inputClass} mt-1`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nairobi Ops" autoFocus />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Description</span>
          <input className={`${inputClass} mt-1`} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </label>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-700">
              Members <span className="font-normal text-gray-400">({members.size} selected)</span>
            </span>
            <div className="w-56">
              <SearchInput value={query} onChange={setQuery} placeholder="Find a person" />
            </div>
          </div>
          <ul className="max-h-80 divide-y divide-gray-50 overflow-y-auto rounded-xl border border-gray-100">
            {shown.map((user) => (
              <li key={user.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
                  <input type="checkbox" checked={members.has(user.id)} onChange={() => toggle(user.id)} className="h-4 w-4 rounded border-gray-300" />
                  <Avatar name={user.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900">{user.name}</span>
                    <span className="block truncate text-xs text-gray-400">{user.email}</span>
                  </span>
                  {user.status !== 'active' && <span className="text-xs text-amber-600">{user.status}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
