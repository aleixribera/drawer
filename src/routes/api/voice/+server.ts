import { error, json } from '@sveltejs/kit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '$lib/server/app';
import type { RequestHandler } from './$types';

/** Speech to text on the server (whisper.cpp): the recording from the Ask page's microphone, as the request body. */
export const POST: RequestHandler = async ({ request }) => {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) error(400, 'No recording.');
  if (bytes.length > 25 * 1024 * 1024) error(413, 'That recording is too long.');
  const dir = mkdtempSync(join(tmpdir(), 'drawer-voice-'));
  try {
    const type = request.headers.get('content-type') ?? '';
    const ext = type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const path = join(dir, `voice.${ext}`);
    writeFileSync(path, bytes);
    const transcript = (await app().extractors.transcribe(path)).trim();
    if (!transcript) error(503, 'Speech recognition is not available on the server.');
    return json({ text: transcript });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
