/** Links: finding them in text, the tracking junk to drop, and the key that makes two shares of one page the same item. */

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+/gi;

export function findUrls(text: string): string[] {
  return (text.match(URL_IN_TEXT) ?? []).map((u) => u.replace(/[),.;:!?]+$/, ''));
}

/** A text that is just one link, maybe with a share-sheet preamble ("Check out this Linktree! - https://…"). */
export function soleUrl(text: string): { url: string; rest: string } | null {
  const urls = findUrls(text);
  if (urls.length !== 1) {
    // Amazon's share text has two links: the product and "Product questions? Ask here". The first is the product.
    if (urls.length === 2 && /Shop on Amazon/i.test(text)) return { url: urls[0]!, rest: '' };
    return null;
  }
  const url = urls[0]!;
  const rest = text.replace(url, '').replace(/\s+-\s*$/, '').trim();
  if (rest.length > 140) return null;
  return { url, rest };
}

const TRACKING = new Set([
  'fbclid', 'gclid', 'igsh', 'igshid', 'si', 'stkn', 'rpxt', 'xtok', 'psln', 'dlrf', 'mdxt', 'cplk', 'srtk', 'exln',
  'g_st', 'ref', 'ref_', 'crid', 'dib', 'dib_tag', 'qid', 'sprefix', 'sr', 'psc', 'coliid', 'colid',
  'usp', 'mibextid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
]);

/** The canonical form of a link, used to notice that the same thing was shared twice. */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw.trim();
  }
  url.hash = /^#(?:content|detail)/i.test(url.hash) ? '' : url.hash;
  url.hostname = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  }
  // youtu.be/ID and youtube.com/shorts/ID are the same video as youtube.com/watch?v=ID.
  const yt = youtubeId(raw);
  if (yt) return `https://youtube.com/watch?v=${yt}`;
  const ig = /instagram\.com\/(?:[\w.]+\/)?(reel|p|tv)\/([\w-]+)/i.exec(raw);
  if (ig) return `https://instagram.com/${ig[1]!.toLowerCase()}/${ig[2]}`;
  const amazon = /amazon\.[a-z.]+\/(?:.*\/)?dp\/([A-Z0-9]{10})/i.exec(raw);
  if (amazon) return `https://amazon/dp/${amazon[1]}`;
  let out = url.toString();
  if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
  return out;
}

export function youtubeId(raw: string): string | null {
  const m =
    /youtu\.be\/([\w-]{11})/i.exec(raw) ??
    /youtube\.com\/(?:shorts|live|embed)\/([\w-]{11})/i.exec(raw) ??
    /youtube\.com\/watch\?(?:.*&)?v=([\w-]{11})/i.exec(raw);
  return m ? m[1]! : null;
}

export type LinkKind = 'video' | 'link';

export function linkKind(raw: string): LinkKind {
  if (youtubeId(raw)) return 'video';
  if (/instagram\.com\/(?:[\w.]+\/)?(?:reel|tv)\//i.test(raw)) return 'video';
  if (/tiktok\.com\//i.test(raw)) return 'video';
  return 'link';
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^(?:www|m)\./, '');
  } catch {
    return '';
  }
}
