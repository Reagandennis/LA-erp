import { describe, expect, it } from 'vitest';

import { loginSchema, managedUserSchema, managedUserUpdateSchema } from '../lib/validation';

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
});
