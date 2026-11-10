import { error, json } from '@sveltejs/kit';
import { app } from '$lib/server/app';
import type { PushSubscriptionJson } from '$lib/server/push';
import type { RequestHandler } from './$types';

/**
 * Notifications on this device. GET says whether push is set up and gives the key a browser subscribes with (and
 * whether the browser asking already is, given ?endpoint=); POST stores this browser's subscription for the device
 * asking; DELETE removes it.
 */
export const GET: RequestHandler = ({ url, locals }) => {
  const { push } = app();
  const endpoint = url.searchParams.get('endpoint');
  const mine = push.subscriptions(locals.device);
  return json({
    enabled: push.enabled,
    publicKey: push.publicKey,
    subscribed: endpoint ? mine.some((s) => s.endpoint === endpoint) : mine.length > 0,
  });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const { push } = app();
  if (!push.enabled) error(503, 'Push is not set up on the server.');
  const subscription = (await request.json().catch(() => null)) as PushSubscriptionJson | null;
  try {
    push.subscribe(locals.device, subscription as PushSubscriptionJson);
  } catch (e) {
    error(400, (e as Error).message);
  }
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) error(400, 'Which subscription?');
  app().push.unsubscribe(body.endpoint, locals.device);
  return json({ ok: true });
};
