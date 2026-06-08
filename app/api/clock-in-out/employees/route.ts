import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Active users who belong on the schedule (have the clock-in-out module or admin role).
// Available to any authenticated user so the read-only schedule isn't empty for non-admins.
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const users = await prisma.user.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      userRoles: { select: { role: { select: { name: true } } } },
      userModules: { select: { module: { select: { slug: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  const employees = users
    .map((u) => {
      const roleNames = u.userRoles.map((r) => r.role.name);
      const moduleSlugs = u.userModules.map((m) => m.module.slug);
      const schedulable =
        moduleSlugs.includes('clock-in-out') || roleNames.some((n) => n.toLowerCase() === 'admin');
      return { id: u.id, name: u.name, position: roleNames[0] ?? 'General Sales', schedulable };
    })
    .filter((e) => e.schedulable)
    .map(({ id, name, position }) => ({ id, name, position }));

  return NextResponse.json({ employees });
}
