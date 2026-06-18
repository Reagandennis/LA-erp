import { NextRequest, NextResponse } from 'next/server';

import { createContact, listContacts, listCustomerOptions } from '@/lib/contacts';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const [contacts, customers] = await Promise.all([listContacts(), listCustomerOptions()]);
  return NextResponse.json({ contacts, customers });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const item = await createContact({
      userId: auth.user.id,
      name: String(body.name ?? ''),
      role: body.role ?? null,
      category: typeof body.category === 'string' ? body.category : undefined,
      email: body.email ?? null,
      phone: body.phone ?? null,
      location: body.location ?? null,
      notes: body.notes ?? null,
      tags: body.tags,
      customerId: typeof body.customerId === 'number' ? body.customerId : null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not add contact';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
