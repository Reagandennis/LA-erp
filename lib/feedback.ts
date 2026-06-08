import 'server-only';

import { prisma } from '@/lib/prisma';

export const FEEDBACK_CATEGORIES = [
  'Bug Report',
  'Feature Idea',
  'Improvement',
  'Technical Support',
] as const;

export const FEEDBACK_STATUSES = [
  'New',
  'Under Review',
  'Planned',
  'Implemented',
  'Declined',
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackSummary = {
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

export type FeedbackStats = {
  total: number;
  implemented: number;
  planned: number;
  underReview: number;
};

export type FeedbackCommentSummary = {
  id: number;
  body: string;
  author: { id: number; name: string };
  createdAt: string;
};

export function isValidCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

export function isValidStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

/** List all feedback, most upvoted first, annotated for the current user. */
export async function listFeedback(userId: number): Promise<FeedbackSummary[]> {
  const rows = await prisma.feedback.findMany({
    orderBy: [{ createdAt: 'desc' }],
    include: {
      author: { select: { id: true, name: true } },
      _count: { select: { upvotes: true, comments: true } },
      upvotes: { where: { userId }, select: { id: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    status: row.status,
    author: { id: row.author.id, name: row.author.name },
    upvotes: row._count.upvotes,
    commentCount: row._count.comments,
    isUpvoted: row.upvotes.length > 0,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  const [total, implemented, planned, underReview] = await Promise.all([
    prisma.feedback.count(),
    prisma.feedback.count({ where: { status: 'Implemented' } }),
    prisma.feedback.count({ where: { status: 'Planned' } }),
    prisma.feedback.count({ where: { status: 'Under Review' } }),
  ]);
  return { total, implemented, planned, underReview };
}

export async function createFeedback(input: {
  userId: number;
  title: string;
  description: string;
  category: string;
}): Promise<FeedbackSummary> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title) throw new Error('Title is required');
  if (!description) throw new Error('Description is required');
  const category = isValidCategory(input.category) ? input.category : 'Improvement';

  const created = await prisma.feedback.create({
    data: { title, description, category, authorId: input.userId },
    include: {
      author: { select: { id: true, name: true } },
      _count: { select: { upvotes: true, comments: true } },
    },
  });

  return {
    id: created.id,
    title: created.title,
    description: created.description,
    category: created.category,
    status: created.status,
    author: { id: created.author.id, name: created.author.name },
    upvotes: created._count.upvotes,
    commentCount: created._count.comments,
    isUpvoted: false,
    createdAt: created.createdAt.toISOString(),
  };
}

/** Toggle the current user's upvote on a feedback item. Returns the new state. */
export async function toggleUpvote(
  userId: number,
  feedbackId: number,
): Promise<{ isUpvoted: boolean; upvotes: number } | null> {
  const feedback = await prisma.feedback.findUnique({ where: { id: feedbackId }, select: { id: true } });
  if (!feedback) return null;

  const existing = await prisma.feedbackUpvote.findUnique({
    where: { feedbackId_userId: { feedbackId, userId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.feedbackUpvote.delete({ where: { id: existing.id } });
  } else {
    await prisma.feedbackUpvote.create({ data: { feedbackId, userId } });
  }

  const upvotes = await prisma.feedbackUpvote.count({ where: { feedbackId } });
  return { isUpvoted: !existing, upvotes };
}

export async function listComments(feedbackId: number): Promise<FeedbackCommentSummary[] | null> {
  const feedback = await prisma.feedback.findUnique({ where: { id: feedbackId }, select: { id: true } });
  if (!feedback) return null;

  const rows = await prisma.feedbackComment.findMany({
    where: { feedbackId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    author: { id: row.user.id, name: row.user.name },
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function addComment(
  userId: number,
  feedbackId: number,
  body: string,
): Promise<FeedbackCommentSummary | null> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Comment body is required');

  const feedback = await prisma.feedback.findUnique({ where: { id: feedbackId }, select: { id: true } });
  if (!feedback) return null;

  const created = await prisma.feedbackComment.create({
    data: { feedbackId, userId, body: trimmed },
    include: { user: { select: { id: true, name: true } } },
  });

  return {
    id: created.id,
    body: created.body,
    author: { id: created.user.id, name: created.user.name },
    createdAt: created.createdAt.toISOString(),
  };
}

/** Admin-only: change a feedback item's status. Returns null if not found. */
export async function updateFeedbackStatus(
  feedbackId: number,
  status: string,
): Promise<boolean> {
  if (!isValidStatus(status)) throw new Error('Invalid status');
  const result = await prisma.feedback.updateMany({
    where: { id: feedbackId },
    data: { status },
  });
  return result.count > 0;
}
