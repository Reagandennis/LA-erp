import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listBrandProfiles } from '@/lib/brand-profiles';
import { getOrganizationSettings } from '@/lib/organization';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasRole } from '@/lib/user';

import QuoteSettingsClient from './quote-settings-client';

export const dynamic = 'force-dynamic';

export default async function QuoteSettingsPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin) redirect('/dashboard');

  const [organization, brandProfiles] = await Promise.all([
    getOrganizationSettings(),
    listBrandProfiles({ includeArchived: true }),
  ]);

  return (
    <QuoteSettingsClient
      initialOrganization={organization}
      initialBrandProfiles={brandProfiles}
    />
  );
}
