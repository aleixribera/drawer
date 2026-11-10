import { json } from '@sveltejs/kit';
import { deviceLabel } from '$lib/server/devices';
import type { RequestHandler } from './$types';

/** Which device is asking: the companion's `drawer login` checks its token with this. */
export const GET: RequestHandler = ({ locals }) =>
  json({ device: locals.device, label: deviceLabel(locals.device), viaToken: locals.viaToken });
