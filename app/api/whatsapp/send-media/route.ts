import { createSendMediaPOST } from '@/lib/messaging-media-route';
import { getMedia, sendMedia } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export const POST = createSendMediaPOST({
  provider: 'whatsapp',
  scopeOf: (ctx) => ctx.account?.handle ?? null,
  getMedia,
  sendMedia,
});
