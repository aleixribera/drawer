import { KIND_FILTERS } from '$lib/cards';
import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, depends }) => {
  depends('drawer:topics');
  const d = drawer();
  const kind = KIND_FILTERS.find((f) => f.kind === url.searchParams.get('kind')) ?? KIND_FILTERS[0]!;
  const stats = d.stats();
  return {
    kind: kind.kind,
    cards: d.recent({ limit: 60, kinds: kind.kinds.length ? kind.kinds : undefined }).map(toCard),
    transit: d.transit().map(toCard),
    topics: d.topics(),
    pinned: d.list({ pinnedOnly: true, limit: 8 }).map(toCard),
    upcoming: d.upcoming().map(toCard),
    stats: { items: stats.items, pending: stats.pending ?? 0, reading: d.modelAvailable() },
    now: new Date().toISOString(),
  };
};
