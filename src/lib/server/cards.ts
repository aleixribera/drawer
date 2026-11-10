import type { Card } from '$lib/cards';
import { youtubeId } from './links';
import type { Item } from './types';

export function toCard(item: Item): Card {
  let picture: string | null = null;
  if (item.file && item.meta.thumb) picture = `/thumb/${item.id}?v=${item.file.sha.slice(0, 8)}`;
  else if (item.kind === 'image' && item.file) picture = `/file/${item.id}`;
  else if (item.meta.linkThumb) picture = `/thumb/${item.id}?v=${item.meta.linkThumb.slice(0, 8)}`;
  else if (item.url && !item.private && item.enrichState === 'pending') {
    // Until the picture is copied home, the site's own; after that, a picture the server couldn't fetch would fail in
    // the browser too. A private link's preview stays off: loading it would tell the site it was opened again.
    const yt = youtubeId(item.url);
    if (yt) picture = `https://i.ytimg.com/vi/${yt}/mqdefault.jpg`;
    else if (item.meta.image && /^https:\/\//.test(item.meta.image)) picture = item.meta.image;
  }
  return {
    id: item.id,
    kind: item.kind,
    lane: item.lane,
    title: item.title,
    label: item.label,
    text: item.text ? item.text.slice(0, 4000) : null,
    summary: item.summary,
    url: item.url,
    host: item.host,
    file: item.file ? { name: item.file.name, mime: item.file.mime, size: item.file.size } : null,
    picture,
    topic: item.topic,
    private: item.private,
    pinned: item.pinned,
    source: item.source,
    target: item.target,
    createdAt: item.createdAt,
    touchedAt: item.touchedAt,
    deliveredAt: item.deliveredAt,
    dueAt: item.dueAt,
    freshness: item.freshness,
    enrichState: item.enrichState,
    pages: item.meta.pages ?? null,
    siteName: item.meta.siteName ?? null,
    note: item.meta.note ?? null,
  };
}

export function queryTerms(query: string): string[] {
  return query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 || /\d/.test(t))
    .slice(0, 12);
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Where the query was found, when it isn't in the title: a short window of the summary, the text, or the words read out
 * of the file. Folding accents keeps the positions the same length as the original for Latin text.
 */
export function snippetOf(item: Item, query: string): string | null {
  const terms = queryTerms(query).map(fold);
  if (!terms.length) return null;
  const title = fold(`${item.label ?? ''} ${item.title}`);
  const sources = [item.summary, item.text, item.meta.note, item.extracted].filter((s): s is string => !!s);
  for (const source of sources) {
    const folded = fold(source);
    if (folded.length !== source.length) continue;
    const at = terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0);
    if (!at.length) continue;
    if (source === item.summary && terms.every((t) => title.includes(t))) return source.slice(0, 160);
    const first = Math.min(...at);
    const start = Math.max(0, first - 60);
    const end = Math.min(source.length, first + 120);
    const cut = source.slice(start, end).replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '…' : ''}${cut}${end < source.length ? '…' : ''}`;
  }
  return item.summary ? item.summary.slice(0, 160) : null;
}
