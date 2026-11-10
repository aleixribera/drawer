import { error, json } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { addDevice, deviceLabel } from '$lib/server/devices';
import type { RequestHandler } from './$types';

const COMPUTERS = new Set(['pc', 'fedora']);

/**
 * The desktop app's one-click connect: the Settings page, open inside the app, asks for a token for this computer and
 * hands it to the app. Only Drawer's own page can ask (the access hook refuses cross-site requests), and a token from
 * the API can't be used to make another. Like a new token made by hand, it replaces this computer's old one.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (locals.viaToken) error(403, 'Connect the app from Drawer’s Settings page.');
  const body = (await request.json().catch(() => ({}))) as { device?: unknown };
  const device = typeof body.device === 'string' ? body.device : '';
  if (!COMPUTERS.has(device)) error(400, 'The desktop app is the PC or the laptop.');
  const token = addDevice(drawer().db, device, device);
  return json({ token, device, label: deviceLabel(device) });
};
