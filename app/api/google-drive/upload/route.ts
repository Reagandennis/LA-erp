import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { uploadFile } from '@/lib/google-drive';
import { driveErrorResponse, resolveDriveRequest } from '@/lib/google-drive-route';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Upload one file into a Drive folder. */
export async function POST(request: NextRequest) {
  const { ctx, response } = await resolveDriveRequest(request);
  if (response || !ctx) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'drive.upload',
    key: `${ctx.userId}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads. Slow down and try again.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart upload.' }, { status: 400 });
  }

  const file = form.get('file');
  const parentId = String(form.get('parentId') ?? '').trim() || undefined;
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
  }

  // The bytes pass through this server, so the app's own per-file ceiling
  // applies even though the file ends up in Drive rather than Postgres.
  const limitMb = await getUploadLimitMb('fileMb');
  if (file.size > mbToBytes(limitMb)) {
    return NextResponse.json(
      { error: `Uploads through the app are limited to ${limitMb} MB.` },
      { status: 413 },
    );
  }

  try {
    const created = await uploadFile(
      ctx.token,
      {
        bytes: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || 'application/octet-stream',
        name: file.name || 'upload',
      },
      parentId,
    );
    await recordAuditEvent({
      action: 'drive.file.uploaded',
      entityType: 'google-drive-file',
      entityId: created.id,
      actorUserId: ctx.userId,
      metadata: { name: created.name, sizeBytes: file.size },
      request,
    });
    return NextResponse.json({ file: created }, { status: 201 });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
