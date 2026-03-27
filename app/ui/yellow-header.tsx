'use client';

import LogoutButton from '@/app/ui/logout-button';

interface YellowHeaderProps {
  userName: string;
}

export default function YellowHeader({ userName }: YellowHeaderProps) {
  return (
    <header className="bg-[#EAB308] px-6 py-2 shrink-0">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 rounded-md bg-white/20 px-4 py-1.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-white/30 cursor-pointer group">
            <span className="group-hover:scale-110 transition-transform">📖</span> Knowledge
          </div>
          <div className="flex items-center gap-2 px-2 text-sm font-bold text-white/80 transition-all hover:text-white cursor-pointer group">
            <span className="group-hover:scale-110 transition-transform">🏢</span> Organization
          </div>
          <div className="flex items-center gap-2 px-2 text-sm font-bold text-white/80 transition-all hover:text-white cursor-pointer group">
            <span className="group-hover:scale-110 transition-transform">📊</span> Reporting
          </div>
          <div className="flex items-center gap-2 px-2 text-sm font-bold text-white/80 transition-all hover:text-white cursor-pointer group">
            <span className="group-hover:scale-110 transition-transform">⚙️</span> Settings
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search or ask a question..." 
              className="w-80 rounded-md border-none bg-white/90 px-4 py-1.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:bg-white transition-all"
            />
            <span className="absolute right-3 top-1.5 text-slate-400 opacity-70">🔍</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xl opacity-80 hover:opacity-100 cursor-pointer transition-opacity">📧</span>
            <span className="text-xl opacity-80 hover:opacity-100 cursor-pointer relative transition-opacity group">
              🔔
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm border border-white/20">4</span>
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white shadow-md border border-white/20">
              {userName[0]}
            </div>
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}
