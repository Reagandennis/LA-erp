import 'server-only';

import { API_ACCESS } from '@/lib/api-access';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  type FeedbackSummary,
  addComment,
  createFeedback,
  getFeedbackStats,
  listComments,
  listFeedback,
  updateFeedbackStatus,
} from '@/lib/feedback';

import { asString, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import { audit, localStamp, matches, optEnum, pageOf, reqId, reqText } from './_shared';

const MODULE = API_ACCESS.feedback;
const HREF = '/modules/feedback';
const PAGE_SIZE = 20;
/** A long thread is read from its newest end. */
const COMMENTS_SHOWN = 30;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The lib's own "no" (a plain Error with a message for the user) is a refusal; a database fault stays a fault. */
async function attempt<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof Error && error.constructor === Error) throw new ToolRefusal(error.message);
    throw error;
  }
}

async function loadFeedback(id: number, ctx: ToolContext): Promise<FeedbackSummary> {
  const item = (await listFeedback(ctx.userId)).find((f) => f.id === id);
  if (!item) throw new ToolRefusal(`Feedback item ${id} was not found. Find it with list_feedback.`);
  return item;
}

const itemView = (f: FeedbackSummary, ctx: ToolContext, descriptionMax: number) => ({
  id: f.id,
  title: f.title,
  category: f.category,
  status: f.status,
  description: clip(f.description, descriptionMax),
  author: f.author.name,
  upvotes: f.upvotes,
  comments: f.commentCount,
  submitted: localStamp(f.createdAt, ctx.timeZone),
});

const listFeedbackTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_feedback',
    description: `Feedback about the platform (bug reports, ideas, improvements, support requests), newest first, with status, author, upvotes and comment count. ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: "Words in the title or description, or the author's name" },
        status: { type: 'string', enum: [...FEEDBACK_STATUSES] },
        category: { type: 'string', enum: [...FEEDBACK_CATEGORIES] },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const q = asString(args.q);
    const status = optEnum(args, 'status', FEEDBACK_STATUSES);
    const category = optEnum(args, 'category', FEEDBACK_CATEGORIES);
    const [all, counts] = await Promise.all([listFeedback(ctx.userId), getFeedbackStats()]);
    const rows = all.filter(
      (f) => (!status || f.status === status) && (!category || f.category === category) && matches(q, f.title, f.description, f.author.name),
    );
    const page = pageOf(rows, args, PAGE_SIZE);
    return {
      total: page.total,
      page: page.page,
      more: page.more,
      counts,
      items: page.rows.map((f) => itemView(f, ctx, 200)),
      href: HREF,
    };
  },
};

const getFeedbackTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'get_feedback',
    description: 'Open one feedback item: its full description and the comments on it.',
    parameters: { type: 'object', properties: { feedbackId: { type: 'integer' } }, required: ['feedbackId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'feedbackId', 'use list_feedback');
    const [item, comments] = await Promise.all([loadFeedback(id, ctx), listComments(id)]);
    const thread = comments ?? [];
    return {
      ...itemView(item, ctx, 4000),
      upvotedByMe: item.isUpvoted,
      comments: thread.slice(-COMMENTS_SHOWN).map((c) => ({
        id: c.id,
        author: c.author.name,
        at: localStamp(c.createdAt, ctx.timeZone),
        body: clip(c.body, 1000),
      })),
      ...(thread.length > COMMENTS_SHOWN ? { note: `Showing the latest ${COMMENTS_SHOWN} of ${thread.length} comments.` } : {}),
      href: HREF,
    };
  },
};

const createFeedbackTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_feedback',
    description: "Submit feedback about the platform in the user's name: a bug report, a feature idea, an improvement or a support request.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: [...FEEDBACK_CATEGORIES] },
      },
      required: ['title', 'description', 'category'],
    },
  },
  async handler(args, ctx) {
    const title = reqText(args, 'title', { max: 200 });
    const description = reqText(args, 'description', { max: 10000 });
    const category = optEnum(args, 'category', FEEDBACK_CATEGORIES);
    // Left to the lib, anything it does not know is filed as an Improvement.
    if (!category) throw new ToolRefusal(`category is required: ${FEEDBACK_CATEGORIES.join(', ')}.`);
    const f = await attempt(() => createFeedback({ userId: ctx.userId, title, description, category }));
    await audit({
      action: 'ai.feedback.create', entityType: 'Feedback', entityId: String(f.id),
      actorUserId: ctx.userId, metadata: { category: f.category }, request: ctx.request,
    });
    return { id: f.id, title: f.title, category: f.category, status: f.status, href: HREF, summary: `Submitted the ${f.category.toLowerCase()} "${f.title}"` };
  },
};

const commentFeedbackTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'comment_feedback',
    description: "Add a comment to a feedback item, in the user's name.",
    parameters: {
      type: 'object',
      properties: { feedbackId: { type: 'integer' }, body: { type: 'string' } },
      required: ['feedbackId', 'body'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'feedbackId', 'use list_feedback');
    const body = reqText(args, 'body', { max: 4000 });
    const comment = await attempt(() => addComment(ctx.userId, id, body));
    if (!comment) throw new ToolRefusal(`Feedback item ${id} was not found. Find it with list_feedback.`);
    await audit({
      action: 'ai.feedback.comment', entityType: 'Feedback', entityId: String(id),
      actorUserId: ctx.userId, metadata: { commentId: comment.id }, request: ctx.request,
    });
    return { commentId: comment.id, feedbackId: id, href: HREF, summary: `Commented on feedback item #${id}` };
  },
};

const setFeedbackStatusTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  requiredRole: 'admin',
  functionDeclaration: {
    name: 'set_feedback_status',
    description: "Change a feedback item's status (admins only).",
    parameters: {
      type: 'object',
      properties: {
        feedbackId: { type: 'integer' },
        status: { type: 'string', enum: [...FEEDBACK_STATUSES] },
      },
      required: ['feedbackId', 'status'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'feedbackId', 'use list_feedback');
    const status = optEnum(args, 'status', FEEDBACK_STATUSES);
    if (!status) throw new ToolRefusal(`status is required: ${FEEDBACK_STATUSES.join(', ')}.`);
    const before = await loadFeedback(id, ctx);
    if (before.status === status) throw new ToolRefusal(`Nothing to change: "${before.title}" is already ${status}.`);
    const ok = await attempt(() => updateFeedbackStatus(id, status));
    if (!ok) throw new ToolRefusal(`Feedback item ${id} was not found.`);
    await audit({
      action: 'ai.feedback.status', entityType: 'Feedback', entityId: String(id),
      actorUserId: ctx.userId, metadata: { from: before.status, status }, request: ctx.request,
    });
    return {
      id,
      title: before.title,
      changed: { status: { from: before.status, to: status } },
      href: HREF,
      summary: `Set "${before.title}" to ${status}`,
    };
  },
};

export const feedbackTools: ToolDefinition[] = [
  listFeedbackTool,
  getFeedbackTool,
  createFeedbackTool,
  commentFeedbackTool,
  setFeedbackStatusTool,
];
