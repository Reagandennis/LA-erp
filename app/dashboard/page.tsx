import Link from 'next/link';
import { redirect } from 'next/navigation';

import Sidebar from '@/app/ui/sidebar';
import YellowHeader from '@/app/ui/yellow-header';
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
    <div className="flex h-screen bg-white font-sans text-slate-900">
      <Sidebar isAdmin={isAdmin} userName={auth.user.name} userEmail={auth.user.email} />

      <main className="flex flex-1 flex-col overflow-hidden bg-slate-50/50">
        <YellowHeader userName={auth.user.name} />

        {/* Dashboard Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Team Dashboard <span className="ml-1 text-slate-400 cursor-help text-base">❓</span></h2>
                <p className="mt-1 text-sm text-slate-500 font-medium">Overview of your current projects and system metrics.</p>
              </div>
              <div className="flex items-center gap-3">
                <button className="rounded-md border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-700">
                  ⚙️
                </button>
                <button className="rounded-md border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-700">
                  ➕
                </button>
              </div>
            </div>

            {/* Widget Grid */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Stats Widget */}
              <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Completion Rate</h3>
                  <span className="text-slate-300">❓</span>
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <div className="relative flex h-48 w-48 items-center justify-center">
                    <svg className="h-full w-full" viewBox="0 0 100 100">
                      <circle className="stroke-slate-100" strokeWidth="8" fill="transparent" r="40" cx="50" cy="50" />
                      <circle className="stroke-emerald-500 transition-all duration-1000" strokeWidth="8" strokeDasharray="251.2" strokeDashoffset="168.3" strokeLinecap="round" fill="transparent" r="40" cx="50" cy="50" />
                    </svg>
                    <span className="absolute text-4xl font-black text-slate-800 tracking-tight">33%</span>
                  </div>
                </div>
              </div>

              {/* Achievements Widget */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-2xl shadow-sm border border-emerald-100">🤖</div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-800">AI Generate Guru</h4>
                    <p className="mt-0.5 truncate text-[13px] text-slate-500 font-medium">Use the Document Generator 2 more times to unlock.</p>
                    <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100">
                      <div className="h-full w-[80%] rounded-full bg-emerald-500 shadow-sm" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-2xl shadow-sm border border-blue-100">👣</div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-800">Step Master</h4>
                    <p className="mt-0.5 truncate text-[13px] text-slate-500 font-medium">Create 12 more steps to unlock.</p>
                    <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100">
                      <div className="h-full w-[40%] rounded-full bg-blue-500 shadow-sm" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Add Widget Placeholder */}
              <div className="flex items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 transition-all hover:border-emerald-300 hover:bg-emerald-50/20 group cursor-pointer">
                <div className="text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm border border-slate-200 group-hover:text-emerald-500 group-hover:border-emerald-200">➕</div>
                  <p className="text-sm font-bold text-slate-500 group-hover:text-emerald-700">Add Widget</p>
                </div>
              </div>

              {/* Recently Viewed */}
              <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Recently Viewed</h3>
                  <span className="text-slate-300">❓</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="group cursor-pointer rounded-lg border border-slate-100 bg-slate-50/30 p-4 transition-all hover:bg-white hover:shadow-sm hover:border-emerald-200">
                    <div className="mb-3 flex items-start justify-between">
                      <h5 className="font-bold text-slate-800 group-hover:text-emerald-700">Waybook Essentials</h5>
                      <span className="text-slate-400 opacity-50">📄</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
                      <span>🥗</span> UNDERSTANDING WAYBOOK
                    </div>
                  </div>
                  <div className="group cursor-pointer rounded-lg border border-slate-100 bg-slate-50/30 p-4 transition-all hover:bg-white hover:shadow-sm hover:border-emerald-200">
                    <div className="mb-3 flex items-start justify-between">
                      <h5 className="font-bold text-slate-800 group-hover:text-emerald-700">Vehicle Refueling Policy</h5>
                      <span className="text-slate-400 opacity-50">📄</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase">
                      <span>💰</span> SOC Finance
                    </div>
                  </div>
                </div>
              </div>

              {/* Notifications Widget */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Notifications (4 Unread)</h3>
                  <span className="text-slate-300">❓</span>
                </div>
                <div className="space-y-4">
                  <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50/30 p-3 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400">12:08 PM on 2 March 2026</span>
                      <span className="text-[10px] font-bold text-emerald-600 uppercase">Unread</span>
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-800">You unlocked a new achievement: Login Leader</p>
                    <p className="mt-1 text-[11px] text-slate-500 font-medium">You used Waybook every week for 4 weeks.</p>
                  </div>
                  <div className="rounded-lg border-l-4 border-slate-300 bg-slate-50/30 p-3 border border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400">6:15 PM on 25 February 2026</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Unread</span>
                    </div>
                    <p className="mt-2 text-xs font-bold text-slate-800">New comment on: Vehicle Policy</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating AI Action Button */}
        <div className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-purple-600 text-2xl text-white shadow-2xl transition-all hover:scale-110 hover:bg-purple-700 cursor-pointer border-4 border-white/20">
          ✨
        </div>
      </main>
    </div>
  );
}
