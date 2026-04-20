'use client';

import React, { useState } from 'react';

// --- Types ---
type ContactStatus = 'online' | 'offline' | 'away' | 'busy';
type ContactCategory = 'Internal' | 'Client' | 'Vendor' | 'Partner';
type ContactFilter = 'All' | ContactCategory;

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  category: ContactCategory;
  status: ContactStatus;
  avatar?: string;
  location: string;
  lastActive: string;
  tags: string[];
  bio?: string;
}

// --- Mock Data ---
const MOCK_CONTACTS: Contact[] = [
  {
    id: 'CON-001',
    name: 'Sarah Smith',
    email: 'sarah.smith@example.com',
    phone: '+1 (555) 123-4567',
    role: 'Senior UI Designer',
    department: 'Product Design',
    category: 'Internal',
    status: 'online',
    avatar: 'SS',
    location: 'New York, USA',
    lastActive: 'Now',
    tags: ['Design', 'Lead', 'Remote'],
    bio: 'Lead designer with 10+ years experience in enterprise SaaS interfaces.'
  },
  {
    id: 'CON-002',
    name: 'Michael Ross',
    email: 'm.ross@client-corp.com',
    phone: '+1 (555) 987-6543',
    role: 'Procurement Manager',
    department: 'Supply Chain',
    category: 'Client',
    status: 'away',
    avatar: 'MR',
    location: 'Chicago, USA',
    lastActive: '2h ago',
    tags: ['Key Client', 'High Priority'],
    bio: 'Primary contact for the Alpha Project at Client Corp.'
  },
  {
    id: 'CON-003',
    name: 'Emily Blunt',
    email: 'emily.b@example.com',
    phone: '+1 (555) 246-8135',
    role: 'Frontend Developer',
    department: 'Engineering',
    category: 'Internal',
    status: 'offline',
    avatar: 'EB',
    location: 'London, UK',
    lastActive: 'Yesterday',
    tags: ['React', 'TypeScript', 'Engineer'],
    bio: 'Core contributor to the internal component library.'
  },
  {
    id: 'CON-004',
    name: 'John Doe',
    email: 'j.doe@vendor-link.com',
    phone: '+1 (555) 369-1470',
    role: 'Account Executive',
    department: 'Sales',
    category: 'Vendor',
    status: 'busy',
    avatar: 'JD',
    location: 'San Francisco, USA',
    lastActive: '15m ago',
    tags: ['Logistics', 'Contractor'],
    bio: 'Account manager for all hardware procurement needs.'
  },
  {
    id: 'CON-005',
    name: 'Olivia Wilson',
    email: 'o.wilson@partner-net.com',
    phone: '+1 (555) 753-9514',
    role: 'Strategic Partner',
    department: 'Business Development',
    category: 'Partner',
    status: 'online',
    avatar: 'OW',
    location: 'Berlin, Germany',
    lastActive: 'Now',
    tags: ['Integration', 'Strategy'],
    bio: 'Managing the joint-venture operations in the EU region.'
  },
  {
    id: 'CON-006',
    name: 'David Miller',
    email: 'david.m@example.com',
    phone: '+1 (555) 159-4826',
    role: 'Security Analyst',
    department: 'IT Security',
    category: 'Internal',
    status: 'online',
    avatar: 'DM',
    location: 'Austin, USA',
    lastActive: 'Now',
    tags: ['Security', 'Infra'],
    bio: 'Responsible for platform audit trails and access control monitoring.'
  }
];

export default function ContactListPage() {
  const [contacts] = useState<Contact[]>(MOCK_CONTACTS);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<ContactFilter>('All');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const filterOptions: ContactFilter[] = ['All', 'Internal', 'Client', 'Vendor', 'Partner'];

  const filteredContacts = contacts.filter((contact) => {
    const matchesSearch = 
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.role.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = activeFilter === 'All' || contact.category === activeFilter;
    
    return matchesSearch && matchesFilter;
  });

  const getStatusColor = (status: ContactStatus) => {
    switch (status) {
      case 'online': return 'bg-emerald-500';
      case 'away': return 'bg-amber-500';
      case 'busy': return 'bg-rose-500';
      default: return 'bg-gray-400';
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
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Contact List</h1>
            <p className="text-gray-500 mt-1 font-medium">Manage your network and internal directory</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4-4m4 4V4" />
              </svg>
              Export
            </button>
            <button className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Contact
            </button>
          </div>
        </div>

        {/* Toolbar Section */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm mb-8 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1">
            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, email or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
            />
          </div>
          <div className="flex items-center gap-2">
            {filterOptions.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activeFilter === filter 
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm' 
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-gray-100 hidden lg:block mx-2" />
          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-lg">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>

        {/* Contacts Grid/List */}
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredContacts.map((contact) => (
              <div
                key={contact.id}
                onClick={() => setSelectedContact(contact)}
                className="group bg-white rounded-3xl p-6 border border-gray-100 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/5 transition-all duration-300 cursor-pointer relative overflow-hidden"
              >
                <div className="flex items-start justify-between mb-4 relative z-10">
                  <div className="relative">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-inner ${getAvatarColor(contact.name)}`}>
                      {contact.avatar}
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${getStatusColor(contact.status)}`} />
                  </div>
                  <button className="text-gray-300 hover:text-emerald-500 transition-colors">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                    </svg>
                  </button>
                </div>

                <div className="relative z-10">
                  <h3 className="text-lg font-bold text-gray-900 group-hover:text-emerald-700 transition-colors truncate">
                    {contact.name}
                  </h3>
                  <p className="text-sm text-gray-500 font-medium mb-4">{contact.role}</p>
                  
                  <div className="space-y-2 mb-6 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="truncate">{contact.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span>{contact.location}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-50">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      contact.category === 'Internal' ? 'bg-blue-50 text-blue-600' :
                      contact.category === 'Client' ? 'bg-amber-50 text-amber-600' :
                      contact.category === 'Vendor' ? 'bg-purple-50 text-purple-600' :
                      'bg-emerald-50 text-emerald-600'
                    }`}>
                      {contact.category}
                    </span>
                    {contact.tags.slice(0, 1).map(tag => (
                      <span key={tag} className="px-3 py-1 rounded-full text-[10px] font-bold bg-gray-50 text-gray-500 uppercase tracking-wider">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Hover background effect */}
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full -mr-12 -mt-12 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-wider">Contact</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-wider">Role & Dept</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-wider">Category</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-wider">Last Active</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredContacts.map((contact) => (
                  <tr 
                    key={contact.id} 
                    onClick={() => setSelectedContact(contact)}
                    className="hover:bg-gray-50 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 ${getAvatarColor(contact.name)}`}>
                          {contact.avatar}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900 group-hover:text-emerald-700 transition-colors">{contact.name}</p>
                          <p className="text-xs text-gray-500">{contact.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-600">
                      <p className="text-gray-900">{contact.role}</p>
                      <p className="text-xs opacity-60">{contact.department}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                        contact.category === 'Internal' ? 'bg-blue-50 text-blue-600' :
                        contact.category === 'Client' ? 'bg-amber-50 text-amber-600' :
                        contact.category === 'Vendor' ? 'bg-purple-50 text-purple-600' :
                        'bg-emerald-50 text-emerald-600'
                      }`}>
                        {contact.category}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(contact.status)}`} />
                        <span className="text-xs font-bold text-gray-600 capitalize">{contact.status}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-gray-500">{contact.lastActive}</td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-gray-300 hover:text-emerald-500 transition-colors">
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty State */}
        {filteredContacts.length === 0 && (
          <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-gray-200">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900">No contacts found</h3>
            <p className="text-gray-500 mt-1">Try adjusting your search or filters.</p>
          </div>
        )}
      </div>

      {/* Contact Details Drawer */}
      {selectedContact && (
        <>
          <div 
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 transition-all duration-500"
            onClick={() => setSelectedContact(null)}
          />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-500 ease-out border-l border-gray-100 flex flex-col">
            <div className="p-8 pb-0 flex flex-col items-center text-center">
              <div className="w-full flex justify-end">
                <button 
                  onClick={() => setSelectedContact(null)}
                  className="p-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="relative mt-2 mb-4">
                <div className={`w-32 h-32 rounded-[2.5rem] flex items-center justify-center text-white font-bold text-4xl shadow-xl ${getAvatarColor(selectedContact.name)}`}>
                  {selectedContact.avatar}
                </div>
                <div className={`absolute bottom-2 right-2 w-7 h-7 rounded-full border-4 border-white ${getStatusColor(selectedContact.status)}`} />
              </div>
              <h2 className="text-2xl font-black text-gray-900">{selectedContact.name}</h2>
              <p className="text-emerald-600 font-bold uppercase tracking-widest text-xs mt-1">{selectedContact.role}</p>
              
              <div className="flex gap-2 mt-6">
                <button className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100">
                  Message
                </button>
                <button className="p-2.5 bg-gray-50 text-gray-600 rounded-xl hover:bg-gray-100 transition-all">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                </button>
                <button className="p-2.5 bg-gray-50 text-gray-600 rounded-xl hover:bg-gray-100 transition-all">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-8 flex-1">
              <div className="space-y-8">
                {/* About Section */}
                <div>
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">About</h4>
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    {selectedContact.bio}
                  </p>
                </div>

                {/* Details Section */}
                <div className="grid grid-cols-2 gap-6 bg-gray-50 p-5 rounded-2xl border border-gray-100">
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Department</p>
                    <p className="text-sm font-bold text-gray-800">{selectedContact.department}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Location</p>
                    <p className="text-sm font-bold text-gray-800">{selectedContact.location}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Category</p>
                    <p className="text-sm font-bold text-gray-800">{selectedContact.category}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">Last Active</p>
                    <p className="text-sm font-bold text-emerald-600">{selectedContact.lastActive}</p>
                  </div>
                </div>

                {/* Contact Methods */}
                <div className="space-y-4">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">Contact Info</h4>
                  <div className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl hover:border-emerald-200 transition-all cursor-pointer group">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                         <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="text-sm font-bold text-gray-700">{selectedContact.email}</span>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl hover:border-emerald-200 transition-all cursor-pointer group">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                      </div>
                      <span className="text-sm font-bold text-gray-700">{selectedContact.phone}</span>
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                </div>

                {/* Tags */}
                <div>
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Tags</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedContact.tags.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-wider rounded-lg">
                        {tag}
                      </span>
                    ))}
                    <button className="px-3 py-1 border border-dashed border-gray-300 text-gray-400 text-[10px] font-bold uppercase tracking-wider rounded-lg hover:bg-gray-50 transition-colors">
                      + Add Tag
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="p-8 pt-4 bg-white border-t border-gray-50 sticky bottom-0">
               <button className="w-full py-4 bg-gray-900 text-white rounded-[1.5rem] font-bold hover:bg-black transition-all shadow-xl shadow-gray-200 mb-3">
                Edit Contact
              </button>
              <button className="w-full py-3 text-red-500 font-bold text-sm hover:text-red-700 transition-all">
                Archive Profile
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
