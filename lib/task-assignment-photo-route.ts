import { NextRequest, NextResponse } from 'next/server';

import { fileResponse } from '@/lib/file-response';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { getResourcePhoto, setResourcePhoto, type ResourceKind } from '@/lib/task-assignment';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Builds GET (serve) / POST (upload-or-replace) handlers for a resource photo.
 * Shared by the vehicle, driver, and officer photo routes.
 */
export function makePhotoHandlers(kind: ResourceKind) {
  // Vehicles are also run from their own module; drivers and officers only from task assignment.
  const modules = kind === 'vehicle' ? API_ACCESS.vehicles : API_ACCESS.taskAssignment;

  async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { auth, response } = await requireModuleRequest(request, ...modules);
    if (response || !auth) return response;

    const { id: raw } = await params;
    const id = parseId(raw);
    if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const photo = await getResourcePhoto(kind, id);
    if (!photo) return NextResponse.json({ error: 'No photo on file' }, { status: 404 });

    return fileResponse({
      content: photo.content,
      mime: photo.mime,
      name: photo.name,
    });
  }

  async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { auth, response } = await requireModuleRequest(request, ...modules);
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
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      return NextResponse.json({ error: 'File must be a non-SVG image' }, { status: 400 });
    }
    const maxPhotoMb = await getUploadLimitMb('photoMb');
    if (file.size > mbToBytes(maxPhotoMb)) {
      return NextResponse.json({ error: `Image exceeds the ${maxPhotoMb} MB limit` }, { status: 400 });
    }

    const ok = await setResourcePhoto(kind, id, {
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      content: Buffer.from(await file.arrayBuffer()),
    });
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ ok: true }, { status: 201 });
  }

  return { GET, POST };
}
