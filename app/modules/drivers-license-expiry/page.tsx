'use client';

import React, { useState } from 'react';

// --- Types ---
type LicenseStatus = 'Valid' | 'Expiring Soon' | 'Expired';
type LicenseCategory = 'Class A' | 'Class B' | 'Class C' | 'Commercial' | 'Special';
type LicenseFilter = 'All' | LicenseStatus;

interface DriverLicense {
  id: string;
  driverName: string;
  licenseNumber: string;
  category: LicenseCategory;
  expiryDate: string;
  status: LicenseStatus;
  daysRemaining: number;
  avatar: string;
  lastVerified: string;
  notes?: string;
}

// --- Mock Data ---
const MOCK_LICENSES: DriverLicense[] = [
  {
    id: 'LIC-001',
    driverName: 'John Doe',
    licenseNumber: 'DL-98234-AX',
    category: 'Commercial',
    expiryDate: 'Apr 15, 2026',
    status: 'Expiring Soon',
    daysRemaining: 15,
    avatar: 'JD',
    lastVerified: 'Mar 20, 2026',
    notes: 'Driver has scheduled a renewal appointment for next week.'
  },
  {
    id: 'LIC-002',
    driverName: 'Sarah Smith',
    licenseNumber: 'DL-11209-BB',
    category: 'Class A',
    expiryDate: 'Dec 20, 2027',
    status: 'Valid',
    daysRemaining: 630,
    avatar: 'SS',
    lastVerified: 'Jan 15, 2026',
  },
  {
    id: 'LIC-003',
    driverName: 'Michael Ross',
    licenseNumber: 'DL-55432-CZ',
    category: 'Class B',
    expiryDate: 'Mar 10, 2026',
    status: 'Expired',
    daysRemaining: -21,
    avatar: 'MR',
    lastVerified: 'Feb 28, 2026',
    notes: 'Access suspended until valid license is presented.'
  },
  {
    id: 'LIC-004',
    driverName: 'Emily Blunt',
    licenseNumber: 'DL-00981-KK',
    category: 'Commercial',
    expiryDate: 'Jun 05, 2026',
    status: 'Valid',
    daysRemaining: 66,
    avatar: 'EB',
    lastVerified: 'Mar 25, 2026',
  },
  {
    id: 'LIC-005',
    driverName: 'David Miller',
    licenseNumber: 'DL-77612-PP',
    category: 'Class C',
    expiryDate: 'Aug 14, 2028',
    status: 'Valid',
    daysRemaining: 865,
    avatar: 'DM',
    lastVerified: 'Feb 10, 2026',
  }
];

export default function DriversLicenseExpiryPage() {
  const [licenses] = useState<DriverLicense[]>(MOCK_LICENSES);
  const [selectedLicense, setSelectedLicense] = useState<DriverLicense | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<LicenseFilter>('All');
  const filterOptions: LicenseFilter[] = ['All', 'Valid', 'Expiring Soon', 'Expired'];

  const filteredLicenses = licenses.filter(lic => {
    const matchesSearch = lic.driverName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         lic.licenseNumber.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === 'All' || lic.status === activeFilter;
    return matchesSearch && matchesFilter;
  });

  const getStatusStyle = (status: LicenseStatus) => {
    switch (status) {
      case 'Valid': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'Expiring Soon': return 'bg-amber-50 text-amber-600 border-amber-100';
      case 'Expired': return 'bg-rose-50 text-rose-600 border-rose-100';
    }
  };

  const getAvatarColor = (name: string) => {
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
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">License Compliance</h1>
            <p className="text-gray-500 mt-1 font-medium">Track driver licensing expiry and renewal schedules</p>
          </div>
          <div className="flex gap-3">
            <button className="px-6 py-3 bg-white border border-gray-200 text-gray-700 rounded-2xl font-bold text-sm hover:bg-gray-50 transition-all shadow-sm flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" />
              </svg>
              Upload Doc
            </button>
            <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Driver
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Drivers', count: licenses.length, color: 'text-gray-900' },
            { label: 'Expired', count: licenses.filter(l => l.status === 'Expired').length, color: 'text-rose-600' },
            { label: 'Expiring Soon', count: licenses.filter(l => l.status === 'Expiring Soon').length, color: 'text-amber-600' },
            { label: 'Valid Licenses', count: licenses.filter(l => l.status === 'Valid').length, color: 'text-emerald-600' },
          ].map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search driver name or license number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {filterOptions.map((status) => (
              <button
                key={status}
                onClick={() => setActiveFilter(status)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  activeFilter === status 
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm' 
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* License Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredLicenses.map((lic) => (
            <div
              key={lic.id}
              onClick={() => setSelectedLicense(lic)}
              className="group bg-white rounded-[2.5rem] p-8 border border-gray-100 hover:border-emerald-300 hover:shadow-2xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer relative overflow-hidden"
            >
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg transition-transform group-hover:scale-105 ${getAvatarColor(lic.driverName)}`}>
                    {lic.avatar}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-gray-900 leading-tight">{lic.driverName}</h3>
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mt-1">{lic.category}</p>
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${getStatusStyle(lic.status)}`}>
                  {lic.status}
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-2xl">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">License No</span>
                  <span className="text-sm font-bold text-gray-900">{lic.licenseNumber}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded-2xl">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Expiry Date</span>
                  <span className={`text-sm font-bold ${lic.status === 'Expired' ? 'text-rose-600' : 'text-gray-900'}`}>{lic.expiryDate}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-6 border-t border-gray-50">
                <div className="flex flex-col">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Time Remaining</span>
                  <span className={`text-sm font-black ${
                    lic.daysRemaining < 0 ? 'text-rose-600' : 
                    lic.daysRemaining < 30 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {lic.daysRemaining < 0 ? `Expired ${Math.abs(lic.daysRemaining)} days ago` : `${lic.daysRemaining} Days Left`}
                  </span>
                </div>
                <button className="p-3 bg-gray-900 text-white rounded-xl hover:bg-black transition-all shadow-lg shadow-gray-200">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredLicenses.length === 0 && (
          <div className="text-center py-20 bg-white rounded-[3rem] border border-dashed border-gray-200">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">No matching records</h3>
            <p className="text-gray-500 mt-1">Try adjusting your search or status filter.</p>
          </div>
        )}
      </div>

      {/* Detail Viewer Drawer */}
      {selectedLicense && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity"
            onClick={() => setSelectedLicense(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-8 pb-0">
              <div className="flex justify-end mb-4">
                <button 
                  onClick={() => setSelectedLicense(null)}
                  className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex flex-col items-center text-center">
                <div className="relative mb-6">
                  <div className={`w-32 h-32 rounded-[2.5rem] flex items-center justify-center text-white font-bold text-4xl shadow-2xl ${getAvatarColor(selectedLicense.driverName)}`}>
                    {selectedLicense.avatar}
                  </div>
                  <div className={`absolute bottom-2 right-2 w-8 h-8 rounded-full border-4 border-white ${
                    selectedLicense.status === 'Valid' ? 'bg-emerald-500' : 
                    selectedLicense.status === 'Expiring Soon' ? 'bg-amber-500' : 'bg-rose-500'
                  }`} />
                </div>
                <h2 className="text-3xl font-black text-gray-900 mb-1">{selectedLicense.driverName}</h2>
                <p className="text-emerald-600 font-black uppercase tracking-[0.2em] text-xs mb-8">{selectedLicense.category} Operator</p>
              </div>
            </div>

            <div className="p-8 flex-1 space-y-8">
              {/* Detailed Specs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">License Number</label>
                  <p className="text-sm font-bold text-gray-900">{selectedLicense.licenseNumber}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Expiration</label>
                  <p className="text-sm font-bold text-gray-900">{selectedLicense.expiryDate}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Last Verified</label>
                  <p className="text-sm font-bold text-gray-900">{selectedLicense.lastVerified}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Compliance</label>
                  <p className={`text-sm font-bold ${selectedLicense.status === 'Valid' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {selectedLicense.status === 'Valid' ? 'In Order' : 'Requires Action'}
                  </p>
                </div>
              </div>

              {/* Notes */}
              <div>
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Admin Notes</h4>
                <div className="p-5 bg-amber-50/50 rounded-2xl border border-amber-100 text-sm text-amber-900 font-medium leading-relaxed">
                  {selectedLicense.notes || "No administrative notes recorded for this driver's license."}
                </div>
              </div>

              {/* Document Preview Placeholder */}
              <div className="p-8 border-2 border-dashed border-gray-200 rounded-[2rem] flex flex-col items-center justify-center text-center">
                <svg className="w-12 h-12 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-xs font-bold text-gray-400">LICENSE_SCAN_V2.PDF</p>
                <button className="mt-4 text-xs font-black text-emerald-600 uppercase tracking-widest hover:text-emerald-700">View Document</button>
              </div>
            </div>

            {/* Actions */}
            <div className="p-8 pt-4 bg-white border-t border-gray-50 sticky bottom-0 flex flex-col gap-3">
              <button className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100">
                Update Renewal
              </button>
              <button className="w-full py-3 text-gray-400 font-bold text-sm hover:text-gray-600 transition-all">
                Print Compliance Report
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
