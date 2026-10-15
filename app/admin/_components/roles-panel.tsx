'use client';

import { useMemo, useState } from 'react';

import { adminFetch, errorMessage } from './admin-api';
import type { AdminModule, AdminRole, AdminUser } from './admin-types';
import { Avatar, Card, Modal, ModulePicker, inputClass, primaryButton, secondaryButton } from './admin-ui';

type EditorState = { mode: 'create'; from?: AdminRole } | { mode: 'edit'; role: AdminRole };

const PREVIEW = 6;

export default function RolesPanel({
  roles,
  modules,
  users,
  onRolesChanged,
  onOpenUser,
  notify,
}: {
  roles: AdminRole[];
  modules: AdminModule[];
  users: AdminUser[];
  onRolesChanged: (roles: AdminRole[]) => Promise<void>;
  onOpenUser: (userId: number) => void;
  notify: (message: { error?: string; success?: string }) => void;
}) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const moduleById = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);

  const remove = async (role: AdminRole) => {
    if (!window.confirm(`Delete the "${role.name}" role? This cannot be undone.`)) return;
    setDeletingId(role.id);
    try {
      const payload = await adminFetch<{ roles: AdminRole[] }>(`/api/admin/roles/${role.id}`, { method: 'DELETE' });
      await onRolesChanged(payload.roles);
      notify({ success: `Deleted the "${role.name}" role.` });
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not delete the role.') });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-gray-700">
          A role is a set of modules. Everyone with the role can open those modules, plus any granted to them one by one.
          Change a role and everyone who has it gets the change on their next page load.
        </p>
        <button type="button" onClick={() => setEditor({ mode: 'create' })} className={`${primaryButton} shrink-0`}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New role
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => {
          const roleModules = role.moduleIds
            .map((id) => moduleById.get(id))
            .filter((m): m is AdminModule => Boolean(m))
            .sort((a, b) => a.name.localeCompare(b.name));
          const members = users.filter((u) => u.roles.some((r) => r.id === role.id));
          return (
            <Card key={role.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-base font-semibold capitalize text-gray-900">
                    <span className="truncate">{role.name}</span>
                    {role.isAdmin && (
                      <span className="rounded-md bg-[#03458f] px-1.5 py-0.5 text-[11px] font-semibold normal-case text-white">Built-in</span>
                    )}
                  </h3>
                  <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">{role.description || 'No description'}</p>
                </div>
              </div>

              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                <span>
                  <span className="font-semibold tabular-nums text-gray-900">{role.memberCount}</span> {role.memberCount === 1 ? 'person' : 'people'}
                </span>
                <span>
                  <span className="font-semibold tabular-nums text-gray-900">{role.isAdmin ? 'All' : role.moduleIds.length}</span> modules
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {role.isAdmin ? (
                  <span className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600">Every module and the admin console</span>
                ) : roleModules.length === 0 ? (
                  <span className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600">
                    No modules yet: this role adds no access by itself{role.memberCount > 0 ? '. Its people use modules granted to them one by one.' : '.'}
                  </span>
                ) : (
                  <>
                    {roleModules.slice(0, PREVIEW).map((m) => (
                      <span key={m.id} className="rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-700">
                        {m.name}
                      </span>
                    ))}
                    {roleModules.length > PREVIEW && (
                      <span className="rounded-md px-1 py-1 text-xs text-gray-500">+{roleModules.length - PREVIEW} more</span>
                    )}
                  </>
                )}
              </div>

              {members.length > 0 && (
                <div className="mt-4 flex items-center gap-1.5">
                  {members.slice(0, 5).map((u) => (
                    <button key={u.id} type="button" onClick={() => onOpenUser(u.id)} title={u.name} className="rounded-lg hover:opacity-80">
                      <Avatar name={u.name} size="sm" />
                    </button>
                  ))}
                  {members.length > 5 && <span className="text-xs text-gray-500">+{members.length - 5}</span>}
                </div>
              )}

              <div className="mt-auto flex flex-wrap gap-1 border-t border-gray-50 pt-3 [&>button]:rounded-lg [&>button]:px-2.5 [&>button]:py-1.5 [&>button]:text-xs [&>button]:font-semibold">
                <button type="button" onClick={() => setEditor({ mode: 'edit', role })} className="text-[#03458f] hover:bg-blue-50">
                  {role.isAdmin ? 'Edit description' : 'Edit'}
                </button>
                {!role.isAdmin && (
                  <button type="button" onClick={() => setEditor({ mode: 'create', from: role })} className="text-gray-600 hover:bg-gray-100">
                    Duplicate
                  </button>
                )}
                {!role.isAdmin && (
                  <button
                    type="button"
                    onClick={() => void remove(role)}
                    disabled={role.memberCount > 0 || deletingId === role.id}
                    title={role.memberCount > 0 ? 'Give its members another role before deleting it' : undefined}
                    className="ml-auto text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
                  >
                    {deletingId === role.id ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {editor && (
        <RoleEditor
          key={editor.mode === 'edit' ? `edit-${editor.role.id}` : `new-${editor.from?.id ?? 0}`}
          state={editor}
          modules={modules}
          members={editor.mode === 'edit' ? users.filter((u) => u.roles.some((r) => r.id === editor.role.id)) : []}
          onClose={() => setEditor(null)}
          onSaved={async (next, message) => {
            await onRolesChanged(next);
            setEditor(null);
            notify({ success: message });
          }}
        />
      )}
    </div>
  );
}

function RoleEditor({
  state,
  modules,
  members,
  onClose,
  onSaved,
}: {
  state: EditorState;
  modules: AdminModule[];
  /** People who hold the role being edited. */
  members: AdminUser[];
  onClose: () => void;
  onSaved: (roles: AdminRole[], message: string) => Promise<void>;
}) {
  const source = state.mode === 'edit' ? state.role : state.from;
  const isAdmin = state.mode === 'edit' && state.role.isAdmin;
  const [name, setName] = useState(state.mode === 'edit' ? state.role.name : source ? `${source.name} copy` : '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [moduleIds, setModuleIds] = useState<number[]>(source?.moduleIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const nameValid = /^[A-Za-z0-9][A-Za-z0-9 &/_-]{1,39}$/.test(name.trim());

  // Modules every member already has, from any source: a quick way to turn
  // access granted one by one into this role. Admin members open everything,
  // so they don't narrow the set.
  const shared = useMemo(() => {
    const counted = members.filter((m) => !m.roles.some((r) => r.name === 'admin'));
    if (counted.length === 0) return [];
    return modules
      .map((mod) => mod.id)
      .filter((id) => counted.every((m) => m.modules.some((x) => x.id === id)));
  }, [members, modules]);
  const sharedMissing = shared.filter((id) => !moduleIds.includes(id));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (state.mode === 'edit') {
        const body = isAdmin ? { description } : { name: name.trim(), description, moduleIds };
        const payload = await adminFetch<{ roles: AdminRole[] }>(`/api/admin/roles/${state.role.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        await onSaved(
          payload.roles,
          state.role.memberCount > 0 && !isAdmin
            ? `Saved "${name.trim()}". ${state.role.memberCount} ${state.role.memberCount === 1 ? 'person gets' : 'people get'} the change on their next page load.`
            : `Saved "${name.trim()}".`,
        );
      } else {
        const payload = await adminFetch<{ roles: AdminRole[] }>('/api/admin/roles', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), description, moduleIds }),
        });
        await onSaved(payload.roles, `Created the "${name.trim()}" role. Assign it to people from the Users tab.`);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not save the role.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      size="lg"
      title={state.mode === 'edit' ? `Edit role: ${state.role.name}` : source ? `Duplicate ${source.name}` : 'New role'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving || !nameValid} className={primaryButton}>
            {saving ? 'Saving…' : state.mode === 'edit' ? 'Save role' : 'Create role'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {error && <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isAdmin}
              maxLength={40}
              placeholder="e.g. Finance"
              className={inputClass}
              autoFocus={!isAdmin}
            />
            {!isAdmin && name && !nameValid && (
              <span className="mt-1 block text-xs text-rose-600">2–40 characters: letters, numbers, spaces and - _ &amp; /</span>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={200}
              placeholder="Who this role is for"
              className={inputClass}
            />
          </label>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900">Modules</h3>
          <p className="mb-3 mt-0.5 text-xs text-gray-500">
            {isAdmin ? 'Admins can open every module, so there is nothing to choose.' : 'What people with this role can open.'}
          </p>
          {!isAdmin && sharedMissing.length > 0 && (
            <div className="mb-3 flex flex-col gap-2 rounded-xl border border-blue-100 bg-blue-50/50 px-3.5 py-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-xs text-gray-700">
                {members.length === 1 ? 'The person' : `All ${members.length} people`} with this role already{' '}
                {members.length === 1 ? 'has' : 'have'} {sharedMissing.length} module{sharedMissing.length === 1 ? '' : 's'} the role
                doesn&apos;t include. Add {sharedMissing.length === 1 ? 'it' : 'them'} so their access is managed in one place.
              </p>
              <button
                type="button"
                onClick={() => setModuleIds([...new Set([...moduleIds, ...sharedMissing])])}
                className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#03458f] ring-1 ring-inset ring-[#03458f]/20 hover:bg-blue-50"
              >
                Add {sharedMissing.length} module{sharedMissing.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
          {!isAdmin && <ModulePicker modules={modules} selected={moduleIds} onChange={setModuleIds} />}
        </div>
      </div>
    </Modal>
  );
}
