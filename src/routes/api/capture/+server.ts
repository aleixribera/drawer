import { error, json } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import { inputsFromRequest, isEmpty } from '$lib/server/intake';
import type { RequestHandler } from './$types';

/** Put something in the drawer: a form, JSON or plain text (see inputsFromRequest). */
export const POST: RequestHandler = async ({ request, locals }) => {
  const inputs = await inputsFromRequest(request, locals.device);
  if (!inputs) error(400, 'Send JSON or a form.');
  if (isEmpty(inputs)) error(400, 'Nothing to capture: send text, a link or a file.');
  const results = inputs.map((input) => drawer().capture(input));
  return json({ results: results.map((r) => ({ outcome: r.outcome, item: toCard(r.item) })) }, { status: 201 });
};
