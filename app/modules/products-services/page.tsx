import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { getOrganizationSettings } from '@/lib/organization';
import { listProducts } from '@/lib/products';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import ProductsClient from './products-client';

export const dynamic = 'force-dynamic';

export default async function ProductsServicesPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'products-services')) {
    redirect('/dashboard');
  }

  const [products, organization] = await Promise.all([
    listProducts({ includeArchived: true }),
    getOrganizationSettings(),
  ]);

  return <ProductsClient initialProducts={products} defaultCurrency={organization.defaultCurrency} />;
}
