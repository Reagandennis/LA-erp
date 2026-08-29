import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import MessagingConsole from '../_components/messaging-console';

export const dynamic = 'force-dynamic';

export default async function WhatsappPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'whatsapp')) {
    redirect('/dashboard');
  }

  return (
    <MessagingConsole
      config={{
        service: 'whatsapp',
        title: 'WhatsApp',
        subtitle: 'Client & group conversations',
        searchPlaceholder: 'Search chats & groups…',
        connectionNoun: 'Account',
        newChatPlaceholder: '+254712345678',
      }}
    />
  );
}
