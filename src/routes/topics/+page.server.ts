import { fail, redirect } from '@sveltejs/kit';
import { drawer } from '$lib/server/app';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ depends }) => {
  depends('drawer:topics');
  const d = drawer();
  const topics = d.topics().map((t) => {
    const latest = d.list({ topicId: t.id, limit: 3 });
    return { ...t, latest: latest.filter((i) => !i.private).map((i) => i.label ?? i.title) };
  });
  const loose = d.list({ loose: true, limit: 1000 }).length;
  return { topics, loose, now: new Date().toISOString() };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const name = String((await request.formData()).get('name') ?? '').trim();
    if (!name) return fail(400, { error: 'Give the topic a name.' });
    const id = drawer().createTopic(name);
    redirect(303, `/topics/${id}`);
  },
};
