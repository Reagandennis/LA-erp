import 'server-only';

import type { Prisma } from '@prisma/client';

import { API_ACCESS } from '@/lib/api-access';
import { prisma } from '@/lib/prisma';
import { todoVisibleTo } from '@/lib/user-groups';
import { personalTodoCreateSchema, personalTodoUpdateSchema } from '@/lib/validation';
import { utcToZoned } from '@/lib/zoned-time';

import { asString, type ToolContext, type ToolDefinition, ToolRefusal } from '../types';
import {
  audit,
  changedFields,
  optAmount,
  optDate,
  optEnum,
  optFlag,
  optText,
  parseWith,
  reqId,
  reqText,
  requireChange,
  todayIn,
  toUtc,
} from './_shared';

const MODULE = API_ACCESS.tasks;
const PAGE_SIZE = 20;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const SHOW = ['open', 'completed', 'overdue', 'deleted'] as const;
/** The board a user starts with, until they rename or add columns (app/modules/todo-personal/page.tsx). */
const DEFAULT_COLUMNS = ['Backlog', 'In progress', 'In review'];

const taskHref = (id: number) => `/modules/todo-personal?open=${id}`;
const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max)}…` : text);

const TODO_SELECT = {
  id: true, userId: true, title: true, description: true, priority: true, status: true,
  startDate: true, dueDate: true, completed: true, deletedAt: true,
} as const;

type TodoRow = Prisma.PersonalTodoGetPayload<{ select: typeof TODO_SELECT }>;

/** The day a stored date falls on for this user: the page stores a day as its local midnight. */
const localDay = (value: Date | null, zone: string) => (value ? utcToZoned(value.toISOString(), zone).date || null : null);

/** A YYYY-MM-DD as the page stores it: that day's midnight where the user is. */
const dayInstant = (date: string, zone: string, what: string) => new Date(toUtc(date, '00:00', zone, what));

/**
 * The columns of the user's board, as the board route reads them. A task whose
 * status is not one of these is on no column, so the board does not show it.
 */
async function boardColumns(userId: number): Promise<string[]> {
  const board = await prisma.personalTodoBoard.findUnique({ where: { userId } });
  const saved = Array.isArray(board?.columns) ? board.columns.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [];
  return saved.length > 0 ? saved : DEFAULT_COLUMNS;
}

/** A status the board has a column for, or a refusal naming the columns it does have. */
function readStatus(args: Record<string, unknown>, columns: string[]): string | undefined {
  const status = optText(args, 'status', { max: 40 });
  if (status == null) return undefined;
  const column = columns.find((c) => c === status) ?? columns.find((c) => c.toLowerCase() === status.toLowerCase());
  if (!column) {
    throw new ToolRefusal(
      `status must be one of this user's board columns: ${columns.join(', ')} (got "${status}"). A task in any other status disappears from the board. To finish a task, set completed: true.`,
    );
  }
  return column;
}

function taskFacts(task: TodoRow, zone: string): Record<string, unknown> {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    startDate: localDay(task.startDate, zone),
    dueDate: localDay(task.dueDate, zone),
    completed: task.completed,
  };
}

const TASK_FIELDS = ['title', 'description', 'priority', 'status', 'startDate', 'dueDate', 'completed'] as const;

/** One of the user's own tasks. A task only shared with them is the owner's to change, as on the page. */
async function loadOwnTask(id: number, ctx: ToolContext): Promise<TodoRow> {
  const task = await prisma.personalTodo.findFirst({ where: { id, userId: ctx.userId }, select: TODO_SELECT });
  if (!task) {
    throw new ToolRefusal(`Task ${id} was not found among this user's own tasks (a task shared with them can only be changed by its owner). Find it with list_todos.`);
  }
  return task;
}

const listTodosTool: ToolDefinition = {
  destructive: false,
  kind: 'read',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_todos',
    description:
      `The user's tasks, their own and those shared with them: open ones first, soonest due first. Returns the board's columns (the valid statuses). ${PAGE_SIZE} per page.`,
    parameters: {
      type: 'object',
      properties: {
        show: { type: 'string', enum: [...SHOW], description: 'Default: everything not deleted. overdue = open and due before today' },
        q: { type: 'string', description: 'Words in the title or description' },
        page: { type: 'integer' },
      },
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const show = optEnum(args, 'show', SHOW);
    const q = asString(args.q);
    const page = optAmount(args, 'page', { min: 1, integer: true }) ?? 1;
    const today = todayIn(zone);
    const startOfToday = dayInstant(today, zone, 'date');

    const where: Prisma.PersonalTodoWhereInput = {
      AND: [
        todoVisibleTo(ctx.userId),
        { deletedAt: show === 'deleted' ? { not: null } : null },
        ...(show === 'open' ? [{ completed: false }] : []),
        ...(show === 'completed' ? [{ completed: true }] : []),
        ...(show === 'overdue' ? [{ completed: false, dueDate: { lt: startOfToday } }] : []),
        ...(q ? [{ OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] }] : []),
      ],
    };
    const [total, rows, columns] = await Promise.all([
      prisma.personalTodo.count({ where }),
      prisma.personalTodo.findMany({
        where,
        orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: TODO_SELECT,
      }),
      boardColumns(ctx.userId),
    ]);
    return {
      total,
      page,
      more: page * PAGE_SIZE < total,
      boardColumns: columns,
      tasks: rows.map((t) => {
        const due = localDay(t.dueDate, zone);
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          completed: t.completed,
          dueDate: due,
          ...(t.startDate ? { startDate: localDay(t.startDate, zone) } : {}),
          ...(due && !t.completed && due < today ? { overdue: true } : {}),
          ...(t.description ? { description: clip(t.description, 200) } : {}),
          ...(t.userId !== ctx.userId ? { sharedWithMe: true } : {}),
          ...(t.deletedAt ? { deleted: true } : {}),
        };
      }),
      today,
    };
  },
};

const createTodoTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_todo',
    description: "Add a task to the user's own board. It goes in the first column unless status names another of their columns.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Max 160 characters' },
        description: { type: 'string', description: 'Max 1000 characters' },
        priority: { type: 'string', enum: [...PRIORITIES], description: 'Default medium' },
        status: { type: 'string', description: "One of the user's board columns (list_todos returns them)" },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title'],
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const title = reqText(args, 'title', { max: 160 });
    const description = optText(args, 'description', { max: 1000 }) ?? null;
    const priority = optEnum(args, 'priority', PRIORITIES);
    const startDate = optDate(args, 'startDate') ?? null;
    const dueDate = optDate(args, 'dueDate') ?? null;
    if (startDate && dueDate && startDate > dueDate) throw new ToolRefusal(`startDate (${startDate}) is after dueDate (${dueDate}).`);
    const columns = await boardColumns(ctx.userId);
    const status = readStatus(args, columns) ?? (columns.includes('Backlog') ? 'Backlog' : columns[0]);

    const input = parseWith(personalTodoCreateSchema, { title, description, ...(priority ? { priority } : {}), status });
    const created = await prisma.personalTodo.create({
      data: {
        userId: ctx.userId,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        status: input.status,
        startDate: startDate ? dayInstant(startDate, zone, 'start date') : null,
        dueDate: dueDate ? dayInstant(dueDate, zone, 'due date') : null,
        completed: false,
        completedAt: null,
      },
      select: TODO_SELECT,
    });
    await audit({
      action: 'ai.todo.create', entityType: 'PersonalTodo', entityId: String(created.id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    const facts = taskFacts(created, zone);
    return {
      id: created.id,
      ...facts,
      href: taskHref(created.id),
      summary: `Added the task "${created.title}" to ${created.status}${facts.dueDate ? `, due ${facts.dueDate}` : ''}`,
    };
  },
};

const updateTodoTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_todo',
    description:
      "Change one of the user's own tasks: title, description, priority, column (status), dates, or done. " +
      'To finish a task set completed: true; status only moves it between the columns of their board. Send only what should change.',
    parameters: {
      type: 'object',
      properties: {
        todoId: { type: 'integer' },
        title: { type: 'string', description: 'Max 160 characters' },
        description: { type: 'string', description: 'Max 1000 characters; null clears it', nullable: true },
        priority: { type: 'string', enum: [...PRIORITIES] },
        status: { type: 'string', description: "One of the user's board columns (list_todos returns them)" },
        startDate: { type: 'string', description: 'YYYY-MM-DD; null clears it', nullable: true },
        dueDate: { type: 'string', description: 'YYYY-MM-DD; null clears it', nullable: true },
        completed: { type: 'boolean' },
      },
      required: ['todoId'],
    },
  },
  async handler(args, ctx) {
    const zone = ctx.timeZone;
    const id = reqId(args, 'todoId', 'use list_todos');
    const before = await loadOwnTask(id, ctx);
    if (before.deletedAt) throw new ToolRefusal(`"${before.title}" is deleted. Bring it back with restore_todo before changing it.`);

    const input: Record<string, unknown> = {};
    const title = optText(args, 'title', { max: 160 });
    if (title != null) input.title = title;
    const description = optText(args, 'description', { max: 1000 });
    if (description !== undefined) input.description = description;
    const priority = optEnum(args, 'priority', PRIORITIES);
    if (priority) input.priority = priority;
    // Every value is read before the board is, so a bad date is refused on its own terms.
    const startDate = optDate(args, 'startDate');
    const dueDate = optDate(args, 'dueDate');
    const completed = optFlag(args, 'completed');
    if (completed !== undefined) input.completed = completed;
    if (args.status !== undefined) input.status = readStatus(args, await boardColumns(ctx.userId));
    if (Object.keys(input).length === 0 && startDate === undefined && dueDate === undefined) {
      throw new ToolRefusal('Say what to change on the task.');
    }
    const start = startDate === undefined ? localDay(before.startDate, zone) : startDate;
    const due = dueDate === undefined ? localDay(before.dueDate, zone) : dueDate;
    if (start && due && start > due) throw new ToolRefusal(`The start date (${start}) would be after the due date (${due}).`);

    const data = parseWith(personalTodoUpdateSchema, { ...input, ...(startDate !== undefined ? { startDate } : {}), ...(dueDate !== undefined ? { dueDate } : {}) });
    const updated = await prisma.personalTodo.updateMany({
      where: { id, userId: ctx.userId },
      data: {
        title: data.title,
        description: data.description === undefined ? undefined : data.description || null,
        priority: data.priority,
        status: data.status,
        startDate: startDate === undefined ? undefined : startDate ? dayInstant(startDate, zone, 'start date') : null,
        dueDate: dueDate === undefined ? undefined : dueDate ? dayInstant(dueDate, zone, 'due date') : null,
        completed: data.completed,
        completedAt: data.completed === undefined ? undefined : data.completed ? new Date() : null,
      },
    });
    const after = updated.count > 0 ? await prisma.personalTodo.findFirst({ where: { id, userId: ctx.userId }, select: TODO_SELECT }) : null;
    if (!after) throw new ToolRefusal(`Task ${id} was not found.`);

    const changed = changedFields(taskFacts(before, zone), taskFacts(after, zone), TASK_FIELDS);
    requireChange(changed, `"${before.title}"`);
    if (changed.description) changed.description = { from: clip(before.description, 120), to: clip(after.description, 120) };
    await audit({
      action: 'ai.todo.update', entityType: 'PersonalTodo', entityId: String(id),
      actorUserId: ctx.userId, metadata: { fields: Object.keys(changed) }, request: ctx.request,
    });
    return {
      id,
      title: after.title,
      changed,
      href: taskHref(id),
      summary: `Updated the task "${after.title}": ${Object.keys(changed).join(', ')}`,
    };
  },
};

const deleteTodoTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  confirmLabel: (args) =>
    `Delete the task ${asString(args.title) ? `"${asString(args.title)}"` : `#${args.todoId}`} (it is kept under the Deleted filter and can be restored)`,
  functionDeclaration: {
    name: 'delete_todo',
    description: "Delete one of the user's own tasks. It is kept under the Deleted filter and restore_todo brings it back.",
    parameters: {
      type: 'object',
      properties: {
        todoId: { type: 'integer' },
        title: { type: 'string', description: "The task's title, shown to the user when they confirm" },
      },
      required: ['todoId'],
    },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'todoId');
    const task = await loadOwnTask(id, ctx);
    if (task.deletedAt) throw new ToolRefusal(`"${task.title}" is already deleted.`);
    await prisma.personalTodo.updateMany({ where: { id, userId: ctx.userId }, data: { deletedAt: new Date() } });
    await audit({
      action: 'ai.todo.delete', entityType: 'PersonalTodo', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    return { deleted: true, todoId: id, restorable: true, href: '/modules/todo-personal', summary: `Deleted the task "${task.title}" (it can be restored)` };
  },
};

const restoreTodoTool: ToolDefinition = {
  destructive: false,
  kind: 'write',
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'restore_todo',
    description: "Bring back one of the user's deleted tasks. Find it with list_todos (show: deleted).",
    parameters: { type: 'object', properties: { todoId: { type: 'integer' } }, required: ['todoId'] },
  },
  async handler(args, ctx) {
    const id = reqId(args, 'todoId', 'use list_todos with show "deleted"');
    const task = await loadOwnTask(id, ctx);
    if (!task.deletedAt) throw new ToolRefusal(`"${task.title}" is not deleted: there is nothing to restore.`);
    await prisma.personalTodo.updateMany({ where: { id, userId: ctx.userId }, data: { deletedAt: null } });
    await audit({
      action: 'ai.todo.restore', entityType: 'PersonalTodo', entityId: String(id),
      actorUserId: ctx.userId, request: ctx.request,
    });
    const columns = await boardColumns(ctx.userId);
    return {
      restored: true,
      id,
      title: task.title,
      status: task.status,
      ...(columns.includes(task.status)
        ? {}
        : { note: `Its column "${task.status}" is no longer on the board, so the board does not show it. Move it with update_todo (columns: ${columns.join(', ')}).` }),
      href: taskHref(id),
      summary: `Restored the task "${task.title}"`,
    };
  },
};

export const todoTools: ToolDefinition[] = [listTodosTool, createTodoTool, updateTodoTool, deleteTodoTool, restoreTodoTool];
