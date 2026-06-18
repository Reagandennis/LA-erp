import { redirect } from 'next/navigation';

import AdminClient, {
  type AdminModule,
  type AdminRole,
  type AdminUser,
} from './admin-client';
import { getServerAuth } from '@/lib/auth';
import { queryAuditLogs } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import {
  listAllModules,
  listManagedUsers,
  listRolesWithPermissions,
  userHasRole,
} from '@/lib/user';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  if (!userHasRole(auth.user, ADMIN_ROLE_NAME)) {
    redirect('/dashboard');
  }

  const [users, roles, modules, audit] = await Promise.all([
    listManagedUsers(),
    listRolesWithPermissions(),
    listAllModules(),
    queryAuditLogs({ page: 1, pageSize: 25 }),
  ]);

  return (
    <AdminClient
      currentUserId={auth.user.id}
      initialUsers={users as AdminUser[]}
      initialRoles={roles as AdminRole[]}
      initialModules={modules as AdminModule[]}
      initialAudit={audit}
    />
  );
}
