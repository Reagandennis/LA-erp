import { NextRequest, NextResponse } from 'next/server';

import { createCategory, getMapWorkspace } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapCategoryCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const { categories } = await getMapWorkspace();
  return NextResponse.json({ items: categories });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const parsed = mapCategoryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid category' }, { status: 400 });
  }

  try {
    const item = await createCategory(parsed.data, auth.user.id);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the category';
    // A duplicate name trips the unique index; say so plainly.
    const conflict = message.includes('Unique constraint');
    return NextResponse.json(
      { error: conflict ? 'A category with that name already exists.' : message },
      { status: 400 },
    );
  }
}
