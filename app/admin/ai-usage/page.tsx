import Link from 'next/link';
import { redirect } from 'next/navigation';

import { aiUsageOverview } from '@/lib/ai-budget';
import { getServerAuth } from '@/lib/auth';
import { isEmailConfigured } from '@/lib/email';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasRole } from '@/lib/user';

import AiUsageClient from './ai-usage-client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AiUsagePage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME)) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <Link href="/admin?tab=settings" className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700">
            ← Admin
          </Link>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-gray-900 sm:text-3xl">AI usage</h1>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 sm:text-xs">
            What Gemini costs, and the limits that keep it predictable
          </p>
        </div>
        <AiUsageClient initial={await aiUsageOverview()} emailConfigured={isEmailConfigured()} />
      </div>
    </div>
  );
}
