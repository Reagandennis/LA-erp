import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { computeStats, isConfigured, listAssessments } from '@/lib/intel';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import IntelClient from './intel-client';

export const dynamic = 'force-dynamic';

export default async function IntelPage() {
  const auth = await getServerAuth();
  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'intel')) {
    redirect('/dashboard');
  }

  const assessments = await listAssessments();

  return (
    <IntelClient
      initialData={{ assessments, stats: computeStats(assessments) }}
      configured={isConfigured()}
    />
  );
}
