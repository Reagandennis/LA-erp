import { NextRequest, NextResponse } from 'next/server';

import { aiUsageOverview, getAiSettings } from '@/lib/ai-budget';
import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';
import { aiSettingsUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** AI spend so far and the limits that cap it. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;
  return NextResponse.json(await aiUsageOverview());
}

export async function PUT(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({ scope: 'admin.ai_settings.update', key: `${auth.user.id}`, limit: 10, windowMs: 60 * 1000 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many changes. Slow down and try again.' }, { status: 429 });
  }

  const validation = aiSettingsUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const before = await getAiSettings();
  await prisma.aiSettings.update({ where: { id: 1 }, data: { ...validation.data, updatedById: auth.user.id } });
  await recordAuditEvent({
    action: 'admin.ai_settings.updated',
    entityType: 'settings',
    entityId: 'ai',
    actorUserId: auth.user.id,
    metadata: {
      before: {
        enabled: before.enabled,
        dailyBudgetUsd: before.dailyBudgetUsd,
        monthlyBudgetUsd: before.monthlyBudgetUsd,
        chatMessagesPerUserPerDay: before.chatMessagesPerUserPerDay,
        webSearchesPerDay: before.webSearchesPerDay,
        intelReportsPerUserPerDay: before.intelReportsPerUserPerDay,
        radioTranscription: before.radioTranscription,
        alertEmails: before.alertEmails,
      },
      after: validation.data,
    },
    request,
  });
  return NextResponse.json(await aiUsageOverview());
}
