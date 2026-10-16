import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { getFeedbackStats, listFeedback } from '@/lib/feedback';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import FeedbackClient from './feedback-client';

export const dynamic = 'force-dynamic';

export default async function FeedbackPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }
  // Only people given the module may use it (Admin → Users), like every other module.
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'feedback')) {
    redirect('/dashboard');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);

  const [items, stats] = await Promise.all([
    listFeedback(auth.user.id),
    getFeedbackStats(),
  ]);

  return (
    <FeedbackClient
      currentUser={{ id: auth.user.id, name: auth.user.name }}
      isAdmin={isAdmin}
      initialItems={items}
      initialStats={stats}
    />
  );
}
