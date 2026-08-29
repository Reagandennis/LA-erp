import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import MessagingConsole from '../_components/messaging-console';

export const dynamic = 'force-dynamic';

export default async function SignalPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'signal')) {
    redirect('/dashboard');
  }

  return (
    <MessagingConsole
      config={{
        service: 'signal',
        title: 'Signal',
        subtitle: 'Direct messages & groups',
        searchPlaceholder: 'Search contacts & groups…',
        connectionNoun: 'Linked number',
        newChatPlaceholder: '+254712345678',
      }}
    />
  );
}
