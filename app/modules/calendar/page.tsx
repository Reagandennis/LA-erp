import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listEvents } from '@/lib/calendar';

import CalendarClient from './calendar-client';

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const events = await listEvents(auth.user.id, from, to);

  return <CalendarClient initialEvents={events} />;
}
