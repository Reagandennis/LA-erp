import 'server-only';

import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

import { asBool, asInt, asNullableString, asString, type ToolDefinition } from '../types';

const MODULE = 'todo-personal';
const PRIORITIES = ['low', 'medium', 'high'];

interface TodoRow {
  id: number;
  title: string;
  priority: string;
  status: string;
  completed: boolean;
  dueDate: Date | null;
}

function parseDue(value: unknown): Date | null {
  const s = asString(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const listTodosTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'list_todos',
    description: "List the current user's tasks (excludes deleted tasks).",
    parameters: { type: 'object', properties: {} },
  },
  async handler(_args, ctx) {
    const rows = (await prisma.personalTodo.findMany({
      where: { userId: ctx.userId, deletedAt: null },
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, title: true, priority: true, status: true, completed: true, dueDate: true },
    })) as TodoRow[];
    return rows.slice(0, 50).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      completed: t.completed,
      dueDate: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
    }));
  },
};

const createTodoTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'create_todo',
    description: 'Create a task for the current user.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: PRIORITIES },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['title'],
    },
  },
  async handler(args, ctx) {
    const title = asString(args.title);
    if (!title) return { error: 'A title is required.' };
    const priority = asString(args.priority);
    const created = await prisma.personalTodo.create({
      data: {
        userId: ctx.userId,
        title,
        description: asNullableString(args.description),
        priority: priority && PRIORITIES.includes(priority) ? priority : 'medium',
        status: 'Backlog',
        dueDate: parseDue(args.dueDate),
        completed: false,
        completedAt: null,
      },
      select: { id: true, title: true },
    });
    await recordAuditEvent({ action: 'ai.todo.create', entityType: 'PersonalTodo', entityId: String(created.id), actorUserId: ctx.userId, request: ctx.request });
    return { id: created.id, title: created.title };
  },
};

const updateTodoTool: ToolDefinition = {
  destructive: false,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'update_todo',
    description: 'Update a task — title, priority, status, due date, or mark it complete/incomplete. Provide only fields to change.',
    parameters: {
      type: 'object',
      properties: {
        todoId: { type: 'integer' },
        title: { type: 'string' },
        priority: { type: 'string', enum: PRIORITIES },
        status: { type: 'string' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        completed: { type: 'boolean' },
      },
      required: ['todoId'],
    },
  },
  async handler(args, ctx) {
    const id = asInt(args.todoId);
    if (!id) return { error: 'A valid todoId is required.' };
    const existing = await prisma.personalTodo.findFirst({ where: { id, userId: ctx.userId, deletedAt: null }, select: { id: true } });
    if (!existing) return { error: 'Task not found.' };

    const data: Record<string, unknown> = {};
    if (args.title !== undefined) {
      const t = asString(args.title);
      if (t) data.title = t;
    }
    const priority = asString(args.priority);
    if (priority && PRIORITIES.includes(priority)) data.priority = priority;
    if (args.status !== undefined) {
      const s = asString(args.status);
      if (s) data.status = s;
    }
    if (args.dueDate !== undefined) data.dueDate = parseDue(args.dueDate);
    if (args.completed !== undefined) {
      const c = asBool(args.completed) ?? false;
      data.completed = c;
      data.completedAt = c ? new Date() : null;
    }
    if (Object.keys(data).length === 0) return { error: 'Provide at least one field to update.' };

    const updated = await prisma.personalTodo.update({ where: { id }, data, select: { id: true, title: true, completed: true } });
    await recordAuditEvent({ action: 'ai.todo.update', entityType: 'PersonalTodo', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
    return { id: updated.id, title: updated.title, completed: updated.completed };
  },
};

const deleteTodoTool: ToolDefinition = {
  destructive: true,
  requiredModule: MODULE,
  functionDeclaration: {
    name: 'delete_todo',
    description: 'Delete a task. It is archived (kept under the Deleted filter) and can be restored.',
    parameters: { type: 'object', properties: { todoId: { type: 'integer' } }, required: ['todoId'] },
  },
  async handler(args, ctx) {
    const id = asInt(args.todoId);
    if (!id) return { error: 'A valid todoId is required.' };
    const existing = await prisma.personalTodo.findFirst({ where: { id, userId: ctx.userId, deletedAt: null }, select: { id: true } });
    if (!existing) return { error: 'Task not found.' };
    await prisma.personalTodo.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAuditEvent({ action: 'ai.todo.delete', entityType: 'PersonalTodo', entityId: String(id), actorUserId: ctx.userId, request: ctx.request });
    return { deleted: true, todoId: id };
  },
};

export const todoTools: ToolDefinition[] = [listTodosTool, createTodoTool, updateTodoTool, deleteTodoTool];
