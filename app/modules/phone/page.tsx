'use client';

import React, { useState } from 'react';

// --- Types ---
type CallType = 'Incoming' | 'Outgoing' | 'Missed';
type PhoneTab = 'Keypad' | 'Recents' | 'Contacts' | 'Voicemail';

interface CallLog {
  id: string;
  name: string;
  number: string;
  type: CallType;
  timestamp: string;
  duration?: string;
  avatar: string;
}

interface PhoneContact {
  id: string;
  name: string;
  number: string;
  role: string;
  avatar: string;
  status: 'Online' | 'Offline';
}

// --- Mock Data ---
const MOCK_CALLS: CallLog[] = [
  { id: 'C1', name: 'Sarah Smith', number: '+1 (555) 123-4567', type: 'Incoming', timestamp: '10:45 AM', duration: '12:04', avatar: 'SS' },
  { id: 'C2', name: 'Michael Ross', number: '+1 (555) 987-6543', type: 'Missed', timestamp: '09:30 AM', avatar: 'MR' },
  { id: 'C3', name: 'Unknown', number: '+44 20 7946 0958', type: 'Outgoing', timestamp: 'Yesterday', duration: '02:15', avatar: '?' },
  { id: 'C4', name: 'Emily Blunt', number: '+1 (555) 246-8135', type: 'Incoming', timestamp: 'Yesterday', duration: '45:20', avatar: 'EB' },
  { id: 'C5', name: 'David Miller', number: '+1 (555) 159-4826', type: 'Missed', timestamp: 'Mon', avatar: 'DM' },
];

const MOCK_CONTACTS: PhoneContact[] = [
  { id: 'P1', name: 'David Miller', number: '+1 (555) 159-4826', role: 'Security Analyst', avatar: 'DM', status: 'Online' },
  { id: 'P2', name: 'Emily Blunt', number: '+1 (555) 246-8135', role: 'Frontend Engineer', avatar: 'EB', status: 'Online' },
  { id: 'P3', name: 'John Doe', number: '+1 (555) 369-1470', role: 'Fleet Manager', avatar: 'JD', status: 'Offline' },
  { id: 'P4', name: 'Michael Ross', number: '+1 (555) 987-6543', role: 'Procurement', avatar: 'MR', status: 'Online' },
  { id: 'P5', name: 'Sarah Smith', number: '+1 (555) 123-4567', role: 'Product Lead', avatar: 'SS', status: 'Online' },
];

export default function PhonePage() {
  const [activeTab, setActiveTab] = useState<PhoneTab>('Keypad');
  const [dialValue, setDialValue] = useState<string>('');
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [activeCallTarget, setActiveCallTarget] = useState<string | null>(null);

  const handleDial = (num: string) => {
    if (dialValue.length < 15) {
      setDialValue(prev => prev + num);
    }
  };

  const handleBackspace = () => {
    setDialValue(prev => prev.slice(0, -1));
  };

  const startCall = (target: string) => {
    setActiveCallTarget(target);
    setIsCalling(true);
  };

  const getAvatarColor = (name: string): string => {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Phone Sidebar Navigation */}
      <div className="w-24 lg:w-32 bg-white border-r border-gray-200 flex flex-col items-center py-10 gap-8">
        <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-200">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </div>

        <nav className="flex flex-col gap-4">
          {(['Keypad', 'Recents', 'Contacts', 'Voicemail'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl transition-all ${
                activeTab === tab ? 'bg-emerald-50 text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              <div className="w-6 h-6">
                {tab === 'Keypad' && <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
                {tab === 'Recents' && <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                {tab === 'Contacts' && <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
                {tab === 'Voicemail' && <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>}
              </div>
              <span className="text-[9px] font-black uppercase tracking-widest">{tab}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[72px] px-8 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
          <h2 className="text-xl font-black text-gray-900 tracking-tight">{activeTab}</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-widest border border-emerald-100">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Line Active
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 flex flex-col items-center">
          <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-2 duration-500">
            
            {activeTab === 'Keypad' && (
              <div className="flex flex-col items-center">
                {/* Dial Display */}
                <div className="w-full h-32 flex flex-col items-center justify-center mb-10">
                  <div className="text-4xl font-black tracking-tight text-gray-900 mb-2">
                    {dialValue || "Enter Number"}
                  </div>
                  {dialValue && (
                    <button onClick={handleBackspace} className="text-gray-400 hover:text-rose-500 transition-colors">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Keypad Grid */}
                <div className="grid grid-cols-3 gap-6 mb-12">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((key) => (
                    <button
                      key={key}
                      onClick={() => handleDial(key)}
                      className="w-20 h-20 rounded-[2rem] bg-white border border-gray-100 flex flex-col items-center justify-center hover:bg-emerald-50 hover:border-emerald-200 transition-all shadow-sm active:scale-95"
                    >
                      <span className="text-2xl font-black text-gray-900">{key}</span>
                      <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
                        {key === '2' ? 'ABC' : key === '3' ? 'DEF' : key === '4' ? 'GHI' : key === '5' ? 'JKL' : key === '6' ? 'MNO' : key === '7' ? 'PQRS' : key === '8' ? 'TUV' : key === '9' ? 'WXYZ' : ''}
                      </span>
                    </button>
                  ))}
                </div>

                <button 
                  onClick={() => startCall(dialValue || 'Unknown')}
                  disabled={!dialValue}
                  className="w-20 h-20 rounded-[2.5rem] bg-emerald-600 flex items-center justify-center text-white shadow-2xl shadow-emerald-200 hover:bg-emerald-700 transition-all disabled:opacity-30 disabled:shadow-none"
                >
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </button>
              </div>
            )}

            {activeTab === 'Recents' && (
              <div className="space-y-3">
                {MOCK_CALLS.map((call) => (
                  <div 
                    key={call.id} 
                    className="group bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between hover:border-emerald-200 transition-all cursor-pointer"
                    onClick={() => startCall(call.name)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-inner ${getAvatarColor(call.name)}`}>
                        {call.avatar}
                      </div>
                      <div>
                        <h3 className={`text-sm font-black ${call.type === 'Missed' ? 'text-rose-600' : 'text-gray-900'}`}>{call.name}</h3>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2 mt-0.5">
                          {call.type === 'Incoming' && <svg className="w-3 h-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>}
                          {call.type === 'Outgoing' && <svg className="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>}
                          {call.type === 'Missed' && <svg className="w-3 h-3 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>}
                          {call.number}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{call.timestamp}</p>
                      {call.duration && <p className="text-[10px] font-bold text-emerald-600 mt-0.5">{call.duration}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'Contacts' && (
              <div className="space-y-3">
                <div className="relative mb-6">
                  <svg className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search personnel..."
                    className="w-full pl-12 pr-6 py-4 bg-white border border-gray-100 rounded-[1.5rem] shadow-sm focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                  />
                </div>
                {MOCK_CONTACTS.map((contact) => (
                  <div 
                    key={contact.id} 
                    className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-lg transition-all group cursor-pointer"
                    onClick={() => startCall(contact.name)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-inner ${getAvatarColor(contact.name)}`}>
                          {contact.avatar}
                        </div>
                        <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${contact.status === 'Online' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-gray-900 group-hover:text-emerald-700 transition-colors">{contact.name}</h3>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{contact.role}</p>
                      </div>
                    </div>
                    <button className="p-3 bg-gray-50 text-emerald-600 rounded-xl hover:bg-emerald-600 hover:text-white transition-all">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'Voicemail' && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 bg-gray-100 rounded-[2.5rem] flex items-center justify-center mb-6 text-gray-300">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <h3 className="text-xl font-black text-gray-900">Inbox Empty</h3>
                <p className="text-sm font-medium text-gray-500 mt-2">You have no new messages in your inbox.</p>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Active Call Overlay */}
      {isCalling && (
        <div className="fixed inset-0 z-[100] bg-gray-900/90 backdrop-blur-xl flex flex-col items-center justify-center animate-in zoom-in-110 duration-500">
          <div className="text-center mb-16">
            <div className={`w-32 h-32 rounded-[3rem] flex items-center justify-center text-white font-black text-4xl shadow-2xl mb-8 mx-auto ${activeCallTarget ? getAvatarColor(activeCallTarget) : 'bg-emerald-600'}`}>
              {activeCallTarget?.substring(0, 2).toUpperCase() || '??'}
            </div>
            <h2 className="text-4xl font-black text-white tracking-tight mb-2">{activeCallTarget}</h2>
            <p className="text-emerald-400 font-black uppercase tracking-[0.3em] text-xs animate-pulse">Establishing Secure Connection...</p>
          </div>

          <div className="grid grid-cols-3 gap-10 mb-20">
            <button className="flex flex-col items-center gap-3 group">
              <div className="w-16 h-16 rounded-full border-2 border-white/10 flex items-center justify-center text-white group-hover:bg-white/10 transition-all">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Mute</span>
            </button>
            <button className="flex flex-col items-center gap-3 group">
              <div className="w-16 h-16 rounded-full border-2 border-white/10 flex items-center justify-center text-white group-hover:bg-white/10 transition-all">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
              </div>
              <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Speaker</span>
            </button>
            <button className="flex flex-col items-center gap-3 group">
              <div className="w-16 h-16 rounded-full border-2 border-white/10 flex items-center justify-center text-white group-hover:bg-white/10 transition-all">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              </div>
              <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Add</span>
            </button>
          </div>

          <button 
            onClick={() => setIsCalling(false)}
            className="w-24 h-24 rounded-[3rem] bg-rose-600 flex items-center justify-center text-white shadow-2xl shadow-rose-900/50 hover:bg-rose-700 hover:scale-105 transition-all"
          >
            <svg className="w-10 h-10 rotate-[135deg]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </button>
        </div>
      )}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
