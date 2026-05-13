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
          <Link
            href="/modules/quotes"
            className="text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-gray-700"
          >
            ← Back to quotes
          </Link>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight mt-1">
            Quote templates
          </h1>
          <p className="text-gray-500 mt-1 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
            Reusable starting points for quotations
          </p>
          <p className="text-sm text-gray-600 mt-3">
            Templates are created from the builder via &quot;Save current setup as a template.&quot; This page
            lets you review and remove existing ones.
          </p>
        </div>
        <TemplatesClient initialTemplates={templates} />
      </div>
    </div>
  );
}
