import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listNotes } from '@/lib/notes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import NotesClient from './notes-client';

export const dynamic = 'force-dynamic';

export default async function NotesPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'notes')) {
    redirect('/dashboard');
  }

  const items = await listNotes(auth.user.id);

  return <NotesClient initialItems={items} />;
}
