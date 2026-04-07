'use client';

import React, { useState } from 'react';

// --- Types ---
type QuoteStatus = 'Draft' | 'Sent' | 'Approved' | 'Declined' | 'Expired';

interface QuoteLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Quote {
  id: string;
  clientName: string;
  subject: string;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  subtotal: number;
  taxRate: number;
  totalAmount: number;
  items: QuoteLineItem[];
  notes?: string;
}

// --- Mock Data ---
const MOCK_QUOTES: Quote[] = [
  {
    id: 'QT-2026-001',
    clientName: 'Global Logistics Corp',
    subject: 'Annual Software Licensing & Support',
    status: 'Approved',
    issueDate: 'Mar 15, 2026',
    expiryDate: 'Apr 15, 2026',
    subtotal: 12000,
    taxRate: 0.08,
    totalAmount: 12960,
    items: [
      { id: '1', description: 'Enterprise License (1 Year)', quantity: 1, unitPrice: 10000, total: 10000 },
      { id: '2', description: 'Priority Support Package', quantity: 1, unitPrice: 2000, total: 2000 }
    ],
    notes: 'Approved during the quarterly review meeting.'
  },
  {
    id: 'QT-2026-002',
    clientName: 'TechFlow Solutions',
    subject: 'Cloud Infrastructure Migration',
    status: 'Sent',
    issueDate: 'Mar 28, 2026',
    expiryDate: 'Apr 28, 2026',
    subtotal: 4500,
    taxRate: 0.08,
    totalAmount: 4860,
    items: [
      { id: '3', description: 'Cloud Setup Fee', quantity: 1, unitPrice: 1500, total: 1500 },
      { id: '4', description: 'Migration Labor (Hours)', quantity: 40, unitPrice: 75, total: 3000 }
    ]
  },
  {
    id: 'QT-2026-003',
    clientName: 'Horizon Partners',
    subject: 'Data Security Audit',
    status: 'Draft',
    issueDate: 'Mar 30, 2026',
    expiryDate: 'Apr 30, 2026',
    subtotal: 8500,
    taxRate: 0.08,
    totalAmount: 9180,
    items: [
      { id: '5', description: 'Security Assessment', quantity: 1, unitPrice: 8500, total: 8500 }
    ]
  },
  {
    id: 'QT-2026-004',
    clientName: 'Stellar Manufacturing',
    subject: 'Custom ERP Integration',
    status: 'Declined',
    issueDate: 'Feb 10, 2026',
    expiryDate: 'Mar 10, 2026',
    subtotal: 25000,
    taxRate: 0.08,
    totalAmount: 27000,
    items: [
      { id: '6', description: 'Module Customization', quantity: 1, unitPrice: 25000, total: 25000 }
    ],
    notes: 'Budget constraints on client side.'
  }
];

export default function QuotesPage() {
  const [quotes] = useState<Quote[]>(MOCK_QUOTES);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeFilter, setActiveFilter] = useState<QuoteStatus | 'All'>('All');

  const filteredQuotes = quotes.filter((q) => {
    const matchesSearch = 
      q.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.subject.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = activeFilter === 'All' || q.status === activeFilter;
    
    return matchesSearch && matchesFilter;
  });

  const getStatusStyle = (status: QuoteStatus): string => {
    switch (status) {
      case 'Approved': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'Sent': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'Draft': return 'bg-gray-50 text-gray-500 border-gray-100';
      case 'Declined': return 'bg-rose-50 text-rose-600 border-rose-100';
      case 'Expired': return 'bg-amber-50 text-amber-600 border-amber-100';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Quotations</h1>
            <p className="text-gray-500 mt-1 font-bold text-xs uppercase tracking-widest">Revenue Pipeline & Proposal Management</p>
          </div>
          <button className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 flex items-center justify-center gap-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
            </svg>
            Generate New Quote
          </button>
        </div>

        {/* Pipeline Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Total Value', count: `$${quotes.reduce((acc, q) => acc + q.totalAmount, 0).toLocaleString()}`, color: 'text-gray-900' },
            { label: 'Pending Approval', count: quotes.filter(q => q.status === 'Sent').length, color: 'text-blue-600' },
            { label: 'Converted', count: quotes.filter(q => q.status === 'Approved').length, color: 'text-emerald-600' },
            { label: 'Draft Proposals', count: quotes.filter(q => q.status === 'Draft').length, color: 'text-gray-400' },
          ].map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by client, reference, or subject..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-6 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {(['All', 'Approved', 'Sent', 'Draft', 'Expired'] as const).map((status) => (
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

        {/* Quotes Table */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50/50 border-b border-gray-100">
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Reference & Subject</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Client</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Value</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Expiry</th>
                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredQuotes.map((q) => (
                <tr 
                  key={q.id} 
                  onClick={() => setSelectedQuote(q)}
                  className="hover:bg-gray-50/80 transition-colors cursor-pointer group"
                >
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white text-[10px] font-black shrink-0">QT</div>
                      <div>
                        <p className="text-sm font-black text-gray-900 group-hover:text-emerald-700 transition-colors">{q.id}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase truncate max-w-[200px] mt-0.5">{q.subject}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-xs font-black text-gray-700">{q.clientName}</p>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <p className="text-sm font-black text-gray-900">${q.totalAmount.toLocaleString()}</p>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">{q.items.length} Line Items</p>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${getStatusStyle(q.status)}`}>
                      {q.status}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{q.expiryDate}</p>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button className="p-2 text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredQuotes.length === 0 && (
            <div className="p-24 text-center">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6 text-gray-200">
                <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">No quotations matching your criteria</h3>
              <p className="text-gray-500 mt-2 font-bold text-sm">Refine your search or create a new proposal from the header.</p>
            </div>
          )}
        </div>
      </div>

      {/* Quote Detail Drawer */}
      {selectedQuote && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-opacity duration-500"
            onClick={() => setSelectedQuote(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out flex flex-col">
            <div className="p-10 border-b border-gray-50 bg-gray-900 text-white relative overflow-hidden">
              <div className="flex justify-between items-start mb-10 relative z-10">
                <div>
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em] mb-2 block">{selectedQuote.id}</span>
                  <h2 className="text-3xl font-black tracking-tight mb-1">{selectedQuote.subject}</h2>
                  <p className="text-white/50 font-bold text-sm uppercase tracking-widest">{selectedQuote.clientName}</p>
                </div>
                <button onClick={() => setSelectedQuote(null)} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white transition-all">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex items-center gap-4 relative z-10">
                <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                  selectedQuote.status === 'Approved' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                }`}>
                  {selectedQuote.status}
                </div>
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest italic">Issued on {selectedQuote.issueDate}</span>
              </div>
              <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl" />
            </div>

            <div className="p-10 space-y-12 flex-1">
              {/* Line Items Ledger */}
              <div>
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-6 border-b border-gray-100 pb-4">Quotation Line Items</h3>
                <div className="space-y-4">
                  {selectedQuote.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-5 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="text-sm font-black text-gray-900 truncate">{item.description}</p>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">QTY: {item.quantity} • UNIT: ${item.unitPrice.toLocaleString()}</p>
                      </div>
                      <p className="text-sm font-black text-gray-900">${item.total.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Financial Recap */}
              <div className="bg-white border-2 border-gray-100 rounded-[2.5rem] p-8 space-y-4 shadow-sm">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Net Amount</span>
                  <span className="text-sm font-black text-gray-900">${selectedQuote.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Tax Provision ({(selectedQuote.taxRate * 100).toFixed(0)}%)</span>
                  <span className="text-sm font-black text-gray-900">${(selectedQuote.subtotal * selectedQuote.taxRate).toLocaleString()}</span>
                </div>
                <div className="pt-4 border-t-2 border-gray-50 flex justify-between items-center">
                  <span className="text-sm font-black text-gray-900 uppercase tracking-widest">Total Valuation</span>
                  <span className="text-2xl font-black text-emerald-600">${selectedQuote.totalAmount.toLocaleString()}</span>
                </div>
              </div>

              {/* Administrative Notes */}
              <div className="bg-amber-50/50 p-8 rounded-[2.5rem] border border-amber-100">
                <h4 className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-3">Proposal Notes</h4>
                <p className="text-sm text-amber-900/70 font-medium leading-relaxed italic">
                  {selectedQuote.notes || "No internal administrative notes recorded for this proposal."}
                </p>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="p-10 sticky bottom-0 bg-white border-t border-gray-100 flex flex-col gap-4">
              <button 
                onClick={() => setSelectedQuote(null)}
                className="w-full py-5 bg-emerald-600 text-white rounded-[2rem] font-black uppercase tracking-[0.25em] text-xs hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 flex items-center justify-center gap-3"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                Dispatch to Client
              </button>
              <div className="grid grid-cols-2 gap-4">
                <button className="py-4 border-2 border-gray-900 text-gray-900 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-50 transition-all">
                  Download PDF
                </button>
                <button className="py-4 border-2 border-gray-200 text-gray-400 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-50 transition-all">
                  Revise Draft
                </button>
              </div>
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
