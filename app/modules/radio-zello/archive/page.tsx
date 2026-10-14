import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ArchiveClient from './archive-client';

export const dynamic = 'force-dynamic';

export default async function RadioArchivePage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'radio-zello')) redirect('/dashboard');

  const network = (process.env.ZELLO_NETWORK ?? '').trim();
  const retentionDays = Number(process.env.ZELLO_RETENTION_DAYS) || 120;

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <Link href="/modules/radio-zello" className="text-xs font-medium text-gray-400 hover:text-gray-700">
            ← Back to the console
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-primary sm:text-3xl">Radio archive</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every voice transmission and text message captured on your Zello channels, with recordings and transcripts.
            Traffic is kept for {retentionDays} days.
          </p>
        </header>
        <ArchiveClient defaultNetwork={network} />
      </div>
    </div>
  );
}
