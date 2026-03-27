import Link from 'next/link';
import { redirect } from 'next/navigation';

import LogoutButton from '@/app/ui/logout-button';
import { getServerAuth } from '@/lib/auth';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { userHasRole } from '@/lib/user';

export default async function DashboardPage() {
  const auth = await getServerAuth();

  if (!auth) {
    redirect('/auth/login');
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">LA-ERP</h1>
            <p className="text-sm text-gray-600">Dashboard</p>
          </div>
          <LogoutButton />
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
          <section className="rounded-lg bg-white p-8 shadow lg:col-span-2">
            <h2 className="mb-2 text-3xl font-bold text-gray-900">
              Welcome back, {auth.user.name}
            </h2>
            <p className="mb-6 text-gray-600">
              Review your account status, roles, and the permissions active on
              this session.
            </p>

            <div className="space-y-6">
              <div>
                <p className="text-sm uppercase tracking-wide text-gray-600">Email</p>
                <p className="text-lg font-medium text-gray-900">{auth.user.email}</p>
              </div>
              <div>
                <p className="text-sm uppercase tracking-wide text-gray-600">
                  Account status
                </p>
                <p className="text-lg font-medium capitalize text-gray-900">
                  {auth.user.status}
                </p>
              </div>
              <div>
                <p className="text-sm uppercase tracking-wide text-gray-600">
                  Access model
                </p>
                <p className="text-lg font-medium text-gray-900">
                  {isAdmin ? 'Administrator access' : 'Role-based access'}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-lg bg-white p-8 shadow">
            <h3 className="mb-4 text-lg font-bold text-gray-900">Quick stats</h3>
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
            </div>
          </section>
        </div>

        <section className="rounded-lg bg-white p-8 shadow">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Role access</h3>
              <p className="mt-1 text-gray-600">
                Your account can only perform actions granted by your assigned
                roles and permissions.
              </p>
            </div>
            {isAdmin && (
              <Link
                href="/admin"
                className="rounded-lg bg-emerald-600 px-5 py-3 font-medium text-white transition-colors hover:bg-emerald-700"
              >
                Manage user access
              </Link>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-gray-200 p-6">
              <h4 className="text-lg font-bold text-gray-900">Assigned roles</h4>
              {auth.user.roles.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {auth.user.roles.map((role) => (
                    <span
                      key={role.id}
                      className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium capitalize text-emerald-800"
                    >
                      {role.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-600">
                  No roles are currently assigned to this account.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-gray-200 p-6">
              <h4 className="text-lg font-bold text-gray-900">
                Effective permissions
              </h4>
              {auth.user.permissions.length > 0 ? (
                <div className="mt-4 grid gap-2">
                  {auth.user.permissions.map((permission) => (
                    <div
                      key={permission.id}
                      className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2"
                    >
                      <code className="text-sm text-gray-700">{permission.name}</code>
                      <span className="text-xs capitalize text-gray-500">
                        {permission.action}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-600">
                  No permissions are currently active for this account.
                </p>
              )}
            </div>
          </div>
        </section>

        {isAdmin && (
          <section className="mt-8 rounded-lg bg-gradient-to-r from-slate-900 to-slate-800 p-8 text-white shadow">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="mb-1 text-xl font-bold">Administrator access</h3>
                <p className="text-slate-300">
                  Manage users, statuses, roles, and audit visibility from one
                  workspace.
                </p>
              </div>
              <Link
                href="/admin"
                className="rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white transition-colors hover:bg-emerald-700"
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
