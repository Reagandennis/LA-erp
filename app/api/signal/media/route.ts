import { createMediaGET } from '@/lib/messaging-media-route';
import { getMedia, sendMedia } from '@/lib/signal-cli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export const GET = createMediaGET({
  provider: 'signal',
  scopeOf: (ctx) => ctx.account?.handle ?? null,
  getMedia,
  sendMedia,
});
