'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

type Category = 'Raw Materials' | 'Equipment' | 'Services' | 'Logistics';
type Status = 'Active' | 'Inactive' | 'On Hold';

type Vendor = {
  id: string;
  name: string;
  email: string;
  phone: string;
  category: Category;
  rating: number;
  status: Status;
  paymentTerms: string;
  location: string;
  lastContact: string;
  totalOrders: number;
  totalSpent: string;
};

const CATEGORIES: Category[] = ['Raw Materials', 'Equipment', 'Services', 'Logistics'];
const STATUSES: Status[] = ['Active', 'Inactive', 'On Hold'];

const CATEGORY_STYLES: Record<Category, string> = {
  'Raw Materials': 'bg-blue-50 text-blue-700',
  Equipment: 'bg-violet-50 text-violet-700',
  Services: 'bg-teal-50 text-teal-700',
  Logistics: 'bg-orange-50 text-orange-700',
};

const STATUS_STYLES: Record<Status, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Inactive: 'bg-gray-100 text-gray-600',
  'On Hold': 'bg-amber-50 text-amber-700',
};

const INITIAL_VENDORS: Vendor[] = [
  { id: 'V-001', name: 'Premium Steel Supplies', email: 'info@premiumsteel.com', phone: '+1-555-0101', category: 'Raw Materials', rating: 4.8, status: 'Active', paymentTerms: 'Net 30', location: 'Cleveland, OH', lastContact: 'Mar 28', totalOrders: 145, totalSpent: '$285,000' },
  { id: 'V-002', name: 'Global Electronics Ltd', email: 'sales@globalelec.com', phone: '+1-555-0102', category: 'Equipment', rating: 4.5, status: 'Active', paymentTerms: 'Net 45', location: 'San Jose, CA', lastContact: 'Mar 25', totalOrders: 89, totalSpent: '$450,200' },
  { id: 'V-003', name: 'Swift Logistics Partners', email: 'ops@swiftlogistics.com', phone: '+1-555-0103', category: 'Logistics', rating: 4.6, status: 'Active', paymentTerms: 'Net 15', location: 'Atlanta, GA', lastContact: 'Mar 29', totalOrders: 267, totalSpent: '$125,300' },
  { id: 'V-004', name: 'Tech Maintenance Services', email: 'support@techmaint.com', phone: '+1-555-0104', category: 'Services', rating: 4.3, status: 'Active', paymentTerms: 'Monthly', location: 'Boston, MA', lastContact: 'Mar 20', totalOrders: 42, totalSpent: '$95,600' },
  { id: 'V-005', name: 'Industrial Polymers Inc', email: 'contact@indpoly.com', phone: '+1-555-0105', category: 'Raw Materials', rating: 4.2, status: 'Active', paymentTerms: 'Net 60', location: 'Houston, TX', lastContact: 'Mar 15', totalOrders: 67, totalSpent: '$320,500' },
  { id: 'V-006', name: 'Precision Machine Tools', email: 'sales@precisiontools.com', phone: '+1-555-0106', category: 'Equipment', rating: 4.9, status: 'Active', paymentTerms: 'Net 30', location: 'Detroit, MI', lastContact: 'Mar 27', totalOrders: 53, totalSpent: '$875,200' },
  { id: 'V-007', name: 'Chemical Solutions Group', email: 'inquiry@chemsol.com', phone: '+1-555-0107', category: 'Raw Materials', rating: 3.8, status: 'On Hold', paymentTerms: 'Net 45', location: 'Newark, NJ', lastContact: 'Mar 10', totalOrders: 34, totalSpent: '$189,400' },
  { id: 'V-008', name: 'Express Courier Network', email: 'dispatch@expresscourier.com', phone: '+1-555-0108', category: 'Logistics', rating: 4.4, status: 'Active', paymentTerms: 'Net 15', location: 'Chicago, IL', lastContact: 'Mar 29', totalOrders: 512, totalSpent: '$234,100' },
  { id: 'V-009', name: 'Quality Control Labs', email: 'testing@qclab.com', phone: '+1-555-0109', category: 'Services', rating: 4.7, status: 'Active', paymentTerms: 'Monthly', location: 'Austin, TX', lastContact: 'Mar 26', totalOrders: 28, totalSpent: '$76,800' },
  { id: 'V-010', name: 'Sustainable Packaging Co', email: 'orders@sustpack.com', phone: '+1-555-0110', category: 'Raw Materials', rating: 4.6, status: 'Active', paymentTerms: 'Net 30', location: 'Portland, OR', lastContact: 'Mar 22', totalOrders: 78, totalSpent: '$142,300' },
];

function parseSpent(value: string): number {
  return Number(value.replace(/[^0-9.]/g, '')) || 0;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString()}`;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const inputClass =
  'w-full rounded-xl bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30';
const labelClass = 'block text-xs font-medium text-gray-600 mb-1.5';

export default function VendorsSuppliersPage() {
  const [vendors, setVendors] = useState<Vendor[]>(INITIAL_VENDORS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'All' | Category>('All');
  const [selectedStatus, setSelectedStatus] = useState<'All' | Status>('All');
  const [draft, setDraft] = useState<Vendor | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDrawer();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vendors.filter((v) => {
      const matchesSearch =
        q.length === 0 ||
        v.name.toLowerCase().includes(q) ||
        v.email.toLowerCase().includes(q) ||
        v.location.toLowerCase().includes(q);
      const matchesCategory = selectedCategory === 'All' || v.category === selectedCategory;
      const matchesStatus = selectedStatus === 'All' || v.status === selectedStatus;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [vendors, searchQuery, selectedCategory, selectedStatus]);

  const totals = useMemo(
    () => ({
      count: vendors.length,
      active: vendors.filter((v) => v.status === 'Active').length,
      onHold: vendors.filter((v) => v.status === 'On Hold').length,
      spent: vendors.reduce((acc, v) => acc + parseSpent(v.totalSpent), 0),
    }),
    [vendors],
  );

  const openVendor = (vendor: Vendor) => {
    setDraft({ ...vendor });
    setIsNew(false);
  };

  const startAdd = () => {
    const max = vendors.reduce((m, v) => Math.max(m, Number(v.id.replace(/\D/g, '')) || 0), 0);
    setDraft({
      id: `V-${String(max + 1).padStart(3, '0')}`,
      name: '',
      email: '',
      phone: '',
      category: 'Services',
      rating: 0,
      status: 'Active',
      paymentTerms: 'Net 30',
      location: '',
      lastContact: '',
      totalOrders: 0,
      totalSpent: '$0',
    });
    setIsNew(true);
  };

  const closeDrawer = () => {
    setDraft(null);
    setIsNew(false);
  };

  const save = () => {
    if (!draft) return;
    setVendors((current) =>
      isNew ? [draft, ...current] : current.map((v) => (v.id === draft.id ? draft : v)),
    );
    closeDrawer();
  };

  const remove = () => {
    if (!draft) return;
    setVendors((current) => current.filter((v) => v.id !== draft.id));
    closeDrawer();
  };

  return (
    <div className="min-h-screen bg-gray-50/50 p-4 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-6 lg:space-y-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">Vendors &amp; suppliers</h1>
            <p className="mt-1 text-sm text-gray-500">Your supplier directory — contacts, terms, and spend.</p>
          </div>
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
            </svg>
            Add vendor
          </button>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <SummaryCard label="Vendors" value={`${totals.count}`} accent="text-primary" />
          <SummaryCard label="Active" value={`${totals.active}`} />
          <SummaryCard label="On hold" value={`${totals.onHold}`} accent={totals.onHold > 0 ? 'text-amber-600' : 'text-gray-900'} />
          <SummaryCard label="Total spent" value={formatUsd(totals.spent)} />
        </div>

        <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <svg
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by name, email, or location…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 transition focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto">
              {(['All', ...STATUSES] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setSelectedStatus(status)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    selectedStatus === status ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto border-t border-gray-50 pt-2">
            {(['All', ...CATEGORIES] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedCategory === cat ? 'bg-primary/10 text-primary' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="space-y-3">
            {filtered.map((vendor) => (
              <button
                key={vendor.id}
                type="button"
                onClick={() => openVendor(vendor)}
                className="group w-full rounded-2xl border border-gray-100 bg-white p-4 text-left transition-colors hover:border-primary/30 sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                      {initials(vendor.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary">
                          {vendor.name || 'Untitled vendor'}
                        </h3>
                        <Badge className={CATEGORY_STYLES[vendor.category]}>{vendor.category}</Badge>
                        <Badge className={STATUS_STYLES[vendor.status]}>{vendor.status}</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm text-gray-500">
                        {vendor.location}
                        {vendor.email ? ` · ${vendor.email}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {vendor.paymentTerms} · {vendor.totalOrders} orders
                        {vendor.lastContact ? ` · last contact ${vendor.lastContact}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <svg className="h-4 w-4 text-secondary" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      <span className="text-sm font-semibold text-gray-900">{vendor.rating || '—'}</span>
                    </div>
                    <p className="mt-1.5 text-base font-bold text-primary">{vendor.totalSpent}</p>
                    <p className="text-xs text-gray-400">total spent</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-gray-300">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3m4-14h10M7 11h10M7 15h4" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">No vendors found</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">Try a different search or clear the filters.</p>
          </div>
        )}
      </div>

      {draft && (
        <>
          <div className="fixed inset-0 z-40 bg-gray-900/30 backdrop-blur-sm" onClick={closeDrawer} />
          <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">{isNew ? 'New vendor' : 'Edit vendor'}</h2>
              <button type="button" onClick={closeDrawer} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-6 px-6 py-6">
              <div>
                <label className={labelClass}>Vendor name</label>
                <input
                  type="text"
                  value={draft.name}
                  placeholder="Company name"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full rounded-xl bg-gray-50 px-4 py-3 text-lg font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Category</label>
                  <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })} className={inputClass}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })} className={inputClass}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Phone</label>
                  <input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Location</label>
                  <input type="text" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Payment terms</label>
                  <input type="text" value={draft.paymentTerms} placeholder="e.g. Net 30" onChange={(e) => setDraft({ ...draft, paymentTerms: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Rating (0–5)</label>
                  <input
                    type="number"
                    min="0"
                    max="5"
                    step="0.1"
                    value={draft.rating}
                    onChange={(e) => setDraft({ ...draft, rating: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Last contact</label>
                  <input type="text" value={draft.lastContact} placeholder="e.g. Mar 28" onChange={(e) => setDraft({ ...draft, lastContact: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Total orders</label>
                  <input
                    type="number"
                    min="0"
                    value={draft.totalOrders}
                    onChange={(e) => setDraft({ ...draft, totalOrders: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Total spent</label>
                  <input type="text" value={draft.totalSpent} placeholder="$0" onChange={(e) => setDraft({ ...draft, totalSpent: e.target.value })} className={inputClass} />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 flex items-center gap-2.5 border-t border-gray-100 bg-white px-6 py-4">
              {!isNew && (
                <button type="button" onClick={remove} className="text-sm font-medium text-rose-600 transition-colors hover:text-rose-800">
                  Delete
                </button>
              )}
              <button type="button" onClick={closeDrawer} className="ml-auto rounded-xl px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={save} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90">
                {isNew ? 'Add vendor' : 'Save changes'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

function SummaryCard({ label, value, accent = 'text-gray-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 lg:p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-2 text-xl font-bold lg:text-2xl ${accent}`}>{value}</p>
    </div>
  );
}
