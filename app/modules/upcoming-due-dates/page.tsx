import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeBuckets, listUpcomingDueDates } from '@/lib/due-dates';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import DueDatesClient from './due-dates-client';

export const dynamic = 'force-dynamic';

export default async function UpcomingDueDatesPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'upcoming-due-dates')) {
    redirect('/dashboard');
  }

  const items = await listUpcomingDueDates(auth.user.id);

  return <DueDatesClient initialItems={items} initialBuckets={computeBuckets(items)} />;
}
