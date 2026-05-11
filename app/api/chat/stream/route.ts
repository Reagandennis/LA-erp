import { NextRequest } from 'next/server';
import { getRequestAuth } from '@/lib/auth';
import { subscribe, unsubscribe } from '@/lib/chat-bus';


const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * GET /api/chat/stream
 *
 * Server-Sent Events endpoint. Opens a persistent connection per authenticated
 * user and streams chat events as they are published to the in-memory bus.
 *
 * Events pushed:
 *  - `message`         { conversationId, message }
 *  - `message_updated` { conversationId, message }
 *  - `message_deleted` { conversationId, messageId }
 *
 * ⚠️  Single-process only — see lib/chat-bus.ts for scaling notes.
 */
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req);
  if (!auth) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = auth.user.id;
  const encoder = new TextEncoder();

  let heartbeat: ReturnType<typeof setInterval>;
  let ctrl: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      subscribe(userId, ctrl);

      // Send initial ping so the client knows the connection is open
      ctrl.enqueue(encoder.encode(': ping\n\n'));

      heartbeat = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe(userId, ctrl);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
