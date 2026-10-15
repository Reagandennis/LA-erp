import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { createRole, findRoleNameClash, isAdminRoleName, modulesExist } from '@/lib/roles';
import { listRolesForAdmin } from '@/lib/user';
import { roleSchema } from '@/lib/validation';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { response } = await requireAdminRequest(request);
  if (response) return response;
  return NextResponse.json({ roles: await listRolesForAdmin() });
}

/** Create a custom role: a name, a description and the modules it opens. */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.role.mutate',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many role changes. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const validation = roleSchema.safeParse(await request.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { name, description, moduleIds } = validation.data;

  if (isAdminRoleName(name) || (await findRoleNameClash(name))) {
    return NextResponse.json({ error: `A role called "${name}" already exists` }, { status: 409 });
  }
  if (!(await modulesExist(moduleIds))) {
    return NextResponse.json({ error: 'One or more selected modules are invalid' }, { status: 400 });
  }

  const role = await createRole({ name, description, moduleIds });

  await recordAuditEvent({
    action: 'admin.role.created',
    entityType: 'role',
    entityId: String(role.id),
    actorUserId: auth.user.id,
    metadata: { name: role.name, moduleIds },
    request,
  });

  return NextResponse.json({ success: true, roles: await listRolesForAdmin(), roleId: role.id }, { status: 201 });
}
