'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import LogoutButton from './logout-button';
import { moduleIcon } from './module-icons';

interface Module {
  id: string | number;
  slug: string;
  name: string;
  category: string;
}

interface User {
  name: string;
  email: string;
}

interface SidebarProps {
  user: User;
  modules: Module[];
}

export default function Sidebar({ user, modules = [] }: SidebarProps) {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Group modules by category
  const groupedModules: Record<string, Module[]> = {};
  for (const m of modules) {
    const cat = m.category || 'Other';
    if (!groupedModules[cat]) {
      groupedModules[cat] = [];
    }
    groupedModules[cat].push(m);
  }

  const isActive = (path: string) => pathname === path;

  return (
    <aside
      className={`bg-secondary h-screen flex flex-col fixed left-0 top-0 overflow-hidden border-r border-primary/10 transition-all duration-300 z-[100] ${
        isCollapsed ? 'w-16' : 'w-72'
      }`}
    >
      {/* Header with Toggle */}
      <div className="p-4 border-b border-primary/5 flex items-center justify-between min-h-[72px]">
        {!isCollapsed && (
          <div className="flex items-center gap-3 animate-in fade-in duration-300">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-secondary font-bold text-sm shrink-0">
              LA
            </div>
            <h1 className="text-primary font-black text-base tracking-tight truncate">LA-ERP</h1>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`p-2 bg-primary/5 hover:bg-primary/10 rounded-lg text-primary transition-all ${isCollapsed ? 'mx-auto' : ''}`}
        >
          {isCollapsed ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          )}
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6 custom-scrollbar scrollbar-hide">
        <div className="space-y-1">
           <Link
            href="/dashboard"
            title={isCollapsed ? "Dashboard" : ""}
            className={`flex items-center gap-3 rounded-lg transition-all font-bold ${
              isCollapsed ? 'justify-center p-2.5' : 'px-3 py-2.5'
            } ${
              isActive('/dashboard')
                ? 'bg-primary text-secondary'
                : 'text-primary/70 hover:bg-primary/5 hover:text-primary'
            }`}
          >
            <div className="w-6 h-6 flex items-center justify-center shrink-0">
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </div>
            {!isCollapsed && <span className="whitespace-nowrap truncate text-sm">Dashboard</span>}
          </Link>
        </div>

        {Object.entries(groupedModules).map(([category, categoryModules]) => (
          <div key={category} className="space-y-1">
            {!isCollapsed ? (
              <h3 className="px-3 text-[10px] font-black text-primary/30 uppercase tracking-[0.2em] mb-2">
                {category}
              </h3>
            ) : (
              <div className="border-t border-primary/10 mx-1 my-3" />
            )}
            {categoryModules.map((module) => {
              const active = isActive(`/modules/${module.slug}`);
              return (
                <Link
                  key={module.id}
                  href={`/modules/${module.slug}`}
                  title={isCollapsed ? module.name : ""}
                  className={`flex items-center gap-3 rounded-lg transition-all text-sm font-bold group ${
                    isCollapsed ? 'justify-center p-2.5' : 'px-3 py-2.5'
                  } ${
                    active
                      ? 'bg-primary text-secondary'
                      : 'text-primary/70 hover:bg-primary/5 hover:text-primary'
                  }`}
                >
                  <div className="w-6 h-6 flex items-center justify-center shrink-0">
                    {moduleIcon(module.slug)}
                  </div>
                  {!isCollapsed && <span className="whitespace-nowrap truncate">{module.name}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Profile/Footer */}
      <div className="p-3 bg-primary/5 border-t border-primary/5">
        <div className={`flex items-center gap-3 py-2 ${isCollapsed ? 'justify-center' : 'px-2'}`}>
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-secondary font-bold text-xs shrink-0 border border-primary/10">
            {user.name.charAt(0)}
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0 animate-in fade-in duration-300">
              <p className="text-xs font-black text-primary truncate leading-tight">{user.name}</p>
              <p className="text-[9px] font-bold text-primary/40 truncate uppercase tracking-tight">{user.email}</p>
            </div>
          )}
        </div>
        <div className={`mt-2 flex ${isCollapsed ? 'justify-center' : 'px-2'}`}>
           <LogoutButton
            variant="ghost"
            className="w-full text-primary/40 hover:text-primary flex items-center justify-center p-2 rounded-lg hover:bg-primary/10 transition-colors"
          />
        </div>
      </div>

    </aside>
  );
}
