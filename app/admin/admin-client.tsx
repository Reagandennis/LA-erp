'use client';

import { useCallback, useEffect, useState } from 'react';

import { useBanner } from '@/app/ui/banner';

import { adminFetch, errorMessage } from './_components/admin-api';
import type {
  AdminModule,
  AdminOverview,
  AdminRole,
  AdminSession,
  AdminTab,
  AdminUser,
  AuditQueryResult,
  UserQuickFilter,
} from './_components/admin-types';
import AuditPanel from './_components/audit-panel';
import CreateUserModal from './_components/create-user-modal';
import OverviewPanel from './_components/overview-panel';
import RolesPanel from './_components/roles-panel';
import SessionsPanel from './_components/sessions-panel';
import SettingsPanel from './_components/settings-panel';
import UserDrawer from './_components/user-drawer';
import UsersPanel, { QUICK_FILTERS } from './_components/users-panel';

interface AdminClientProps {
  currentUserId: number;
  initialTab: AdminTab;
  initialUsers: AdminUser[];
  initialRoles: AdminRole[];
  initialModules: AdminModule[];
  initialAudit: AuditQueryResult;
  initialOverview: AdminOverview;
  initialSessions: AdminSession[];
  emailConfigured: boolean;
  /** Server render time, so relative times match during hydration. */
  renderedAt: string;
}

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'audit', label: 'Audit log' },
  { id: 'settings', label: 'Settings' },
];

type Notice = { error?: string; success?: string };

export default function AdminClient({
  currentUserId,
  initialTab,
  initialUsers,
  initialRoles,
  initialModules,
  initialAudit,
  initialOverview,
  initialSessions,
  emailConfigured,
  renderedAt,
}: AdminClientProps) {
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [users, setUsers] = useState(initialUsers);
  const [roles, setRoles] = useState(initialRoles);
  const [modules, setModules] = useState(initialModules);
  const [overview, setOverview] = useState(initialOverview);
  const [sessions, setSessions] = useState(initialSessions);
  const [recentAudit, setRecentAudit] = useState(initialAudit);
  const [quickFilter, setQuickFilter] = useState<UserQuickFilter | null>(null);
  const [auditAction, setAuditAction] = useState('');
  const [openUserId, setOpenUserId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const banner = useBanner();
  const [now, setNow] = useState(() => Date.parse(renderedAt));

  // Relative times ("5 min ago") start from the server's clock so the first
  // client render matches the HTML, then follow the real clock.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  /** Outcomes go through the app-wide banner, like every other module. */
  const notify = useCallback(
    (message: Notice) => {
      if (message.error) banner.error(message.error);
      else if (message.success) banner.success(message.success);
    },
    [banner],
  );

  const showTab = useCallback((next: AdminTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }, []);

  const navigate = (next: AdminTab, filter?: string) => {
    if (next === 'users') setQuickFilter(filter && filter in QUICK_FILTERS ? (filter as UserQuickFilter) : null);
    if (next === 'audit') setAuditAction(filter ?? '');
    showTab(next);
  };

  // --- Loading ---------------------------------------------------------------

  const reloadUsers = useCallback(async () => {
    const payload = await adminFetch<{ users: AdminUser[]; roles: AdminRole[]; modules: AdminModule[] }>('/api/admin/users');
    setUsers(payload.users);
    setRoles(payload.roles);
    setModules(payload.modules);
  }, []);

  const reloadOverview = useCallback(async () => {
    const [ov, audit] = await Promise.all([
      adminFetch<{ overview: AdminOverview }>('/api/admin/overview'),
      adminFetch<AuditQueryResult>('/api/admin/audit?page=1&pageSize=25'),
    ]);
    setOverview(ov.overview);
    setRecentAudit(audit);
  }, []);

  const reloadSessions = useCallback(async () => {
    const payload = await adminFetch<{ sessions: AdminSession[] }>('/api/admin/sessions');
    setSessions(payload.sessions);
  }, []);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([reloadUsers(), reloadOverview(), reloadSessions()]);
    } catch (err) {
      notify({ error: errorMessage(err, 'Refresh failed.') });
    } finally {
      setRefreshing(false);
    }
  };

  /** After a change to people or roles: everything that counts them may move. */
  const afterChange = useCallback(async () => {
    await Promise.all([reloadUsers(), reloadOverview(), reloadSessions()]).catch(() => {});
  }, [reloadUsers, reloadOverview, reloadSessions]);

  // --- Sessions ---------------------------------------------------------------

  const revokeSession = async (sessionId: string) => {
    try {
      const payload = await adminFetch<{ sessions: AdminSession[] }>(`/api/admin/sessions?id=${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      });
      setSessions(payload.sessions);
      notify({ success: 'Session signed out.' });
      void reloadUsers().catch(() => {});
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not sign that session out.') });
    }
  };

  const revokeAll = async (userId: number) => {
    const person = users.find((u) => u.id === userId);
    const self = userId === currentUserId;
    if (!window.confirm(self ? 'Sign out all your other devices?' : `Sign ${person?.name ?? 'this person'} out on every device?`)) return;
    try {
      const payload = await adminFetch<{ sessions: AdminSession[]; revoked: number }>(`/api/admin/sessions?userId=${userId}`, {
        method: 'DELETE',
      });
      setSessions(payload.sessions);
      notify({ success: `Signed out of ${payload.revoked} session${payload.revoked === 1 ? '' : 's'}.` });
      void reloadUsers().catch(() => {});
    } catch (err) {
      notify({ error: errorMessage(err, 'Could not sign them out.') });
    }
  };

  const openUser = users.find((u) => u.id === openUserId) ?? null;
  const counts: Partial<Record<AdminTab, number>> = { users: users.length, roles: roles.length, sessions: sessions.length };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white">
        {/* Right padding keeps the floating notification bell off the buttons. */}
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-3 pl-4 pr-20 sm:pl-6 sm:pr-24">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#03458f] text-white">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-gray-900">Admin console</h1>
              <p className="truncate text-xs text-gray-500">People, roles, security and settings</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-600 transition hover:text-[#03458f] disabled:opacity-60"
          >
            <svg className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
        <nav className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Admin sections">
          <div className="flex w-max gap-1 rounded-xl border border-gray-100 bg-white p-1">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                    active ? 'bg-[#03458f] text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                  {counts[t.id] !== undefined && (
                    <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                      {counts[t.id]}
                    </span>
                  )}
                  {t.id === 'overview' && overview.attention.some((a) => a.tone !== 'info') && (
                    <span className={`h-2 w-2 rounded-full ${active ? 'bg-amber-300' : 'bg-amber-500'}`} aria-label="Needs attention" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {tab === 'overview' && (
          <OverviewPanel overview={overview} roles={roles} recent={recentAudit.logs} now={now} onNavigate={navigate} />
        )}
        {tab === 'users' && (
          <UsersPanel
            users={users}
            roles={roles}
            now={now}
            quickFilter={quickFilter}
            onQuickFilterChange={setQuickFilter}
            onOpenUser={setOpenUserId}
            onCreateUser={() => setCreating(true)}
          />
        )}
        {tab === 'roles' && (
          <RolesPanel
            roles={roles}
            modules={modules}
            users={users}
            onRolesChanged={async (next) => {
              setRoles(next);
              await afterChange();
            }}
            onOpenUser={setOpenUserId}
            notify={notify}
          />
        )}
        {tab === 'sessions' && <SessionsPanel sessions={sessions} now={now} onRevoke={revokeSession} onOpenUser={setOpenUserId} />}
        {tab === 'audit' && <AuditPanel key={auditAction} initial={initialAudit} initialAction={auditAction} users={users} />}
        {tab === 'settings' && <SettingsPanel notify={notify} />}
      </main>

      {openUser && (
        <UserDrawer
          key={openUser.id}
          user={openUser}
          roles={roles}
          modules={modules}
          sessions={sessions.filter((s) => s.user.id === openUser.id)}
          currentUserId={currentUserId}
          now={now}
          onClose={() => setOpenUserId(null)}
          onChanged={afterChange}
          onDeleted={async () => {
            setOpenUserId(null);
            await afterChange();
          }}
          onRevokeSession={revokeSession}
          onRevokeAll={revokeAll}
          notify={notify}
        />
      )}

      {creating && (
        <CreateUserModal
          roles={roles}
          emailConfigured={emailConfigured}
          onClose={() => setCreating(false)}
          onCreated={async (userId, message) => {
            setCreating(false);
            notify({ success: message });
            await afterChange();
            showTab('users');
            setOpenUserId(userId);
          }}
        />
      )}
    </div>
  );
}
