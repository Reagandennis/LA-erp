import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import {
  getModuleBySlug,
  userHasModule,
  userHasRole,
} from '@/lib/user';

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const { slug } = await params;
  const featureModule = await getModuleBySlug(slug);

  if (!featureModule) {
    notFound();
  }

  const canAccess =
    userHasRole(auth.user, ADMIN_ROLE_NAME) ||
    userHasModule(auth.user, featureModule.slug);

  if (!canAccess) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-600 mb-1">
              {featureModule.category}
            </p>
            <h1 className="text-2xl font-bold text-gray-900">{featureModule.name}</h1>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-900 text-white rounded-lg font-medium"
          >
            Back to dashboard
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="bg-white rounded-2xl shadow p-8">
            <h2 className="text-3xl font-bold text-gray-900">Module workspace</h2>
            <p className="text-gray-600 mt-3 leading-7">{featureModule.description}</p>

            <div className="mt-8 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-8">
              <p className="text-sm uppercase tracking-[0.24em] text-gray-500 mb-3">
                Ready for implementation
              </p>
              <h3 className="text-xl font-bold text-gray-900">
                This module entry point is now on the platform.
              </h3>
              <p className="text-gray-600 mt-3 leading-7">
                The access control and navigation are active. The next step is to build
                the internal workflow, data model, and screens specific to this module.
              </p>
            </div>
          </section>

          <aside className="bg-slate-900 text-white rounded-2xl shadow p-8">
            <p className="text-sm uppercase tracking-[0.25em] text-emerald-300 mb-3">
              Access summary
            </p>
            <div className="space-y-5">
              <div>
                <p className="text-slate-400 text-sm">Signed in as</p>
                <p className="font-semibold text-lg">{auth.user.name}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Email</p>
                <p className="font-medium">{auth.user.email}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Account status</p>
                <p className="font-medium capitalize">{auth.user.status}</p>
              </div>
              <div>
                <p className="text-slate-400 text-sm">Module category</p>
                <p className="font-medium">{featureModule.category}</p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
