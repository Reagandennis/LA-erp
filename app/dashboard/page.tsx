import Link from 'next/link';
import { redirect } from 'next/navigation';

import LogoutButton from '@/app/ui/logout-button';
import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { getAccessibleModulesForUser, userHasRole } from '@/lib/user';

export default async function DashboardPage() {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const accessibleModules = await getAccessibleModulesForUser(auth.user);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">LA-ERP</h1>
            <p className="text-sm text-gray-600">Dashboard</p>
          </div>
          <LogoutButton />
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
          <section className="lg:col-span-2 bg-white rounded-lg shadow p-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome back, {auth.user.name}
            </h2>
            <p className="text-gray-600 mb-6">
              Your dashboard now reflects only the modules you are allowed to use.
            </p>

            <div className="space-y-6">
              <div>
                <p className="text-sm text-gray-600 uppercase tracking-wide">Email</p>
                <p className="text-lg font-medium text-gray-900">{auth.user.email}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 uppercase tracking-wide">Account status</p>
                <p className="text-lg font-medium text-gray-900 capitalize">
                  {auth.user.status}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 uppercase tracking-wide">Access model</p>
                <p className="text-lg font-medium text-gray-900">
                  {isAdmin
                    ? 'Administrator access across all modules'
                    : 'Restricted to assigned modules only'}
                </p>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg shadow p-8">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Quick stats</h3>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Assigned roles</p>
                <p className="text-2xl font-bold text-emerald-600">
                  {auth.user.roles.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Effective permissions</p>
                <p className="text-2xl font-bold text-blue-600">
                  {auth.user.permissions.length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Accessible modules</p>
                <p className="text-2xl font-bold text-slate-900">
                  {accessibleModules.length}
                </p>
              </div>
            </div>
          </section>
        </div>

        <section className="bg-white rounded-lg shadow p-8">
          <div className="flex items-center justify-between gap-4 mb-6 flex-col sm:flex-row">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Your modules</h3>
              <p className="text-gray-600 mt-1">
                Open only the workspaces you have been granted access to.
              </p>
            </div>
            {isAdmin && (
              <Link
                href="/admin"
                className="px-5 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
              >
                Manage user access
              </Link>
            )}
          </div>

          {accessibleModules.length > 0 ? (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {accessibleModules.map((module) => (
                <Link
                  key={module.id}
                  href={`/modules/${module.slug}`}
                  className="rounded-2xl border border-gray-200 p-5 hover:border-emerald-400 hover:shadow-md transition-all bg-gradient-to-br from-white to-gray-50"
                >
                  <p className="text-xs uppercase tracking-[0.22em] text-gray-500 mb-3">
                    {module.category}
                  </p>
                  <h4 className="text-lg font-bold text-gray-900">{module.name}</h4>
                  <p className="text-sm text-gray-600 mt-2 leading-6">
                    {module.description}
                  </p>
                  <p className="text-sm text-emerald-700 mt-4 font-medium">
                    Open module
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center">
              <h4 className="text-lg font-bold text-gray-900">No modules assigned yet</h4>
              <p className="text-gray-600 mt-2">
                Ask an administrator to grant access to one or more dashboard modules.
              </p>
            </div>
          )}
        </section>

        {isAdmin && (
          <section className="mt-8 bg-gradient-to-r from-slate-900 to-slate-800 rounded-lg shadow p-8 text-white">
            <div className="flex items-center justify-between gap-4 flex-col sm:flex-row">
              <div>
                <h3 className="text-xl font-bold mb-1">Administrator access</h3>
                <p className="text-slate-300">
                  Suspend accounts, deactivate users, and assign several modules at once.
                </p>
              </div>
              <Link
                href="/admin"
                className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
              >
                Open admin workspace
              </Link>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
