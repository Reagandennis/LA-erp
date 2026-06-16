import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  addComment,
  createFeedback,
  listFeedback,
  updateFeedbackStatus,
} from '@/lib/feedback';

import { asInt, asString, type ToolDefinition } from '../types';

const MODULE = 'feedback';

const listFeedbackTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_feedback',
    description: 'List feedback items (bugs, ideas, improvements) with their status and upvotes.',
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const rows = await listFeedback(ctx.userId);
    return rows.slice(0, 40).map((f) => ({ id: f.id, title: f.title, category: f.category, status: f.status, upvotes: f.upvotes }));
  },
};

const createFeedbackTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_feedback',
    description: 'Submit a new feedback item.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string', enum: [...FEEDBACK_CATEGORIES] },
      },
      required: ['title', 'description'],
    },
  },
  async handler(args, ctx) {
    const title = asString(args.title);
    const description = asString(args.description);
    if (!title || !description) return { error: 'A title and description are required.' };
    const f = await createFeedback({
      userId: ctx.userId,
      title,
      description,
      category: asString(args.category) ?? 'Improvement',
    });
    await recordAuditEvent({ action: 'ai.feedback.create', entityType: 'Feedback', entityId: String(f.id), actorUserId: ctx.userId, request: ctx.request });
    return { id: f.id, title: f.title, status: f.status };
  },
};

const commentFeedbackTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'comment_feedback',
    description: 'Add a comment to a feedback item.',
    parameters: {
      type: 'object',
      properties: { feedbackId: { type: 'integer' }, body: { type: 'string' } },
      required: ['feedbackId', 'body'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.feedbackId);
    const body = asString(args.body);
    if (!id) return { error: 'A valid feedbackId is required.' };
    if (!body) return { error: 'A comment body is required.' };
    const comment = await addComment(ctx.userId, id, body);
    if (!comment) return { error: 'Feedback not found.' };
    return { id: comment.id, feedbackId: id };
  },
};

const setFeedbackStatusTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  requiredRole: 'admin',
  functionDeclaration: {
    name: 'set_feedback_status',
    description: 'Change a feedback item\'s status (admin only).',
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
    const id = asInt(args.feedbackId);
    const status = asString(args.status);
    if (!id || !status) return { error: 'feedbackId and status are required.' };
    try {
      const ok = await updateFeedbackStatus(id, status);
      if (!ok) return { error: 'Feedback not found.' };
      await recordAuditEvent({ action: 'ai.feedback.status', entityType: 'Feedback', entityId: String(id), actorUserId: ctx.userId, metadata: { status }, request: ctx.request });
      return { id, status };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Invalid status.' };
    }
  },
};

export const feedbackTools: ToolDefinition[] = [
  listFeedbackTool,
  createFeedbackTool,
  commentFeedbackTool,
  setFeedbackStatusTool,
];
