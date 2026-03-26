import { describe, expect, it } from 'vitest';

import { POST } from '../app/api/auth/signup/route';

describe('signup route', () => {
  it('rejects public signup requests', async () => {
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('administrator');
  });
});
