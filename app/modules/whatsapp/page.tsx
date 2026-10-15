import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import MessagingConsole from '../_components/messaging-console';

export const dynamic = 'force-dynamic';

export default async function WhatsappPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'whatsapp')) {
    redirect('/dashboard');
  }

  // The console checks the id against the user's own accounts on every request.
  const { account } = await searchParams;
  const accountId = Number(Array.isArray(account) ? account[0] : account);

  return (
    <MessagingConsole
      initialAccountId={Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null}
      config={{
        service: 'whatsapp',
        title: 'WhatsApp',
        subtitle: 'Client & group conversations',
        searchPlaceholder: 'Search chats & groups…',
        connectionNoun: 'Account',
        newChatPlaceholder: '+254712345678',
        multiAccount: true,
      }}
    />
  );
}
