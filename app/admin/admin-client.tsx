'use client';

import Link from 'next/link';
import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export interface AdminModule {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  sortOrder: number;
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
  modules: AdminModule[];
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
  initialModules: AdminModule[];
  initialLogs: AdminAuditLog[];
}

async function parseJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
        users?: AdminUser[];
        roles?: AdminRole[];
        modules?: AdminModule[];
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

function buildModuleAssignments(moduleIds: number[], modules: AdminModule[]) {
  return modules
    .filter((module) => moduleIds.includes(module.id))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export default function AdminClient({
  currentUserId,
  initialUsers,
  initialRoles,
  initialModules,
  initialLogs,
}: AdminClientProps) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [roles, setRoles] = useState(initialRoles);
  const [modules, setModules] = useState(initialModules);
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
    moduleIds: number[];
  }>({
    name: '',
    email: '',
    password: '',
    status: 'active',
    roleIds: initialRoles
      .filter((role) => role.name === 'viewer')
      .map((role) => role.id),
    moduleIds: [],
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
      setModules(usersPayload?.modules || []);
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

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
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
          moduleIds: [],
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

  const handleAccessSave = async (
    userId: number,
    roleIds: number[],
    moduleIds: number[],
  ) => {
    resetMessages();

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ roleIds, moduleIds }),
      });
      const payload = await parseJson(response);

      if (payload?.user) {
        setUsers((currentUsers) =>
          currentUsers.map((user) => (user.id === userId ? payload.user! : user)),
        );
        setSuccess('Roles and module access updated');

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
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-600 mb-1">
              Admin workspace
            </p>
            <h1 className="text-2xl font-bold text-gray-900">User lifecycle and module control</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => void syncData()}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors font-medium disabled:opacity-60"
              disabled={isSyncing}
            >
              {isSyncing ? 'Refreshing...' : 'Refresh'}
            </button>
            <LogoutButton />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
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
          <div className="bg-white rounded-2xl shadow p-6">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900">Create managed user</h2>
              <p className="text-sm text-gray-600 mt-1">
                Assign one or more modules per user. Administrators still see every
                module automatically.
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
                <p className="text-sm font-medium text-gray-700 mb-3">Roles</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  {roles.map((role) => {
                    const checked = createForm.roleIds.includes(role.id);

                    return (
                      <label
                        key={role.id}
                        className={`rounded-2xl border p-4 cursor-pointer transition-colors ${
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
                        <p className="font-semibold text-gray-900 capitalize">{role.name}</p>
                        <p className="text-sm text-gray-600 mt-1">{role.description}</p>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">Module access</p>
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
                  {modules.map((module) => {
                    const checked = createForm.moduleIds.includes(module.id);

                    return (
                      <label
                        key={module.id}
                        className={`rounded-2xl border p-4 cursor-pointer transition-colors ${
                          checked
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setCreateForm((current) => ({
                              ...current,
                              moduleIds: toggleId(module.id, current.moduleIds),
                            }))
                          }
                          className="sr-only"
                        />
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                          {module.category}
                        </p>
                        <p className="font-semibold text-gray-900">{module.name}</p>
                        <p className="text-sm text-gray-600 mt-1">{module.description}</p>
                      </label>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 inline-flex items-center justify-center px-5 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-60"
              >
                {isSubmitting ? 'Creating...' : 'Create account'}
              </button>
            </form>
          </div>

          <div className="bg-slate-900 text-white rounded-2xl shadow p-6">
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-300 mb-3">
              Audit visibility
            </p>
            <h2 className="text-xl font-bold mb-4">Recent admin and auth activity</h2>
            <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
              {logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <code className="text-sm text-emerald-200">{log.action}</code>
                    <span className="text-xs text-slate-400">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 mt-2">
                    Actor: {log.actor?.email ?? 'system'} | Target:{' '}
                    {log.target?.email ?? log.entityId ?? 'n/a'}
                  </p>
                  {log.ipAddress && (
                    <p className="text-xs text-slate-500 mt-1">IP: {log.ipAddress}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[0.95fr_1.05fr] gap-8">
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Managed users</h2>
                  <p className="text-sm text-gray-600">{filteredUsers.length} visible users</p>
                </div>
                <input
                  type="text"
                  placeholder="Search users"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full sm:w-64 rounded-xl border border-gray-300 px-4 py-2"
                />
              </div>
            </div>

            <div className="divide-y divide-gray-200 max-h-[42rem] overflow-y-auto">
              {filteredUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className={`w-full text-left px-6 py-4 transition-colors ${
                    selectedUser?.id === user.id ? 'bg-emerald-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">{user.name}</p>
                      <p className="text-sm text-gray-600 mt-1 break-all">{user.email}</p>
                      <div className="flex flex-wrap gap-2 mt-3">
                        {user.roles.map((role) => (
                          <span
                            key={role.id}
                            className="px-2 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-medium"
                          >
                            {role.name}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-3">
                        {user.modules.length} assigned module
                        {user.modules.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${
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

          <div className="bg-white rounded-2xl shadow p-6">
            {selectedUser ? (
              <div className="space-y-8">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-gray-500 mb-2">
                      User detail
                    </p>
                    <h2 className="text-2xl font-bold text-gray-900">{selectedUser.name}</h2>
                    <p className="text-gray-600 mt-1">{selectedUser.email}</p>
                  </div>
                  {selectedUser.id === currentUserId && (
                    <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                      Your account
                    </span>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-sm text-gray-500 mb-2">Status</p>
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
                    <p className="text-sm text-gray-500 mb-2">Lifecycle</p>
                    <p className="text-sm text-gray-700">
                      Created {new Date(selectedUser.createdAt).toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-700 mt-1">
                      Updated {new Date(selectedUser.updatedAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Role assignment</h3>
                      <p className="text-sm text-gray-600">
                        Suspend, deactivate, or limit users to only the modules they need.
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
                          className={`rounded-2xl border p-4 cursor-pointer ${
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
                              <p className="font-semibold text-gray-900 capitalize">
                                {role.name}
                              </p>
                              <p className="text-sm text-gray-600 mt-1">
                                {role.description}
                              </p>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Module access</h3>
                  <div className="grid gap-3 max-h-72 overflow-y-auto pr-1">
                    {modules.map((module) => {
                      const checked = selectedUser.modules.some(
                        (selectedModule) => selectedModule.id === module.id,
                      );

                      return (
                        <label
                          key={module.id}
                          className={`rounded-2xl border p-4 cursor-pointer ${
                            checked
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const nextModuleIds = toggleId(
                                  module.id,
                                  selectedUser.modules.map(
                                    (selectedModule) => selectedModule.id,
                                  ),
                                );

                                setUsers((currentUsers) =>
                                  currentUsers.map((user) =>
                                    user.id === selectedUser.id
                                      ? {
                                          ...user,
                                          modules: buildModuleAssignments(
                                            nextModuleIds,
                                            modules,
                                          ),
                                        }
                                      : user,
                                  ),
                                );
                              }}
                              className="mt-1"
                            />
                            <div>
                              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                                {module.category}
                              </p>
                              <p className="font-semibold text-gray-900">
                                {module.name}
                              </p>
                              <p className="text-sm text-gray-600 mt-1">
                                {module.description}
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
                      selectedUser.modules.map((module) => module.id),
                    )
                  }
                  className="w-full px-4 py-3 bg-emerald-600 text-white rounded-xl font-semibold"
                >
                  Save roles and module access
                </button>

                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Effective permissions</h3>
                  <div className="grid gap-2 max-h-56 overflow-y-auto">
                    {selectedUser.permissions.map((permission) => (
                      <div
                        key={permission.id}
                        className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2"
                      >
                        <code className="text-sm text-gray-700">{permission.name}</code>
                        <span className="text-xs text-gray-500 capitalize">
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
                  className="w-full px-4 py-3 bg-red-600 text-white rounded-xl font-semibold disabled:opacity-60"
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
