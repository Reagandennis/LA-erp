'use client';

import { APP_LOCALE } from '@/lib/locale';
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

const BRAND = '#03458f';
const inputClass =
  'w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 focus:border-[#03458f]/40';

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
  return new Date(iso).toLocaleDateString(APP_LOCALE);
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'New': return 'bg-blue-50 text-blue-700 border-blue-100';
    case 'Under Review': return 'bg-amber-50 text-amber-700 border-amber-100';
    case 'Planned': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
    case 'Implemented': return 'bg-green-50 text-green-700 border-green-100';
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
    { label: 'Total ideas', count: stats.total },
    { label: 'Implemented', count: stats.implemented },
    { label: 'Planned', count: stats.planned },
    { label: 'Under review', count: stats.underReview },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Feedback &amp; Ideas</h1>
            <p className="text-gray-500 mt-1 text-sm">Help us improve the platform with your suggestions.</p>
          </div>
          <button
            onClick={() => setIsFormOpen(!isFormOpen)}
            className="self-start md:self-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors hover:opacity-95"
            style={{ backgroundColor: BRAND }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Submit feedback
          </button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {statCards.map((stat, i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{stat.label}</p>
              <p className="text-xl font-semibold text-gray-900">{stat.count}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Feed */}
          <div className="lg:col-span-2 space-y-5">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-white border border-gray-100 rounded-xl p-1 overflow-x-auto">
              {FILTER_OPTIONS.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    activeFilter === cat ? 'text-white' : 'text-gray-500 hover:bg-gray-50'
                  }`}
                  style={activeFilter === cat ? { backgroundColor: BRAND } : undefined}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Feedback List */}
            <div className="space-y-4">
              {filteredItems.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 border border-dashed border-gray-200 text-center">
                  <p className="text-sm text-gray-500">No feedback here yet. Be the first to share an idea.</p>
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div key={item.id} className="bg-white rounded-2xl p-5 border border-gray-100 hover:border-[#03458f]/40 hover:shadow-sm transition-all">
                    <div className="flex gap-4">
                      {/* Upvote Column */}
                      <div className="flex flex-col items-center gap-1">
                        <button
                          onClick={() => handleUpvote(item)}
                          className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center transition-colors border ${
                            item.isUpvoted
                              ? 'text-white border-transparent'
                              : 'bg-gray-50 text-gray-400 border-gray-100 hover:text-[#03458f] hover:border-[#03458f]/30'
                          }`}
                          style={item.isUpvoted ? { backgroundColor: BRAND } : undefined}
                          aria-pressed={item.isUpvoted}
                          aria-label={item.isUpvoted ? 'Remove upvote' : 'Upvote'}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 4l-8 8h16l-8-8z" />
                          </svg>
                          <span className="text-xs font-semibold">{item.upvotes}</span>
                        </button>
                      </div>

                      {/* Content Column */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          {isAdmin ? (
                            <select
                              value={item.status}
                              onChange={(e) => handleStatusChange(item, e.target.value)}
                              className={`px-2 py-0.5 rounded-md text-xs font-medium border cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 ${getStatusStyle(item.status)}`}
                              aria-label="Change status"
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          ) : (
                            <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${getStatusStyle(item.status)}`}>
                              {item.status}
                            </span>
                          )}
                          <span className="text-xs text-gray-400">{item.category}</span>
                        </div>
                        <h3 className="text-base font-semibold text-gray-900 mb-1.5">
                          {item.title}
                        </h3>
                        <p className="text-gray-500 text-sm leading-relaxed mb-4 whitespace-pre-wrap">
                          {item.description}
                        </p>

                        <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-semibold text-[10px]">
                              {initials(item.author.name)}
                            </div>
                            <p className="text-xs text-gray-400">
                              By <span className="text-gray-700 font-medium">{item.author.id === currentUser.id ? 'You' : item.author.name}</span> • {timeAgo(item.createdAt)}
                            </p>
                          </div>
                          <div className="flex items-center gap-4 text-gray-400">
                            <button
                              onClick={() => toggleComments(item.id)}
                              className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${expandedId === item.id ? 'text-[#03458f]' : 'hover:text-[#03458f]'}`}
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
                              <p className="text-xs text-gray-400">No comments yet. Start the discussion.</p>
                            ) : (
                              (commentsByFeedback[item.id] ?? []).map((comment) => (
                                <div key={comment.id} className="flex gap-3">
                                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 font-semibold text-[9px] shrink-0">
                                    {initials(comment.author.name)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-gray-900">
                                      {comment.author.id === currentUser.id ? 'You' : comment.author.name}
                                      <span className="text-gray-400 font-normal"> • {timeAgo(comment.createdAt)}</span>
                                    </p>
                                    <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">{comment.body}</p>
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
                                className="flex-1 px-3.5 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#03458f]/30 text-sm"
                              />
                              <button
                                onClick={() => handleAddComment(item.id)}
                                disabled={!commentInput.trim() || commentSubmitting}
                                className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                                style={commentInput.trim() && !commentSubmitting ? { backgroundColor: BRAND } : undefined}
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
          <div className="space-y-6">
            <div className={`bg-white rounded-2xl p-6 border transition-colors ${isFormOpen ? 'border-[#03458f]/40 shadow-sm' : 'border-gray-100'}`}>
              <h3 className="text-base font-semibold text-gray-900 mb-5">New suggestion</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Idea title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Briefly describe your idea..."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                    className={inputClass}
                  >
                    {CATEGORY_OPTIONS.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1.5 block">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Tell us more about it..."
                    rows={4}
                    className={inputClass}
                  />
                </div>
                {formError && <p className="text-xs text-rose-600">{formError}</p>}
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: BRAND }}
                >
                  {submitting ? 'Submitting...' : 'Submit to board'}
                </button>
              </div>
            </div>

            {/* Guidelines */}
            <div className="bg-white rounded-2xl p-6 border border-gray-100">
              <h3 className="text-base font-semibold text-gray-900 mb-4">Submission guide</h3>
              <ul className="space-y-3">
                {[
                  'Check for duplicate ideas first',
                  'Be specific about the problem',
                  'Explain the expected benefit',
                  'Keep it professional and concise',
                ].map((tip, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-600">
                    <svg className="w-5 h-5 shrink-0" style={{ color: BRAND }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
