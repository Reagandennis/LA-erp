import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { IMPORT_EXTENSIONS, extensionOf, isSupportedImport, parseMapUpload } from '@/lib/geo-import';
import { createLayerFromImport } from '@/lib/map-store';
import type { LayerKind } from '@/lib/map-types';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireModuleRequest } from '@/lib/request-auth';
import { getUploadLimitMb, mbToBytes } from '@/lib/upload-limits';

// node:zlib and Buffer are needed to open a .kmz.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'map');
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'map.import',
    key: `${auth.user.id}`,
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many imports. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (!isSupportedImport(file.name)) {
    return NextResponse.json(
      { error: `Unsupported file type "${extensionOf(file.name) || file.name}". Upload ${IMPORT_EXTENSIONS.join(', ')}.` },
      { status: 400 },
    );
  }

  const maxMb = await getUploadLimitMb('documentMb');
  if (file.size > mbToBytes(maxMb)) {
    return NextResponse.json(
      { error: `"${file.name}" exceeds the ${maxMb} MB per-file limit` },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseMapUpload({ fileName: file.name, bytes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read that file' },
      { status: 400 },
    );
  }

  if (parsed.features.length === 0) {
    return NextResponse.json(
      { error: parsed.warnings[0] ?? 'No map features were found in that file.' },
      { status: 400 },
    );
  }

  const layerName = String(formData.get('name') ?? '').trim() || file.name.replace(/\.[^.]+$/, '');
  const kind: LayerKind = formData.get('kind') === 'boundary' ? 'boundary' : 'import';
  const rawCategory = Number(formData.get('categoryId'));
  const categoryId = Number.isInteger(rawCategory) && rawCategory > 0 ? rawCategory : null;

  const result = await createLayerFromImport(
    {
      name: layerName,
      source: parsed.source,
      kind,
      fileName: file.name,
      fileMime: file.type || 'application/octet-stream',
      fileContent: bytes,
      features: parsed.features,
      categoryId,
    },
    auth.user.id,
  );

  await recordAuditEvent({
    action: 'map.layer.imported',
    entityType: 'MapLayer',
    entityId: String(result.layer.id),
    actorUserId: auth.user.id,
    metadata: { fileName: file.name, source: parsed.source, imported: result.imported },
    request,
  });

  const warnings = [...parsed.warnings];
  if (result.categoriesCreated.length > 0) {
    warnings.push(
      `Created ${result.categoriesCreated.length} categor${result.categoriesCreated.length === 1 ? 'y' : 'ies'}: ${result.categoriesCreated.join(', ')}.`,
    );
  }

  return NextResponse.json(
    { layer: result.layer, imported: result.imported, skipped: parsed.skipped, warnings },
    { status: 201 },
  );
}
