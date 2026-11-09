import { describe, expect, it } from 'vitest';

import { personalTodoBoardSchema, personalTodoCreateSchema, personalTodoUpdateSchema } from '../lib/validation';

/**
 * Kanban columns are the person's own: a task moved into a column they
 * created must be accepted with that column's name as its status.
 */
describe('personal task status', () => {
  it('accepts a custom column name, trimmed', () => {
    expect(personalTodoUpdateSchema.safeParse({ status: '  Waiting on client ' }).data?.status).toBe('Waiting on client');
    expect(personalTodoCreateSchema.safeParse({ title: 'Call back', status: 'QA' }).data?.status).toBe('QA');
  });

  it('still defaults a new task to Backlog', () => {
    expect(personalTodoCreateSchema.safeParse({ title: 'Call back' }).data?.status).toBe('Backlog');
  });

  it('refuses an empty status or one longer than a column name may be', () => {
    expect(personalTodoUpdateSchema.safeParse({ status: '   ' }).success).toBe(false);
    const tooLong = 'x'.repeat(41);
    expect(personalTodoUpdateSchema.safeParse({ status: tooLong }).success).toBe(false);
    // The two limits agree, so any column the board accepts is a valid status.
    expect(personalTodoBoardSchema.safeParse({ columns: [tooLong] }).success).toBe(false);
    expect(personalTodoBoardSchema.safeParse({ columns: ['x'.repeat(40)] }).success).toBe(true);
    expect(personalTodoUpdateSchema.safeParse({ status: 'x'.repeat(40) }).success).toBe(true);
  });
});
