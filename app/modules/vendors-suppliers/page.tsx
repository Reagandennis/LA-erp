import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';
import { getVendorRegister, listCatalogServices } from '@/lib/vendors';

import VendorsClient from './vendors-client';

export const dynamic = 'force-dynamic';

export default async function VendorsSuppliersPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'vendors-suppliers')) {
    redirect('/dashboard');
  }

  const [register, catalog] = await Promise.all([getVendorRegister(), listCatalogServices()]);

  return <VendorsClient initialRegister={register} catalog={catalog} />;
}
