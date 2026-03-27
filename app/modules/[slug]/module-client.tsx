'use client';

import Sidebar, { MODULE_CATEGORIES } from '@/app/ui/sidebar';
import YellowHeader from '@/app/ui/yellow-header';

interface ModuleClientProps {
  slug: string;
  isAdmin: boolean;
  userName: string;
  userEmail: string;
}

export default function ModuleClient({ slug, isAdmin, userName, userEmail }: ModuleClientProps) {
  // Find module info
  const moduleInfo = MODULE_CATEGORIES.flatMap(c => c.items).find(i => i.slug === slug);
  const moduleName = moduleInfo?.name || slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');

  return (
    <div className="flex h-screen bg-white font-sans text-slate-900">
      <Sidebar isAdmin={isAdmin} userName={userName} userEmail={userEmail} />

      <main className="flex flex-1 flex-col overflow-hidden">
        <YellowHeader userName={userName} />

        {/* Module Toolbar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-6 bg-slate-50/50">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold flex items-center gap-2 text-slate-700">
              <span className="text-lg grayscale opacity-70">{moduleInfo?.icon}</span>
              {moduleName}
            </h2>
            <div className="h-3 w-[1px] bg-slate-300" />
            <div className="relative">
              <input
                type="text"
                placeholder={`Search ${moduleName.toLowerCase()}...`}
                className="w-48 rounded border border-slate-200 bg-white px-3 py-0.5 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
             <button className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-800">
              Filter
            </button>
            <button className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 shadow-sm transition-all active:scale-95">
              + Add Record
            </button>
          </div>
        </header>

        {/* Content Area - Specific UIs based on slug */}
        <div className="flex-1 overflow-auto bg-white relative">
          {renderModuleUI(slug, moduleName, userName)}
        </div>

        {/* Pagination Footer */}
        <footer className="flex h-11 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-6">
          <div className="flex items-center gap-4 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
            <span>1 - 50 of 248 records</span>
          </div>
          <div className="flex items-center gap-1">
            <button className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all">
              ◀
            </button>
            <div className="flex gap-1 px-2">
              <button className="h-7 px-2 rounded bg-emerald-600 text-[11px] font-bold text-white shadow-sm transition-all active:scale-95">1</button>
              <button className="h-7 px-2 rounded border border-transparent text-[11px] font-bold text-slate-500 hover:bg-slate-50 transition-all active:scale-95">2</button>
              <button className="h-7 px-2 rounded border border-transparent text-[11px] font-bold text-slate-500 hover:bg-slate-50 transition-all active:scale-95">3</button>
              <span className="text-slate-300 px-1 text-[11px]">...</span>
              <button className="h-7 px-2 rounded border border-transparent text-[11px] font-bold text-slate-500 hover:bg-slate-50 transition-all active:scale-95">5</button>
            </div>
            <button className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all">
              ▶
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}

function renderModuleUI(slug: string, name: string, userName: string) {
  // Planning & Tasks Table View
  if (['todo-personal', 'todo-group', 'task-list', 'task-log'].includes(slug)) {
    return (
      <table className="w-full border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white text-slate-500 border-b border-slate-200 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
          <tr>
            <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] border-r border-slate-100 last:border-0">Task Name</th>
            <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] border-r border-slate-100 last:border-0">Priority</th>
            <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] border-r border-slate-100 last:border-0">Category</th>
            <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] border-r border-slate-100 last:border-0">Due Date</th>
            <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px]">Assignee</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => (
            <tr key={i} className="hover:bg-emerald-50/30 group cursor-pointer transition-colors">
              <td className="px-6 py-3 border-r border-slate-100 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="h-4 w-4 rounded border border-slate-300 group-hover:border-emerald-500 transition-colors shadow-sm"></div>
                  <span className="font-bold text-slate-800">Complete system audit for {name} session {i}</span>
                </div>
              </td>
              <td className="px-6 py-3 border-r border-slate-100 last:border-0">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase border shadow-sm ${
                  i % 3 === 0 ? 'bg-red-50 text-red-600 border-red-100' : 
                  i % 3 === 1 ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                  'bg-blue-50 text-blue-600 border-blue-100'
                }`}>
                  {i % 3 === 0 ? 'High' : i % 3 === 1 ? 'Medium' : 'Low'}
                </span>
              </td>
              <td className="px-6 py-3 text-slate-500 font-medium border-r border-slate-100 last:border-0">
                {i % 2 === 0 ? 'Operations' : 'Finance'}
              </td>
              <td className="px-6 py-3 text-slate-500 border-r border-slate-100 last:border-0">
                Mar {27 + i}, 2026
              </td>
              <td className="px-6 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-700 border border-emerald-100 shadow-sm">
                    {userName[0]}
                  </div>
                  <span className="text-xs font-medium text-slate-600">{userName}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Data-heavy modules (Airtable Style)
  if (['whatsapp', 'phone', 'radio', 'ai-chatbot'].includes(slug)) {
    return (
      <div className="flex h-full flex-col bg-white">
        <div className="flex-1 overflow-auto p-6 space-y-4">
           <div className="max-w-[80%] rounded-2xl bg-slate-100 p-4 mr-auto">
            <p className="text-sm text-slate-700">Hello! This is the automated {name} interface. How can I assist you today?</p>
            <span className="mt-1 text-[10px] font-bold text-slate-400">System • 09:41 AM</span>
          </div>
          <div className="max-w-[80%] rounded-2xl bg-emerald-600 p-4 ml-auto text-white shadow-md shadow-emerald-200">
            <p className="text-sm">I need to check the status of the current vehicle refueling policy.</p>
            <span className="mt-1 text-[10px] font-bold text-emerald-200">You • 09:42 AM</span>
          </div>
        </div>
        <div className="border-t border-slate-200 p-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
             <input type="text" placeholder="Type a message..." className="flex-1 bg-transparent text-sm outline-none" />
             <button className="text-xl">📤</button>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard/Report modules
  if (['reports', 'kpis', 'due-dates', 'attendance'].includes(slug)) {
     return (
      <div className="p-8">
        <div className="grid grid-cols-4 gap-6 mb-8">
           {[1, 2, 3, 4].map(i => (
             <div key={i} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">Metric {i}</p>
                <p className="mt-2 text-3xl font-black text-slate-800">1,234</p>
                <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase italic">
                  <span>▲</span> 12% Growth
                </div>
             </div>
           ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm h-64 flex items-center justify-center">
           <p className="text-slate-400 font-bold italic">Interactive Data Visualization Chart Placeholder</p>
        </div>
      </div>
    );
  }

  // Fallback for others (Calendar, Map, etc.)
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="text-center">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-white text-5xl shadow-2xl shadow-emerald-100 border border-emerald-50 group transition-all hover:scale-110">
           {MODULE_CATEGORIES.flatMap(c => c.items).find(i => i.slug === slug)?.icon || '🏢'}
        </div>
        <h3 className="text-2xl font-black text-slate-800">{name}</h3>
        <p className="mt-2 text-slate-500 font-medium max-w-md">This is a realistic UI placeholder for the {name} module. Integrating live system components...</p>
        <div className="mt-8 flex justify-center gap-4">
           <button className="rounded-full bg-slate-900 px-6 py-2 text-xs font-bold text-white shadow-xl transition-all hover:bg-slate-800 active:scale-95">Primary Action</button>
           <button className="rounded-full border border-slate-200 bg-white px-6 py-2 text-xs font-bold text-slate-600 shadow-sm transition-all hover:bg-slate-50 active:scale-95">View Details</button>
        </div>
      </div>
    </div>
  );
}
