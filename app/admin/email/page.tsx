import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { getEmailConfigStatus } from '@/lib/email';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasRole } from '@/lib/user';

import EmailSettingsClient from './email-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function EmailSettingsPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME)) redirect('/dashboard');

  const status = getEmailConfigStatus();

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link
            href="/admin"
            className="text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-gray-700"
          >
            ← Admin
          </Link>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight mt-1">Email / SMTP</h1>
          <p className="text-gray-500 mt-1 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
            How the platform sends invoices, quotes, and account emails
          </p>
        </div>
        <EmailSettingsClient status={status} suggestedTo={auth.user.email} />
      </div>
    </div>
  );
}
