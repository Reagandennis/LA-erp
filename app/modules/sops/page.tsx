import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { getSopStats, listSops } from '@/lib/sops';
import { userHasModule, userHasRole } from '@/lib/user';

import SopsClient from './sops-client';

export const dynamic = 'force-dynamic';

export default async function SopsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'sops')) {
    redirect('/dashboard');
  }

  // Global search deep-links straight onto a procedure (?open=<id>).
  const { open } = await searchParams;
  const openId = Number(Array.isArray(open) ? open[0] : open);

  const [items, stats] = await Promise.all([listSops(auth.user.id), getSopStats()]);

  return (
    <SopsClient
      currentUser={{ id: auth.user.id, name: auth.user.name }}
      isAdmin={isAdmin}
      initialItems={items}
      initialStats={stats}
      initialOpenId={Number.isInteger(openId) && openId > 0 ? openId : null}
    />
  );
}
