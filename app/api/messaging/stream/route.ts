import { NextRequest } from 'next/server';

import { getRequestAuth } from '@/lib/auth';
import { subscribe, unsubscribe } from '@/lib/chat-bus';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Server-Sent Events feed for the messaging consoles.
 *
 * Replaces the old 4s/8s polling: background ingest publishes to the in-process
 * bus, and this streams it to whichever browser tabs that user has open. Events
 * carry only the affected chat ids — the client refetches from Postgres, so a
 * dropped or duplicated event can never corrupt what's on screen.
 */
export async function GET(request: NextRequest) {
  const auth = await getRequestAuth(request);
  if (!auth) return new Response('Unauthorized', { status: 401 });

  const userId = auth.user.id;
  let heartbeat: NodeJS.Timeout;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      subscribe(userId, controller);
      controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));

      // Comment frames keep proxies from closing an idle connection.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': ping\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        unsubscribe(userId, controller);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel(controller) {
      clearInterval(heartbeat);
      unsubscribe(userId, controller as unknown as ReadableStreamDefaultController<Uint8Array>);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stop nginx from buffering the stream into uselessness.
      'X-Accel-Buffering': 'no',
    },
  });
}
