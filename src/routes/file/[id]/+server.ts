import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { drawer } from '$lib/server/app';
import type { RequestHandler } from './$types';

/** The item's file, with byte ranges so videos, voice notes and PDFs seek. `?download` saves it instead of showing it. */
export const GET: RequestHandler = ({ params, request, url }) => {
  const item = drawer().get(Number(params.id));
  const file = item ? drawer().fileOf(item) : null;
  if (!item || !file || !existsSync(file.path)) error(404, 'No such file.');
  const size = statSync(file.path).size;
  const disposition = `${url.searchParams.has('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`;
  const headers: Record<string, string> = {
    'content-type': file.mime,
    'content-disposition': disposition,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
  // Files are the owner's own, but an HTML or SVG file must never run as a page on this origin.
  if (!/^(image\/(jpeg|png|gif|webp|heic)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+|text\/plain)$/.test(file.mime)) {
    headers['content-disposition'] = disposition.replace(/^inline/, 'attachment');
    headers['content-security-policy'] = "default-src 'none'; sandbox";
  }
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) error(416, 'Range not satisfiable.');
    return new Response(Readable.toWeb(createReadStream(file.path, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream, {
    headers: { ...headers, 'content-length': String(size) },
  });
};
