'use client';

import React, { useState } from 'react';

// --- Types (mirror lib/feedback.ts) ---
type FeedbackCategory = 'Bug Report' | 'Feature Idea' | 'Improvement' | 'Technical Support';
type FeedbackFilter = 'All' | FeedbackCategory;

type FeedbackItem = {
  id: number;
  title: string;
  description: string;
  category: string;
  status: string;
  author: { id: number; name: string };
  upvotes: number;
  commentCount: number;
  isUpvoted: boolean;
  createdAt: string;
};

type FeedbackStats = {
  total: number;
  implemented: number;
  planned: number;
  underReview: number;
};

type FeedbackComment = {
  id: number;
  body: string;
  author: { id: number; name: string };
  createdAt: string;
};

type Props = {
  currentUser: { id: number; name: string };
  isAdmin: boolean;
  initialItems: FeedbackItem[];
  initialStats: FeedbackStats;
};

const FILTER_OPTIONS: FeedbackFilter[] = ['All', 'Bug Report', 'Feature Idea', 'Improvement', 'Technical Support'];
const CATEGORY_OPTIONS: FeedbackCategory[] = ['Improvement', 'Feature Idea', 'Bug Report', 'Technical Support'];
const STATUS_OPTIONS = ['New', 'Under Review', 'Planned', 'Implemented', 'Declined'] as const;

function computeStats(items: FeedbackItem[]): FeedbackStats {
  return {
    total: items.length,
    implemented: items.filter((i) => i.status === 'Implemented').length,
    planned: items.filter((i) => i.status === 'Planned').length,
    underReview: items.filter((i) => i.status === 'Under Review').length,
  };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function timeAgo(iso: string) {
  const then = new Date(iso).getTime();
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'New': return 'bg-blue-50 text-blue-600 border-blue-100';
    case 'Under Review': return 'bg-amber-50 text-amber-600 border-amber-100';
    case 'Planned': return 'bg-purple-50 text-purple-600 border-purple-100';
    case 'Implemented': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    case 'Declined': return 'bg-gray-50 text-gray-500 border-gray-100';
    default: return 'bg-gray-50 text-gray-500 border-gray-100';
  }
}

export default function FeedbackClient({ currentUser, isAdmin, initialItems, initialStats }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>(initialItems);
  const [stats, setStats] = useState<FeedbackStats>(initialStats);
  const [activeFilter, setActiveFilter] = useState<FeedbackFilter>('All');
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Submission form
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('Improvement');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Comments
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [commentsByFeedback, setCommentsByFeedback] = useState<Record<number, FeedbackComment[]>>({});
  const [commentInput, setCommentInput] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const filteredItems = items.filter((item) => activeFilter === 'All' || item.category === activeFilter);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!title.trim() || !description.trim()) {
      setFormError('Please add a title and description.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, category }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setFormError(data?.error ?? 'Could not submit feedback.');
        return;
      }
      const data = (await res.json()) as { item?: FeedbackItem };
      if (data.item) {
        setItems((prev) => [data.item as FeedbackItem, ...prev]);
        setStats((prev) => ({ ...prev, total: prev.total + 1 }));
      }
      setTitle('');
      setDescription('');
      setCategory('Improvement');
      setIsFormOpen(false);
    } catch {
      setFormError('Could not submit feedback.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpvote = async (item: FeedbackItem) => {
    // Optimistic toggle
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? { ...it, isUpvoted: !it.isUpvoted, upvotes: it.upvotes + (it.isUpvoted ? -1 : 1) }
          : it,
      ),
    );
    try {
      const res = await fetch(`/api/feedback/${item.id}/upvote`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { isUpvoted: boolean; upvotes: number };
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, isUpvoted: data.isUpvoted, upvotes: data.upvotes } : it,
        ),
      );
    } catch {
      // Revert on failure
      setItems((prev) =>
        prev.map((it) =>
          it.id === item.id
            ? { ...it, isUpvoted: item.isUpvoted, upvotes: item.upvotes }
            : it,
        ),
      );
    }
  };

  const handleStatusChange = async (item: FeedbackItem, status: string) => {
    if (status === item.status) return;
    const previousStatus = item.status;
    // Optimistic update + recompute stats locally.
    setItems((prev) => {
      const next = prev.map((it) => (it.id === item.id ? { ...it, status } : it));
      setStats(computeStats(next));
      return next;
    });
    try {
      const res = await fetch(`/api/feedback/${item.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      // Revert on failure
      setItems((prev) => {
        const next = prev.map((it) => (it.id === item.id ? { ...it, status: previousStatus } : it));
        setStats(computeStats(next));
        return next;
      });
    }
  };

  const toggleComments = async (feedbackId: number) => {
    if (expandedId === feedbackId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(feedbackId);
    setCommentInput('');
    if (!commentsByFeedback[feedbackId]) {
      try {
        const res = await fetch(`/api/feedback/${feedbackId}/comments`, { credentials: 'include' });
        if (res.ok) {
          const data = (await res.json()) as { comments?: FeedbackComment[] };
          setCommentsByFeedback((prev) => ({ ...prev, [feedbackId]: data.comments ?? [] }));
        }
      } catch {
        // ignore
      }
    }
  };

  const handleAddComment = async (feedbackId: number) => {
    const text = commentInput.trim();
    if (!text || commentSubmitting) return;
    setCommentSubmitting(true);
    try {
      const res = await fetch(`/api/feedback/${feedbackId}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { comment?: FeedbackComment };
      if (data.comment) {
        setCommentsByFeedback((prev) => ({
          ...prev,
          [feedbackId]: [...(prev[feedbackId] ?? []), data.comment as FeedbackComment],
        }));
        setItems((prev) =>
          prev.map((it) => (it.id === feedbackId ? { ...it, commentCount: it.commentCount + 1 } : it)),
        );
        setCommentInput('');
      }
    } catch {
      // ignore
    } finally {
      setCommentSubmitting(false);
    }
  };

  const statCards = [
    { label: 'Total Ideas', count: stats.total, color: 'text-gray-900' },
    { label: 'Implemented', count: stats.implemented, color: 'text-emerald-600' },
    { label: 'Planned', count: stats.planned, color: 'text-purple-600' },
    { label: 'Under Review', count: stats.underReview, color: 'text-amber-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Feedback &amp; Ideas</h1>
            <p className="text-gray-500 mt-1 font-medium">Help us improve the platform with your suggestions</p>
          </div>
          <button
            onClick={() => setIsFormOpen(!isFormOpen)}
            className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Submit Feedback
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statCards.map((stat, i) => (
            <div key={i} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.count}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Feed */}
          <div className="lg:col-span-2 space-y-6">
            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {FILTER_OPTIONS.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(cat)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                    activeFilter === cat
                      ? 'bg-gray-900 text-white shadow-md'
                      : 'bg-white text-gray-500 border border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Feedback List */}
            <div className="space-y-4">
              {filteredItems.length === 0 ? (
                <div className="bg-white rounded-3xl p-10 border border-gray-100 shadow-sm text-center">
                  <p className="text-sm font-bold text-gray-400">No feedback here yet. Be the first to share an idea.</p>
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div key={item.id} className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm hover:border-emerald-200 transition-all group">
                    <div className="flex gap-6">
                      {/* Upvote Column */}
                      <div className="flex flex-col items-center gap-1">
                        <button
                          onClick={() => handleUpvote(item)}
                          className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center transition-all ${
                            item.isUpvoted ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' : 'bg-gray-50 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600'
                          }`}
                          aria-pressed={item.isUpvoted}
                          aria-label={item.isUpvoted ? 'Remove upvote' : 'Upvote'}
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 4l-8 8h16l-8-8z" />
                          </svg>
                          <span className="text-xs font-black">{item.upvotes}</span>
                        </button>
                      </div>

                      {/* Content Column */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          {isAdmin ? (
                            <select
                              value={item.status}
                              onChange={(e) => handleStatusChange(item, e.target.value)}
                              className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border cursor-pointer focus:ring-2 focus:ring-emerald-500 ${getStatusStyle(item.status)}`}
                              aria-label="Change status"
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${getStatusStyle(item.status)}`}>
                              {item.status}
                            </span>
                          )}
                          <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">{item.category}</span>
                        </div>
                        <h3 className="text-lg font-black text-gray-900 mb-2 group-hover:text-emerald-700 transition-colors">
                          {item.title}
                        </h3>
                        <p className="text-gray-500 text-sm font-medium leading-relaxed mb-4 whitespace-pre-wrap">
                          {item.description}
                        </p>

                        <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-[10px]">
                              {initials(item.author.name)}
                            </div>
                            <p className="text-xs font-bold text-gray-400">
                              By <span className="text-gray-900">{item.author.id === currentUser.id ? 'You' : item.author.name}</span> • {timeAgo(item.createdAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-4 text-gray-400">
                            <button
                              onClick={() => toggleComments(item.id)}
                              className={`flex items-center gap-1.5 text-xs font-bold transition-colors ${expandedId === item.id ? 'text-emerald-600' : 'hover:text-emerald-600'}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              {item.commentCount}
                            </button>
                          </div>
                        </div>

                        {/* Comment thread */}
                        {expandedId === item.id && (
                          <div className="mt-4 pt-4 border-t border-gray-50 space-y-3">
                            {(commentsByFeedback[item.id] ?? []).length === 0 ? (
                              <p className="text-xs font-medium text-gray-400">No comments yet. Start the discussion.</p>
                            ) : (
                              (commentsByFeedback[item.id] ?? []).map((comment) => (
                                <div key={comment.id} className="flex gap-3">
                                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-bold text-[9px] shrink-0">
                                    {initials(comment.author.name)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-gray-900">
                                      {comment.author.id === currentUser.id ? 'You' : comment.author.name}
                                      <span className="text-gray-400 font-medium"> • {timeAgo(comment.createdAt)}</span>
                                    </p>
                                    <p className="text-sm text-gray-600 font-medium whitespace-pre-wrap break-words">{comment.body}</p>
                                  </div>
                                </div>
                              ))
                            )}

                            <div className="flex items-center gap-2 pt-1">
                              <input
                                type="text"
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleAddComment(item.id);
                                  }
                                }}
                                placeholder="Write a comment..."
                                className="flex-1 px-3 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                              />
                              <button
                                onClick={() => handleAddComment(item.id)}
                                disabled={!commentInput.trim() || commentSubmitting}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                                  commentInput.trim() && !commentSubmitting ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                Post
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Sidebar / Submission Form */}
          <div className="space-y-8">
            <div className={`bg-white rounded-[2.5rem] p-8 border-2 transition-all duration-300 ${isFormOpen ? 'border-emerald-500 shadow-2xl shadow-emerald-500/10' : 'border-transparent shadow-sm'}`}>
              <h3 className="text-xl font-black text-gray-900 mb-6">New Suggestion</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Idea Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Briefly describe your idea..."
                    className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                    className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-bold text-gray-600"
                  >
                    {CATEGORY_OPTIONS.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Tell us more about it..."
                    rows={4}
                    className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 text-sm font-medium"
                  />
                </div>
                {formError && <p className="text-xs font-bold text-rose-500">{formError}</p>}
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-black transition-all shadow-xl shadow-gray-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Submitting...' : 'Submit to Board'}
                </button>
              </div>
            </div>

            {/* Guidelines */}
            <div className="bg-emerald-600 rounded-[2.5rem] p-8 text-white shadow-xl shadow-emerald-200">
              <h3 className="text-xl font-black mb-4">Submission Guide</h3>
              <ul className="space-y-3">
                {[
                  'Check for duplicate ideas first',
                  'Be specific about the problem',
                  'Explain the expected benefit',
                  'Keep it professional and concise',
                ].map((tip, i) => (
                  <li key={i} className="flex gap-3 text-sm font-medium text-white/80">
                    <svg className="w-5 h-5 shrink-0 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
