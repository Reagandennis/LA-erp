'use client';

import React, { useState } from 'react';

// --- Types ---
type BulletinCategory = 'Announcement' | 'Operational' | 'Safety' | 'General';
type Priority = 'High' | 'Medium' | 'Low';
type BulletinFilter = 'All' | BulletinCategory;

interface BulletinPost {
  id: string;
  title: string;
  content: string;
  author: {
    name: string;
    role: string;
    avatar: string;
  };
  category: BulletinCategory;
  priority: Priority;
  timestamp: string;
  attachments: Array<{ name: string; type: string; size: string }>;
  isPinned: boolean;
  viewCount: number;
}

// --- Mock Data ---
const MOCK_POSTS: BulletinPost[] = [
  {
    id: 'POST-001',
    title: 'New Health and Safety Protocols - Q2 2026',
    content: 'Please find attached the updated safety protocols for all field operations starting next month. All staff must review these by Friday.',
    author: { name: 'David Miller', role: 'Safety Officer', avatar: 'DM' },
    category: 'Safety',
    priority: 'High',
    timestamp: '2 hours ago',
    attachments: [
      { name: 'Safety_Protocols_Q2_2026.pdf', type: 'pdf', size: '2.4 MB' },
      { name: 'Emergency_Contacts.xlsx', type: 'excel', size: '1.1 MB' }
    ],
    isPinned: true,
    viewCount: 145
  },
  {
    id: 'POST-002',
    title: 'Upcoming System Maintenance',
    content: 'The central ERP system will be undergoing scheduled maintenance this Sunday from 02:00 to 06:00 UTC. Expect intermittent downtime during this window.',
    author: { name: 'IT Infrastructure', role: 'DevOps Team', avatar: 'IT' },
    category: 'Operational',
    priority: 'Medium',
    timestamp: '5 hours ago',
    attachments: [],
    isPinned: false,
    viewCount: 89
  },
  {
    id: 'POST-003',
    title: 'Quarterly Town Hall Meeting',
    content: 'Our next town hall is scheduled for next Tuesday. We will be discussing the expansion into the EMEA region and new project milestones.',
    author: { name: 'Sarah Smith', role: 'Chief of Staff', avatar: 'SS' },
    category: 'Announcement',
    priority: 'Low',
    timestamp: 'Yesterday',
    attachments: [
      { name: 'Townhall_Agenda.pdf', type: 'pdf', size: '540 KB' }
    ],
    isPinned: true,
    viewCount: 230
  }
];

export default function BulletinBoardPage() {
  const [posts] = useState<BulletinPost[]>(MOCK_POSTS);
  const [filter, setFilter] = useState<BulletinFilter>('All');
  const [isNewPostModalOpen, setIsNewPostModalOpen] = useState(false);
  const filterOptions: BulletinFilter[] = ['All', 'Announcement', 'Operational', 'Safety', 'General'];

  const filteredPosts = posts.filter(post => filter === 'All' || post.category === filter);
  const pinnedPosts = filteredPosts.filter(p => p.isPinned);
  const otherPosts = filteredPosts.filter(p => !p.isPinned);

  const getPriorityStyles = (priority: Priority) => {
    switch (priority) {
      case 'High': return 'bg-red-50 text-red-700 border-red-100';
      case 'Medium': return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'Low': return 'bg-blue-50 text-blue-700 border-blue-100';
    }
  };

  const getCategoryColor = (category: BulletinCategory) => {
    switch (category) {
      case 'Announcement': return 'text-purple-600';
      case 'Operational': return 'text-blue-600';
      case 'Safety': return 'text-rose-600';
      case 'General': return 'text-gray-600';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Bulletin Board</h1>
            <p className="text-gray-500 mt-1 font-medium">Important updates, announcements, and materials</p>
          </div>
          <button 
            onClick={() => setIsNewPostModalOpen(true)}
            className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Create Post
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
          {filterOptions.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                filter === cat 
                  ? 'bg-emerald-600 text-white shadow-md' 
                  : 'bg-white text-gray-600 border border-gray-100 hover:bg-gray-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Pinned Section Label */}
            {pinnedPosts.length > 0 && (
              <div className="flex items-center gap-2 px-2">
                <svg className="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16 9V4l1 1V2H7v2l1-1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
                </svg>
                <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">Pinned Important</h2>
              </div>
            )}

            {/* Pinned Posts */}
            {pinnedPosts.map((post) => (
              <PostCard key={post.id} post={post} styles={getPriorityStyles(post.priority)} catColor={getCategoryColor(post.category)} />
            ))}

            {/* Regular Section Label */}
            <div className="flex items-center gap-2 px-2 pt-4">
              <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">Latest Updates</h2>
            </div>

            {/* Other Posts */}
            {otherPosts.map((post) => (
              <PostCard key={post.id} post={post} styles="bg-white" catColor={getCategoryColor(post.category)} />
            ))}
          </div>

          {/* Sidebar Area */}
          <div className="space-y-8">
            {/* Stats / Quick Info */}
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Board Activity</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl">
                  <span className="text-sm font-medium text-gray-500">Total Posts</span>
                  <span className="text-sm font-bold text-gray-900">{posts.length}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl">
                  <span className="text-sm font-medium text-gray-500">My Pinned</span>
                  <span className="text-sm font-bold text-emerald-600">{posts.filter(p => p.isPinned).length}</span>
                </div>
              </div>
            </div>

            {/* Materials Quick Access */}
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Quick Materials</h3>
              <div className="space-y-3">
                {[
                  { name: 'Operating_Manual.pdf', size: '12 MB' },
                  { name: 'Brand_Guidelines.pdf', size: '4.5 MB' },
                  { name: 'Shift_Schedule_May.xlsx', size: '1.2 MB' }
                ].map((file, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-2xl border border-gray-50 hover:border-emerald-200 transition-all cursor-pointer group">
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate group-hover:text-emerald-700">{file.name}</p>
                      <p className="text-[10px] text-gray-400 font-medium">{file.size}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button className="w-full mt-4 py-3 text-emerald-600 font-bold text-sm hover:bg-emerald-50 rounded-xl transition-all">
                View All Library
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* New Post Modal Mockup */}
      {isNewPostModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Create New Post</h2>
              <button onClick={() => setIsNewPostModalOpen(false)} className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <input 
                type="text" 
                placeholder="Post Title" 
                className="w-full px-5 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
              />
              <div className="flex gap-3">
                <select className="flex-1 px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-600">
                  <option>Select Category</option>
                  <option>Announcement</option>
                  <option>Operational</option>
                  <option>Safety</option>
                </select>
                <select className="flex-1 px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-600">
                  <option>Select Priority</option>
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </div>
              <textarea 
                placeholder="Write your content here..." 
                rows={4}
                className="w-full px-5 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
              />
              <button className="w-full py-4 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 font-bold text-sm hover:border-emerald-300 hover:text-emerald-600 transition-all flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Attach Materials
              </button>
            </div>

            <div className="mt-8 flex gap-3">
              <button 
                onClick={() => setIsNewPostModalOpen(false)}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
              >
                Save Draft
              </button>
              <button 
                onClick={() => setIsNewPostModalOpen(false)}
                className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
              >
                Publish Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PostCard({ post, styles, catColor }: { post: BulletinPost, styles: string, catColor: string }) {
  return (
    <div className={`${styles} rounded-3xl p-6 border border-gray-100 shadow-sm hover:shadow-lg transition-all relative overflow-hidden group`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white font-black text-xs">
            {post.author.avatar}
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">{post.author.name}</p>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{post.timestamp} • {post.author.role}</p>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${styles === 'bg-white' ? 'bg-gray-50 text-gray-500' : 'bg-white/50'}`}>
          {post.priority} Priority
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-black uppercase tracking-[0.15em] ${catColor}`}>{post.category}</span>
          <div className="w-1 h-1 rounded-full bg-gray-300" />
          <span className="text-[10px] font-black text-gray-300 uppercase tracking-[0.15em]">ID: {post.id}</span>
        </div>
        <h3 className="text-xl font-black text-gray-900 group-hover:text-emerald-700 transition-colors mb-2">{post.title}</h3>
        <p className="text-gray-600 text-sm leading-relaxed font-medium">
          {post.content}
        </p>
      </div>

      {post.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {post.attachments.map((file, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 bg-white/40 border border-gray-100 rounded-xl text-xs font-bold text-gray-700 hover:bg-white transition-colors cursor-pointer">
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {file.name}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-6 border-t border-gray-100/50">
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-emerald-600 transition-colors">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {post.viewCount} views
          </button>
          <button className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-emerald-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Comment
          </button>
        </div>
        <button className={`p-2 rounded-xl transition-all ${post.isPinned ? 'text-emerald-600 bg-emerald-50' : 'text-gray-300 hover:text-emerald-500 hover:bg-gray-50'}`}>
           <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M16 9V4l1 1V2H7v2l1-1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
