import { NextRequest, NextResponse } from 'next/server';

import { isPersonnelRole, PEOPLE_MODULE_SLUGS } from '@/lib/people-views';
import { createPersonnel, listPersonnel, listUserOptions } from '@/lib/personnel';
import { requireAdminRequest, requireModuleRequest } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  // Serves all five people modules, so any of their grants is enough. This
  // was previously bare `requireRequestAuth`, which handed the full staff
  // directory to every logged-in user regardless of module access.
  const { auth, response } = await requireModuleRequest(request, ...PEOPLE_MODULE_SLUGS);
  if (response || !auth) return response;

  const roleParam = request.nextUrl.searchParams.get('role');
  const role = isPersonnelRole(roleParam) ? roleParam : null;

  const [items, users] = await Promise.all([listPersonnel({ role }), listUserOptions()]);
  return NextResponse.json({ items, users });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createPersonnel({
      createdById: auth.user.id,
      name: String(body.name ?? ''),
      email: body.email ?? null,
      phone: body.phone ?? null,
      role: body.role ?? null,
      department: typeof body.department === 'string' ? body.department : undefined,
      status: typeof body.status === 'string' ? body.status : undefined,
      location: body.location ?? null,
      manager: body.manager ?? null,
      joinDate: typeof body.joinDate === 'string' ? body.joinDate : null,
      skills: body.skills,
      roles: body.roles,
      engagement: typeof body.engagement === 'string' ? body.engagement : undefined,
      supplierName: body.supplierName ?? null,
      callSign: body.callSign ?? null,
      grade: body.grade ?? null,
      notes: body.notes ?? null,
      userId: typeof body.userId === 'number' ? body.userId : null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add personnel';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
