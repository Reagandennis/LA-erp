'use client';

import React, { useState } from 'react';

// --- Types ---
type ContractStatus = 'Active' | 'Expiring Soon' | 'In Renewal' | 'Expired';
type ContractType = 'Fixed Term' | 'Retainer' | 'Project Based';

interface Contract {
  id: string;
  consultantName: string;
  email: string;
  department: string;
  type: ContractType;
  startDate: string;
  endDate: string;
  status: ContractStatus;
  value: number;
  remainingDays: number;
  avatar: string;
  lastRenewalDate?: string;
  documents: Array<{ name: string; type: string }>;
}

// --- Mock Data ---
const MOCK_CONTRACTS: Contract[] = [
  {
    id: 'CTR-9901',
    consultantName: 'Sarah Smith',
    email: 'sarah.s@consultant.io',
    department: 'Product Design',
    type: 'Retainer',
    startDate: 'Jan 01, 2025',
    endDate: 'May 15, 2026',
    status: 'Expiring Soon',
    value: 12500,
    remainingDays: 15,
    avatar: 'SS',
    documents: [{ name: 'Master_Agreement_V2.pdf', type: 'PDF' }],
  },
  {
    id: 'CTR-8842',
    consultantName: 'Michael Ross',
    email: 'm.ross@legal-exec.com',
    department: 'Legal & Compliance',
    type: 'Project Based',
    startDate: 'Mar 10, 2026',
    endDate: 'Jun 10, 2026',
    status: 'Active',
    value: 8400,
    remainingDays: 71,
    avatar: 'MR',
    documents: [],
  },
  {
    id: 'CTR-1109',
    consultantName: 'David Miller',
    email: 'd.miller@sec-expert.net',
    department: 'IT Security',
    type: 'Fixed Term',
    startDate: 'Jul 22, 2025',
    endDate: 'Mar 28, 2026',
    status: 'Expired',
    value: 15000,
    remainingDays: -3,
    avatar: 'DM',
    documents: [{ name: 'SOW_Security_Audit.pdf', type: 'PDF' }],
  },
  {
    id: 'CTR-5521',
    consultantName: 'Emily Blunt',
    email: 'e.blunt@talent-ops.com',
    department: 'Human Resources',
    type: 'Retainer',
    startDate: 'Feb 14, 2026',
    endDate: 'Feb 14, 2027',
    status: 'Active',
    value: 9200,
    remainingDays: 320,
    avatar: 'EB',
    documents: [{ name: 'HR_Services_2026.pdf', type: 'PDF' }],
  },
  {
    id: 'CTR-4430',
    consultantName: 'John Doe',
    email: 'j.doe@logistics-pro.com',
    department: 'Operations',
    type: 'Fixed Term',
    startDate: 'Dec 01, 2025',
    endDate: 'Jun 01, 2026',
    status: 'In Renewal',
    value: 11000,
    remainingDays: 31,
    avatar: 'JD',
    documents: [{ name: 'Operations_SOW_Draft.docx', type: 'DOCX' }],
  }
];

export default function ContractRenewalPage() {
  const [contracts] = useState<Contract[]>(MOCK_CONTRACTS);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<ContractStatus | 'All'>('All');

  const filteredContracts = contracts.filter((c) => {
    const matchesSearch = 
      c.consultantName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.department.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = activeFilter === 'All' || c.status === activeFilter;
    
    return matchesSearch && matchesFilter;
  });

  const getStatusStyle = (status: ContractStatus): string => {
    switch (status) {
      case 'Active': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'Expiring Soon': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'In Renewal': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'Expired': return 'bg-rose-50 text-rose-600 border-rose-100';
    }
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
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase italic">Contract Renewal</h1>
            <p className="text-gray-500 mt-1 font-bold text-xs uppercase tracking-widest">Global Consultant Lifecycle Management</p>
          </div>
          <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 flex items-center justify-center gap-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Initiate Contract
          </button>
        </div>

        {/* Efficiency Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Upcoming Renewals', count: contracts.filter(c => c.status === 'Expiring Soon').length, color: 'text-amber-600' },
            { label: 'Action Required', count: contracts.filter(c => c.status === 'Expired').length, color: 'text-rose-600' },
            { label: 'In Processing', count: contracts.filter(c => c.status === 'In Renewal').length, color: 'text-blue-600' },
            { label: 'Total Value (Monthly)', count: `$${contracts.reduce((acc, c) => acc + c.value, 0).toLocaleString()}`, color: 'text-gray-900' },
          ].map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col justify-center">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Management Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by consultant, ID, or department..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-6 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {(['All', 'Active', 'Expiring Soon', 'In Renewal', 'Expired'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                  activeFilter === status 
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' 
                    : 'text-gray-400 hover:bg-gray-100'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Practical Data Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredContracts.map((ctr) => (
            <div
              key={ctr.id}
              onClick={() => setSelectedContract(ctr)}
              className="group bg-white rounded-[3rem] p-8 border border-gray-100 hover:border-emerald-300 hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-start justify-between mb-8 relative z-10">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center text-white font-black text-xl shadow-lg transition-transform group-hover:scale-105 duration-300 ${getAvatarColor(ctr.consultantName)}`}>
                    {ctr.avatar}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-gray-900 leading-tight group-hover:text-emerald-700 transition-colors">{ctr.consultantName}</h3>
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mt-1">{ctr.id}</p>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${getStatusStyle(ctr.status)}`}>
                  {ctr.status}
                </div>
              </div>

              <div className="space-y-4 mb-8 relative z-10">
                <div className="flex justify-between items-center px-4 py-3 bg-gray-50 rounded-2xl">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Department</span>
                  <span className="text-xs font-black text-gray-900">{ctr.department}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3 bg-gray-50 rounded-2xl">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">End Date</span>
                  <span className={`text-xs font-black ${ctr.remainingDays < 30 ? 'text-amber-600' : 'text-gray-900'}`}>{ctr.endDate}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-gray-50 relative z-10">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Monthly Value</span>
                  <span className="text-base font-black text-gray-900">${ctr.value.toLocaleString()}</span>
                </div>
                <button className="px-4 py-2 bg-gray-900 text-white rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-emerald-600 transition-all">
                  Process Renewal
                </button>
              </div>

              {/* Background accent */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 rounded-bl-full -mr-16 -mt-16 group-hover:bg-emerald-50 transition-colors duration-300" />
            </div>
          ))}
        </div>

        {filteredContracts.length === 0 && (
          <div className="text-center py-32 bg-white rounded-[4rem] border border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-200">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-2xl font-black text-gray-900 tracking-tight">No contracts found</h3>
            <p className="text-gray-500 mt-2 font-bold text-sm">Adjust your filters to see more results</p>
          </div>
        )}
      </div>

      {/* High-Efficiency Processing Drawer */}
      {selectedContract && (
        <>
          <div className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity duration-500" onClick={() => setSelectedContract(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-10 border-b border-gray-50 bg-gray-900 text-white">
              <div className="flex justify-between items-start mb-10">
                <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center text-white font-black text-3xl shadow-xl ${getAvatarColor(selectedContract.consultantName)}`}>
                  {selectedContract.avatar}
                </div>
                <button onClick={() => setSelectedContract(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white transition-all">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <h2 className="text-4xl font-black tracking-tight mb-2 uppercase italic">{selectedContract.consultantName}</h2>
              <p className="text-white/50 font-black uppercase tracking-[0.2em] text-xs mb-8">{selectedContract.department} Consultant</p>
              <div className="flex items-center gap-4">
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                  selectedContract.status === 'Active' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                }`}>
                  {selectedContract.status}
                </div>
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Reference: {selectedContract.id}</span>
              </div>
            </div>

            <div className="p-10 space-y-12 flex-1">
              {/* Critical Dates & Value */}
              <div className="grid grid-cols-2 gap-6">
                <div className="p-6 bg-gray-50 rounded-[2.5rem] border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Termination Date</p>
                  <p className={`text-lg font-black ${selectedContract.remainingDays < 30 ? 'text-rose-600' : 'text-gray-900'}`}>{selectedContract.endDate}</p>
                  <p className="text-[9px] font-black text-gray-400 uppercase mt-1">{selectedContract.remainingDays} Days Remaining</p>
                </div>
                <div className="p-6 bg-gray-50 rounded-[2.5rem] border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Contract Type</p>
                  <p className="text-lg font-black text-gray-900 uppercase tracking-widest">{selectedContract.type}</p>
                  <p className="text-[9px] font-black text-emerald-600 uppercase mt-1">Monthly Billing</p>
                </div>
              </div>

              {/* Renewal Action Workflow */}
              <div className="space-y-6">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-6 border-b border-gray-100 pb-4">Renewal Workflow</h3>
                
                <div className="grid gap-4">
                  <div className="p-6 bg-emerald-50/50 border-2 border-emerald-100 rounded-[2rem] relative">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-black text-[10px]">01</div>
                      <p className="text-sm font-black text-emerald-900 uppercase tracking-widest">Extension Proposal</p>
                    </div>
                    <div className="space-y-4">
                      <div className="flex gap-3">
                        <select className="flex-1 bg-white border-none rounded-xl px-4 py-3 text-xs font-bold text-gray-700 focus:ring-2 focus:ring-emerald-500 shadow-sm">
                          <option>Extend by 6 Months</option>
                          <option>Extend by 12 Months</option>
                          <option>Project Completion</option>
                        </select>
                        <input 
                          type="text" 
                          defaultValue={`$${selectedContract.value.toLocaleString()}`}
                          className="w-32 bg-white border-none rounded-xl px-4 py-3 text-xs font-bold text-gray-700 focus:ring-2 focus:ring-emerald-500 shadow-sm text-center"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-6 bg-gray-50 border border-gray-100 rounded-[2rem] opacity-60">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-white font-black text-[10px]">02</div>
                      <p className="text-sm font-black text-gray-400 uppercase tracking-widest">Document Execution</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Document Repository */}
              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-6">Execution Materials</h3>
                <div className="grid gap-3">
                  {selectedContract.documents.map((doc, i) => (
                    <div key={i} className="flex items-center justify-between p-5 bg-white border border-gray-100 rounded-[1.5rem] shadow-sm group hover:border-emerald-200 transition-all cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center text-white shadow-lg">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-900 truncate max-w-[200px]">{doc.name}</p>
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{doc.type} Attachment</p>
                        </div>
                      </div>
                      <button className="p-2 text-gray-300 hover:text-emerald-600 transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg></button>
                    </div>
                  ))}
                  <button className="w-full py-4 border-2 border-dashed border-gray-200 rounded-[1.5rem] text-gray-400 font-black uppercase tracking-widest text-[10px] hover:border-emerald-300 hover:text-emerald-600 transition-all flex items-center justify-center gap-3">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                    Upload Executed SOW
                  </button>
                </div>
              </div>
            </div>

            <div className="p-10 sticky bottom-0 bg-white border-t border-gray-100 flex flex-col gap-4">
              <button 
                onClick={() => setSelectedContract(null)}
                className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-black uppercase tracking-[0.25em] text-xs hover:bg-black transition-all shadow-2xl shadow-gray-200"
              >
                Dispatch Extension Offer
              </button>
              <button 
                onClick={() => setSelectedContract(null)}
                className="w-full py-4 text-gray-400 font-black uppercase tracking-[0.2em] text-[10px] hover:bg-gray-50 rounded-2xl transition-all"
              >
                Archive Contract Registry
              </button>
            </div>
          </div>
        </>
      )}

      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
