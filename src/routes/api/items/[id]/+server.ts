import { error, json } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import type { RequestHandler } from './$types';

function item(id: string) {
  const found = drawer().get(Number(id), { includeDeleted: true });
  if (!found) error(404, 'No such item.');
  return found;
}

export const GET: RequestHandler = ({ params }) => json({ item: toCard(item(params.id)) });

/**
 * Change an item: { pinned, private, label, topic (a name, an id, or null), keep: true, opened: true,
 * delivered: true, restore: true }.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = item(params.id).id;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const d = drawer();
  if (typeof body.pinned === 'boolean') d.pin(id, body.pinned);
  if (typeof body.private === 'boolean' || body.private === null) d.setPrivate(id, body.private as boolean | null);
  if (typeof body.label === 'string' || body.label === null) d.setLabel(id, body.label as string | null);
  if (typeof body.topic === 'string' || typeof body.topic === 'number' || body.topic === null) d.setTopic(id, body.topic as string | number | null);
  if (body.restore === true) d.restore(id);
  if (body.keep === true) d.keep(id);
  if (body.opened === true) d.open(id);
  if (body.delivered === true) d.delivered(id);
  const after = d.get(id, { includeDeleted: true });
  return json({ item: after ? toCard(after) : null });
};

export const DELETE: RequestHandler = ({ params }) => {
  const removed = drawer().remove(item(params.id).id);
  return json({ item: removed ? toCard(removed) : null });
};

/** Send this item to a device: { target: "pc" }. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
  const body = (await request.json().catch(() => ({}))) as { target?: string };
  if (!body.target) error(400, 'Say which device to send it to.');
  const sent = drawer().sendItem(item(params.id).id, body.target, locals.device);
  return json({ item: sent ? toCard(sent) : null }, { status: 201 });
};
