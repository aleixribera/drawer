import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import { deviceForToken } from '$lib/server/devices';
import type { RequestHandler } from './$types';

/**
 * Live updates as Server-Sent Events: `item` (a card, new or changed), `removed` ({ id }) and `topics`. Open pages
 * refresh from these; the companion listens for transit items meant for its device.
 *
 * A stream opened with a device token ends once that token is replaced or removed on the Settings page, so a computer
 * that was set up again doesn't keep receiving on its old connection too.
 */
export const GET: RequestHandler = ({ request, locals }) => {
  const token = locals.viaToken ? request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] : undefined;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          close();
        }
      };
      const close = () => {
        unsubscribe();
        if (ping) clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      send('hello', { at: new Date().toISOString() });
      unsubscribe = drawer().events.subscribe((event) => {
        if (event.type === 'item') send('item', toCard(event.item));
        else if (event.type === 'removed') send('removed', { id: event.id });
        else send('topics', event.type === 'topic-created' ? { created: event.name } : {});
      });
      // A comment every 25 s keeps proxies (tailscale serve included) from closing an idle stream.
      ping = setInterval(() => {
        if (token && !deviceForToken(drawer().db, token)) return close();
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          close();
        }
      }, 25_000);
      request.signal.addEventListener('abort', close);
    },
    cancel() {
      unsubscribe();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
};
