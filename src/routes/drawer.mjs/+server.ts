import companion from '../../../companion/drawer.mjs?raw';
import type { RequestHandler } from './$types';

/** The companion itself, so a computer on the tailnet can fetch it: curl -o drawer.mjs <drawer>/drawer.mjs */
export const GET: RequestHandler = () =>
  new Response(companion, {
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' },
  });
