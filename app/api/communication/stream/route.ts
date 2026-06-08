import { NextRequest } from 'next/server';

import { requireRequestAuth } from '@/lib/request-auth';
import { subscribe, unsubscribe } from '@/lib/chat-bus';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Server-Sent Events stream: pushes live `message` events to the current user.
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const userId = auth.user.id;
  const encoder = new TextEncoder();

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let onAbort: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscribe(userId, controller);
      // Initial comment so the connection opens immediately.
      controller.enqueue(encoder.encode(': connected\n\n'));

      // Keep-alive comment every 25s to defeat idle proxies.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          // controller already closed; cleanup happens on abort
        }
      }, 25000);

      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe(userId, controller);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      onAbort = cleanup;
      request.signal.addEventListener('abort', cleanup);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (onAbort) request.signal.removeEventListener('abort', onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
