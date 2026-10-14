import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireModuleRequest } from '@/lib/request-auth';
import { ARCHIVE_SELECT, archiveWhere, parseArchiveFilter } from '@/lib/zello-archive';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const PAGE_MAX = 200;

/**
 * Browse stored radio traffic across channels and dates.
 *
 * Unlike /api/zello/activity (one channel, used by the live console), this is the
 * archive view: filterable, keyset-paginated (newest first), and it also returns
 * the channel / speaker facets so the UI can offer them as pick-lists.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, 'radio-zello');
  if (response || !auth) return response;

  const { searchParams } = new URL(request.url);
  const filter = parseArchiveFilter(searchParams);
  const where = archiveWhere(filter);
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), PAGE_MAX);
  const cursor = Number(searchParams.get('cursor'));

  const [rows, total, channels, speakers] = await Promise.all([
    prisma.zelloActivity.findMany({
      where,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(Number.isInteger(cursor) && cursor > 0 ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: ARCHIVE_SELECT,
    }),
    prisma.zelloActivity.count({ where }),
    prisma.zelloActivity.findMany({
      where: filter.network ? { network: filter.network } : {},
      distinct: ['channel'],
      select: { channel: true },
      orderBy: { channel: 'asc' },
    }),
    prisma.zelloActivity.findMany({
      where: filter.network ? { network: filter.network } : {},
      distinct: ['fromName'],
      select: { fromName: true },
      orderBy: { fromName: 'asc' },
    }),
  ]);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return NextResponse.json({
    items,
    total,
    nextCursor: hasMore ? items[items.length - 1].id : null,
    channels: channels.map((c) => c.channel),
    speakers: speakers.map((s) => s.fromName),
  });
}
