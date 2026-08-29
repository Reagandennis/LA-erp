import { describe, expect, it } from 'vitest';

import {
  loginSchema,
  managedUserSchema,
  managedUserUpdateSchema,
  personalTodoCreateSchema,
  personalTodoUpdateSchema,
} from '../lib/validation';

describe('validation schemas', () => {
  it('normalizes login email addresses', () => {
    const result = loginSchema.parse({
      email: 'ADMIN@Example.COM ',
      password: 'secret',
    });

    expect(result.email).toBe('admin@example.com');
  });

  it('requires strong managed-user passwords', () => {
    const result = managedUserSchema.safeParse({
      email: 'user@example.com',
      name: 'Managed User',
      password: 'password',
      status: 'active',
      roleIds: [1],
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty managed-user update payloads', () => {
    const result = managedUserUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('requires a title for personal todo creation', () => {
    const result = personalTodoCreateSchema.safeParse({
      title: '   ',
      priority: 'medium',
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty personal todo updates', () => {
    const result = personalTodoUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('accepts a personal todo update that only moves the start date', () => {
    // A Gantt edge-drag sends nothing else, so the "at least one field"
    // refinement has to count startDate.
    const result = personalTodoUpdateSchema.safeParse({
      startDate: '2026-08-28T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('allows a start date to be cleared', () => {
    const result = personalTodoUpdateSchema.safeParse({ startDate: null });

    expect(result.success).toBe(true);
  });

  it('accepts a start date on personal todo creation', () => {
    const result = personalTodoCreateSchema.safeParse({
      title: 'Draft the report',
      startDate: '2026-08-24T00:00:00.000Z',
      dueDate: '2026-08-28T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });
});
