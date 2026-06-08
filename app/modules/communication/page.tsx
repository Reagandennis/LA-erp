import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listConversationsForUser, listMessageableUsers } from '@/lib/communication';

import CommunicationClient from './communication-client';

export const dynamic = 'force-dynamic';

export default async function CommunicationPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
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
