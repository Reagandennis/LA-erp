import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { listProducts } from '@/lib/products';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasModule, userHasRole } from '@/lib/user';

import CatalogClient from './catalog-client';

export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const auth = await getServerAuth();
  if (!auth) redirect('/auth/login');

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'quotes')) redirect('/dashboard');

  const products = await listProducts({ includeArchived: true });

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-10">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Link
              href="/modules/quotes"
              className="text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-gray-700"
            >
              ← Back to quotes
            </Link>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight mt-1">
              Product & service catalog
            </h1>
            <p className="text-gray-500 mt-1 font-bold text-[10px] sm:text-xs uppercase tracking-widest">
              Reusable line items for quotations
            </p>
          </div>
        </div>
        <CatalogClient initialProducts={products} />
      </div>
    </div>
  );
}
