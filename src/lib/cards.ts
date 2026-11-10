/** What the browser gets for an item: everything a row or the item page shows, without the bulky extracted text. */

export type Kind = 'note' | 'link' | 'video' | 'image' | 'pdf' | 'audio' | 'clip' | 'file';

export interface Card {
  id: number;
  kind: Kind;
  lane: 'keep' | 'transit';
  title: string;
  label: string | null;
  text: string | null;
  summary: string | null;
  url: string | null;
  host: string | null;
  file: { name: string; mime: string; size: number } | null;
  /** A picture for the row: our own thumbnail, a YouTube still or the page's preview image. */
  picture: string | null;
  topic: { id: number; name: string } | null;
  private: boolean;
  pinned: boolean;
  source: string;
  target: string | null;
  createdAt: string;
  touchedAt: string;
  deliveredAt: string | null;
  dueAt: string | null;
  freshness: 'fresh' | 'recent' | 'faded';
  enrichState: 'pending' | 'done' | 'local' | 'failed';
  pages: number | null;
  siteName: string | null;
  note: string | null;
  /** In search results: where the words were found. */
  snippet?: string | null;
}

export const KIND_FILTERS: { kind: Kind | 'all'; label: string; kinds: Kind[] }[] = [
  { kind: 'all', label: 'All', kinds: [] },
  { kind: 'link', label: 'Links', kinds: ['link'] },
  { kind: 'video', label: 'Videos', kinds: ['video', 'clip'] },
  { kind: 'image', label: 'Images', kinds: ['image'] },
  { kind: 'pdf', label: 'Files', kinds: ['pdf', 'file'] },
  { kind: 'note', label: 'Notes', kinds: ['note', 'audio'] },
];

export const KIND_WORD: Record<Kind, string> = {
  note: 'Note',
  link: 'Link',
  video: 'Video',
  image: 'Image',
  pdf: 'PDF',
  audio: 'Voice note',
  clip: 'Video',
  file: 'File',
};

export const DEVICES = [
  { name: 'iphone', label: 'iPhone' },
  { name: 'pc', label: 'PC' },
  { name: 'fedora', label: 'Laptop' },
] as const;

export function deviceWord(name: string | null | undefined): string {
  if (!name) return '';
  if (name.startsWith('whatsapp:')) return 'WhatsApp';
  return DEVICES.find((d) => d.name === name)?.label ?? (name === 'web' ? 'Web' : name);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
