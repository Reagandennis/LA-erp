import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { renameFile, trashFile } from '@/lib/google-drive';
import { driveErrorResponse, resolveDriveRequest } from '@/lib/google-drive-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Rename a file or folder. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { ctx, response } = await resolveDriveRequest(request);
  if (response || !ctx) return response;

  const { fileId } = await params;
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

  try {
    return NextResponse.json({ file: await renameFile(ctx.token, fileId, name) });
  } catch (error) {
    return driveErrorResponse(error);
  }
}

/**
 * Move to Drive's bin. Never a permanent delete — an accidental click here
 * stays recoverable from Drive itself.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { ctx, response } = await resolveDriveRequest(request);
  if (response || !ctx) return response;

  const { fileId } = await params;
  try {
    await trashFile(ctx.token, fileId);
    await recordAuditEvent({
      action: 'drive.file.trashed',
      entityType: 'google-drive-file',
      entityId: fileId,
      actorUserId: ctx.userId,
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
