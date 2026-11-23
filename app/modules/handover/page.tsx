import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, listHandovers } from '@/lib/handover';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { groupPeerIds } from '@/lib/user-groups';
import { userHasModule, userHasRole } from '@/lib/user';

import HandoverClient from './handover-client';

export const dynamic = 'force-dynamic';

export default async function HandoverPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'handover')) {
    redirect('/dashboard');
  }

  const [handovers, peers] = await Promise.all([listHandovers(), groupPeerIds(auth.user.id)]);
  // `?handover=<id>` (from the bell) opens the screen on that entry.
  const { handover } = await searchParams;
  const focusId = Number(Array.isArray(handover) ? handover[0] : handover);

  return (
    <HandoverClient
      currentUser={{ id: auth.user.id, name: auth.user.name }}
      isAdmin={isAdmin}
      teamIds={[...peers]}
      initialData={{ handovers, stats: computeStats(handovers) }}
      focusId={Number.isInteger(focusId) && focusId > 0 ? focusId : null}
    />
  );
}
