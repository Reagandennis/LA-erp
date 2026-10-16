import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';
import { listConversationsForUser, listMessageableUsers } from '@/lib/communication';

import CommunicationClient from './communication-client';

export const dynamic = 'force-dynamic';

export default async function CommunicationPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }
  // Only people given the module may use it (Admin → Users), like every other module.
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'communication')) {
    redirect('/dashboard');
  }

  const [conversations, users] = await Promise.all([
    listConversationsForUser(auth.user.id),
    listMessageableUsers(auth.user.id),
  ]);

  return (
    <CommunicationClient
      currentUser={{ id: auth.user.id, name: auth.user.name, email: auth.user.email }}
      initialConversations={conversations}
      initialUsers={users}
    />
  );
}
