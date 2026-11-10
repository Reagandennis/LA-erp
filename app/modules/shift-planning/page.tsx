import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { currentMonth, myShifts } from '@/lib/shift-planning';
import { SHIFT_MODULE, canManageShifts } from '@/lib/shift-planning-route';
import { userHasModule } from '@/lib/user';

import MyShiftsClient from './my-shifts-client';

export const dynamic = 'force-dynamic';

/**
 * What staff see: their own published shifts. Admins and schedulers also get
 * an "Everyone" tab; building and changing the roster lives in Shift Planning
 * Admin.
 */
export default async function ShiftPlanningPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const canManage = canManageShifts(auth.user);
  if (!canManage && !userHasModule(auth.user, SHIFT_MODULE)) {
    redirect('/dashboard');
  }

  const initial = await myShifts(auth.user.id, await currentMonth());
  return <MyShiftsClient initial={initial} canManage={canManage} userName={auth.user.name} />;
}
