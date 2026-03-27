'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const MODULE_CATEGORIES = [
  {
    name: 'Planning & Tasks',
    items: [
      { name: 'To-do List Personal', slug: 'todo-personal', icon: '📝' },
      { name: 'To-do List Group', slug: 'todo-group', icon: '👥' },
      { name: 'Task List', slug: 'task-list', icon: '📋' },
      { name: 'Task Log - Entry', slug: 'task-log', icon: '✍️' },
      { name: 'Calendar', slug: 'calendar', icon: '🗓️' },
      { name: 'Countdown Timer', slug: 'countdown', icon: '⏳' },
      { name: 'Upcoming Due Dates', slug: 'due-dates', icon: '🔔' },
    ],
  },
  {
    name: 'Directory & Resources',
    items: [
      { name: 'Personnel', slug: 'personnel', icon: '🧑‍💼' },
      { name: 'Vendors/Suppliers', slug: 'vendors', icon: '📦' },
      { name: 'Contact List', slug: 'contacts', icon: '📖' },
      { name: 'Vehicles', slug: 'vehicles', icon: '🚛' },
      { name: 'Access to SOPs', slug: 'sops', icon: '📜' },
      { name: 'Storage / Google Drive', slug: 'storage', icon: '📁' },
    ],
  },
  {
    name: 'Communication',
    items: [
      { name: 'WhatsApp', slug: 'whatsapp', icon: '💬' },
      { name: 'Phone', slug: 'phone', icon: '📞' },
      { name: 'Radio/Zello API', slug: 'radio', icon: '📻' },
      { name: 'Bulletin Board', slug: 'bulletin-board', icon: '📌' },
      { name: 'Feedback', slug: 'feedback', icon: '💭' },
    ],
  },
  {
    name: 'Operations',
    items: [
      { name: 'Map', slug: 'map', icon: '🗺️' },
      { name: 'File Upload', slug: 'file-upload', icon: '📤' },
      { name: 'AI Chatbot', slug: 'ai-chatbot', icon: '🤖' },
      { name: 'Flight Tracker', slug: 'flight-tracker', icon: '✈️' },
      { name: 'Weather', slug: 'weather', icon: '🌦️' },
      { name: 'Clock-in/out', slug: 'attendance', icon: '🕒' },
      { name: 'Clock', slug: 'clock', icon: '⌚' },
    ],
  },
  {
    name: 'Business & Finance',
    items: [
      { name: 'Accounts', slug: 'accounts', icon: '💰' },
      { name: 'Quotes', slug: 'quotes', icon: '📝' },
      { name: 'Products/Services', slug: 'products', icon: '🛒' },
      { name: 'Reports', slug: 'reports', icon: '📊' },
      { name: 'KPIs', slug: 'kpis', icon: '📈' },
    ],
  },
];

export default function Sidebar({ isAdmin, userName, userEmail }: { isAdmin: boolean, userName: string, userEmail: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col border-r border-slate-200 bg-slate-50 h-screen sticky top-0">
      <div className="flex items-center gap-2 border-b border-slate-200 px-6 py-4 bg-white">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-600 text-[10px] font-bold text-white shadow-sm">
          LA
        </div>
        <Link href="/dashboard" className="font-bold tracking-tight text-slate-800 hover:text-emerald-600 transition-colors">
          LA-ERP
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-6">
        <div>
          <Link
            href="/dashboard"
            className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-all ${
              pathname === '/dashboard' ? 'bg-white text-emerald-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-white hover:text-emerald-600'
            }`}
          >
            <span className="text-lg">🏠</span>
            Team Dashboard
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className={`mt-1 flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-all ${
                pathname === '/admin' ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-white hover:text-blue-600'
              }`}
            >
              <span className="text-lg">🛡️</span>
              Admin Console
            </Link>
          )}
        </div>

        {MODULE_CATEGORIES.map((category) => (
          <div key={category.name}>
            <h3 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {category.name}
            </h3>
            <div className="space-y-0.5">
              {category.items.map((item) => {
                const href = `/modules/${item.slug}`;
                const isActive = pathname === href;
                return (
                  <Link
                    key={item.slug}
                    href={href}
                    className={`flex items-center gap-3 rounded px-3 py-1.5 text-[13px] font-medium transition-all ${
                      isActive ? 'bg-white text-emerald-700 shadow-sm border border-slate-200' : 'text-slate-600 hover:bg-white hover:text-emerald-600'
                    }`}
                  >
                    <span className="text-base grayscale opacity-70 group-hover:grayscale-0 group-hover:opacity-100">{item.icon}</span>
                    <span className="truncate">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 bg-white p-4 mt-auto">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 border border-emerald-200 shadow-sm">
            {userName[0]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-slate-800">{userName}</p>
            <p className="truncate text-[10px] text-slate-500">{userEmail}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
