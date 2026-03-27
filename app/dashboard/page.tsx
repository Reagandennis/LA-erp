import Link from 'next/link';
import { redirect } from 'next/navigation';
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
    <main className="p-8 lg:p-12 space-y-12 bg-gray-50/50 min-h-full">
      {/* Welcome Section */}
      <section className="relative overflow-hidden bg-primary rounded-3xl p-10 lg:p-16 text-white shadow-2xl">
        <div className="relative z-10 max-w-2xl">
          <h2 className="text-4xl lg:text-6xl font-bold mb-4 tracking-tight leading-tight">
            Welcome back, <br />
            <span className="text-secondary">{auth.user.name}</span>
          </h2>
          <p className="text-white/70 text-lg mb-8 leading-relaxed max-w-lg">
            Your centralized command center for enterprise operations. 
            All your accessible workspaces are ready for you.
          </p>
          <div className="flex flex-wrap gap-4 items-center">
            {isAdmin && (
              <Link
                href="/admin"
                className="px-8 py-4 bg-secondary text-primary rounded-2xl hover:bg-white transition-all font-bold shadow-lg shadow-secondary/20"
              >
                Admin Workspace
              </Link>
            )}
            <div className="px-6 py-4 bg-white/10 rounded-2xl border border-white/20 backdrop-blur-md">
              <span className="text-secondary font-bold mr-2">{accessibleModules.length}</span>
              <span className="text-white/60 font-medium">Workspaces</span>
            </div>
          </div>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-white/5 to-transparent -skew-x-12 transform translate-x-1/4" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-secondary/10 rounded-full blur-3xl" />
      </section>

      {/* Accessible Modules Grid */}
      <section className="space-y-6">
        <div className="flex items-end justify-between px-2">
          <div>
            <h3 className="text-2xl font-bold text-primary">Your Modules</h3>
            <p className="text-gray-500 font-medium mt-1">Quick access to your assigned tools</p>
          </div>
          {isAdmin && (
            <Link href="/admin" className="text-primary font-bold hover:text-secondary transition-colors text-sm flex items-center gap-2">
              Manage Access
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          )}
        </div>

        {accessibleModules.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {accessibleModules.map((module) => (
              <Link
                key={module.id}
                href={`/modules/${module.slug}`}
                className="group relative bg-white rounded-[2rem] p-8 border border-gray-100 hover:border-secondary hover:shadow-2xl hover:shadow-secondary/5 transition-all duration-300"
              >
                <div className="mb-6 flex items-center justify-between">
                  <div className="text-[10px] uppercase font-bold tracking-[0.2em] text-gray-400 bg-gray-50 px-4 py-2 rounded-full group-hover:bg-secondary group-hover:text-primary transition-colors">
                    {module.category}
                  </div>
                  <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-primary group-hover:bg-secondary/10 group-hover:text-secondary transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
                <h4 className="text-xl font-bold text-primary mb-2 group-hover:translate-x-1 transition-transform">{module.name}</h4>
                <p className="text-gray-500 text-sm leading-relaxed mb-6 group-hover:translate-x-1 transition-transform delay-75">
                  {module.description}
                </p>
                <div className="flex items-center text-secondary font-bold text-sm">
                  <span>Open Workspace</span>
                  <svg className="w-4 h-4 ml-2 group-hover:translate-x-2 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-[2.5rem] p-20 text-center border-2 border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-300">
               <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h4 className="text-2xl font-bold text-primary mb-2">No Modules Assigned</h4>
            <p className="text-gray-500 max-w-sm mx-auto">
              Please contact your administrator to grant you access to the required ERP modules.
            </p>
          </div>
        )}
      </section>

      {/* Admin Quick Action (only for admins) */}
      {isAdmin && (
        <section className="bg-gray-900 rounded-[2.5rem] p-12 text-white relative overflow-hidden group hover:shadow-2xl transition-all duration-500">
          <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8">
            <div className="text-center lg:text-left">
              <h3 className="text-3xl font-bold mb-2">Administrative Control</h3>
              <p className="text-white/50 text-lg max-w-xl">
                Manage user permissions, security audits, and system-wide settings across the entire enterprise platform.
              </p>
            </div>
            <Link
              href="/admin"
              className="whitespace-nowrap px-10 py-5 bg-white text-primary rounded-2xl hover:bg-secondary transition-all font-bold text-lg"
            >
              Open Admin Workspace
            </Link>
          </div>
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10 pointer-events-none group-hover:opacity-20 transition-opacity">
            <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" strokeWidth="0.5" />
              </pattern>
              <rect width="100" height="100" fill="url(#grid)" />
            </svg>
          </div>
        </section>
      )}
    </main>
  );
}
