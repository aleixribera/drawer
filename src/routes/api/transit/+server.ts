import { json } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import type { RequestHandler } from './$types';

/** What is on its way to a device in the last 24 h (`?for=pc`, or the calling device). `?pending` leaves out delivered ones. */
export const GET: RequestHandler = ({ url, locals }) => {
  const target = url.searchParams.get('for') ?? locals.device;
  let items = drawer().transit(target);
  if (url.searchParams.has('pending')) items = items.filter((i) => !i.deliveredAt);
  return json({ items: items.map(toCard) });
};
