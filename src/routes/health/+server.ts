import { json } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import type { RequestHandler } from './$types';

/** For the container's health check: the database answers. Counts only, never content. */
export const GET: RequestHandler = () => {
  const d = drawer();
  const row = d.db.prepare('SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NULL').get() as { n: number };
  return json({ ok: true, items: row.n, model: d.modelAvailable() });
};
