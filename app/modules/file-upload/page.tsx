import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, listFiles, listShareableUsers } from '@/lib/files';

import FileUploadClient from './file-upload-client';

export const dynamic = 'force-dynamic';

export default async function FileUploadPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
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
