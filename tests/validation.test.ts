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
});
