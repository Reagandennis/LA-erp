import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { getGeminiApiKey, getGeminiModel, getJwtSecret } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasPermission, userHasRole } from '@/lib/user';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const ACTION_CONFIRM_TTL_SECONDS = 60 * 10;

type ChatHistoryItem = {
  role: 'user' | 'assistant';
  text: string;
};

type ParsedAction =
  | { type: 'summary_tasks' }
  | { type: 'summary_calendar_internal'; tripId: number }
  | { type: 'create_task'; title: string; dueDate?: string | null }
  | { type: 'update_task_description'; taskId: number; description: string }
  | { type: 'set_task_due_date'; taskId: number; dueDate: string }
  | { type: 'add_task_subtasks'; taskId: number; subtasks: string[] }
  | {
      type: 'move_task_subtasks_to_personal_todos';
      taskId: number;
      dueDate?: string | null;
      clearSource?: boolean;
    }
  | { type: 'delete_task'; taskId: number }
  | { type: 'create_calendar_internal'; tripId: number; dayNumber: number; title: string }
  | { type: 'delete_calendar_internal'; tripId: number; itemId: number }
  | {
      type: 'create_calendar_google';
      summary: string;
      startTime: string;
      endTime?: string | null;
      description?: string | null;
    }
  | { type: 'delete_calendar_google'; eventId: string };

type ConfirmTokenPayload = {
  sub: string;
  type: 'ai_action_confirm';
  action: ParsedAction;
};

function getMaskedKeyHint(apiKey: string) {
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  return `${start}...${end}`;
}

function can(
  authUser: { roles: Array<{ name: string }>; permissions: Array<{ name: string }> },
  permissionName: string,
) {
  if (userHasRole(authUser as never, 'admin')) {
    return true;
  }

  if (userHasPermission(authUser as never, permissionName)) {
    return true;
  }

  if (userHasRole(authUser as never, 'editor')) {
    return ['ai:execute', 'summary:read', 'task:create', 'task:delete', 'calendar:create', 'calendar:delete'].includes(permissionName);
  }

  if (userHasRole(authUser as never, 'viewer')) {
    return permissionName === 'summary:read';
  }

  return false;
}

function extractTextFromGeminiResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return text || null;
}

function parsePositiveInt(value: string | undefined) {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseActionFromPrompt(prompt: string): ParsedAction | null {
  const trimmed = prompt.trim();

  if (/^\/summary\s+tasks$/i.test(trimmed)) {
    return { type: 'summary_tasks' };
  }

  const summaryCalendar = trimmed.match(/^\/summary\s+calendar\s+internal\s+trip\s+(\d+)$/i);
  if (summaryCalendar) {
    const tripId = parsePositiveInt(summaryCalendar[1]);
    if (!tripId) return null;
    return { type: 'summary_calendar_internal', tripId };
  }

  const createTask = trimmed.match(/^\/task\s+create\s+(.+)$/i);
  if (createTask) {
    const rest = createTask[1].trim();
    const dueMatch = rest.match(/\s+\|\s*due:\s*(.+)$/i);
    const title = (dueMatch ? rest.slice(0, dueMatch.index) : rest).trim();
    const dueDate = dueMatch?.[1]?.trim() ?? null;
    if (!title) return null;
    return { type: 'create_task', title, dueDate };
  }

  const deleteTask = trimmed.match(/^\/task\s+delete\s+(\d+)$/i);
  if (deleteTask) {
    const taskId = parsePositiveInt(deleteTask[1]);
    if (!taskId) return null;
    return { type: 'delete_task', taskId };
  }

  const createInternal = trimmed.match(/^\/calendar\s+create\s+internal\s+trip\s+(\d+)\s+day\s+(\d+)\s+title\s+(.+)$/i);
  if (createInternal) {
    const tripId = parsePositiveInt(createInternal[1]);
    const dayNumber = parsePositiveInt(createInternal[2]);
    const title = createInternal[3]?.trim();
    if (!tripId || !dayNumber || !title) return null;
    return { type: 'create_calendar_internal', tripId, dayNumber, title };
  }

  const deleteInternal = trimmed.match(/^\/calendar\s+delete\s+internal\s+trip\s+(\d+)\s+item\s+(\d+)$/i);
  if (deleteInternal) {
    const tripId = parsePositiveInt(deleteInternal[1]);
    const itemId = parsePositiveInt(deleteInternal[2]);
    if (!tripId || !itemId) return null;
    return { type: 'delete_calendar_internal', tripId, itemId };
  }

  const createGoogle = trimmed.match(/^\/calendar\s+create\s+google\s+summary\s+"([^"]+)"\s+start\s+(\S+)(?:\s+end\s+(\S+))?(?:\s+description\s+"([^"]+)")?$/i);
  if (createGoogle) {
    return {
      type: 'create_calendar_google',
      summary: createGoogle[1],
      startTime: createGoogle[2],
      endTime: createGoogle[3] ?? null,
      description: createGoogle[4] ?? null,
    };
  }

  const deleteGoogle = trimmed.match(/^\/calendar\s+delete\s+google\s+event\s+(.+)$/i);
  if (deleteGoogle) {
    const eventId = deleteGoogle[1]?.trim();
    if (!eventId) return null;
    return { type: 'delete_calendar_google', eventId };
  }

  return null;
}

function normalizeRelativeDate(value: string | null | undefined) {
  if (!value) return null;

  const v = value.trim().toLowerCase();
  if (!v) return null;

  if (v === 'today') {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString();
  }

  if (v === 'tomorrow') {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    return tomorrow.toISOString();
  }

  return value;
}

function extractTaskIdFromText(text: string): number | null {
  const match =
    text.match(/\btask\s*#?\s*(\d+)\b/i) ??
    text.match(/\bpt[-\s]?(\d+)\b/i);

  if (!match) return null;
  return parsePositiveInt(match[1]);
}

function inferTaskIdFromContext(prompt: string, history?: ChatHistoryItem[]): number | null {
  const fromPrompt = extractTaskIdFromText(prompt);
  if (fromPrompt) return fromPrompt;

  if (!history || history.length === 0) return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (!item?.text) continue;
    const inferred = extractTaskIdFromText(item.text);
    if (inferred) return inferred;
  }

  return null;
}

function extractSubtasksFromText(text: string): string[] {
  const idx = text.indexOf(':');
  if (idx < 0) return [];

  return text
    .slice(idx + 1)
    .split(/[,;\n]/)
    .map((item) => item.trim().replace(/^[-*]\s*/, ''))
    .filter((item) => item.length > 0);
}

function normalizeStoredSubtasks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const maybe = item as { title?: unknown; text?: unknown; name?: unknown };
        const candidate = [maybe.title, maybe.text, maybe.name].find(
          (v) => typeof v === 'string' && v.trim().length > 0,
        );
        return typeof candidate === 'string' ? candidate.trim() : '';
      }
      return '';
    })
    .filter((item) => item.length > 0);
}

function extractDateTokenFromText(text: string): string | null {
  const match = text.match(/\b(today|tomorrow|\d{4}-\d{2}-\d{2})\b/i);
  if (!match) return null;
  return normalizeRelativeDate(match[1]);
}

function parseActionFromNaturalLanguage(prompt: string, history?: ChatHistoryItem[]): ParsedAction | null {
  const text = prompt.trim();
  const lower = text.toLowerCase();

  if ((/\b(summary|summarize|overview|show)\b/.test(lower) && /\b(tasks?)\b/.test(lower)) || /\bmy tasks\b/.test(lower)) {
    return { type: 'summary_tasks' };
  }

  const calendarSummary = text.match(/(?:summary|summar(?:y|ize)|show).*(?:calendar|itinerary).*(?:trip\s*#?\s*(\d+))/i)
    ?? text.match(/trip\s*#?\s*(\d+).*(?:calendar|itinerary).*(?:summary|overview|show)/i);
  if (calendarSummary) {
    const tripId = parsePositiveInt(calendarSummary[1]);
    if (tripId) {
      return { type: 'summary_calendar_internal', tripId };
    }
  }

  const createTask = text.match(/(?:create|add)\s+(?:a\s+)?task\s*(?:called|named|title)?\s*[:"' ]+(.+?)(?:\s+(?:due|by)\s+(.+))?$/i);
  if (createTask) {
    const title = createTask[1]?.trim().replace(/^['"]|['"]$/g, '');
    const dueDate = normalizeRelativeDate(createTask[2]?.trim() ?? null);
    if (title) {
      return { type: 'create_task', title, dueDate };
    }
  }

  const descriptionIntent =
    /\b(description|describe)\b/.test(lower) &&
    /\b(update|set|assign|give|change)\b/.test(lower);
  if (descriptionIntent) {
    const taskId = inferTaskIdFromContext(text, history);
    if (taskId) {
      const descriptionMatch =
        text.match(/(?:description\s*(?:to|as|:)?\s*)(.+)$/i) ??
        text.match(/(?:give\s+(?:it|task(?:\s*#?\s*\d+)?)\s+a\s+description\s+)(.+)$/i) ??
        text.match(/(?:on\s+(?:task|pt)[-\s#]*\d+\s+give\s+it\s+a\s+description\s+)(.+)$/i);

      const description = descriptionMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
      if (description) {
        return { type: 'update_task_description', taskId, description };
      }
    }
  }

  const dueDateIntent =
    /\b(set|assign|update|change)\b/.test(lower) &&
    /\bdue\s*date\b|\bdue\b/.test(lower);
  if (dueDateIntent) {
    const taskId = inferTaskIdFromContext(text, history);
    const dueDate = extractDateTokenFromText(text);
    if (taskId && dueDate) {
      return { type: 'set_task_due_date', taskId, dueDate };
    }
  }

  const addSubtasksIntent = /\b(add|set|assign|give)\b/.test(lower) && /\bsubtasks?\b/.test(lower);
  if (addSubtasksIntent) {
    const taskId = inferTaskIdFromContext(text, history);
    if (taskId) {
      return {
        type: 'add_task_subtasks',
        taskId,
        subtasks: extractSubtasksFromText(text),
      };
    }
  }

  const moveSubtasksIntent =
    ((/\b(move|migrate|convert|turn)\b/.test(lower) && /\bsubtasks?\b/.test(lower)) &&
      (/\bpersonal\b.*\bto-?do\b/.test(lower) || /\btodo\b/.test(lower))) ||
    /\bthey\b.*\bto\s*-?\s*do\b.*\bpersonal\b.*\bto\s*-?\s*do\b/.test(lower);

  if (moveSubtasksIntent) {
    const taskId = inferTaskIdFromContext(text, history);
    if (taskId) {
      const dueDate = extractDateTokenFromText(text);
      const keepSource =
        /\bkeep\b.*\bsubtasks?\b/.test(lower) ||
        /\bretain\b.*\bsubtasks?\b/.test(lower) ||
        /\bleave\b.*\bsubtasks?\b/.test(lower) ||
        /\bdon['’]?t\s+clear\b/.test(lower);

      return {
        type: 'move_task_subtasks_to_personal_todos',
        taskId,
        dueDate: dueDate ?? null,
        clearSource: !keepSource,
      };
    }
  }

  const deleteTask = text.match(/(?:delete|remove)\s+(?:task\s*)#?\s*(\d+)/i);
  if (deleteTask) {
    const taskId = parsePositiveInt(deleteTask[1]);
    if (taskId) {
      return { type: 'delete_task', taskId };
    }
  }

  const createInternal = text.match(/(?:create|add).*(?:calendar|itinerary).*(?:event|item).*(?:trip\s*#?\s*(\d+)).*(?:day\s*(\d+)).*(?:title|called|named)\s*[:"' ]+(.+)$/i);
  if (createInternal) {
    const tripId = parsePositiveInt(createInternal[1]);
    const dayNumber = parsePositiveInt(createInternal[2]);
    const title = createInternal[3]?.trim().replace(/^['"]|['"]$/g, '');
    if (tripId && dayNumber && title) {
      return { type: 'create_calendar_internal', tripId, dayNumber, title };
    }
  }

  const deleteInternalPrimary = text.match(/(?:delete|remove).*(?:calendar|itinerary).*(?:item|event)\s*#?\s*(\d+).*(?:trip\s*#?\s*(\d+))/i);
  if (deleteInternalPrimary) {
    const itemId = parsePositiveInt(deleteInternalPrimary[1]);
    const tripId = parsePositiveInt(deleteInternalPrimary[2]);
    if (tripId && itemId) {
      return { type: 'delete_calendar_internal', tripId, itemId };
    }
  }

  const deleteInternalAlt = text.match(/(?:trip\s*#?\s*(\d+)).*(?:delete|remove).*(?:calendar|itinerary).*(?:item|event)\s*#?\s*(\d+)/i);
  if (deleteInternalAlt) {
    const tripId = parsePositiveInt(deleteInternalAlt[1]);
    const itemId = parsePositiveInt(deleteInternalAlt[2]);
    if (tripId && itemId) {
      return { type: 'delete_calendar_internal', tripId, itemId };
    }
  }

  return null;
}

function looksLikeActionIntent(prompt: string) {
  if (/^\s*(today|tomorrow|\d{4}-\d{2}-\d{2})\s*$/i.test(prompt)) {
    return true;
  }

  const lower = prompt.toLowerCase();
  const hasVerb = /\b(create|add|delete|remove|update|edit|schedule|summarize|summary|show|set|move|assign|give)\b/.test(lower);
  const hasTarget = /\b(task|tasks|calendar|itinerary|event|events|subtask|subtasks|todo|to-do|description|due\s*date)\b/.test(lower);
  return hasVerb && hasTarget;
}

async function buildActionPreview(action: ParsedAction, userId: number, googleAccessToken?: string | null) {
  if (action.type === 'update_task_description') {
    const preview = action.description.length > 120
      ? `${action.description.slice(0, 117)}...`
      : action.description;
    return `Update task #${action.taskId} description. New description: ${preview}`;
  }

  if (action.type === 'set_task_due_date') {
    const normalized = normalizeRelativeDate(action.dueDate);
    const parsed = parseDate(normalized);
    return `Set due date for task #${action.taskId} to ${parsed ? parsed.toISOString().slice(0, 10) : action.dueDate}.`;
  }

  if (action.type === 'add_task_subtasks') {
    const items = action.subtasks.slice(0, 5).join(', ');
    return `Add ${action.subtasks.length} subtask(s) to task #${action.taskId}.${items ? ` Items: ${items}${action.subtasks.length > 5 ? ', ...' : ''}` : ''}`;
  }

  if (action.type === 'move_task_subtasks_to_personal_todos') {
    const duePart = action.dueDate ? ` Due date override: ${action.dueDate}.` : '';
    const clearPart = action.clearSource === false
      ? ' Source subtasks will be kept.'
      : ' Source subtasks will be cleared.';
    return `Move subtasks from task #${action.taskId} into personal todos.${duePart}${clearPart}`;
  }

  if (action.type === 'delete_task') {
    const task = await prisma.personalTodo.findFirst({
      where: { id: action.taskId, userId },
      select: { id: true, title: true, dueDate: true, status: true },
    });

    if (!task) {
      return 'Task preview unavailable: task not found or access denied.';
    }

    return `Delete task #${task.id}: ${task.title}${task.dueDate ? `, due ${task.dueDate.toISOString().slice(0, 10)}` : ''}, status ${task.status}.`;
  }

  if (action.type === 'delete_calendar_internal') {
    const item = await prisma.tripItineraryItem.findFirst({
      where: { id: action.itemId, tripId: action.tripId, trip: { userId } },
      select: { id: true, dayNumber: true, title: true, itemType: true },
    });

    if (!item) {
      return 'Calendar preview unavailable: item not found or access denied.';
    }

    return `Delete internal calendar item #${item.id}: Day ${item.dayNumber}, ${item.title} (${item.itemType}).`;
  }

  if (action.type === 'delete_calendar_google') {
    if (!googleAccessToken) {
      return 'Google event preview unavailable: connect Google first.';
    }

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(action.eventId)}`,
      { headers: { Authorization: `Bearer ${googleAccessToken}` } },
    );

    if (!response.ok) {
      return `Google event preview unavailable for ${action.eventId}.`;
    }

    const event = (await response.json()) as { summary?: string; start?: { dateTime?: string; date?: string } };
    const start = event.start?.dateTime ?? event.start?.date ?? 'unknown time';
    return `Delete Google event ${event.summary ?? action.eventId} (${start}).`;
  }

  return null;
}

function signConfirmationToken(userId: number, action: ParsedAction) {
  return jwt.sign(
    {
      sub: String(userId),
      type: 'ai_action_confirm',
      action,
    } satisfies ConfirmTokenPayload,
    getJwtSecret(),
    { expiresIn: ACTION_CONFIRM_TTL_SECONDS },
  );
}

function verifyConfirmationToken(token: string, userId: number): ParsedAction | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as ConfirmTokenPayload;
    if (payload.type !== 'ai_action_confirm') return null;
    if (Number(payload.sub) !== userId) return null;
    return payload.action;
  } catch {
    return null;
  }
}

async function executeAction(params: {
  action: ParsedAction;
  userId: number;
  googleAccessToken?: string | null;
  request: NextRequest;
}) {
  const { action, userId, googleAccessToken, request } = params;

  if (action.type === 'summary_tasks') {
    const tasks = await prisma.personalTodo.findMany({
      where: { userId },
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 5,
    });

    const total = await prisma.personalTodo.count({ where: { userId } });
    const open = await prisma.personalTodo.count({ where: { userId, completed: false } });

    const lines = tasks.map((task, index) => {
      const due = task.dueDate ? ` (due ${task.dueDate.toISOString().slice(0, 10)})` : '';
      return `${index + 1}. ${task.title}${due}`;
    });

    return {
      text: `Task summary:\n- Total: ${total}\n- Open: ${open}${lines.length ? `\n\nTop tasks:\n${lines.join('\n')}` : '\n\nNo tasks yet.'}`,
    };
  }

  if (action.type === 'summary_calendar_internal') {
    const trip = await prisma.trip.findFirst({
      where: { id: action.tripId, userId },
      select: { id: true, title: true },
    });

    if (!trip) return { text: 'Trip not found or access denied.' };

    const items = await prisma.tripItineraryItem.findMany({
      where: { tripId: action.tripId },
      orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }],
      take: 10,
    });

    return {
      text: `Internal calendar summary for ${trip.title}: ${items.length} item(s).${items.length ? `\n\n${items.map((item) => `- Day ${item.dayNumber}: ${item.title}`).join('\n')}` : ''}`,
    };
  }

  if (action.type === 'create_task') {
    const dueDate = parseDate(action.dueDate ?? null);
    if (action.dueDate && !dueDate) return { text: 'Invalid due date format. Use ISO date like 2026-05-20.' };

    const task = await prisma.personalTodo.create({
      data: {
        userId,
        title: action.title,
        priority: 'medium',
        status: 'Backlog',
        dueDate,
        completed: false,
      },
    });

    await recordAuditEvent({
      action: 'ai.task.create',
      entityType: 'PersonalTodo',
      entityId: String(task.id),
      actorUserId: userId,
      metadata: { title: task.title },
      request,
    });

    return { text: `Task created: #${task.id} ${task.title}` };
  }

  if (action.type === 'update_task_description') {
    const task = await prisma.personalTodo.findFirst({
      where: { id: action.taskId, userId },
      select: { id: true, title: true },
    });
    if (!task) return { text: 'Task not found or you do not own it.' };

    const description = action.description.trim();
    if (!description) return { text: 'Description cannot be empty.' };

    await prisma.personalTodo.update({
      where: { id: task.id },
      data: { description },
    });

    await recordAuditEvent({
      action: 'ai.task.update_description',
      entityType: 'PersonalTodo',
      entityId: String(task.id),
      actorUserId: userId,
      metadata: { title: task.title, descriptionLength: description.length },
      request,
    });

    return { text: `Task #${task.id} updated. Description set.` };
  }

  if (action.type === 'set_task_due_date') {
    const task = await prisma.personalTodo.findFirst({
      where: { id: action.taskId, userId },
      select: { id: true, title: true },
    });
    if (!task) return { text: 'Task not found or you do not own it.' };

    const normalizedDueDate = normalizeRelativeDate(action.dueDate);
    const dueDate = parseDate(normalizedDueDate);
    if (!dueDate) return { text: 'Invalid due date format. Use today, tomorrow, or YYYY-MM-DD.' };

    await prisma.personalTodo.update({
      where: { id: task.id },
      data: { dueDate },
    });

    await recordAuditEvent({
      action: 'ai.task.update_due_date',
      entityType: 'PersonalTodo',
      entityId: String(task.id),
      actorUserId: userId,
      metadata: { title: task.title, dueDate: dueDate.toISOString() },
      request,
    });

    return { text: `Task #${task.id} due date set to ${dueDate.toISOString().slice(0, 10)}.` };
  }

  if (action.type === 'add_task_subtasks') {
    const task = await prisma.personalTodo.findFirst({
      where: { id: action.taskId, userId },
      select: { id: true, title: true, subtasks: true },
    });
    if (!task) return { text: 'Task not found or you do not own it.' };

    const incomingSubtasks = action.subtasks
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (incomingSubtasks.length === 0) {
      return {
        text: 'Please provide a comma-separated subtask list after a colon, for example: add subtasks to task #5: call vendor, submit report.',
      };
    }

    const existing = normalizeStoredSubtasks(task.subtasks);
    const merged = [...existing, ...incomingSubtasks];

    await prisma.personalTodo.update({
      where: { id: task.id },
      data: { subtasks: merged as unknown as object },
    });

    await recordAuditEvent({
      action: 'ai.task.add_subtasks',
      entityType: 'PersonalTodo',
      entityId: String(task.id),
      actorUserId: userId,
      metadata: { title: task.title, added: incomingSubtasks.length, total: merged.length },
      request,
    });

    return { text: `Added ${incomingSubtasks.length} subtask(s) to task #${task.id}.` };
  }

  if (action.type === 'move_task_subtasks_to_personal_todos') {
    const task = await prisma.personalTodo.findFirst({
      where: { id: action.taskId, userId },
      select: { id: true, title: true, subtasks: true },
    });
    if (!task) return { text: 'Task not found or you do not own it.' };

    const sourceSubtasks = normalizeStoredSubtasks(task.subtasks);
    if (sourceSubtasks.length === 0) {
      return { text: `Task #${task.id} has no subtasks to move.` };
    }

    const normalizedDueDate = action.dueDate ? normalizeRelativeDate(action.dueDate) : null;
    const dueDate = normalizedDueDate ? parseDate(normalizedDueDate) : null;

    if (action.dueDate && !dueDate) {
      return { text: 'Invalid due date format. Use today, tomorrow, or YYYY-MM-DD.' };
    }

    const clearSource = action.clearSource !== false;

    const createdCount = await prisma.$transaction(async (tx) => {
      let count = 0;

      for (const subtask of sourceSubtasks) {
        await tx.personalTodo.create({
          data: {
            userId,
            title: subtask,
            priority: 'medium',
            status: 'Backlog',
            dueDate,
            completed: false,
          },
        });
        count += 1;
      }

      if (clearSource) {
        await tx.personalTodo.update({
          where: { id: task.id },
          data: { subtasks: [] as unknown as object },
        });
      }

      return count;
    });

    await recordAuditEvent({
      action: 'ai.task.subtasks_to_todos',
      entityType: 'PersonalTodo',
      entityId: String(task.id),
      actorUserId: userId,
      metadata: { title: task.title, createdCount, clearSource },
      request,
    });

    return { text: `Created ${createdCount} personal todo(s) from task #${task.id} subtasks.${clearSource ? ' Source subtasks cleared.' : ''}` };
  }

  if (action.type === 'delete_task') {
    const task = await prisma.personalTodo.findFirst({
      where: { id: action.taskId, userId },
      select: { id: true, title: true },
    });

    if (!task) return { text: 'Task not found or you do not own it.' };

    await prisma.personalTodo.delete({ where: { id: task.id } });
    await recordAuditEvent({
      action: 'ai.task.delete',
      entityType: 'PersonalTodo',
      entityId: String(task.id),
      actorUserId: userId,
      metadata: { title: task.title },
      request,
    });

    return { text: `Task deleted: #${task.id} ${task.title}` };
  }

  if (action.type === 'create_calendar_internal') {
    const trip = await prisma.trip.findFirst({ where: { id: action.tripId, userId }, select: { id: true } });
    if (!trip) return { text: 'Trip not found or access denied.' };

    const maxSort = await prisma.tripItineraryItem.aggregate({
      where: { tripId: action.tripId, dayNumber: action.dayNumber },
      _max: { sortOrder: true },
    });

    const item = await prisma.tripItineraryItem.create({
      data: {
        tripId: action.tripId,
        dayNumber: action.dayNumber,
        title: action.title,
        itemType: 'AI Event',
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    await recordAuditEvent({
      action: 'ai.calendar.internal.create',
      entityType: 'TripItineraryItem',
      entityId: String(item.id),
      actorUserId: userId,
      metadata: { tripId: action.tripId },
      request,
    });

    return { text: `Internal calendar event created: item #${item.id}.` };
  }

  if (action.type === 'delete_calendar_internal') {
    const trip = await prisma.trip.findFirst({ where: { id: action.tripId, userId }, select: { id: true } });
    if (!trip) return { text: 'Trip not found or access denied.' };

    const item = await prisma.tripItineraryItem.findFirst({
      where: { id: action.itemId, tripId: action.tripId },
      select: { id: true, title: true },
    });
    if (!item) return { text: 'Calendar item not found.' };

    await prisma.tripItineraryItem.delete({ where: { id: item.id } });
    await recordAuditEvent({
      action: 'ai.calendar.internal.delete',
      entityType: 'TripItineraryItem',
      entityId: String(item.id),
      actorUserId: userId,
      metadata: { tripId: action.tripId, title: item.title },
      request,
    });

    return { text: `Internal calendar event deleted: #${item.id} ${item.title}` };
  }

  if (action.type === 'create_calendar_google') {
    if (!googleAccessToken) return { text: 'Google access token missing. Connect Google first.' };
    const start = parseDate(action.startTime);
    const end = parseDate(action.endTime ?? null) ?? (start ? new Date(start.getTime() + 60 * 60 * 1000) : null);
    if (!start || !end) return { text: 'Invalid Google Calendar time. Use ISO datetime.' };

    const createResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: action.summary,
        description: action.description ?? '',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    });

    if (!createResponse.ok) return { text: 'Failed to create Google Calendar event. Check Google permissions.' };

    const event = (await createResponse.json()) as { id?: string; summary?: string };
    await recordAuditEvent({
      action: 'ai.calendar.google.create',
      entityType: 'GoogleCalendarEvent',
      entityId: event.id ?? null,
      actorUserId: userId,
      metadata: { summary: event.summary ?? action.summary },
      request,
    });

    return { text: `Google Calendar event created: ${event.summary ?? action.summary} (${event.id ?? 'n/a'}).` };
  }

  if (!googleAccessToken) return { text: 'Google access token missing. Connect Google first.' };

  const eventResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(action.eventId)}`,
    { headers: { Authorization: `Bearer ${googleAccessToken}` } },
  );

  if (!eventResponse.ok) return { text: 'Google Calendar event not found or inaccessible.' };

  const event = (await eventResponse.json()) as {
    creator?: { self?: boolean };
    organizer?: { self?: boolean };
    summary?: string;
  };
  if (!event.creator?.self && !event.organizer?.self) {
    return { text: 'You can only delete Google events you own.' };
  }

  const deleteResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(action.eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${googleAccessToken}` },
    },
  );

  if (!deleteResponse.ok) return { text: 'Failed to delete Google Calendar event.' };

  await recordAuditEvent({
    action: 'ai.calendar.google.delete',
    entityType: 'GoogleCalendarEvent',
    entityId: action.eventId,
    actorUserId: userId,
    metadata: { summary: event.summary ?? null },
    request,
  });

  return { text: `Google Calendar event deleted: ${event.summary ?? action.eventId}` };
}

export async function POST(req: NextRequest) {
  const { auth, response } = await requireRequestAuth(req);
  if (response || !auth) return response;

  let body: {
    prompt?: string;
    history?: ChatHistoryItem[];
    confirmToken?: string;
    googleAccessToken?: string;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const confirmToken = typeof body.confirmToken === 'string' ? body.confirmToken : null;
  const googleAccessToken = typeof body.googleAccessToken === 'string' ? body.googleAccessToken : null;

  const history = Array.isArray(body.history)
    ? body.history.filter((item) =>
        item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.text === 'string' &&
        item.text.trim().length > 0,
      )
    : [];

  const permissionMap: Record<ParsedAction['type'], string> = {
    summary_tasks: 'summary:read',
    summary_calendar_internal: 'summary:read',
    create_task: 'task:create',
    update_task_description: 'task:create',
    set_task_due_date: 'task:create',
    add_task_subtasks: 'task:create',
    move_task_subtasks_to_personal_todos: 'task:create',
    delete_task: 'task:delete',
    create_calendar_internal: 'calendar:create',
    delete_calendar_internal: 'calendar:delete',
    create_calendar_google: 'calendar:create',
    delete_calendar_google: 'calendar:delete',
  };

  if (confirmToken) {
    if (!can(auth.user, 'ai:execute')) {
      return NextResponse.json({ error: 'You do not have permission to execute AI actions.' }, { status: 403 });
    }

    const action = verifyConfirmationToken(confirmToken, auth.user.id);
    if (!action) {
      return NextResponse.json({ error: 'Invalid or expired confirmation token.' }, { status: 400 });
    }

    if (!can(auth.user, permissionMap[action.type])) {
      return NextResponse.json({ error: 'Action not allowed for your role.' }, { status: 403 });
    }

    return NextResponse.json(
      await executeAction({ action, userId: auth.user.id, googleAccessToken, request: req }),
    );
  }

  if (prompt) {
    const parsedAction = parseActionFromPrompt(prompt) ?? parseActionFromNaturalLanguage(prompt, history);
    if (parsedAction) {
      if (!can(auth.user, 'ai:execute')) {
        return NextResponse.json({ text: 'You do not have permission to execute AI actions.' }, { status: 403 });
      }

      if (!can(auth.user, permissionMap[parsedAction.type])) {
        return NextResponse.json({ text: 'Action not allowed for your role.' }, { status: 403 });
      }

      if (parsedAction.type === 'add_task_subtasks' && parsedAction.subtasks.length === 0) {
        return NextResponse.json({
          text:
            'Please provide subtasks after a colon, for example: add subtasks to task #5: call vendor, submit report.',
        });
      }

      if (['delete_task', 'delete_calendar_internal', 'delete_calendar_google'].includes(parsedAction.type)) {
        const token = signConfirmationToken(auth.user.id, parsedAction);
        const preview = await buildActionPreview(parsedAction, auth.user.id, googleAccessToken);
        return NextResponse.json({
          text: 'Please confirm this destructive action.',
          pendingActionToken: token,
          pendingActionLabel: parsedAction.type,
          pendingActionPreview: preview,
        });
      }

      return NextResponse.json(
        await executeAction({ action: parsedAction, userId: auth.user.id, googleAccessToken, request: req }),
      );
    }

    if (looksLikeActionIntent(prompt)) {
      return NextResponse.json({
        text:
          'I detected an action request, but I could not safely extract required details. No action was executed. Please include explicit details like trip ID, day, task ID, or date and try again.',
      });
    }
  }

  if (!prompt) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: 'Gemini API is not configured' }, { status: 503 });
  }

  const contents = [
    ...history.map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.text }],
    })),
    {
      role: 'user',
      parts: [{
        text:
          `${prompt}\n\nYou can trigger platform actions from natural language. If intent is ambiguous, ask for missing IDs or dates. Supported actions include: task summaries, internal calendar summaries, task create/delete, internal calendar create/delete, and google calendar create/delete.`,
      }],
    },
  ];

  try {
    const model = getGeminiModel();
    const responseFromGemini = await fetch(`${GEMINI_API_URL}/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!responseFromGemini.ok) {
      const errorText = await responseFromGemini.text();
      let geminiReason: string | null = null;

      try {
        const errorPayload = JSON.parse(errorText) as {
          error?: {
            details?: Array<{ reason?: string }>;
          };
        };
        geminiReason = errorPayload.error?.details?.[0]?.reason ?? null;
      } catch {
        // Ignore parse errors.
      }

      console.error('[ai-chatbot] Gemini error', responseFromGemini.status, {
        reason: geminiReason,
        model,
        keyHint: getMaskedKeyHint(apiKey),
      });

      if (geminiReason === 'API_KEY_INVALID') {
        return NextResponse.json(
          {
            error:
              'Invalid Gemini API key. Update GEMINI_API_KEY (or GOOGLE_API_KEY) and restart the server.',
            code: 'API_KEY_INVALID',
          },
          { status: 503 },
        );
      }

      return NextResponse.json({ error: 'Failed to get Gemini response', code: 'GEMINI_REQUEST_FAILED' }, { status: 502 });
    }

    const payload = (await responseFromGemini.json()) as unknown;
    const text = extractTextFromGeminiResponse(payload);
    if (!text) {
      return NextResponse.json({ error: 'No response text returned by Gemini' }, { status: 502 });
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('[ai-chatbot] Unexpected error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { auth, response } = await requireRequestAuth(req);
  if (response || !auth) return response;

  const apiKey = getGeminiApiKey();
  const model = getGeminiModel();

  return NextResponse.json({
    userId: auth.user.id,
    geminiConfigured: Boolean(apiKey),
    model,
    keyHint: apiKey ? getMaskedKeyHint(apiKey) : null,
    roleNames: auth.user.roles.map((role) => role.name),
    permissionNames: auth.user.permissions.map((permission) => permission.name),
  });
}
