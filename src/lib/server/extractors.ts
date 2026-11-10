import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { youtubeId } from './links';
import type { Extractors, Unfurl } from './types';

/**
 * The local tools: pdftotext and pdftoppm (poppler), tesseract, ffmpeg and a whisper.cpp server. All run on the home
 * server, so nothing here sends the owner's files anywhere. Link unfurling is the only network call, and it refuses
 * private addresses.
 */

const run = promisify(execFile);

async function tool(command: string, args: string[], timeoutMs = 120_000): Promise<string> {
  const { stdout } = await run(command, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
  return stdout;
}

async function has(command: string): Promise<boolean> {
  try {
    await run(command, ['-v'], { timeout: 5000 });
    return true;
  } catch (error) {
    // Some tools print their version and exit non-zero; only a missing binary is ENOENT.
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

export interface ExtractorOptions {
  /** whisper.cpp server, e.g. http://whisper:8080; transcription is skipped without it. */
  whisperUrl?: string | null;
  ocrLanguages?: string;
  log?: (message: string) => void;
}

export function createExtractors(options: ExtractorOptions = {}): Extractors {
  const log = options.log ?? (() => {});
  const languages = options.ocrLanguages ?? 'eng+spa+cat';
  const available = new Map<string, Promise<boolean>>();
  const check = (command: string) => {
    if (!available.has(command)) available.set(command, has(command));
    return available.get(command)!;
  };

  async function ocr(path: string): Promise<string> {
    if (!(await check('tesseract'))) return '';
    try {
      return cleanOcr(await tool('tesseract', [path, 'stdout', '-l', languages, '--psm', '3'], 90_000));
    } catch (error) {
      log(`ocr: ${(error as Error).message}`);
      return '';
    }
  }

  const extractors: Extractors = {
    async pdf(path) {
      let text = '';
      let pages: number | undefined;
      try {
        const info = await tool('pdfinfo', [path], 20_000);
        const match = /^Pages:\s+(\d+)/m.exec(info);
        if (match) pages = Number(match[1]);
      } catch {
        /* pdfinfo is optional */
      }
      try {
        text = await tool('pdftotext', ['-layout', '-l', '40', path, '-'], 60_000);
      } catch (error) {
        log(`pdftotext: ${(error as Error).message}`);
      }
      // A scanned PDF has no text layer: read the first pages with OCR.
      if (text.replace(/\s+/g, '').length < 40 && (await check('pdftoppm'))) {
        const dir = mkdtempSync(join(tmpdir(), 'drawer-pdf-'));
        try {
          await tool('pdftoppm', ['-r', '200', '-l', '4', '-png', path, join(dir, 'page')], 90_000);
          const parts: string[] = [];
          for (const file of readdirSync(dir).sort()) parts.push(await ocr(join(dir, file)));
          text = parts.join('\n\n');
        } catch (error) {
          log(`pdf ocr: ${(error as Error).message}`);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
      return { text: text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), pages };
    },

    ocr,

    async transcribe(path) {
      if (!options.whisperUrl || !(await check('ffmpeg'))) return '';
      const dir = mkdtempSync(join(tmpdir(), 'drawer-audio-'));
      try {
        const wav = join(dir, 'audio.wav');
        await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-t', '900', '-ar', '16000', '-ac', '1', wav], 120_000);
        const form = new FormData();
        form.append('file', new Blob([readFileSync(wav)], { type: 'audio/wav' }), 'audio.wav');
        form.append('response_format', 'json');
        form.append('language', 'auto');
        const response = await fetch(`${options.whisperUrl.replace(/\/$/, '')}/inference`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(300_000),
        });
        if (!response.ok) throw new Error(`whisper answered ${response.status}`);
        const body = (await response.json()) as { text?: string };
        return (body.text ?? '').replace(/\s+/g, ' ').trim();
      } catch (error) {
        log(`transcribe: ${(error as Error).message}`);
        return '';
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },

    unfurl: (url) => unfurl(url, log),

    async picture(url, out) {
      if (existsSync(out)) return true;
      const dir = mkdtempSync(join(tmpdir(), 'drawer-picture-'));
      try {
        const image = await fetchImage(url);
        if (!image) return false;
        const file = join(dir, 'picture');
        writeFileSync(file, image.bytes);
        return await extractors.thumbnail(file, image.mime, out);
      } catch (error) {
        log(`picture: ${(error as Error).message}`);
        return false;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },

    async thumbnail(path, mime, out) {
      if (existsSync(out)) return true;
      try {
        if (mime === 'application/pdf') {
          if (!(await check('pdftoppm'))) return false;
          const dir = mkdtempSync(join(tmpdir(), 'drawer-thumb-'));
          try {
            await tool('pdftoppm', ['-r', '60', '-f', '1', '-l', '1', '-png', '-singlefile', path, join(dir, 'p')], 30_000);
            await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', join(dir, 'p.png'), '-vf', 'scale=480:-2', '-q:v', '70', out]);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        } else if (mime.startsWith('video/')) {
          await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', path, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '70', out]);
        } else if (mime.startsWith('image/')) {
          await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '72', out]);
        } else {
          return false;
        }
        return existsSync(out);
      } catch (error) {
        log(`thumbnail: ${(error as Error).message}`);
        return false;
      }
    },

    async shrink(path) {
      const dir = mkdtempSync(join(tmpdir(), 'drawer-shrink-'));
      try {
        const out = join(dir, 'small.jpg');
        await tool('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-frames:v', '1', '-vf', "scale='min(1568,iw)':'min(1568,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', out]);
        return new Uint8Array(readFileSync(out));
      } catch (error) {
        log(`shrink: ${(error as Error).message}`);
        return null;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
  return extractors;
}

/** An image from a public host, following redirects by hand so each hop is checked; null for anything else. */
async function fetchImage(raw: string, hops = 4): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let current = raw;
  for (let i = 0; i <= hops; i++) {
    const url = new URL(current);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!(await safeHost(url))) return null;
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/*;q=0.8' },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) return null;
      current = new URL(next, url).toString();
      continue;
    }
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!response.ok || !mime.startsWith('image/') || mime === 'image/svg+xml') return null;
    if (Number(response.headers.get('content-length') ?? 0) > PICTURE_LIMIT) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PICTURE_LIMIT) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { bytes, mime };
  }
  return null;
}

const PICTURE_LIMIT = 10 * 1024 * 1024;

function cleanOcr(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.replace(/[^\p{L}\p{N}]/gu, '').length >= 2)
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------- link unfurling

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return PRIVATE_V4.some((re) => re.test(address));
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function safeHost(url: URL): Promise<boolean> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/(^localhost$|\.local$|\.internal$|\.ts\.net$|\.lan$)/i.test(host)) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

const UA = 'Mozilla/5.0 (compatible; Drawer/1.0; personal link preview)';

async function fetchPage(raw: string, hops = 4): Promise<{ url: string; html: string } | null> {
  let current = raw;
  for (let i = 0; i <= hops; i++) {
    const url = new URL(current);
    if (!(await safeHost(url))) return null;
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en,es;q=0.8,ca;q=0.6' },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) return null;
      current = new URL(next, url).toString();
      continue;
    }
    if (!response.ok || !/html/i.test(response.headers.get('content-type') ?? '')) return { url: current, html: '' };
    // Only the head matters; stop reading after 512 KB.
    const reader = response.body?.getReader();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      while (html.length < 512_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      void reader.cancel().catch(() => {});
    }
    return { url: current, html };
  }
  return null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim();

export function parseHead(html: string): Unfurl {
  const metas = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const value = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && value && !metas.has(key)) metas.set(key, decodeEntities(value));
  }
  const title = metas.get('og:title') ?? metas.get('twitter:title') ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)![1]!) : undefined);
  return {
    title: title || undefined,
    description: metas.get('og:description') ?? metas.get('description') ?? metas.get('twitter:description'),
    siteName: metas.get('og:site_name'),
    image: metas.get('og:image') ?? metas.get('twitter:image'),
  };
}

async function unfurl(raw: string, log: (m: string) => void): Promise<Unfurl | null> {
  try {
    const yt = youtubeId(raw);
    if (yt) {
      const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const body = (await response.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        return {
          title: body.title,
          description: body.author_name ? `YouTube video by ${body.author_name}` : undefined,
          siteName: 'YouTube',
          image: body.thumbnail_url,
        };
      }
    }
    const page = await fetchPage(raw);
    if (!page) return null;
    const head = parseHead(page.html);
    // Instagram and similar walls answer with a login page; its title says nothing about the reel.
    if (head.title && /^(instagram|login|log in|sign in|tiktok - make your day)$/i.test(head.title.trim())) head.title = undefined;
    return { ...head, finalUrl: page.url };
  } catch (error) {
    log(`unfurl: ${(error as Error).message}`);
    return null;
  }
}
