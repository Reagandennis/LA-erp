import { redirect } from 'next/navigation';

import AdminClient, {
  type AdminAuditLog,
  type AdminModule,
  type AdminRole,
  type AdminUser,
} from './admin-client';
import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import {
  getRecentAuditLogs,
  listAllModules,
  listManagedUsers,
  listRolesWithPermissions,
  userHasRole,
} from '@/lib/user';

export default async function AdminPage() {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  if (!userHasRole(auth.user, ADMIN_ROLE_NAME)) {
    redirect('/dashboard');
  }

  const [users, roles, modules, logs] = await Promise.all([
    listManagedUsers(),
    listRolesWithPermissions(),
    listAllModules(),
    getRecentAuditLogs(30),
  ]);

  return (
    <AdminClient
      currentUserId={auth.user.id}
      initialUsers={users as AdminUser[]}
      initialRoles={roles as AdminRole[]}
      initialModules={modules as AdminModule[]}
      initialLogs={logs as AdminAuditLog[]}
    />
  );
}
