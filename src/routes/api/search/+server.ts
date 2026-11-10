import { json } from '@sveltejs/kit';
import { KIND_FILTERS } from '$lib/cards';
import { drawer } from '$lib/server/app';
import { snippetOf, toCard } from '$lib/server/cards';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
  const q = url.searchParams.get('q') ?? '';
  const kinds = KIND_FILTERS.find((f) => f.kind === url.searchParams.get('kind'))?.kinds;
  const limit = Math.min(100, Number(url.searchParams.get('limit')) || 40);
  const hits = drawer().search(q, { kinds: kinds?.length ? kinds : undefined, limit });
  return json({ items: hits.map((h) => ({ ...toCard(h.item), snippet: snippetOf(h.item, q) })) });
};
