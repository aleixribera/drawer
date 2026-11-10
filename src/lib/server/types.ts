/** The shapes shared across the server: items as the app sees them, and the seams to the model and the local tools. */

export type Kind = 'note' | 'link' | 'video' | 'image' | 'pdf' | 'audio' | 'clip' | 'file';
export type Lane = 'keep' | 'transit';
export type EnrichState = 'pending' | 'done' | 'local' | 'failed';
export type Freshness = 'fresh' | 'recent' | 'faded';

export interface Item {
  id: number;
  kind: Kind;
  lane: Lane;
  text: string | null;
  url: string | null;
  host: string | null;
  file: { sha: string; name: string; mime: string; size: number } | null;
  label: string | null;
  title: string;
  summary: string | null;
  keywords: string[];
  extracted: string | null;
  meta: ItemMeta;
  topic: { id: number; name: string } | null;
  topicHint: string | null;
  private: boolean;
  sensitiveReasons: string[];
  pinned: boolean;
  source: string;
  target: string | null;
  createdAt: string;
  touchedAt: string;
  openedAt: string | null;
  deliveredAt: string | null;
  dueAt: string | null;
  enrichState: EnrichState;
  freshness: Freshness;
}

export interface ItemMeta {
  siteName?: string;
  description?: string;
  image?: string;
  pages?: number;
  duration?: number;
  width?: number;
  height?: number;
  /** The owner's own words around a share (Shortcut text, a share-sheet preamble). */
  note?: string;
  forwarded?: boolean;
  /** When there's a thumbnail on disk. */
  thumb?: boolean;
  /** A link's preview picture, copied into thumbs/ under this name (the sha256 of its URL) so it never rots. */
  linkThumb?: string;
  /** Original chat, for imported items. */
  chat?: string;
}

/** What a device or the importer hands to `capture`. */
export interface CaptureInput {
  text?: string | null;
  url?: string | null;
  file?: { name: string; mime?: string | null; bytes: Uint8Array } | null;
  /** The device it came from: "iphone", "pc", "fedora", "web", or "whatsapp:You" for the import. */
  source: string;
  lane?: Lane;
  /** For transit: the device it's for. */
  target?: string | null;
  /** The owner marked it private at capture. */
  private?: boolean;
  /** When it was sent, for imports; defaults to now. */
  at?: Date;
  forwarded?: boolean;
}

export interface CaptureResult {
  item: Item;
  /** What happened: a new item, an existing one bumped, or the text became the label of another item. */
  outcome: 'created' | 'bumped' | 'labelled';
}

// ---------------------------------------------------------------- the model seam

export interface EnrichRequest {
  kind: Kind;
  text?: string | null;
  url?: string | null;
  label?: string | null;
  fileName?: string | null;
  extracted?: string | null;
  unfurl?: { title?: string; description?: string; siteName?: string } | null;
  image?: { mime: string; base64: string } | null;
  topics: string[];
  hints: string[];
  now: Date;
}

export interface EnrichResult {
  title: string;
  summary: string;
  keywords: string[];
  topic: string | null;
  newTopic: string | null;
  dueAt: string | null;
}

export interface TopicPlanRequest {
  hints: { hint: string; count: number; examples: string[] }[];
  topics: string[];
}

export interface TopicPlan {
  topics: { name: string; hints: string[] }[];
}

export interface Model {
  readonly name: string;
  enrich(request: EnrichRequest): Promise<EnrichResult>;
  planTopics(request: TopicPlanRequest): Promise<TopicPlan>;
}

// ---------------------------------------------------------------- the local tools seam

export interface Unfurl {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  finalUrl?: string;
}

export interface Extractors {
  pdf(path: string): Promise<{ text: string; pages?: number }>;
  ocr(path: string): Promise<string>;
  transcribe(path: string): Promise<string>;
  unfurl(url: string): Promise<Unfurl | null>;
  thumbnail(path: string, mime: string, out: string): Promise<boolean>;
  /** Download a link's preview picture (public hosts only, images only, 10 MB at most) and thumbnail it to `out`. */
  picture(url: string, out: string): Promise<boolean>;
  /** A JPEG no longer than 1568 px on its long side, for sending an image to the model. */
  shrink(path: string): Promise<Uint8Array | null>;
}
