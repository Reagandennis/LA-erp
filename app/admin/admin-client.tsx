'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useState, type FormEvent } from 'react';

import LogoutButton from '@/app/ui/logout-button';

export interface AdminPermission {
  id: number;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export interface AdminRole {
  id: number;
  name: string;
  description: string;
  permissions: AdminPermission[];
}

export interface AdminUser {
  id: number;
  email: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  sessionVersion: number;
  roles: Array<{ id: number; name: string; description: string }>;
  permissions: AdminPermission[];
}

export interface AdminAuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  actor: { id: number; email: string; name: string } | null;
  target: { id: number; email: string; name: string } | null;
}

interface AdminClientProps {
  currentUserId: number;
  initialUsers: AdminUser[];
  initialRoles: AdminRole[];
  initialLogs: AdminAuditLog[];
}

async function parseJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
        users?: AdminUser[];
        roles?: AdminRole[];
        logs?: AdminAuditLog[];
        user?: AdminUser;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed');
  }

  return payload;
}

function toggleId(id: number, selectedIds: number[]) {
  if (selectedIds.includes(id)) {
    return selectedIds.filter((value) => value !== id);
  }

  return [...selectedIds, id];
}

function buildRoleAssignments(roleIds: number[], roles: AdminRole[]) {
  return roles
    .filter((role) => roleIds.includes(role.id))
    .map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
    }));
}

export default function AdminClient({
  currentUserId,
  initialUsers,
  initialRoles,
  initialLogs,
}: AdminClientProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [roles, setRoles] = useState(initialRoles);
  const [logs, setLogs] = useState(initialLogs);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(
    initialUsers[0]?.id ?? null,
  );
  const [createForm, setCreateForm] = useState<{
    name: string;
    email: string;
    password: string;
    status: string;
    roleIds: number[];
  }>({
    name: '',
    email: '',
    password: '',
    status: 'active',
    roleIds: initialRoles
      .filter((role) => role.name === 'viewer')
      .map((role) => role.id),
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const selectedUser =
    users.find((user) => user.id === selectedUserId) ?? users[0] ?? null;

  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const syncData = async () => {
    setIsSyncing(true);

    try {
      const [usersResponse, logsResponse] = await Promise.all([
        fetch('/api/admin/users', { credentials: 'include' }),
        fetch('/api/admin/audit', { credentials: 'include' }),
      ]);
      const [usersPayload, logsPayload] = await Promise.all([
        parseJson(usersResponse),
        parseJson(logsResponse),
      ]);

      setUsers(usersPayload?.users || []);
      setRoles(usersPayload?.roles || []);
      setLogs(logsPayload?.logs || []);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to refresh admin data',
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const resetMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(createForm),
      });
      const payload = await parseJson(response);

      if (payload?.user) {
        setUsers((currentUsers) => [payload.user as AdminUser, ...currentUsers]);
        setSelectedUserId((payload.user as AdminUser).id);
        setCreateForm({
          name: '',
          email: '',
          password: '',
          status: 'active',
          roleIds: roles.filter((role) => role.name === 'viewer').map((role) => role.id),
        });
        setSuccess('User created successfully');
        await syncData();
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to create user',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (userId: number, status: string) => {
    resetMessages();

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      const payload = await parseJson(response);

      if (payload?.user) {
        setUsers((currentUsers) =>
          currentUsers.map((user) => (user.id === userId ? payload.user! : user)),
        );
        setSuccess('User status updated');

        if (userId === currentUserId) {
          startTransition(() => {
            router.refresh();
          });
        }

        await syncData();
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update user status',
      );
    }
  };

  const handleAccessSave = async (userId: number, roleIds: number[]) => {
    resetMessages();

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ roleIds }),
      });
      const payload = await parseJson(response);

      if (payload?.user) {
        setUsers((currentUsers) =>
          currentUsers.map((user) => (user.id === userId ? payload.user! : user)),
        );
        setSuccess('Role access updated');

        if (userId === currentUserId) {
          startTransition(() => {
            router.refresh();
          });
        }

        await syncData();
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update user access',
      );
    }
  };

  const handleDeleteUser = async (userId: number) => {
    resetMessages();

    if (!globalThis.confirm('Delete this account permanently?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      await parseJson(response);
      const remainingUsers = users.filter((user) => user.id !== userId);

      setUsers(remainingUsers);
      setSelectedUserId(remainingUsers[0]?.id ?? null);
      setSuccess('User deleted');
      await syncData();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to delete user',
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="mb-1 text-sm uppercase tracking-[0.25em] text-emerald-600">
              Admin workspace
            </p>
            <h1 className="text-2xl font-bold text-gray-900">
              User lifecycle and access control
            </h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 font-medium text-gray-700 transition-colors hover:text-gray-900"
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => void syncData()}
              className="rounded-lg bg-gray-900 px-4 py-2 font-medium text-white transition-colors hover:bg-black disabled:opacity-60"
              disabled={isSyncing}
            >
              {isSyncing ? 'Refreshing...' : 'Refresh'}
            </button>
            <LogoutButton />
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        {(error || success) && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              error
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {error || success}
          </div>
        )}

        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl bg-white p-6 shadow">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900">Create managed user</h2>
              <p className="mt-1 text-sm text-gray-600">
                Create accounts with the right role and status from the start.
              </p>
            </div>

            <form onSubmit={handleCreateUser} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm text-gray-700">
                  Full name
                  <input
                    value={createForm.name}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm text-gray-700">
                  Email
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3"
                    required
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                <label className="grid gap-2 text-sm text-gray-700">
                  Initial password
                  <input
                    type="password"
                    value={createForm.password}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3"
                    placeholder="At least 8 chars with letters and numbers"
                    required
                  />
                </label>
                <label className="grid gap-2 text-sm text-gray-700">
                  Status
                  <select
                    value={createForm.status}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-300 px-4 py-3"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </label>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-gray-700">Roles</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {roles.map((role) => {
                    const checked = createForm.roleIds.includes(role.id);

                    return (
                      <label
                        key={role.id}
                        className={`cursor-pointer rounded-2xl border p-4 transition-colors ${
                          checked
                            ? 'border-emerald-500 bg-emerald-50'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCreateForm((current) => ({
                              ...current,
                              roleIds: toggleId(role.id, current.roleIds),
                            }))
                          }
                          className="sr-only"
                        />
                        <p className="font-semibold capitalize text-gray-900">
                          {role.name}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">{role.description}</p>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {isSubmitting ? 'Creating...' : 'Create account'}
              </button>
            </form>
          </div>

          <div className="rounded-2xl bg-slate-900 p-6 text-white shadow">
            <p className="mb-3 text-sm uppercase tracking-[0.25em] text-emerald-300">
              Audit visibility
            </p>
            <h2 className="mb-4 text-xl font-bold">Recent admin and auth activity</h2>
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <code className="text-sm text-emerald-200">{log.action}</code>
                    <span className="text-xs text-slate-400">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    Actor: {log.actor?.email ?? 'system'} | Target:{' '}
                    {log.target?.email ?? log.entityId ?? 'n/a'}
                  </p>
                  {log.ipAddress && (
                    <p className="mt-1 text-xs text-slate-500">IP: {log.ipAddress}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-gray-200 px-6 py-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Managed users</h2>
                  <p className="text-sm text-gray-600">
                    {filteredUsers.length} visible users
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Search users"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-2 sm:w-64"
                />
              </div>
            </div>

            <div className="max-h-[42rem] divide-y divide-gray-200 overflow-y-auto">
              {filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className={`w-full px-6 py-4 text-left transition-colors ${
                    selectedUser?.id === user.id ? 'bg-emerald-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">{user.name}</p>
                      <p className="mt-1 break-all text-sm text-gray-600">{user.email}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {user.roles.map((role) => (
                          <span
                            key={role.id}
                            className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800"
                          >
                            {role.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                        user.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : user.status === 'inactive'
                            ? 'bg-gray-100 text-gray-700'
                            : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {user.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow">
            {selectedUser ? (
              <div className="space-y-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="mb-2 text-sm uppercase tracking-[0.25em] text-gray-500">
                      User detail
                    </p>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {selectedUser.name}
                    </h2>
                    <p className="mt-1 text-gray-600">{selectedUser.email}</p>
                  </div>
                  {selectedUser.id === currentUserId && (
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      Your account
                    </span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="mb-2 text-sm text-gray-500">Status</p>
                    <select
                      value={selectedUser.status}
                      onChange={(event) =>
                        void handleStatusChange(selectedUser.id, event.target.value)
                      }
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 capitalize"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="mb-2 text-sm text-gray-500">Lifecycle</p>
                    <p className="text-sm text-gray-700">
                      Created {new Date(selectedUser.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-1 text-sm text-gray-700">
                      Updated {new Date(selectedUser.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">
                        Role assignment
                      </h3>
                      <p className="text-sm text-gray-600">
                        Suspend, deactivate, or narrow access by changing the
                        user&apos;s assigned roles.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {roles.map((role) => {
                      const checked = selectedUser.roles.some(
                        (selectedRole) => selectedRole.id === role.id,
                      );

                      return (
                        <label
                          key={role.id}
                          className={`cursor-pointer rounded-2xl border p-4 ${
                            checked
                              ? 'border-emerald-500 bg-emerald-50'
                              : 'border-gray-200'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const nextRoleIds = toggleId(
                                  role.id,
                                  selectedUser.roles.map((selectedRole) => selectedRole.id),
                                );

                                setUsers((currentUsers) =>
                                  currentUsers.map((user) =>
                                    user.id === selectedUser.id
                                      ? {
                                          ...user,
                                          roles: buildRoleAssignments(nextRoleIds, roles),
                                        }
                                      : user,
                                  ),
                                );
                              }}
                              className="mt-1"
                            />
                            <div>
                              <p className="font-semibold capitalize text-gray-900">
                                {role.name}
                              </p>
                              <p className="mt-1 text-sm text-gray-600">
                                {role.description}
                              </p>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void handleAccessSave(
                      selectedUser.id,
                      selectedUser.roles.map((role) => role.id),
                    )
                  }
                  className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white"
                >
                  Save role access
                </button>

                <div>
                  <h3 className="mb-4 text-lg font-bold text-gray-900">
                    Effective permissions
                  </h3>
                  <div className="grid max-h-56 gap-2 overflow-y-auto">
                    {selectedUser.permissions.map((permission) => (
                      <div
                        key={permission.id}
                        className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2"
                      >
                        <code className="text-sm text-gray-700">{permission.name}</code>
                        <span className="text-xs capitalize text-gray-500">
                          {permission.action}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void handleDeleteUser(selectedUser.id)}
                  disabled={selectedUser.id === currentUserId}
                  className="w-full rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
                >
                  Delete user
                </button>
              </div>
            ) : (
              <p className="text-gray-600">Select a user to review details.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
