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

function toggleId(id: number, selectedIds: number[]): number[] {
  if (selectedIds.includes(id)) {
    return selectedIds.filter((value) => value !== id);
  }
  return [...selectedIds, id];
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
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [roles, setRoles] = useState<AdminRole[]>(initialRoles);
  const [modules, setModules] = useState<AdminModule[]>(initialModules);
  const [logs, setLogs] = useState<AdminAuditLog[]>(initialLogs);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'audit' | 'roles' | 'overview'>('users');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    status: 'active',
    roleIds: initialRoles.filter((r) => r.name === 'viewer').map((r) => r.id),
    moduleIds: [] as number[],
  });
  
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const syncData = async () => {
    setIsSyncing(true);
    try {
      const [usersRes, logsRes] = await Promise.all([
        fetch('/api/admin/users', { credentials: 'include' }),
        fetch('/api/admin/audit', { credentials: 'include' }),
      ]);
      const [uPayload, lPayload] = await Promise.all([parseJson(usersRes), parseJson(logsRes)]);
      setUsers(uPayload?.users || []);
      setRoles(uPayload?.roles || []);
      setModules(uPayload?.modules || []);
      setLogs(lPayload?.logs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(createForm),
      });
      const payload = await parseJson(res);
      if (payload?.user) {
        setUsers([payload.user as AdminUser, ...users]);
        setShowCreateModal(false);
        setSuccess('Account deployed successfully');
        await syncData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (userId: number, status: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      const payload = await parseJson(res);
      if (payload?.user) {
        setUsers(users.map((u) => (u.id === userId ? (payload.user as AdminUser) : u)));
        setSuccess('Status synchronized');
        if (userId === currentUserId) startTransition(() => router.refresh());
        await syncData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleAccessSave = async (userId: number, rIds: number[], mIds: number[]) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ roleIds: rIds, moduleIds: mIds }),
      });
      const payload = await parseJson(res);
      if (payload?.user) {
        setUsers(users.map((u) => (u.id === userId ? (payload.user as AdminUser) : u)));
        setSuccess('Privileges updated');
        if (userId === currentUserId) startTransition(() => router.refresh());
        await syncData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!globalThis.confirm('Permanently revoke this identity?')) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', credentials: 'include' });
      await parseJson(res);
      setUsers(users.filter((u) => u.id !== userId));
      setSelectedUserId(null);
      setSuccess('Identity purged');
      await syncData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purge failed');
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Global Admin Navigation */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-gray-900 tracking-tight">System Control</h1>
              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Administrative Interface</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => void syncData()}
              disabled={isSyncing}
              className="px-4 py-2 bg-gray-50 text-gray-500 hover:text-emerald-600 rounded-xl font-bold text-xs transition-all flex items-center gap-2 border border-gray-100"
            >
              <svg className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isSyncing ? 'Syncing...' : 'Sync Data'}
            </button>
            <div className="h-6 w-px bg-gray-100 mx-2" />
            <Link href="/admin/email" className="px-4 py-2 text-gray-400 hover:text-gray-900 font-bold text-xs uppercase tracking-widest transition-all">Email</Link>
            <Link href="/dashboard" className="px-4 py-2 text-gray-400 hover:text-gray-900 font-bold text-xs uppercase tracking-widest transition-all">Portal</Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6 lg:p-10">
        {/* Alerts */}
        {(error || success) && (
          <div className={`mb-10 p-4 rounded-2xl border flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
            error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}>
            <div className={`w-2 h-2 rounded-full ${error ? 'bg-rose-500' : 'bg-emerald-500'}`} />
            <p className="text-sm font-bold">{error || success}</p>
            <button onClick={() => { setError(''); setSuccess(''); }} className="ml-auto p-1 hover:bg-black/5 rounded">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Tab System */}
        <div className="flex items-center gap-1 bg-gray-100 p-1.5 rounded-[1.25rem] w-fit mb-10">
          {(['users', 'audit', 'roles', 'overview'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === tab ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content Views */}
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
                <div className="relative flex-1 max-w-md">
                  <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search identity catalog..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-12 pr-6 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                  />
                </div>
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                  </svg>
                  New Deployment
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredUsers.map((u) => (
                  <div
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className="group bg-white p-8 rounded-[2.5rem] border border-gray-100 hover:border-emerald-300 hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer relative overflow-hidden"
                  >
                    <div className="flex justify-between items-start mb-6">
                      <div className="w-14 h-14 rounded-2xl bg-gray-900 flex items-center justify-center text-white font-black text-xl shadow-lg transition-transform group-hover:scale-105 duration-300">
                        {u.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border ${
                        u.status === 'active' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'
                      }`}>
                        {u.status}
                      </div>
                    </div>
                    <h3 className="text-lg font-black text-gray-900 group-hover:text-emerald-700 transition-colors truncate">{u.name}</h3>
                    <p className="text-xs text-gray-400 font-bold mt-1 truncate mb-6">{u.email}</p>
                    <div className="flex flex-wrap gap-1.5 mb-6">
                      {u.roles.map(r => (
                        <span key={r.id} className="text-[8px] font-black uppercase tracking-widest px-2 py-1 bg-gray-50 text-gray-500 rounded-lg border border-gray-100">
                          {r.name}
                        </span>
                      ))}
                    </div>
                    <div className="pt-6 border-t border-gray-50 flex items-center justify-between">
                      <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">{u.modules.length} Modules</span>
                      <button className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-700">Settings</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-10 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div>
                  <h2 className="text-2xl font-black text-gray-900 tracking-tight">Global Audit Log</h2>
                  <p className="text-sm text-gray-500 font-medium mt-1">Platform-wide trace of administrative & authentication events</p>
                </div>
                <div className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 text-[10px] font-black uppercase tracking-widest">Live Activity</div>
              </div>
              <div className="divide-y divide-gray-50">
                {logs.map((log) => (
                  <div key={log.id} className="p-8 hover:bg-gray-50 transition-all flex items-start gap-8">
                    <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center shrink-0 shadow-lg shadow-gray-200">
                      <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04 transition-all" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <code className="text-xs font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 uppercase">{log.action}</code>
                        <span className="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em]">{log.entityType}</span>
                      </div>
                      <p className="text-base font-bold text-gray-900 mb-2">
                        <span className="text-emerald-600">{log.actor?.email ?? 'SYSTEM'}</span> 
                        <span className="text-gray-400 mx-2 font-medium">processed</span> 
                        <span className="text-gray-900">{log.target?.email ?? log.entityId ?? 'internal entity'}</span>
                      </p>
                      <div className="flex items-center gap-6 text-[10px] text-gray-400 font-black uppercase tracking-widest">
                        <span className="flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> {new Date(log.createdAt).toLocaleString()}</span>
                        {log.ipAddress && <span className="flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" /></svg> {log.ipAddress}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'roles' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {roles.map(r => (
                <div key={r.id} className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm relative overflow-hidden group">
                  <div className="relative z-10">
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.3em] mb-4 block">{r.permissions.length} Permissions</span>
                    <h3 className="text-3xl font-black text-gray-900 capitalize mb-2">{r.name}</h3>
                    <p className="text-sm text-gray-500 font-medium mb-8 leading-relaxed">{r.description}</p>
                    <div className="space-y-2">
                      {r.permissions.slice(0, 5).map(p => (
                        <div key={p.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                          <code className="text-[10px] font-black text-gray-700">{p.name}</code>
                          <span className="text-[9px] font-black text-gray-400 uppercase">{p.action}</span>
                        </div>
                      ))}
                      {r.permissions.length > 5 && <p className="text-[10px] font-black text-gray-300 text-center pt-2">+{r.permissions.length - 5} MORE CAPABILITIES</p>}
                    </div>
                  </div>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -mr-16 -mt-16 group-hover:scale-110 transition-transform" />
                </div>
              ))}
            </div>
          )}

          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-gray-900 p-12 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden">
                <h3 className="text-2xl font-black mb-10 relative z-10">Security Distribution</h3>
                <div className="space-y-8 relative z-10">
                  <div className="flex items-end justify-between border-b border-white/10 pb-6">
                    <div>
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2">Platform Admins</p>
                      <p className="text-5xl font-black">{users.filter(u => u.roles.some(r => r.name === 'admin')).length}</p>
                    </div>
                    <p className="text-[10px] text-white/40 font-bold max-w-[140px] text-right">Maximum system privileges assigned</p>
                  </div>
                  <div className="flex items-end justify-between border-b border-white/10 pb-6">
                    <div>
                      <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-2">Suspended Entities</p>
                      <p className="text-5xl font-black">{users.filter(u => u.status === 'suspended').length}</p>
                    </div>
                    <p className="text-[10px] text-white/40 font-bold max-w-[140px] text-right">Identities currently restricted from access</p>
                  </div>
                </div>
                <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
              </div>

              <div className="bg-white p-12 rounded-[3.5rem] border border-gray-100 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="text-2xl font-black text-gray-900 mb-8">System Health</h3>
                  <div className="grid grid-cols-2 gap-6 mb-10">
                    <div className="p-6 bg-gray-50 rounded-[2rem]">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Database Hub</p>
                      <p className="text-lg font-black text-emerald-600 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Online
                      </p>
                    </div>
                    <div className="p-6 bg-gray-50 rounded-[2rem]">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Audit Pipeline</p>
                      <p className="text-lg font-black text-emerald-600 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Operational
                      </p>
                    </div>
                  </div>
                </div>
                <button className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-black uppercase tracking-[0.25em] text-xs hover:bg-black transition-all">
                  Generate Comprehensive Audit
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* User Detail Drawer - Spacious full height right panel */}
      {selectedUser && (
        <>
          <div className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity" onClick={() => setSelectedUserId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-10 border-b border-gray-50 bg-gray-900 text-white">
              <div className="flex justify-between items-start mb-10">
                <div className="w-20 h-20 rounded-[1.5rem] bg-emerald-500 flex items-center justify-center text-white font-black text-3xl shadow-xl">
                  {selectedUser.name.substring(0, 2).toUpperCase()}
                </div>
                <button onClick={() => setSelectedUserId(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white transition-all">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <h2 className="text-4xl font-black tracking-tight mb-2">{selectedUser.name}</h2>
              <p className="text-white/50 font-bold text-lg mb-8">{selectedUser.email}</p>
              <div className="flex items-center gap-4">
                <div className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20">Identity Active</div>
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">ID: {selectedUser.id}</span>
              </div>
            </div>

            <div className="p-10 space-y-12 flex-1">
              <div className="grid grid-cols-2 gap-6">
                <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Account Lifecycle</p>
                  <p className="text-sm font-bold text-gray-900">Created {new Date(selectedUser.createdAt).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-400 font-medium mt-1">Session v{selectedUser.sessionVersion}</p>
                </div>
                <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Access Status</p>
                  <select 
                    value={selectedUser.status}
                    onChange={(e) => void handleStatusChange(selectedUser.id, e.target.value)}
                    className="w-full bg-white border-gray-200 rounded-xl py-2 px-3 text-sm font-black uppercase tracking-widest text-gray-900 focus:ring-emerald-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-6 border-b border-gray-100 pb-4">Privilege Mapping</h3>
                <div className="grid gap-3">
                  {modules.map((m) => {
                    const hasAcc = selectedUser.modules.some(x => x.id === m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          const next = toggleId(m.id, selectedUser.modules.map(x => x.id));
                          setUsers(users.map(u => u.id === selectedUser.id ? { ...u, modules: buildModuleAssignments(next, modules) } : u));
                        }}
                        className={`w-full flex items-center justify-between p-5 rounded-[1.5rem] border transition-all ${
                          hasAcc ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100 hover:bg-gray-50'
                        }`}
                      >
                        <div className="text-left">
                          <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">{m.category}</p>
                          <p className="text-sm font-black text-gray-900">{m.name}</p>
                        </div>
                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                          hasAcc ? 'bg-emerald-600 border-emerald-600 shadow-lg shadow-emerald-200' : 'border-gray-200'
                        }`}>
                          {hasAcc && <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-10 sticky bottom-0 bg-white border-t border-gray-100 flex flex-col gap-4">
              <button 
                onClick={() => void handleAccessSave(selectedUser.id, selectedUser.roles.map(r => r.id), selectedUser.modules.map(m => m.id))}
                className="w-full py-5 bg-emerald-600 text-white rounded-[2rem] font-black uppercase tracking-[0.25em] text-xs hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100"
              >
                Synchronize Identity
              </button>
              <button 
                onClick={() => void handleDeleteUser(selectedUser.id)}
                disabled={selectedUser.id === currentUserId}
                className="w-full py-4 text-rose-500 font-black uppercase tracking-[0.2em] text-[10px] hover:bg-rose-50 rounded-2xl transition-all disabled:opacity-20"
              >
                Revoke Credentials
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl p-12 animate-in zoom-in-95 duration-300 flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-10 shrink-0">
              <div>
                <h2 className="text-3xl font-black text-gray-900 tracking-tight">Identity Deployment</h2>
                <p className="text-sm text-gray-500 font-medium mt-1">Configure new system access credentials</p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <form onSubmit={handleCreateUser} className="space-y-8 overflow-y-auto pr-4 custom-scrollbar">
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Full Identity Name</label>
                  <input
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="w-full px-6 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Secure Email Hub</label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    className="w-full px-6 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">System Password</label>
                  <input
                    type="password"
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    className="w-full px-6 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Operational State</label>
                  <select
                    value={createForm.status}
                    onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
                    className="w-full px-6 py-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-4 block">Primary System Roles</label>
                <div className="grid grid-cols-2 gap-4">
                  {roles.map((r) => {
                    const chk = createForm.roleIds.includes(r.id);
                    return (
                      <label key={r.id} className={`flex items-center gap-4 p-5 rounded-[1.5rem] border cursor-pointer transition-all ${
                        chk ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-transparent hover:bg-gray-100'
                      }`}>
                        <input
                          type="checkbox"
                          checked={chk}
                          onChange={() => setCreateForm({ ...createForm, roleIds: toggleId(r.id, createForm.roleIds) })}
                          className="w-5 h-5 rounded-lg border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <p className="text-xs font-black text-gray-900 uppercase tracking-widest">{r.name}</p>
                          <p className="text-[10px] text-gray-500 font-medium line-clamp-1">{r.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-6 shrink-0">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-black uppercase tracking-[0.25em] text-xs hover:bg-black transition-all shadow-2xl shadow-gray-200 disabled:opacity-60"
                >
                  {isSubmitting ? 'Deploying...' : 'Initiate Deployment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
      `}</style>
    </div>
  );
}
