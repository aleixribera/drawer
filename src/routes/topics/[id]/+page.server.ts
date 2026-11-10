import { error, fail, redirect } from '@sveltejs/kit';
import { KIND_FILTERS } from '$lib/cards';
import { drawer } from '$lib/server/app';
import { toCard } from '$lib/server/cards';
import type { Actions, PageServerLoad } from './$types';

/** One topic (or `loose`: everything not in a topic yet), pins first, then newest. */
export const load: PageServerLoad = ({ params, url, depends }) => {
  depends('drawer:topics');
  const d = drawer();
  const kind = KIND_FILTERS.find((f) => f.kind === url.searchParams.get('kind')) ?? KIND_FILTERS[0]!;
  const kinds = kind.kinds.length ? kind.kinds : undefined;
  const topics = d.topics();
  if (params.id === 'loose') {
    const items = d.list({ loose: true, kinds, limit: 300 });
    return { topic: null, kind: kind.kind, pinned: [], cards: items.map(toCard), others: topics, now: new Date().toISOString() };
  }
  const topic = topics.find((t) => t.id === Number(params.id));
  if (!topic) error(404, 'No such topic. It may have been merged into another one.');
  const items = d.list({ topicId: topic.id, kinds, limit: 300 });
  return {
    topic,
    kind: kind.kind,
    pinned: items.filter((i) => i.pinned).map(toCard),
    cards: items.filter((i) => !i.pinned).map(toCard),
    others: topics.filter((t) => t.id !== topic.id),
    now: new Date().toISOString(),
  };
};

export const actions: Actions = {
  rename: async ({ params, request }) => {
    const name = String((await request.formData()).get('name') ?? '').trim();
    if (!name) return fail(400, { error: 'A topic needs a name.' });
    const d = drawer();
    d.renameTopic(Number(params.id), name);
    // Renaming onto an existing name merges the two; follow it there.
    const after = d.topics().find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (after && after.id !== Number(params.id)) redirect(303, `/topics/${after.id}`);
    return { done: 'Renamed.' };
  },
  merge: async ({ params, request }) => {
    const into = Number((await request.formData()).get('into'));
    if (!into) return fail(400, { error: 'Pick the topic to merge into.' });
    drawer().mergeTopics(Number(params.id), into);
    redirect(303, `/topics/${into}`);
  },
  remove: async ({ params }) => {
    drawer().deleteTopic(Number(params.id));
    redirect(303, '/topics');
  },
};
