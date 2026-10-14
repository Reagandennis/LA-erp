'use client';

import { APP_LOCALE } from '@/lib/locale';
import Link from 'next/link';
import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AuditLogEntry, AuditQueryResult } from '@/lib/audit';
import LogoutButton from '@/app/ui/logout-button';
import { AvatarStatus, StatusDot, presenceOf, usePresence } from '@/app/ui/status-dot';

const BRAND = '#03458f';

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

interface AdminClientProps {
  currentUserId: number;
  initialUsers: AdminUser[];
  initialRoles: AdminRole[];
  initialModules: AdminModule[];
  initialAudit: AuditQueryResult;
}

type AuditFilterState = {
  q: string;
  action: string;
  entityType: string;
  actorId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
};

const EMPTY_AUDIT_FILTERS: AuditFilterState = {
  q: '', action: '', entityType: '', actorId: '', from: '', to: '', page: 1, pageSize: 25,
};

const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

async function parseJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; users?: AdminUser[]; roles?: AdminRole[]; modules?: AdminModule[]; user?: AdminUser; limits?: UploadLimits }
    | null;
  if (!response.ok) throw new Error(payload?.error || 'Request failed');
  return payload;
}

const UPLOAD_LIMIT_FIELDS = [
  { key: 'fileMb', label: 'Files & attachments', description: 'File manager uploads and task attachments' },
  { key: 'photoMb', label: 'Photos', description: 'Personnel, contact, and fleet photos' },
  { key: 'documentMb', label: 'Documents', description: 'Contract and driver licence documents' },
  { key: 'audioMb', label: 'Radio audio', description: 'Zello recordings and transcription clips' },
  { key: 'logoMb', label: 'Logos', description: 'Organization and quote brand logos' },
] as const;

type UploadLimitKey = (typeof UPLOAD_LIMIT_FIELDS)[number]['key'];
type UploadLimits = Record<UploadLimitKey, number>;
type UploadLimitsDraft = Record<UploadLimitKey, string>;

function toLimitsDraft(limits: UploadLimits): UploadLimitsDraft {
  return {
    fileMb: String(limits.fileMb),
    photoMb: String(limits.photoMb),
    documentMb: String(limits.documentMb),
    audioMb: String(limits.audioMb),
    logoMb: String(limits.logoMb),
  };
}

function parseLimitMb(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

function toggleId(id: number, selectedIds: number[]): number[] {
  return selectedIds.includes(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id];
}

function buildModuleAssignments(moduleIds: number[], modules: AdminModule[]) {
  return modules.filter((m) => moduleIds.includes(m.id)).sort((a, b) => a.sortOrder - b.sortOrder);
}

function userStatusStyle(status: string) {
  switch (status) {
    case 'active': return 'bg-green-50 text-green-700 border-green-100';
    case 'suspended': return 'bg-amber-50 text-amber-700 border-amber-100';
    default: return 'bg-gray-50 text-gray-500 border-gray-200';
  }
}

function buildAuditQuery(f: AuditFilterState): string {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set('q', f.q.trim());
  if (f.action) sp.set('action', f.action);
  if (f.entityType) sp.set('entityType', f.entityType);
  if (f.actorId) sp.set('actorId', f.actorId);
  if (f.from) sp.set('from', f.from);
  if (f.to) sp.set('to', f.to);
  sp.set('page', String(f.page));
  sp.set('pageSize', String(f.pageSize));
  return sp.toString();
}

export default function AdminClient({
  currentUserId,
  initialUsers,
  initialRoles,
  initialModules,
  initialAudit,
}: AdminClientProps) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>(initialUsers);
  const [roles, setRoles] = useState<AdminRole[]>(initialRoles);
  const [modules, setModules] = useState<AdminModule[]>(initialModules);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'roles' | 'audit' | 'settings'>('overview');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [createForm, setCreateForm] = useState({
    name: '', email: '', password: '', status: 'active',
    roleIds: initialRoles.filter((r) => r.name === 'viewer').map((r) => r.id),
    moduleIds: [] as number[],
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const [passwordDraft, setPasswordDraft] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Reset the password field when a different user is selected (adjusted
  // during render so the stale draft never paints).
  const [passwordDraftUserId, setPasswordDraftUserId] = useState(selectedUserId);
  if (passwordDraftUserId !== selectedUserId) {
    setPasswordDraftUserId(selectedUserId);
    setPasswordDraft('');
  }

  const [limitsDraft, setLimitsDraft] = useState<UploadLimitsDraft | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);
  const [limitsSaving, setLimitsSaving] = useState(false);

  // Fetched on demand when the settings tab opens (an event, not an effect).
  const loadUploadLimits = () => {
    if (limitsDraft || limitsLoading) return;
    setLimitsLoading(true);
    fetch('/api/admin/upload-limits', { credentials: 'include' })
      .then(parseJson)
      .then((payload) => {
        if (payload?.limits) setLimitsDraft(toLimitsDraft(payload.limits));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load upload limits'))
      .finally(() => setLimitsLoading(false));
  };

  const openTab = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'settings') loadUploadLimits();
  };

  // --- Audit state ---------------------------------------------------------
  const [audit, setAudit] = useState<AuditQueryResult>(initialAudit);
  const [auditFilters, setAuditFilters] = useState<AuditFilterState>(EMPTY_AUDIT_FILTERS);
  const [auditLoading, setAuditLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const auditLoadedOnce = useRef(false);

  const selectedUser = users.find((u) => u.id === selectedUserId) ?? null;
  const filteredUsers = users.filter(
    (u) => u.name.toLowerCase().includes(searchTerm.toLowerCase()) || u.email.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const fetchAudit = useCallback(async (filters: AuditFilterState) => {
    setAuditLoading(true);
    try {
      const res = await fetch(`/api/admin/audit?${buildAuditQuery(filters)}`, { credentials: 'include' });
      if (res.ok) setAudit((await res.json()) as AuditQueryResult);
    } catch {
      /* keep current data */
    } finally {
      setAuditLoading(false);
    }
  }, []);

  // Re-query audit when filters change (debounced) once the tab has been opened.
  useEffect(() => {
    if (activeTab !== 'audit') return;
    if (!auditLoadedOnce.current) {
      auditLoadedOnce.current = true;
      // First open with default filters → initialAudit already covers it.
      const isDefault = JSON.stringify(auditFilters) === JSON.stringify(EMPTY_AUDIT_FILTERS);
      if (isDefault) return;
    }
    const t = setTimeout(() => void fetchAudit(auditFilters), 250);
    return () => clearTimeout(t);
  }, [activeTab, auditFilters, fetchAudit]);

  const setFilter = (patch: Partial<AuditFilterState>) =>
    setAuditFilters((f) => ({ ...f, page: 1, ...patch }));

  const resetAuditFilters = () => setAuditFilters(EMPTY_AUDIT_FILTERS);

  const exportAuditCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/audit?${buildAuditQuery({ ...auditFilters, page: 1, pageSize: 1000 })}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as AuditQueryResult;
      const header = ['Timestamp', 'Action', 'Entity type', 'Entity id', 'Actor', 'Target', 'IP', 'User agent', 'Metadata'];
      const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = data.logs.map((l) => [
        new Date(l.createdAt).toISOString(),
        l.action,
        l.entityType,
        l.entityId ?? '',
        l.actor ? `${l.actor.name} <${l.actor.email}>` : '',
        l.target ? `${l.target.name} <${l.target.email}>` : '',
        l.ipAddress ?? '',
        l.userAgent ?? '',
        l.metadata ? JSON.stringify(l.metadata) : '',
      ].map(escape).join(','));
      const csv = [header.map(escape).join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // --- User management (unchanged logic) -----------------------------------

  const syncData = async () => {
    setIsSyncing(true);
    try {
      const usersRes = await fetch('/api/admin/users', { credentials: 'include' });
      const uPayload = await parseJson(usersRes);
      setUsers(uPayload?.users || []);
      setRoles(uPayload?.roles || []);
      setModules(uPayload?.modules || []);
      if (activeTab === 'audit') await fetchAudit(auditFilters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(createForm),
      });
      const payload = await parseJson(res);
      if (payload?.user) {
        setUsers([payload.user as AdminUser, ...users]);
        setShowCreateModal(false);
        setSuccess('User created successfully.');
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
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ status }),
      });
      const payload = await parseJson(res);
      if (payload?.user) {
        setUsers(users.map((u) => (u.id === userId ? (payload.user as AdminUser) : u)));
        setSuccess('Status updated.');
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
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ roleIds: rIds, moduleIds: mIds }),
      });
      const payload = await parseJson(res);
      if (payload?.user) {
        setUsers(users.map((u) => (u.id === userId ? (payload.user as AdminUser) : u)));
        setSuccess('Access updated.');
        if (userId === currentUserId) startTransition(() => router.refresh());
        await syncData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handlePasswordReset = async (userId: number) => {
    setError(''); setSuccess(''); setIsResettingPassword(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/password`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ password: passwordDraft }),
      });
      const payload = await parseJson(res);
      if (payload?.user) {
        setUsers(users.map((u) => (u.id === userId ? (payload.user as AdminUser) : u)));
        setPasswordDraft('');
        setSuccess(
          userId === currentUserId
            ? 'Your password was changed. Other sessions were signed out.'
            : 'Password reset. The user was signed out of all sessions.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleSaveUploadLimits = async () => {
    if (!limitsDraft) return;
    const parsed = {
      fileMb: parseLimitMb(limitsDraft.fileMb),
      photoMb: parseLimitMb(limitsDraft.photoMb),
      documentMb: parseLimitMb(limitsDraft.documentMb),
      audioMb: parseLimitMb(limitsDraft.audioMb),
      logoMb: parseLimitMb(limitsDraft.logoMb),
    };
    if (Object.values(parsed).some((v) => v === null)) {
      setError('Upload limits must be whole numbers between 1 and 100 MB.');
      return;
    }
    setError(''); setSuccess(''); setLimitsSaving(true);
    try {
      const res = await fetch('/api/admin/upload-limits', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(parsed),
      });
      const payload = await parseJson(res);
      if (payload?.limits) {
        setLimitsDraft(toLimitsDraft(payload.limits));
        setSuccess('Upload limits saved.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save upload limits');
    } finally {
      setLimitsSaving(false);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!globalThis.confirm('Delete this user account? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', credentials: 'include' });
      await parseJson(res);
      setUsers(users.filter((u) => u.id !== userId));
      setSelectedUserId(null);
      setSuccess('User deleted.');
      await syncData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const adminCount = users.filter((u) => u.roles.some((r) => r.name === 'admin')).length;
  const suspendedCount = users.filter((u) => u.status === 'suspended').length;
  const presence = usePresence();

  const TABS = ['overview', 'users', 'roles', 'audit', 'settings'] as const;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="max-w-[1500px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: BRAND }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900">Admin console</h1>
              <p className="text-xs text-gray-400">Users, roles & audit</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void syncData()} disabled={isSyncing} className="px-3 py-2 bg-gray-50 text-gray-600 hover:text-[#03458f] rounded-xl font-medium text-sm transition-colors flex items-center gap-2 border border-gray-100 disabled:opacity-60">
              <svg className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isSyncing ? 'Syncing…' : 'Sync'}
            </button>
            <Link href="/admin/email" className="px-3 py-2 text-gray-500 hover:text-gray-900 font-medium text-sm rounded-xl hover:bg-gray-50">Email</Link>
            <Link href="/admin/organization" className="px-3 py-2 text-gray-500 hover:text-gray-900 font-medium text-sm rounded-xl hover:bg-gray-50">Organization</Link>
            <Link href="/dashboard" className="px-3 py-2 text-gray-500 hover:text-gray-900 font-medium text-sm rounded-xl hover:bg-gray-50">Dashboard</Link>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto p-6 lg:p-8">
        {(error || success) && (
          <div className={`mb-6 p-3.5 rounded-xl border flex items-center gap-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
            <span className={`w-2 h-2 rounded-full ${error ? 'bg-rose-500' : 'bg-green-500'}`} />
            <p className="font-medium">{error || success}</p>
            <button onClick={() => { setError(''); setSuccess(''); }} className="ml-auto p-1 hover:bg-black/5 rounded">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-white border border-gray-100 p-1 rounded-xl w-fit mb-8">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => openTab(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${activeTab === tab ? 'text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              style={activeTab === tab ? { backgroundColor: BRAND } : undefined}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Total users', value: users.length },
                { label: 'Admins', value: adminCount },
                { label: 'Suspended', value: suspendedCount },
                { label: 'Audit events', value: audit.total },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-100 p-4">
                  <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                  <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Recent activity</h3>
                <div className="space-y-2">
                  {audit.logs.slice(0, 6).map((l) => (
                    <div key={l.id} className="flex items-center gap-3 text-sm">
                      <code className="text-xs font-medium text-[#03458f] bg-blue-50 px-1.5 py-0.5 rounded shrink-0">{l.action}</code>
                      <span className="text-gray-500 truncate">{l.actor?.email ?? 'system'}</span>
                      <span className="text-xs text-gray-400 ml-auto shrink-0">{new Date(l.createdAt).toLocaleString(APP_LOCALE)}</span>
                    </div>
                  ))}
                  {audit.logs.length === 0 && <p className="text-sm text-gray-400">No activity yet.</p>}
                </div>
                <button onClick={() => setActiveTab('audit')} className="mt-4 text-sm font-semibold text-[#03458f] hover:underline">View full audit log →</button>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">System health</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400 mb-1">Database</p>
                    <p className="text-sm font-semibold text-green-700 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" /> Online</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-400 mb-1">Audit pipeline</p>
                    <p className="text-sm font-semibold text-green-700 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" /> Operational</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="text" placeholder="Search users…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30" />
              </div>
              <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: BRAND }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                New user
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredUsers.map((u) => (
                <button key={u.id} onClick={() => setSelectedUserId(u.id)} className="text-left bg-white p-5 rounded-2xl border border-gray-100 hover:border-[#03458f]/40 hover:shadow-sm transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <AvatarStatus variant={presenceOf(presence, u.id)}>
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-semibold" style={{ backgroundColor: BRAND }}>
                        {u.name.substring(0, 2).toUpperCase()}
                      </div>
                    </AvatarStatus>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${userStatusStyle(u.status)}`}>{u.status}</span>
                      <StatusDot variant={presenceOf(presence, u.id)} size="sm" showLabel />
                    </div>
                  </div>
                  <h3 className="font-semibold text-gray-900 truncate">{u.name}</h3>
                  <p className="text-xs text-gray-400 truncate mt-0.5 mb-3">{u.email}</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {u.roles.map((r) => <span key={r.id} className="text-xs px-2 py-0.5 bg-gray-50 text-gray-500 rounded-md border border-gray-100">{r.name}</span>)}
                  </div>
                  <p className="text-xs text-gray-400 pt-3 border-t border-gray-50">{u.modules.length} module{u.modules.length === 1 ? '' : 's'}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Roles */}
        {activeTab === 'roles' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((r) => (
              <div key={r.id} className="bg-white p-6 rounded-2xl border border-gray-100">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-semibold text-gray-900 capitalize">{r.name}</h3>
                  <span className="text-xs text-gray-400">{r.permissions.length} perms</span>
                </div>
                <p className="text-sm text-gray-500 mb-4">{r.description}</p>
                <div className="space-y-1.5">
                  {r.permissions.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                      <code className="text-xs text-gray-700">{p.name}</code>
                      <span className="text-xs text-gray-400">{p.action}</span>
                    </div>
                  ))}
                  {r.permissions.length > 6 && <p className="text-xs text-gray-400 text-center pt-1">+{r.permissions.length - 6} more</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Audit — fully functional */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            {/* Filter bar */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="text" placeholder="Search action, entity, user, IP…" value={auditFilters.q} onChange={(e) => setFilter({ q: e.target.value })} className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#03458f]/30" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                <select value={auditFilters.action} onChange={(e) => setFilter({ action: e.target.value })} className={inputClass}>
                  <option value="">All actions</option>
                  {audit.facets.actions.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <select value={auditFilters.entityType} onChange={(e) => setFilter({ entityType: e.target.value })} className={inputClass}>
                  <option value="">All entities</option>
                  {audit.facets.entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={auditFilters.actorId} onChange={(e) => setFilter({ actorId: e.target.value })} className={inputClass}>
                  <option value="">All actors</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <input type="date" value={auditFilters.from} onChange={(e) => setFilter({ from: e.target.value })} className={inputClass} title="From date" />
                <input type="date" value={auditFilters.to} onChange={(e) => setFilter({ to: e.target.value })} className={inputClass} title="To date" />
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-gray-400">
                  {auditLoading ? 'Loading…' : `${audit.total} event${audit.total === 1 ? '' : 's'}`}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={resetAuditFilters} className="px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700">Reset</button>
                  <button onClick={() => void exportAuditCsv()} disabled={exporting || audit.total === 0} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {exporting ? 'Exporting…' : 'Export CSV'}
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {audit.logs.length === 0 ? (
                <div className="p-16 text-center">
                  <p className="text-gray-900 font-medium">No matching events</p>
                  <p className="text-sm text-gray-500 mt-1">Adjust the filters above.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {audit.logs.map((log) => (
                    <button key={log.id} onClick={() => setSelectedLog(log)} className="w-full text-left px-5 py-3.5 hover:bg-gray-50 transition-colors flex items-center gap-4">
                      <code className="text-xs font-medium text-[#03458f] bg-blue-50 px-2 py-1 rounded shrink-0">{log.action}</code>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-900 truncate">
                          <span className="font-medium">{log.actor?.name ?? 'System'}</span>
                          <span className="text-gray-400"> · {log.entityType}</span>
                          {log.target && <span className="text-gray-500"> → {log.target.name}</span>}
                          {!log.target && log.entityId && <span className="text-gray-400"> #{log.entityId}</span>}
                        </p>
                      </div>
                      {log.ipAddress && <span className="hidden md:block text-xs text-gray-400 shrink-0">{log.ipAddress}</span>}
                      <span className="text-xs text-gray-400 shrink-0 w-36 text-right">{new Date(log.createdAt).toLocaleString(APP_LOCALE)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span>Rows</span>
                <select value={auditFilters.pageSize} onChange={(e) => setFilter({ pageSize: Number(e.target.value) })} className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-sm">
                  {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">Page {audit.page} of {audit.totalPages}</span>
                <button disabled={audit.page <= 1 || auditLoading} onClick={() => setAuditFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Prev</button>
                <button disabled={audit.page >= audit.totalPages || auditLoading} onClick={() => setAuditFilters((f) => ({ ...f, page: f.page + 1 }))} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Next</button>
              </div>
            </div>
          </div>
        )}

        {/* Settings */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl">
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-1">Upload limits</h3>
              <p className="text-sm text-gray-500 mb-5">
                Maximum size per uploaded file, in megabytes (1–100). Changes apply immediately for all users.
              </p>
              {!limitsDraft ? (
                <p className="text-sm text-gray-400">{limitsLoading ? 'Loading…' : 'Upload limits could not be loaded.'}</p>
              ) : (
                <div className="space-y-3">
                  {UPLOAD_LIMIT_FIELDS.map((field) => (
                    <div key={field.key} className="flex items-center justify-between gap-4 p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{field.label}</p>
                        <p className="text-xs text-gray-400">{field.description}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={limitsDraft[field.key]}
                          onChange={(e) => setLimitsDraft({ ...limitsDraft, [field.key]: e.target.value })}
                          className={`w-20 px-3 py-2 bg-white border rounded-lg text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 ${parseLimitMb(limitsDraft[field.key]) === null ? 'border-rose-300' : 'border-gray-200'}`}
                        />
                        <span className="text-xs text-gray-400 w-7">MB</span>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={() => void handleSaveUploadLimits()}
                    disabled={limitsSaving || UPLOAD_LIMIT_FIELDS.some((f) => parseLimitMb(limitsDraft[f.key]) === null)}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                    style={{ backgroundColor: BRAND }}
                  >
                    {limitsSaving ? 'Saving…' : 'Save limits'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Audit detail drawer */}
      {selectedLog && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40" onClick={() => setSelectedLog(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">Event detail</h2>
              <button onClick={() => setSelectedLog(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <code className="text-sm font-medium text-[#03458f] bg-blue-50 px-2 py-1 rounded">{selectedLog.action}</code>
              </div>
              <DetailRow label="Entity type" value={selectedLog.entityType} />
              <DetailRow label="Entity id" value={selectedLog.entityId ?? '—'} />
              <DetailRow label="Actor" value={selectedLog.actor ? `${selectedLog.actor.name} (${selectedLog.actor.email})` : 'System'} />
              <DetailRow label="Target" value={selectedLog.target ? `${selectedLog.target.name} (${selectedLog.target.email})` : '—'} />
              <DetailRow label="When" value={new Date(selectedLog.createdAt).toLocaleString(APP_LOCALE)} />
              <DetailRow label="IP address" value={selectedLog.ipAddress ?? '—'} />
              <div>
                <p className="text-xs text-gray-400 mb-1">User agent</p>
                <p className="text-sm text-gray-700 break-words">{selectedLog.userAgent ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Metadata</p>
                {selectedLog.metadata ? (
                  <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
                ) : (
                  <p className="text-sm text-gray-400">—</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* User detail drawer */}
      {selectedUser && (
        <>
          <div className="fixed inset-0 bg-gray-900/20 backdrop-blur-sm z-40" onClick={() => setSelectedUserId(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-lg font-semibold text-gray-900">User details</h2>
              <button onClick={() => setSelectedUserId(null)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 flex-1 space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-semibold text-xl" style={{ backgroundColor: BRAND }}>
                  {selectedUser.name.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold text-gray-900 truncate">{selectedUser.name}</h3>
                  <p className="text-sm text-gray-500 truncate">{selectedUser.email}</p>
                  <p className="text-xs text-gray-400 mt-1">ID {selectedUser.id} · session v{selectedUser.sessionVersion}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl border border-gray-100 p-3.5">
                  <p className="text-xs text-gray-400 mb-1">Created</p>
                  <p className="text-sm font-medium text-gray-900">{new Date(selectedUser.createdAt).toLocaleDateString(APP_LOCALE)}</p>
                </div>
                <div className="bg-gray-50 rounded-xl border border-gray-100 p-3.5">
                  <p className="text-xs text-gray-400 mb-1.5">Status</p>
                  <select value={selectedUser.status} onChange={(e) => void handleStatusChange(selectedUser.id, e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg py-1.5 px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Module access</h3>
                <div className="grid gap-2">
                  {modules.map((m) => {
                    const hasAcc = selectedUser.modules.some((x) => x.id === m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          const next = toggleId(m.id, selectedUser.modules.map((x) => x.id));
                          setUsers(users.map((u) => (u.id === selectedUser.id ? { ...u, modules: buildModuleAssignments(next, modules) } : u)));
                        }}
                        className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-colors ${hasAcc ? 'bg-blue-50 border-[#03458f]/30' : 'bg-white border-gray-100 hover:bg-gray-50'}`}
                      >
                        <div className="text-left">
                          <p className="text-xs text-gray-400">{m.category}</p>
                          <p className="text-sm font-medium text-gray-900">{m.name}</p>
                        </div>
                        <span className={`w-5 h-5 rounded-full border flex items-center justify-center ${hasAcc ? 'border-transparent text-white' : 'border-gray-200'}`} style={hasAcc ? { backgroundColor: BRAND } : undefined}>
                          {hasAcc && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Reset password</h3>
                <div className="space-y-2">
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="New password"
                    value={passwordDraft}
                    onChange={(e) => setPasswordDraft(e.target.value)}
                    className={inputClass}
                  />
                  <button
                    onClick={() => void handlePasswordReset(selectedUser.id)}
                    disabled={
                      isResettingPassword ||
                      passwordDraft.length < 8 ||
                      !/[A-Za-z]/.test(passwordDraft) ||
                      !/\d/.test(passwordDraft)
                    }
                    className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {isResettingPassword ? 'Resetting…' : 'Reset password'}
                  </button>
                  <p className="text-xs text-gray-400">
                    At least 8 characters with a letter and a number.{' '}
                    {selectedUser.id === currentUserId
                      ? 'Your other sessions will be signed out; this one stays active.'
                      : 'The user will be signed out of all sessions.'}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-gray-100 sticky bottom-0 bg-white flex flex-col gap-2">
              <button onClick={() => void handleAccessSave(selectedUser.id, selectedUser.roles.map((r) => r.id), selectedUser.modules.map((m) => m.id))} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: BRAND }}>
                Save access
              </button>
              <button onClick={() => void handleDeleteUser(selectedUser.id)} disabled={selectedUser.id === currentUserId} className="w-full py-2.5 text-rose-500 font-semibold text-sm hover:text-rose-600 disabled:opacity-30">
                Delete user
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create user modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-900/30 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">New user</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Name</label>
                  <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Email</label>
                  <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className={inputClass} required />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Password</label>
                  <input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Status</label>
                  <select value={createForm.status} onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })} className={inputClass}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block">Roles</label>
                <div className="grid grid-cols-2 gap-2">
                  {roles.map((r) => {
                    const chk = createForm.roleIds.includes(r.id);
                    return (
                      <label key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${chk ? 'bg-blue-50 border-[#03458f]/30' : 'bg-gray-50 border-transparent hover:bg-gray-100'}`}>
                        <input type="checkbox" checked={chk} onChange={() => setCreateForm({ ...createForm, roleIds: toggleId(r.id, createForm.roleIds) })} className="w-4 h-4 rounded accent-[#03458f]" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 capitalize">{r.name}</p>
                          <p className="text-xs text-gray-500 truncate">{r.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm disabled:opacity-60" style={{ backgroundColor: BRAND }}>
                  {isSubmitting ? 'Creating…' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-50">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right break-words">{value}</span>
    </div>
  );
}
