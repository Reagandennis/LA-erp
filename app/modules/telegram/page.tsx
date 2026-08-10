import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import MessagingConsole from '../_components/messaging-console';

export const dynamic = 'force-dynamic';

export default async function TelegramPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'telegram')) {
    redirect('/dashboard');
  }

  return (
    <MessagingConsole
      config={{
        service: 'telegram',
        title: 'Telegram',
        subtitle: 'Bot conversations & groups',
        searchPlaceholder: 'Search chats & groups…',
        connectionNoun: 'Bot',
      }}
    />
  );
}
