import { json } from '@sveltejs/kit';
import { KIND_FILTERS } from '$lib/cards';
import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import type { RequestHandler } from './$types';

/** The kept items, newest first: `?before=<iso>` pages back, `?kind=` filters, `?topic=<id>` keeps to one topic. */
export const GET: RequestHandler = ({ url }) => {
  const before = url.searchParams.get('before') ?? undefined;
  const kinds = KIND_FILTERS.find((f) => f.kind === url.searchParams.get('kind'))?.kinds;
  const limit = Math.min(200, Number(url.searchParams.get('limit')) || 60);
  const topic = Number(url.searchParams.get('topic'));
  const d = drawer();
  const items = topic
    ? d.list({ topicId: topic, kinds: kinds?.length ? kinds : undefined, until: before, limit })
    : d.recent({ before, kinds: kinds?.length ? kinds : undefined, limit });
  return json({ items: items.map(toCard) });
};
