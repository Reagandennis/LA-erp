import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { adminOverview, currentMonth } from '@/lib/shift-planning';
import { canManageShifts } from '@/lib/shift-planning-route';

import AdminClient from './admin-client';

export const dynamic = 'force-dynamic';

/**
 * The roster's back office: admins, and anyone granted this module as a
 * scheduler. Staff never reach it; they read their shifts in Shift Planning.
 */
export default async function ShiftPlanningAdminPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');
  if (!canManageShifts(auth.user)) redirect('/dashboard');

  const initial = await adminOverview(await currentMonth());
  return <AdminClient initial={initial} />;
}
