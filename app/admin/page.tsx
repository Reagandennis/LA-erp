import { redirect } from 'next/navigation';

import AdminClient from './admin-client';
import type { AdminTab } from './_components/admin-types';
import { getAdminOverview, listActiveSessions } from '@/lib/admin-console';
import { queryAuditLogs } from '@/lib/audit';
import { getServerAuth } from '@/lib/auth';
import { isEmailConfigured } from '@/lib/email';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listAllModules, listManagedUsers, listRolesForAdmin, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';

const TABS: AdminTab[] = ['overview', 'users', 'roles', 'sessions', 'audit', 'settings'];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  if (!userHasRole(auth.user, ADMIN_ROLE_NAME)) {
    redirect('/dashboard');
  }

  const [{ tab }, users, roles, modules, audit, overview, sessions] = await Promise.all([
    searchParams,
    listManagedUsers(),
    listRolesForAdmin(),
    listAllModules(),
    queryAuditLogs({ page: 1, pageSize: 25 }),
    getAdminOverview(),
    listActiveSessions(auth.sessionId),
  ]);
  const requested = (Array.isArray(tab) ? tab[0] : tab) as AdminTab | undefined;

  return (
    <AdminClient
      currentUserId={auth.user.id}
      initialTab={requested && TABS.includes(requested) ? requested : 'overview'}
      initialUsers={users}
      initialRoles={roles}
      initialModules={modules}
      initialAudit={audit}
      initialOverview={overview}
      initialSessions={sessions}
      emailConfigured={isEmailConfigured()}
      renderedAt={overview.generatedAt}
    />
  );
}
