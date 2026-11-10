import { error } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import { youtubeId } from '$lib/server/links';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
  const d = drawer();
  const id = Number(params.id);
  const found = d.get(id, { includeDeleted: true });
  if (!found) error(404, 'This item is not in the drawer, or it was deleted for good.');
  const deleted = !d.get(id);
  const item = deleted ? found : (d.open(id) ?? found);
  const related = item.topic
    ? d.list({ topicId: item.topic.id, limit: 7 }).filter((i) => i.id !== item.id).slice(0, 6)
    : [];
  return {
    card: toCard(item),
    deleted,
    keywords: item.keywords,
    extracted: item.extracted ? item.extracted.slice(0, 30_000) : null,
    extractedLength: item.extracted?.length ?? 0,
    description: item.meta.description ?? null,
    sensitiveReasons: item.sensitiveReasons,
    privateByOwner: item.private && item.sensitiveReasons.length === 0,
    youtube: item.url ? youtubeId(item.url) : null,
    duration: item.meta.duration ?? null,
    chat: item.meta.chat ?? null,
    topicNames: d.topicNames(),
    related: related.map(toCard),
  };
};
