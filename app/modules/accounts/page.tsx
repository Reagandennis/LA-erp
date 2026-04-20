'use client';

import React, { useState } from 'react';

// --- Types ---
type AccountStatus = 'Active' | 'Overdue' | 'Inactive' | 'Closed';
type AccountType = 'Client' | 'Vendor' | 'Partner' | 'Internal';

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'Credit' | 'Debit';
}

interface Account {
  id: string;
  name: string;
  email: string;
  type: AccountType;
  status: AccountStatus;
  balance: number;
  currency: string;
  lastTransaction: string;
  avatar: string;
  terms: string;
  transactions: Transaction[];
}

// --- Mock Data ---
const MOCK_ACCOUNTS: Account[] = [
  {
    id: 'ACC-7701',
    name: 'Global Logistics Corp',
    email: 'billing@globallogistics.com',
    type: 'Client',
    status: 'Active',
    balance: 12450.00,
    currency: 'USD',
    lastTransaction: 'Mar 28, 2026',
    avatar: 'GL',
    terms: 'Net 30',
    transactions: [
      { id: 'TX-101', date: 'Mar 28, 2026', description: 'Monthly Service Fee', amount: 4500.00, type: 'Debit' },
      { id: 'TX-102', date: 'Mar 15, 2026', description: 'Invoice Payment #882', amount: 12000.00, type: 'Credit' }
    ]
  },
  {
    id: 'ACC-8842',
    name: 'TechFlow Solutions',
    email: 'accounts@techflow.io',
    type: 'Vendor',
    status: 'Overdue',
    balance: -3200.50,
    currency: 'USD',
    lastTransaction: 'Feb 10, 2026',
    avatar: 'TF',
    terms: 'Net 15',
    transactions: [
      { id: 'TX-201', date: 'Feb 10, 2026', description: 'Server Maintenance', amount: 3200.50, type: 'Debit' }
    ]
  },
  {
    id: 'ACC-1109',
    name: 'Sarah Smith (Individual)',
    email: 'sarah.s@example.com',
    type: 'Internal',
    status: 'Active',
    balance: 0.00,
    currency: 'USD',
    lastTransaction: 'Mar 01, 2026',
    avatar: 'SS',
    terms: 'Due on Receipt',
    transactions: []
  },
  {
    id: 'ACC-5521',
    name: 'Horizon Partners',
    email: 'finance@horizon.com',
    type: 'Partner',
    status: 'Active',
    balance: 89400.00,
    currency: 'USD',
    lastTransaction: 'Mar 25, 2026',
    avatar: 'HP',
    terms: 'Quarterly',
    transactions: [
      { id: 'TX-301', date: 'Mar 25, 2026', description: 'Revenue Share Q1', amount: 89400.00, type: 'Credit' }
    ]
  },
  {
    id: 'ACC-9930',
    name: 'Stellar Manufacturing',
    email: 'stellar.m@industry.com',
    type: 'Vendor',
    status: 'Inactive',
    balance: -150.00,
    currency: 'USD',
    lastTransaction: 'Dec 15, 2025',
    avatar: 'SM',
    terms: 'Net 60',
    transactions: []
  }
];

export default function AccountsPage() {
  const [accounts] = useState<Account[]>(MOCK_ACCOUNTS);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<AccountStatus | 'All'>('All');

  const filteredAccounts = accounts.filter((acc) => {
    const matchesSearch = 
      acc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      acc.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      acc.email.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = activeFilter === 'All' || acc.status === activeFilter;
    
    return matchesSearch && matchesFilter;
  });

  const getStatusStyle = (status: AccountStatus): string => {
    switch (status) {
      case 'Active': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'Overdue': return 'bg-rose-50 text-rose-600 border-rose-100';
      case 'Inactive': return 'bg-gray-50 text-gray-500 border-gray-100';
      case 'Closed': return 'bg-slate-50 text-slate-600 border-slate-100';
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
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Accounts & Finance</h1>
            <p className="text-gray-500 mt-1 font-medium">Manage commercial relationships and balances</p>
          </div>
          <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Create Account
          </button>
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="bg-gray-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-2 relative z-10">Total Receivables</p>
            <p className="text-4xl font-black relative z-10">$124,350.50</p>
            <div className="mt-6 flex items-center gap-2 relative z-10">
              <span className="text-[10px] font-bold text-emerald-400 bg-white/10 px-2 py-1 rounded-lg">+12% from last month</span>
            </div>
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl" />
          </div>
          
          <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm">
            <p className="text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] mb-2">At Risk / Overdue</p>
            <p className="text-4xl font-black text-gray-900">$3,200.50</p>
            <p className="text-[10px] font-bold text-gray-400 mt-6 uppercase tracking-widest">2 Accounts require attention</p>
          </div>

          <div className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm">
            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-2">Settled this week</p>
            <p className="text-4xl font-black text-gray-900">$42,100.00</p>
            <p className="text-[10px] font-bold text-gray-400 mt-6 uppercase tracking-widest">15 Transactions processed</p>
          </div>
        </div>

        {/* Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, ID or email..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {(['All', 'Active', 'Overdue', 'Inactive'] as const).map((status) => (
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

        {/* Accounts Table */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Account Hub</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Type & Terms</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Balance</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredAccounts.map((acc) => (
                <tr 
                  key={acc.id} 
                  onClick={() => setSelectedAccount(acc)}
                  className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
                >
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-inner shrink-0 ${getAvatarColor(acc.name)}`}>
                        {acc.avatar}
                      </div>
                      <div>
                        <p className="text-sm font-black text-gray-900 group-hover:text-emerald-700 transition-colors">{acc.name}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">{acc.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-gray-700">{acc.type}</span>
                      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-widest">{acc.terms}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <p className={`text-sm font-black ${acc.balance < 0 ? 'text-rose-600' : 'text-gray-900'}`}>
                      {acc.balance < 0 ? `-$${Math.abs(acc.balance).toLocaleString()}` : `$${acc.balance.toLocaleString()}`}
                    </p>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Last Activity: {acc.lastTransaction}</p>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider border ${getStatusStyle(acc.status)}`}>
                      {acc.status}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button className="p-2 text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredAccounts.length === 0 && (
            <div className="p-20 text-center">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-200">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">No matching accounts</h3>
              <p className="text-gray-500 mt-1 font-medium">Try adjusting your filters or search term.</p>
            </div>
          )}
        </div>
      </div>

      {/* Account Detail Viewer Drawer */}
      {selectedAccount && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity duration-500"
            onClick={() => setSelectedAccount(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-10 border-b border-gray-50 bg-gray-900 text-white">
              <div className="flex justify-between items-start mb-8">
                <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center text-white font-black text-3xl shadow-xl ${getAvatarColor(selectedAccount.name)}`}>
                  {selectedAccount.avatar}
                </div>
                <button onClick={() => setSelectedAccount(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white transition-all">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <h2 className="text-3xl font-black tracking-tight mb-1">{selectedAccount.name}</h2>
              <p className="text-emerald-400 font-bold text-sm mb-8 uppercase tracking-[0.2em]">{selectedAccount.type} Relationship</p>
              <div className="flex items-center gap-4">
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                  selectedAccount.status === 'Active' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                }`}>
                  Account {selectedAccount.status}
                </div>
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">UID: {selectedAccount.id}</span>
              </div>
            </div>

            <div className="p-10 space-y-12 flex-1">
              {/* Financial Breakdown */}
              <div className="grid grid-cols-2 gap-6">
                <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Current Balance</p>
                  <p className={`text-2xl font-black ${selectedAccount.balance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    ${selectedAccount.balance.toLocaleString()}
                  </p>
                </div>
                <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Terms & Conditions</p>
                  <p className="text-sm font-black text-gray-900">{selectedAccount.terms}</p>
                </div>
              </div>

              {/* Transaction History */}
              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-6 border-b border-gray-100 pb-4">Recent Ledger</h3>
                <div className="space-y-4">
                  {selectedAccount.transactions.length > 0 ? (
                    selectedAccount.transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-emerald-200 transition-all">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tx.type === 'Credit' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-400'}`}>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {tx.type === 'Credit' ? <path d="M12 4v16m8-8H4" /> : <path d="M20 12H4" />}
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-black text-gray-900">{tx.description}</p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">{tx.date} • {tx.id}</p>
                          </div>
                        </div>
                        <p className={`text-sm font-black ${tx.type === 'Credit' ? 'text-emerald-600' : 'text-gray-900'}`}>
                          {tx.type === 'Credit' ? `+$${tx.amount.toLocaleString()}` : `-$${tx.amount.toLocaleString()}`}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="p-10 border-2 border-dashed border-gray-100 rounded-2xl text-center">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">No transaction history found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Secure Notes */}
              <div className="bg-amber-50/50 p-8 rounded-[2rem] border border-amber-100">
                <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-3">Internal Audit Note</h4>
                <p className="text-sm text-amber-900/70 font-medium leading-relaxed">
                  Financial relationship established {new Date(selectedAccount.lastTransaction).getFullYear()}. 
                  Compliance status verified for current fiscal period.
                </p>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="p-10 sticky bottom-0 bg-white border-t border-gray-100 flex flex-col gap-4">
              <button className="w-full py-5 bg-gray-900 text-white rounded-[2rem] font-black uppercase tracking-[0.25em] text-xs hover:bg-black transition-all shadow-xl shadow-gray-200">
                Generate Statement
              </button>
              <div className="grid grid-cols-2 gap-4">
                <button className="py-4 border-2 border-emerald-600 text-emerald-600 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-emerald-50 transition-all">
                  Post Payment
                </button>
                <button className="py-4 border-2 border-gray-200 text-gray-400 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-50 transition-all">
                  Edit Profile
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
