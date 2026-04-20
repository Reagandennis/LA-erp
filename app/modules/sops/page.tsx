'use client';

import React, { useState } from 'react';

// --- Types ---
type SOPStatus = 'Active' | 'Draft' | 'Review' | 'Archived';
type SOPCategory = 'Safety' | 'Operations' | 'Human Resources' | 'IT & Security' | 'Finance';
type SOPFilter = 'All' | SOPCategory;

interface SOP {
  id: string;
  code: string;
  title: string;
  category: SOPCategory;
  status: SOPStatus;
  version: string;
  lastUpdated: string;
  owner: string;
  description: string;
  content: string[]; // List of steps or sections
}

// --- Mock Data ---
const MOCK_SOPS: SOP[] = [
  {
    id: 'SOP-001',
    code: 'OPS-SAF-01',
    title: 'Emergency Evacuation Procedure',
    category: 'Safety',
    status: 'Active',
    version: 'v2.4',
    lastUpdated: 'Mar 15, 2026',
    owner: 'David Miller',
    description: 'Standard protocol for evacuating the main facility during fire, earthquake, or other immediate threats.',
    content: [
      'Identify the emergency type and trigger the alarm system.',
      'Cease all operations immediately and secure hazardous materials.',
      'Exit the building via the nearest marked emergency exit.',
      'Assemble at the designated meeting point in the North Parking Lot.',
      'Wait for roll call by department leads.'
    ]
  },
  {
    id: 'SOP-002',
    code: 'IT-SEC-05',
    title: 'Password & Access Control Policy',
    category: 'IT & Security',
    status: 'Active',
    version: 'v1.2',
    lastUpdated: 'Feb 10, 2026',
    owner: 'IT Security Team',
    description: 'Guidelines for maintaining secure credentials and requesting platform access.',
    content: [
      'Passwords must be at least 12 characters with mixed complexity.',
      'Multi-factor authentication (MFA) is mandatory for all accounts.',
      'Access requests must be approved by department heads.',
      'Credentials must not be shared between team members.'
    ]
  },
  {
    id: 'SOP-003',
    code: 'HR-ONB-02',
    title: 'New Employee Onboarding Flow',
    category: 'Human Resources',
    status: 'Review',
    version: 'v3.0-RC',
    lastUpdated: 'Mar 28, 2026',
    owner: 'Emily Blunt',
    description: 'Step-by-step guide for integrating new hires into the company culture and systems.',
    content: [
      'Confirm contract signature and legal documentation.',
      'Initiate hardware procurement and system account creation.',
      'Schedule orientation meeting and team introductions.',
      'Review role-specific KPIs and growth roadmap.'
    ]
  },
  {
    id: 'SOP-004',
    code: 'OPS-LOG-09',
    title: 'Warehouse Inventory Audit',
    category: 'Operations',
    status: 'Active',
    version: 'v4.1',
    lastUpdated: 'Jan 05, 2026',
    owner: 'Olivia Wilson',
    description: 'Monthly procedure for physical count and digital reconciliation of warehouse stock.',
    content: [
      'Prepare current stock report from the ERP system.',
      'Assign audit teams to specific warehouse zones.',
      'Perform physical count of all high-value items.',
      'Record discrepancies and initiate reconciliation tickets.'
    ]
  }
];

export default function SOPsPage() {
  const [sops] = useState<SOP[]>(MOCK_SOPS);
  const [selectedSOP, setSelectedSOP] = useState<SOP | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<SOPFilter>('All');
  const categoryOptions: SOPFilter[] = ['All', 'Safety', 'Operations', 'Human Resources', 'IT & Security', 'Finance'];

  const filteredSops = sops.filter(sop => {
    const matchesSearch = sop.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         sop.code.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = activeCategory === 'All' || sop.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const getStatusStyle = (status: SOPStatus) => {
    switch (status) {
      case 'Active': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'Draft': return 'bg-gray-50 text-gray-500 border-gray-100';
      case 'Review': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'Archived': return 'bg-rose-50 text-rose-600 border-rose-100';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">SOP Library</h1>
            <p className="text-gray-500 mt-1 font-medium">Standard Operating Procedures & Compliance Docs</p>
          </div>
          <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create SOP
          </button>
        </div>

        <div className="grid lg:grid-cols-4 gap-8">
          {/* Sidebar - Categories */}
          <aside className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-6">Categories</h3>
              <nav className="space-y-2">
                {categoryOptions.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                      activeCategory === cat 
                        ? 'bg-emerald-50 text-emerald-700 shadow-sm' 
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    <span>{cat}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-md ${activeCategory === cat ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      {cat === 'All' ? sops.length : sops.filter(s => s.category === cat).length}
                    </span>
                  </button>
                ))}
              </nav>
            </div>

            <div className="bg-gray-900 p-8 rounded-[2rem] text-white shadow-xl">
              <h4 className="text-lg font-black mb-2">Compliance Alert</h4>
              <p className="text-white/50 text-xs font-medium leading-relaxed mb-6">
                You have 2 SOPs pending review. Ensure all procedures are updated by the end of the quarter.
              </p>
              <button className="w-full py-3 bg-white text-gray-900 rounded-xl font-bold text-xs hover:bg-emerald-400 transition-colors">
                Open Review Queue
              </button>
            </div>
          </aside>

          {/* Main List Area */}
          <div className="lg:col-span-3 space-y-6">
            {/* Search Toolbar */}
            <div className="relative">
              <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by procedure title or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-6 py-4 bg-white border border-gray-100 rounded-[1.5rem] shadow-sm focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
              />
            </div>

            {/* SOP Items */}
            <div className="space-y-4">
              {filteredSops.map((sop) => (
                <div
                  key={sop.id}
                  onClick={() => setSelectedSOP(sop)}
                  className="bg-white p-6 rounded-3xl border border-gray-100 hover:border-emerald-200 transition-all cursor-pointer group shadow-sm hover:shadow-xl hover:shadow-emerald-500/5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                          {sop.code}
                        </span>
                        <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">{sop.category}</span>
                      </div>
                      <h3 className="text-xl font-black text-gray-900 group-hover:text-emerald-700 transition-colors mb-2">
                        {sop.title}
                      </h3>
                      <p className="text-gray-500 text-sm font-medium line-clamp-1 mb-4">
                        {sop.description}
                      </p>
                      
                      <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-gray-300" />
                          <span className="text-xs font-bold text-gray-400">Updated: <span className="text-gray-900">{sop.lastUpdated}</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-gray-300" />
                          <span className="text-xs font-bold text-gray-400">Version: <span className="text-gray-900">{sop.version}</span></span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-gray-300" />
                          <span className="text-xs font-bold text-gray-400">Owner: <span className="text-gray-900">{sop.owner}</span></span>
                        </div>
                      </div>
                    </div>
                    
                    <div className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyle(sop.status)}`}>
                      {sop.status}
                    </div>
                  </div>
                </div>
              ))}

              {filteredSops.length === 0 && (
                <div className="text-center py-20 bg-white rounded-[3rem] border border-dashed border-gray-200">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900">No procedures found</h3>
                  <p className="text-gray-500 mt-1">Try refining your search or category filter.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SOP Detail Viewer Drawer */}
      {selectedSOP && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setSelectedSOP(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="sticky top-0 bg-white border-b border-gray-50 px-8 py-6 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                 <span className="text-xs font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-100">
                  {selectedSOP.code}
                </span>
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest">{selectedSOP.category}</span>
              </div>
              <button 
                onClick={() => setSelectedSOP(null)}
                className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-all"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-10 flex-1">
              <h2 className="text-4xl font-black text-gray-900 leading-tight mb-4">{selectedSOP.title}</h2>
              <p className="text-lg text-gray-500 font-medium leading-relaxed mb-10">
                {selectedSOP.description}
              </p>

              <div className="grid grid-cols-3 gap-6 bg-gray-50 p-6 rounded-3xl mb-12 border border-gray-100">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Version</label>
                  <p className="text-sm font-bold text-gray-900">{selectedSOP.version}</p>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Status</label>
                  <p className="text-sm font-bold text-emerald-600">{selectedSOP.status}</p>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Last Update</label>
                  <p className="text-sm font-bold text-gray-900">{selectedSOP.lastUpdated}</p>
                </div>
              </div>

              <div className="space-y-8">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-[0.2em] border-b border-gray-100 pb-4">Procedure Steps</h4>
                <div className="space-y-6">
                  {selectedSOP.content.map((step, index) => (
                    <div key={index} className="flex gap-6">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold text-xs">
                        {index + 1}
                      </div>
                      <p className="text-gray-700 font-medium leading-relaxed pt-1">
                        {step}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-16 flex gap-4">
                <button className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-2">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download PDF
                </button>
                <button className="px-10 py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all">
                  Edit Procedure
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
