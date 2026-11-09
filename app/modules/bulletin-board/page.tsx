import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, listPosts } from '@/lib/bulletin';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import BulletinClient from './bulletin-client';

export const dynamic = 'force-dynamic';

export default async function BulletinBoardPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'bulletin-board')) {
    redirect('/dashboard');
  }

  const posts = await listPosts(auth.user.id);

  return (
    <BulletinClient
      currentUser={{ id: auth.user.id, name: auth.user.name }}
      isAdmin={isAdmin}
      initialData={{ posts, stats: computeStats(posts) }}
    />
  );
}
