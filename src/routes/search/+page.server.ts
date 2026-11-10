import { KIND_FILTERS } from '$lib/cards';
import { drawer } from '$lib/server/app';
import { queryTerms, snippetOf, toCard } from '$lib/server/cards';
import type { PageServerLoad } from './$types';

/** One search over everything; the tabs count what each kind holds, and the chosen tab shows its share. */
export const load: PageServerLoad = ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  const kind = KIND_FILTERS.find((f) => f.kind === url.searchParams.get('kind')) ?? KIND_FILTERS[0]!;
  if (!q) return { q, kind: kind.kind, terms: [], counts: {}, cards: [], total: 0 };
  const hits = drawer().search(q, { limit: 200 });
  const counts: Record<string, number> = { all: hits.length };
  for (const f of KIND_FILTERS) if (f.kinds.length) counts[f.kind] = hits.filter((h) => f.kinds.includes(h.item.kind)).length;
  const shown = kind.kinds.length ? hits.filter((h) => kind.kinds.includes(h.item.kind)) : hits;
  return {
    q,
    kind: kind.kind,
    terms: queryTerms(q),
    counts,
    total: hits.length,
    cards: shown.slice(0, 80).map((h) => ({ ...toCard(h.item), snippet: snippetOf(h.item, q) })),
  };
};
