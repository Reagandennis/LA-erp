import { mediaKindFromMime } from '@/lib/messaging-ingest';
import { writeCache } from '@/lib/messaging-media-cache';
import { createSendMediaPOST } from '@/lib/messaging-media-route';
import { recordOutgoing } from '@/lib/messaging-repo';
import { getMedia, sendMedia } from '@/lib/wacli';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export const POST = createSendMediaPOST({
  provider: 'whatsapp',
  scopeOf: (ctx) => ctx.account?.handle ?? null,
  getMedia,
  sendMedia,
  // wacli doesn't echo our own sends to the webhook; mirror the attachment
  // now, keyed on the message id so the media route can fetch it back.
  onSent: async (ctx, chatId, result, file, caption) => {
    if (!ctx.account || !result.messageId) return;
    // We already hold the bytes, so the bubble renders at once instead of
    // round-tripping a download of the file we just uploaded.
    await writeCache(ctx.account.id, chatId, result.messageId, {
      bytes: file.bytes,
      mimeType: file.mimeType,
      fileName: file.fileName,
    });
    await recordOutgoing(ctx.account.id, ctx.userId, {
      chatId,
      messageId: result.messageId,
      text: caption,
      media: {
        kind: mediaKindFromMime(file.mimeType),
        ref: result.messageId,
        mimeType: file.mimeType,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
      },
    });
  },
});
