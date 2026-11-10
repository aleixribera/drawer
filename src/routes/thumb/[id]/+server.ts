import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { drawer } from '$lib/server/app';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
  const item = drawer().get(Number(params.id));
  const path = item ? drawer().thumbOf(item) : null;
  if (!path) error(404, 'No thumbnail.');
  return new Response(readFileSync(path), {
    headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' },
  });
};
