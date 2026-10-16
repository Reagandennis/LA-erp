import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import TelegramConsole from './telegram-console';

export const dynamic = 'force-dynamic';

export default async function TelegramPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'telegram')) {
    redirect('/dashboard');
  }

  // Message alerts link here with `?chat=`; the console only ever opens the user's own chats.
  const { chat } = await searchParams;
  return <TelegramConsole initialChatId={(Array.isArray(chat) ? chat[0] : chat) ?? null} />;
}
