import { NextRequest, NextResponse } from 'next/server';

import { getContactPhoto, setContactPhoto } from '@/lib/contacts';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const photo = await getContactPhoto(id);
  if (!photo) return NextResponse.json({ error: 'No photo on file' }, { status: 404 });

  const body = new Uint8Array(photo.content);
  return new Response(body, {
    headers: {
      'Content-Type': photo.mime,
      'Content-Disposition': `inline; filename="${photo.name.replace(/"/g, '')}"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('photo');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No image uploaded' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: 'Image exceeds the 8 MB limit' }, { status: 400 });
  }

  const ok = await setContactPhoto(id, {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    content: Buffer.from(await file.arrayBuffer()),
  });
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
