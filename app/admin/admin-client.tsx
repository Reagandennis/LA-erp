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

function formatRelativeSession(version: number) {
  return version === 1 ? 'Original session scope' : `Revoked ${version - 1} time(s)`;
}

function getStatusBadgeClass(status: string) {
  if (status === 'active') {
    return 'border-emerald-300 bg-emerald-100 text-emerald-900';
  }

  if (status === 'inactive') {
    return 'border-stone-300 bg-stone-200 text-stone-800';
  }

  return 'border-rose-300 bg-rose-100 text-rose-900';
}

function getRoleTone(roleName: string) {
  if (roleName === 'admin') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  if (roleName === 'editor') {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }

  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className={`text-xs font-semibold uppercase tracking-wider ${accent}`}>
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold text-slate-900">
        {value}
      </p>
    </div>
  );
}

import Sidebar from '@/app/ui/sidebar';

export default function AdminClient({
  currentUserId,
  initialUsers,
  initialRoles,
  initialLogs,
}: AdminClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'audit'>('users');
  const [users, setUsers] = useState(initialUsers);
  const [roles, setRoles] = useState(initialRoles);
  const [logs, setLogs] = useState(initialLogs);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  
  const currentUser = users.find(u => u.id === currentUserId) || { name: 'Admin', email: 'admin@system.com' };

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
    users.find((user) => user.id === selectedUserId) ?? null;

  const filteredUsers = users.filter(
    (user) =>
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const activeUsers = users.filter((user) => user.status === 'active').length;
  const suspendedUsers = users.filter((user) => user.status === 'suspended').length;
  const adminUsers = users.filter((user) =>
    user.roles.some((role) => role.name === 'admin'),
  ).length;

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
      setError(caughtError instanceof Error ? caughtError.message : 'Refresh failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');
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
        setUsers((current) => [payload.user as AdminUser, ...current]);
        setCreateForm({
          name: '',
          email: '',
          password: '',
          status: 'active',
          roleIds: roles.filter((r) => r.name === 'viewer').map((r) => r.id),
        });
        setSuccess('User created');
        setShowCreateModal(false);
        await syncData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (userId: number, status: string) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      const payload = await parseJson(response);
      if (payload?.user) {
        setUsers((current) =>
          current.map((u) => (u.id === userId ? payload.user! : u)),
        );
        if (userId === currentUserId) router.refresh();
      }
    } catch (err) {
      setError('Status update failed');
    }
  };

  const handleAccessSave = async (userId: number, roleIds: number[]) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ roleIds }),
      });
      const payload = await parseJson(response);
      if (payload?.user) {
        setUsers((current) =>
          current.map((u) => (u.id === userId ? payload.user! : u)),
        );
        setSuccess('Permissions updated');
        if (userId === currentUserId) router.refresh();
      }
    } catch (err) {
      setError('Access update failed');
    }
  };

  return (
    <div className="flex h-screen bg-white font-sans text-slate-900">
      <Sidebar isAdmin={true} userName={currentUser.name} userEmail={currentUser.email} />

      {/* Main Content Area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <header className="flex h-14 items-center justify-between border-b border-slate-200 px-6 bg-white">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <span className="text-xl">🛡️</span>
              Admin Console
            </h2>
            <div className="h-4 w-[1px] bg-slate-200" />
            <div className="flex gap-1 bg-slate-100 p-1 rounded-md">
              <button 
                onClick={() => setActiveTab('overview')}
                className={`px-3 py-1 text-xs font-bold rounded transition-all ${activeTab === 'overview' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Overview
              </button>
              <button 
                onClick={() => setActiveTab('users')}
                className={`px-3 py-1 text-xs font-bold rounded transition-all ${activeTab === 'users' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Users
              </button>
              <button 
                onClick={() => setActiveTab('audit')}
                className={`px-3 py-1 text-xs font-bold rounded transition-all ${activeTab === 'audit' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Audit Logs
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="relative">
              <input
                type="text"
                placeholder="Search records..."
                className="w-64 rounded border border-slate-200 bg-slate-50 px-3 py-1 text-sm outline-none focus:border-blue-500 focus:bg-white"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button
              onClick={() => void syncData()}
              className="text-slate-400 hover:text-slate-600 disabled:opacity-50 p-2"
              disabled={isSyncing}
              title="Sync Data"
            >
              🔄
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700 shadow-sm"
            >
              + Create User
            </button>
            <LogoutButton />
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-slate-50/50">
          {(error || success) && (
            <div className={`mx-6 mt-4 rounded border p-3 text-[13px] font-medium ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
              {error || success}
            </div>
          )}

          {activeTab === 'users' && (
            <div className="flex h-full">
              <div className="flex-1 border-r border-slate-200 overflow-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Name</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Email</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Roles</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {filteredUsers.map((user) => (
                      <tr
                        key={user.id}
                        onClick={() => setSelectedUserId(user.id)}
                        className={`cursor-pointer transition-colors hover:bg-blue-50/50 ${selectedUserId === user.id ? 'bg-blue-50 shadow-[inset_3px_0_0_0_#2563eb]' : ''}`}
                      >
                        <td className="px-4 py-3 font-medium">{user.name}</td>
                        <td className="px-4 py-3 text-slate-500">{user.email}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium uppercase border ${getStatusBadgeClass(user.status)}`}>
                            {user.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((r) => (
                              <span key={r.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 uppercase">
                                {r.name}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Detail Panel */}
              <div className={`w-[400px] border-l border-slate-200 bg-white transition-all overflow-auto ${selectedUserId ? 'translate-x-0' : 'translate-x-full absolute right-0'}`}>
                {selectedUser ? (
                  <div className="p-6">
                    <div className="mb-6 flex items-start justify-between">
                      <div>
                        <h3 className="text-xl font-bold">{selectedUser.name}</h3>
                        <p className="text-sm text-slate-500">{selectedUser.email}</p>
                      </div>
                      <button onClick={() => setSelectedUserId(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                    </div>

                    <div className="space-y-6">
                      <section>
                        <h4 className="mb-3 text-xs font-bold uppercase text-slate-400">Account Details</h4>
                        <div className="rounded border border-slate-200 bg-slate-50 p-4 space-y-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase text-slate-400">Status</p>
                            <select
                              value={selectedUser.status}
                              onChange={(e) => void handleStatusChange(selectedUser.id, e.target.value)}
                              className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-sm outline-none focus:border-blue-500"
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                              <option value="suspended">Suspended</option>
                            </select>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase text-slate-400">Last Updated</p>
                            <p className="text-sm text-slate-700">{new Date(selectedUser.updatedAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                      </section>

                      <section>
                        <h4 className="mb-3 text-xs font-bold uppercase text-slate-400">Roles & Access</h4>
                        <div className="space-y-2">
                          {roles.map((role) => {
                            const hasRole = selectedUser.roles.some((r) => r.id === role.id);
                            return (
                              <label key={role.id} className={`flex items-center gap-3 rounded border p-3 transition-colors cursor-pointer ${hasRole ? 'border-blue-200 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                <input
                                  type="checkbox"
                                  checked={hasRole}
                                  onChange={() => {
                                    const next = toggleId(role.id, selectedUser.roles.map(r => r.id));
                                    handleAccessSave(selectedUser.id, next);
                                  }}
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <div className="flex-1">
                                  <p className="text-sm font-bold capitalize">{role.name}</p>
                                  <p className="text-xs text-slate-500">{role.description}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-8 text-center text-slate-400">
                    <div>
                      <div className="mx-auto mb-4 h-12 w-12 rounded border-2 border-dashed border-slate-200" />
                      <p className="text-sm">Select a user to view and edit details</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="p-8">
              <div className="mb-8 grid grid-cols-4 gap-4">
                <div className="rounded border border-slate-200 bg-white p-6">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Total Users</p>
                  <p className="mt-2 text-3xl font-bold">{users.length}</p>
                </div>
                <div className="rounded border border-slate-200 bg-white p-6">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Active Now</p>
                  <p className="mt-2 text-3xl font-bold text-green-600">{activeUsers}</p>
                </div>
                <div className="rounded border border-slate-200 bg-white p-6">
                  <p className="text-[10px] font-bold uppercase text-slate-400">Suspended</p>
                  <p className="mt-2 text-3xl font-bold text-red-600">{suspendedUsers}</p>
                </div>
                <div className="rounded border border-slate-200 bg-white p-6">
                  <p className="text-[10px] font-bold uppercase text-slate-400">System Admins</p>
                  <p className="mt-2 text-3xl font-bold text-blue-600">{adminUsers}</p>
                </div>
              </div>

              <div className="rounded border border-slate-200 bg-white overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
                  <h3 className="font-bold">Recent System Activity</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {logs.slice(0, 10).map((log) => (
                    <div key={log.id} className="px-6 py-4 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-4">
                        <span className="font-bold text-blue-600">{log.action}</span>
                        <span className="text-slate-500">by {log.actor?.email || 'System'}</span>
                      </div>
                      <span className="text-slate-400">{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Action</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Actor</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Target</th>
                      <th className="px-4 py-3 font-semibold uppercase tracking-wider">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-blue-600">{log.action}</td>
                        <td className="px-4 py-3 text-slate-600">{log.actor?.email || 'system'}</td>
                        <td className="px-4 py-3 text-slate-500">{log.target?.email || log.entityId || 'n/a'}</td>
                        <td className="px-4 py-3 text-slate-400">{new Date(log.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="font-bold">Create New User</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold uppercase text-slate-400">Full Name</label>
                  <input
                    required
                    value={createForm.name}
                    onChange={e => setCreateForm({...createForm, name: e.target.value})}
                    className="mt-1 w-full rounded border border-slate-200 p-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-400">Email</label>
                  <input
                    type="email"
                    required
                    value={createForm.email}
                    onChange={e => setCreateForm({...createForm, email: e.target.value})}
                    className="mt-1 w-full rounded border border-slate-200 p-2 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-slate-400">Password</label>
                <input
                  type="password"
                  required
                  value={createForm.password}
                  onChange={e => setCreateForm({...createForm, password: e.target.value})}
                  className="mt-1 w-full rounded border border-slate-200 p-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded bg-blue-600 px-6 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
