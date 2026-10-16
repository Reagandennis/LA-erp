import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

/**
 * Flight tracker renders entirely in the browser, so the module check that other
 * modules make in their page lives here: only people given the module may use it.
 */
export default async function ModuleAccessLayout({ children }: { children: React.ReactNode }) {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'flight-tracker')) redirect('/dashboard');
  return children;
}
