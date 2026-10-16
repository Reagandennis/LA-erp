import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';
import { listEvents } from '@/lib/calendar';

import CalendarClient from './calendar-client';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }
  // Only people given the module may use it (Admin → Users), like every other module.
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'calendar')) {
    redirect('/dashboard');
  }

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const events = await listEvents(auth.user.id, from, to);

  return <CalendarClient initialEvents={events} />;
}
