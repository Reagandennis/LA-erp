'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { APP_LOCALE } from '@/lib/locale';

import { adminFetch, errorMessage } from './admin-api';
import { ADMIN_ROLE, type AdminModule, type AdminRole, type AdminSession, type AdminUser } from './admin-types';
import {
  Avatar,
  Drawer,
  ModulePicker,
  StatusPill,
  dangerButton,
  describeDevice,
  formatDateTime,
  formatIp,
  generatePassword,
  inputClass,
  isValidPassword,
  primaryButton,
  relativeTime,
  secondaryButton,
} from './admin-ui';

const STATUSES = [
  { value: 'active', label: 'Active', hint: 'Can sign in and work as normal.' },
  { value: 'inactive', label: 'Inactive', hint: 'Cannot sign in. For people who have left.' },
  { value: 'suspended', label: 'Suspended', hint: 'Cannot sign in. For a temporary block, e.g. during an investigation.' },
] as const;

interface Draft {
  name: string;
  email: string;
  status: string;
  roleIds: number[];
  moduleIds: number[];
}

function draftOf(user: AdminUser): Draft {
  return {
    name: user.name,
    email: user.email,
    status: user.status,
    roleIds: user.roles.map((r) => r.id),
    moduleIds: user.directModuleIds,
  };
}

const sameIds = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-100 px-5 py-5 last:border-b-0 sm:px-6">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function UserDrawer({
  user,
  roles,
  modules,
  sessions,
  currentUserId,
  now,
  onClose,
  onChanged,
  onDeleted,
  onRevokeSession,
  onRevokeAll,
  notify,
}: {
  user: AdminUser;
  roles: AdminRole[];
  modules: AdminModule[];
  sessions: AdminSession[];
  currentUserId: number;
  now: number;
  onClose: () => void;
  /** The user was saved; reload whatever depends on them. */
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
  onRevokeSession: (sessionId: string) => Promise<void>;
  onRevokeAll: (userId: number) => Promise<void>;
  notify: (message: { error?: string; success?: string }) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftOf(user));
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busySession, setBusySession] = useState<string | null>(null);

  const isSelf = user.id === currentUserId;
  const adminRole = roles.find((r) => r.isAdmin);
  const draftIsAdmin = Boolean(adminRole && draft.roleIds.includes(adminRole.id));

  const saved = draftOf(user);
  const accessDirty =
    draft.status !== saved.status || !sameIds(draft.roleIds, saved.roleIds) || !sameIds(draft.moduleIds, saved.moduleIds);
  const profileDirty = draft.name.trim() !== saved.name || draft.email.trim().toLowerCase() !== saved.email;
  const dirty = accessDirty || profileDirty;

  /** Modules this person gets from the roles currently ticked, and from which role. */
  const fromRoles = useMemo(() => {
    const map = new Map<number, string>();
    for (const role of roles) {
      if (!draft.roleIds.includes(role.id) || role.isAdmin) continue;
      for (const id of role.moduleIds) if (!map.has(id)) map.set(id, role.name);
    }
    return map;
  }, [roles, draft.roleIds]);

  const effectiveCount = draftIsAdmin ? modules.length : new Set([...fromRoles.keys(), ...draft.moduleIds]).size;
  const directOnly = draft.moduleIds.filter((id) => !fromRoles.has(id)).length;

  const toggleRole = (roleId: number) =>
    setDraft((d) => ({
      ...d,
      roleIds: d.roleIds.includes(roleId) ? d.roleIds.filter((id) => id !== roleId) : [...d.roleIds, roleId],
    }));

  const save = async () => {
    if (draft.roleIds.length === 0) {
      notify({ error: 'Keep at least one role.' });
      return;
    }
    const body: Record<string, unknown> = {};
    if (draft.name.trim() !== saved.name) body.name = draft.name.trim();
    if (draft.email.trim().toLowerCase() !== saved.email) body.email = draft.email.trim();
    if (draft.status !== saved.status) body.status = draft.status;
    if (!sameIds(draft.roleIds, saved.roleIds)) body.roleIds = draft.roleIds;
    // Direct grants already covered by a role are dropped, so removing that
    // role later really removes the access.
    const direct = draft.moduleIds.filter((id) => !fromRoles.has(id));
    if (!sameIds(direct, saved.moduleIds)) body.moduleIds = draftIsAdmin ? saved.moduleIds : direct;

    setSaving(true);
    try {
      await adminFetch(`/api/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify(body) });
      notify({
        success: accessDirty && !isSelf ? `Saved. ${draft.name.trim()} was signed out so the new access applies.` : 'Changes saved.',
      });
      if (isSelf && accessDirty) {
        // Access changes end every session, this one included.
        router.replace('/auth/login');
        return;
      }
      await onChanged();
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not save the changes.') });
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async () => {
    setResetting(true);
    try {
      await adminFetch(`/api/admin/users/${user.id}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
      notify({
        success: isSelf
          ? 'Your password was changed. Your other sessions were signed out.'
          : `Password reset. ${user.name} was signed out everywhere. Share the new password with them securely.`,
      });
      setPassword('');
      setShowPassword(false);
      await onChanged();
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not reset the password.') });
    } finally {
      setResetting(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${user.name} (${user.email})? Their account and personal data are removed. This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await adminFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      notify({ success: `${user.name} was deleted.` });
      await onDeleted();
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not delete the user.') });
      setDeleting(false);
    }
  };

  const revoke = async (sessionId: string) => {
    setBusySession(sessionId);
    try {
      await onRevokeSession(sessionId);
    } finally {
      setBusySession(null);
    }
  };

  const close = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };

  return (
    <Drawer
      wide
      onClose={close}
      title={<span className="flex items-center gap-2">Edit user {isSelf && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">You</span>}</span>}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <p className="text-xs text-gray-500 sm:mr-auto">
            {accessDirty
              ? isSelf
                ? 'Saving access changes signs you out; sign back in to continue.'
                : `Saving signs ${user.name.split(' ')[0]} out so the new access applies.`
              : dirty
                ? 'Unsaved changes'
                : 'No changes'}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDraft(draftOf(user))} disabled={!dirty || saving} className={`${secondaryButton} flex-1 sm:flex-none`}>
              Discard
            </button>
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={`${primaryButton} flex-1 sm:flex-none`}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex items-center gap-4 border-b border-gray-100 px-5 py-5 sm:px-6">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-gray-900">{user.name}</p>
          <p className="truncate text-sm text-gray-500">{user.email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
            <StatusPill status={user.status} />
            <span>Last active {relativeTime(user.lastSeenAt, now).toLowerCase()}</span>
            <span aria-hidden="true">·</span>
            <span>Joined {new Date(user.createdAt).toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </p>
        </div>
      </div>

      <Section title="Profile">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">Full name</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} maxLength={80} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-600">Email (used to sign in)</span>
            <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputClass} />
          </label>
        </div>
      </Section>

      <Section title="Status">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Account status">
          {STATUSES.map((s) => {
            const on = draft.status === s.value;
            const locked = isSelf && s.value !== 'active';
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={locked}
                onClick={() => setDraft({ ...draft, status: s.value })}
                className={`rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? 'border-[#03458f]/40 bg-blue-50/70 ring-1 ring-[#03458f]/30' : 'border-gray-100 hover:bg-gray-50'
                }`}
              >
                <span className="block text-sm font-semibold text-gray-900">{s.label}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{s.hint}</span>
              </button>
            );
          })}
        </div>
        {isSelf && <p className="mt-2 text-xs text-gray-500">You can&apos;t deactivate your own account.</p>}
      </Section>

      <Section title="Roles" description="People get every module from each of their roles.">
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((role) => {
            const on = draft.roleIds.includes(role.id);
            const locked = isSelf && role.isAdmin && on;
            return (
              <label
                key={role.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${
                  on ? 'border-[#03458f]/30 bg-blue-50/60' : 'border-gray-100 hover:bg-gray-50'
                } ${locked ? 'cursor-not-allowed' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={locked}
                  onChange={() => toggleRole(role.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#03458f]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold capitalize text-gray-900">{role.name}</span>
                  <span className="block text-xs text-gray-500">
                    {role.isAdmin ? 'Every module, plus this admin console' : `${role.moduleIds.length} module${role.moduleIds.length === 1 ? '' : 's'}`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {isSelf && <p className="mt-2 text-xs text-gray-500">You can&apos;t remove your own admin role.</p>}
        {draft.roleIds.length === 0 && <p className="mt-2 text-xs font-medium text-rose-600">Pick at least one role.</p>}
      </Section>

      <Section
        title="Module access"
        description={
          draftIsAdmin
            ? 'Admins can open every module.'
            : `${effectiveCount} module${effectiveCount === 1 ? '' : 's'}: ${fromRoles.size} from roles, ${directOnly} granted to ${user.name.split(' ')[0]} directly.`
        }
      >
        {draftIsAdmin ? (
          <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
            Remove the {ADMIN_ROLE} role to choose modules one by one.
          </p>
        ) : (
          <ModulePicker
            modules={modules}
            selected={draft.moduleIds.filter((id) => !fromRoles.has(id))}
            locked={fromRoles}
            onChange={(moduleIds) => setDraft({ ...draft, moduleIds })}
          />
        )}
      </Section>

      <Section
        title="Signed-in sessions"
        description={sessions.length ? `${sessions.length} active` : 'Not signed in anywhere right now.'}
      >
        {sessions.length > 0 && (
          <>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-gray-900">
                      {describeDevice(s.userAgent)}
                      {s.current && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">This device</span>}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {formatIp(s.ipAddress)} · active {relativeTime(s.lastSeenAt, now).toLowerCase()} · signed in {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <button
                      type="button"
                      onClick={() => void revoke(s.id)}
                      disabled={busySession !== null}
                      className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                    >
                      {busySession === s.id ? 'Signing out…' : 'Sign out'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {sessions.some((s) => !s.current) && (
              <button
                type="button"
                onClick={() => void onRevokeAll(user.id)}
                className="mt-2 text-xs font-semibold text-rose-600 hover:underline"
              >
                {isSelf ? 'Sign out my other devices' : `Sign ${user.name.split(' ')[0]} out everywhere`}
              </button>
            )}
          </>
        )}
      </Section>

      <Section
        title="Reset password"
        description={isSelf ? 'Your other sessions are signed out; this one stays.' : 'They are signed out everywhere and use the new password next time.'}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-16 font-mono`}
              aria-label="New password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setPassword(generatePassword());
              setShowPassword(true);
            }}
            className={secondaryButton}
          >
            Generate
          </button>
          <button type="button" onClick={() => void resetPassword()} disabled={resetting || !isValidPassword(password)} className={primaryButton}>
            {resetting ? 'Resetting…' : 'Reset'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">At least 8 characters with a letter and a number.</p>
      </Section>

      {!isSelf && (
        <Section title="Delete user" description="Removes the account and everything personal to it. Prefer Inactive if you may need their history.">
          <button type="button" onClick={() => void remove()} disabled={deleting} className={dangerButton}>
            {deleting ? 'Deleting…' : `Delete ${user.name.split(' ')[0]}`}
          </button>
        </Section>
      )}
    </Drawer>
  );
}
