'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import LogoutButton from './logout-button';

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Productivity: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  Communication: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  ),
  Planning: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Operations: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  ),
  Workforce: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  Procurement: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  ),
  Files: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  Automation: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  Fleet: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  ),
  Compliance: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  Sales: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Finance: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  ),
  Insights: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  Time: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Tools: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};

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
                    {CATEGORY_ICONS[category] || (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                      </svg>
                    )}
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

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </aside>
  );
}
