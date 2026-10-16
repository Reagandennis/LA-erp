import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';
import { computeStats, listFiles, listShareableUsers } from '@/lib/files';

import FileUploadClient from './file-upload-client';

export const dynamic = 'force-dynamic';

export default async function FileUploadPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }
  // Only people given the module may use it (Admin → Users), like every other module.
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'file-upload')) {
    redirect('/dashboard');
  }

  const [items, users] = await Promise.all([
    listFiles(auth.user.id),
    listShareableUsers(auth.user.id),
  ]);

  return (
    <FileUploadClient
      viewer={{ id: auth.user.id, name: auth.user.name }}
      initialItems={items}
      initialStats={computeStats(items)}
      shareableUsers={users}
    />
  );
}
