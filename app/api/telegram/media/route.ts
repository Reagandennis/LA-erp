import { createMediaGET } from '@/lib/messaging-media-route';
import { getMedia, sendMedia } from '@/lib/telegram';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export const GET = createMediaGET({
  provider: 'telegram',
  scopeOf: (ctx) => ctx.userId,
  getMedia,
  sendMedia,
});
