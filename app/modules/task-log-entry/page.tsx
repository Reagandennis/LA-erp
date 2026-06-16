import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listTaskLogEntries } from '@/lib/task-log';
import { userHasModule, userHasRole } from '@/lib/user';

import TaskLogClient from './task-log-client';

export const dynamic = 'force-dynamic';

export default async function TaskLogEntryPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'task-log-entry')) {
    redirect('/dashboard');
  }

  const entries = await listTaskLogEntries({ userId: auth.user.id, isAdmin });

  return <TaskLogClient entries={entries} isAdmin={isAdmin} />;
}
