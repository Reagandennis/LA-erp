import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { listTemplates } from '@/lib/templates';
import { userHasModule, userHasRole } from '@/lib/user';

import TemplatesClient from './templates-client';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'quotes')) redirect('/dashboard');

  const templates = await listTemplates();

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-10">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <Link href="/modules/quotes" className="text-xs font-medium text-gray-400 hover:text-gray-700">
            ← Back to quotes
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900 mt-1">Quote templates</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Reusable starting points for quotations — build one here, or save one from the quote builder.
          </p>
        </div>
        <TemplatesClient initialTemplates={templates} />
      </div>
    </div>
  );
}
