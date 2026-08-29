import { NextRequest, NextResponse } from 'next/server';

import { deleteCategory, updateCategory } from '@/lib/map-store';
import { requireModuleRequest } from '@/lib/request-auth';
import { mapCategoryUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).categoryId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });

  const parsed = mapCategoryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid category' }, { status: 400 });
  }

  const item = await updateCategory(id, parsed.data);
  if (!item) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const id = Number((await params).categoryId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });

  const deleted = await deleteCategory(id);
  if (!deleted) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
