import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import JarvisClient from './jarvis-client';

export const dynamic = 'force-dynamic';

export default async function AiChatbotPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'ai-chatbot')) {
    redirect('/dashboard');
  }

  return (
    <JarvisClient
      userName={auth.user.name}
      moduleNames={auth.user.modules.map((m) => m.name)}
    />
  );
}
