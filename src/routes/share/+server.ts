import { redirect } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { inputsFromRequest, isEmpty } from '$lib/server/intake';
import type { RequestHandler } from './$types';

/**
 * The installed app's share target (manifest share_target): Share → Drawer on Android, ChromeOS and desktop Chromium.
 * Keeps what was shared and lands on it; several files land on Recent.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const inputs = await inputsFromRequest(request, locals.device);
  if (!inputs || isEmpty(inputs)) redirect(303, '/');
  const results = inputs.map((input) => drawer().capture(input));
  redirect(303, results.length === 1 ? `/item/${results[0]!.item.id}?kept=1` : '/');
};

export const GET: RequestHandler = () => redirect(303, '/');
