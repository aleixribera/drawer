import { error, type Handle } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { deviceForToken } from '$lib/server/devices';

/**
 * Access: Drawer is reachable only on the tailnet. The web app trusts that; the API also takes per-device bearer tokens
 * for Shortcuts and the companion. SvelteKit's own origin check is off (csrf trustedOrigins), so state-changing
 * requests are checked here: a bearer token, or a same-origin browser request.
 */

const DEVICES = new Set(['iphone', 'pc', 'fedora']);

function guessDevice(userAgent: string): string {
  // The phone slot is called iPhone; an Android phone takes it too.
  if (/iPhone|iPad|Android/i.test(userAgent)) return 'iphone';
  if (/Windows/i.test(userAgent)) return 'pc';
  if (/Linux|X11/i.test(userAgent)) return 'fedora';
  return 'pc';
}

function sameOrigin(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === (request.headers.get('host') ?? url.host);
  } catch {
    return false;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const { request, url, cookies } = event;
  const auth = request.headers.get('authorization');
  const token = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (token) {
    const device = deviceForToken(drawer().db, token);
    if (!device) error(401, 'Unknown device token.');
    event.locals.device = device.name;
    event.locals.viaToken = true;
  } else {
    const chosen = cookies.get('drawer_device');
    event.locals.device = chosen && DEVICES.has(chosen) ? chosen : guessDevice(request.headers.get('user-agent') ?? '');
    event.locals.viaToken = false;
    const changes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (changes && !sameOrigin(request, url)) error(403, 'Cross-site requests are refused.');
  }

  return resolve(event);
};
