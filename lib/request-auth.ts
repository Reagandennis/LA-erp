import { NextRequest, NextResponse } from 'next/server';

import { getRequestAuth } from './auth';
import { ADMIN_ROLE_NAME } from './rbac';
import { userHasRole } from './user';

export async function requireRequestAuth(request: NextRequest) {
  const auth = await getRequestAuth(request);

  if (!auth) {
    return {
      auth: null,
      response: NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 },
      ),
    };
  }

  return {
    auth,
    response: null,
  };
}

export async function requireAdminRequest(request: NextRequest) {
  const result = await requireRequestAuth(request);

  if (result.response || !result.auth) {
    return result;
  }

  if (!userHasRole(result.auth.user, ADMIN_ROLE_NAME)) {
    return {
      auth: null,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }

  return result;
}
