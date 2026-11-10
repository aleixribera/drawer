import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { transaction } from './db';
import { createEvents, type Events } from './events';
import { fileKind, mimeOf, sha256, type FileStore } from './files';
import { findUrls, hostOf, linkKind, normalizeUrl, soleUrl } from './links';
import { checkSensitivity } from './sensitivity';
import { DAY, daysBetween, type Clock } from './time';
import type {
  CaptureInput,
  CaptureResult,
  EnrichState,
  Extractors,
  Freshness,
  Item,
  ItemMeta,
  Kind,
  Lane,
  Model,
} from './types';

/**
 * The Drawer core: the one interface the routes, the importer, the librarian and the tests talk to. It stores what
 * devices capture, pairs labels, notices duplicates, runs the enrichment pipeline (local tools, the privacy gate, then
 * the model), keeps topics, ranks by freshness and searches.
 */

export const FRESH_DAYS = 30;
export const FADE_DAYS = 180;
export const DORMANT_DAYS = 90;
export const TRANSIT_VISIBLE_MS = DAY;
export const TRANSIT_DELETE_MS = 7 * DAY;
export const TRASH_PURGE_MS = 30 * DAY;
/** A short text this soon after an item from the same device is that item's label. */
export const LABEL_AFTER_MS = 2 * 60_000;
/** A short text this soon before a link or file from the same device is its label too. */
export const LABEL_BEFORE_MS = 30_000;
export const LABEL_MAX_CHARS = 100;
export const TOPIC_MIN_ITEMS = 3;
export const PRIVATE_TOPIC = 'Private';

export interface DrawerOptions {
  db: DatabaseSync;
  files: FileStore;
  clock: Clock;
  extractors: Extractors;
  /** The model, or null to run local-only. */
  model: Model | null;
  /** Monthly model spend limit in USD; over it, enrichment runs local-only. */
  spendCapUsd?: number;
  events?: Events;
  log?: (message: string) => void;
}

interface ItemRow {
  id: number;
  kind: Kind;
  lane: Lane;
  text: string | null;
  url: string | null;
  dedupe_key: string | null;
  file_sha: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  label: string | null;
  title: string | null;
  summary: string | null;
  keywords: string | null;
  extracted: string | null;
  meta: string | null;
  topic_id: number | null;
  topic_name: string | null;
  topic_hint: string | null;
  sensitive: number;
  sensitive_reasons: string | null;
  private_override: number | null;
  pinned: number;
  source: string;
  target: string | null;
  created_at: string;
  touched_at: string;
  opened_at: string | null;
  delivered_at: string | null;
  due_at: string | null;
  enrich_state: EnrichState;
  enrich_error: string | null;
  deleted_at: string | null;
}

export interface TopicSummary {
  id: number;
  name: string;
  count: number;
  lastActivity: string | null;
  dormant: boolean;
  origin: string;
}

export interface ListFilters {
  kinds?: Kind[];
  topicId?: number | null;
  /** Items with no topic yet. */
  loose?: boolean;
  lane?: Lane;
  since?: string;
  until?: string;
  includeFaded?: boolean;
  pinnedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  item: Item;
  score: number;
}

const ITEM_SELECT = `SELECT items.*, topics.name AS topic_name FROM items LEFT JOIN topics ON topics.id = items.topic_id`;

const isShortText = (text: string) =>
  text.length <= LABEL_MAX_CHARS && !text.includes('\n') && findUrls(text).length === 0;

const iso = (date: Date) => date.toISOString();

export type Drawer = ReturnType<typeof createDrawer>;

export function createDrawer(options: DrawerOptions) {
  const { db, files, clock, extractors } = options;
  const events = options.events ?? createEvents();
  const log = options.log ?? (() => {});
  const spendCap = options.spendCapUsd ?? 10;

  const q = <T>(sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params) as T[];
  const one = <T>(sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) as T | undefined;
  const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);

  // ---------------------------------------------------------------- reading

  function freshnessOf(row: Pick<ItemRow, 'touched_at' | 'pinned'>, now = clock.now()): Freshness {
    const age = daysBetween(row.touched_at, now);
    if (age <= FRESH_DAYS) return 'fresh';
    if (age > FADE_DAYS && !row.pinned) return 'faded';
    return 'recent';
  }

  function toItem(row: ItemRow, now = clock.now()): Item {
    const meta = row.meta ? (JSON.parse(row.meta) as ItemMeta) : {};
    const privateItem = row.private_override === null ? row.sensitive === 1 : row.private_override === 1;
    return {
      id: row.id,
      kind: row.kind,
      lane: row.lane,
      text: row.text,
      url: row.url,
      host: row.url ? hostOf(row.url) : null,
      file: row.file_sha
        ? { sha: row.file_sha, name: row.file_name ?? 'file', mime: row.file_mime ?? 'application/octet-stream', size: row.file_size ?? 0 }
        : null,
      label: row.label,
      title: row.title ?? localTitle(row, meta),
      summary: row.summary,
      keywords: row.keywords ? row.keywords.split(',').filter(Boolean) : [],
      extracted: row.extracted,
      meta,
      topic: row.topic_id !== null && row.topic_name ? { id: row.topic_id, name: row.topic_name } : null,
      topicHint: row.topic_hint,
      private: privateItem,
      sensitiveReasons: row.sensitive_reasons ? row.sensitive_reasons.split(',') : [],
      pinned: row.pinned === 1,
      source: row.source,
      target: row.target,
      createdAt: row.created_at,
      touchedAt: row.touched_at,
      openedAt: row.opened_at,
      deliveredAt: row.delivered_at,
      dueAt: row.due_at,
      enrichState: row.enrich_state,
      freshness: freshnessOf(row, now),
    };
  }

  function rowOf(id: number): ItemRow | undefined {
    return one<ItemRow>(`${ITEM_SELECT} WHERE items.id = ?`, id);
  }

  function get(id: number, opts: { includeDeleted?: boolean } = {}): Item | null {
    const row = rowOf(id);
    if (!row || (row.deleted_at && !opts.includeDeleted)) return null;
    return toItem(row);
  }

  function list(filters: ListFilters = {}): Item[] {
    const where: string[] = ['items.deleted_at IS NULL'];
    const params: SQLInputValue[] = [];
    const now = clock.now();
    const lane = filters.lane ?? 'keep';
    where.push('items.lane = ?');
    params.push(lane);
    if (lane === 'transit') {
      where.push('items.created_at >= ?');
      params.push(iso(new Date(now.getTime() - TRANSIT_VISIBLE_MS)));
    }
    if (filters.kinds?.length) {
      where.push(`items.kind IN (${filters.kinds.map(() => '?').join(',')})`);
      params.push(...filters.kinds);
    }
    if (filters.topicId !== undefined && filters.topicId !== null) {
      where.push('items.topic_id = ?');
      params.push(filters.topicId);
    }
    if (filters.loose) where.push('items.topic_id IS NULL');
    if (filters.since) {
      where.push('items.touched_at >= ?');
      params.push(filters.since);
    }
    if (filters.until) {
      where.push('items.touched_at < ?');
      params.push(filters.until);
    }
    if (filters.pinnedOnly) where.push('items.pinned = 1');
    if (filters.includeFaded === false) {
      where.push('(items.pinned = 1 OR items.touched_at >= ?)');
      params.push(iso(new Date(now.getTime() - FADE_DAYS * DAY)));
    }
    params.push(filters.limit ?? 60, filters.offset ?? 0);
    return q<ItemRow>(
      `${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY items.pinned DESC, items.touched_at DESC, items.id DESC LIMIT ? OFFSET ?`,
      ...params,
    ).map((row) => toItem(row, now));
  }

  /** The Recent page: kept items by freshness, newest first (pins are on the topic pages, not here). */
  function recent(opts: { limit?: number; before?: string; kinds?: Kind[] } = {}): Item[] {
    const where = ["deleted_at IS NULL", "lane = 'keep'"];
    const params: SQLInputValue[] = [];
    if (opts.before) {
      where.push('touched_at < ?');
      params.push(opts.before);
    }
    if (opts.kinds?.length) {
      where.push(`kind IN (${opts.kinds.map(() => '?').join(',')})`);
      params.push(...opts.kinds);
    }
    params.push(opts.limit ?? 50);
    const now = clock.now();
    return q<ItemRow>(
      `${ITEM_SELECT} WHERE ${where.map((w) => `items.${w}`).join(' AND ')} ORDER BY items.touched_at DESC, items.id DESC LIMIT ?`,
      ...params,
    ).map((row) => toItem(row, now));
  }

  /** Things with a date coming up (a deadline, an exam, a booking), from a day ago to `days` ahead. */
  function upcoming(days = 21): Item[] {
    const now = clock.now();
    return q<ItemRow>(
      `${ITEM_SELECT} WHERE items.deleted_at IS NULL AND items.lane = 'keep' AND items.due_at IS NOT NULL
       AND items.due_at >= ? AND items.due_at <= ? ORDER BY items.due_at LIMIT 12`,
      iso(new Date(now.getTime() - DAY)),
      iso(new Date(now.getTime() + days * DAY)),
    ).map((row) => toItem(row, now));
  }

  // ---------------------------------------------------------------- topics

  function topicByName(name: string): { id: number; name: string } | undefined {
    return one<{ id: number; name: string }>('SELECT id, name FROM topics WHERE name = ? COLLATE NOCASE', name.trim());
  }

  function ensureTopic(name: string, origin = 'model'): number {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    const existing = topicByName(clean);
    if (existing) return existing.id;
    return Number(run('INSERT INTO topics (name, origin, created_at) VALUES (?, ?, ?)', clean, origin, iso(clock.now())).lastInsertRowid);
  }

  function topics(): TopicSummary[] {
    const now = clock.now();
    const rows = q<{ id: number; name: string; origin: string; count: number; last: string | null }>(
      `SELECT topics.id, topics.name, topics.origin, COUNT(items.id) AS count, MAX(items.touched_at) AS last
       FROM topics LEFT JOIN items ON items.topic_id = topics.id AND items.deleted_at IS NULL AND items.lane = 'keep'
       GROUP BY topics.id ORDER BY last DESC NULLS LAST, topics.name`,
    );
    return rows
      .filter((r) => r.count > 0 || r.origin === 'owner')
      .map((r) => ({
        id: r.id,
        name: r.name,
        count: r.count,
        lastActivity: r.last,
        origin: r.origin,
        dormant: !r.last || daysBetween(r.last, now) > DORMANT_DAYS,
      }));
  }

  function topicNames(): string[] {
    return q<{ name: string }>("SELECT name FROM topics WHERE name != ? ORDER BY name", PRIVATE_TOPIC).map((r) => r.name);
  }

  function looseHints(): string[] {
    return q<{ hint: string }>(
      "SELECT DISTINCT topic_hint AS hint FROM items WHERE topic_id IS NULL AND topic_hint IS NOT NULL AND deleted_at IS NULL",
    ).map((r) => r.hint);
  }

  function renameTopic(id: number, name: string): void {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean) throw new Error('A topic needs a name.');
    const clash = topicByName(clean);
    if (clash && clash.id !== id) return mergeTopics(id, clash.id);
    run("UPDATE topics SET name = ?, origin = 'owner' WHERE id = ?", clean, id);
    events.emit({ type: 'topics' });
  }

  function mergeTopics(fromId: number, intoId: number): void {
    if (fromId === intoId) return;
    transaction(db, () => {
      const moved = q<{ id: number }>('SELECT id FROM items WHERE topic_id = ?', fromId);
      run('UPDATE items SET topic_id = ? WHERE topic_id = ?', intoId, fromId);
      run('DELETE FROM topics WHERE id = ?', fromId);
      for (const { id } of moved) reindex(id);
    });
    events.emit({ type: 'topics' });
  }

  function createTopic(name: string): number {
    const id = ensureTopic(name, 'owner');
    run("UPDATE topics SET origin = 'owner' WHERE id = ?", id);
    events.emit({ type: 'topics' });
    return id;
  }

  function deleteTopic(id: number): void {
    run('UPDATE items SET topic_id = NULL WHERE topic_id = ?', id);
    run('DELETE FROM topics WHERE id = ?', id);
    events.emit({ type: 'topics' });
  }

  function setTopic(itemId: number, topic: number | string | null): Item | null {
    const topicId = topic === null ? null : typeof topic === 'number' ? topic : ensureTopic(topic, 'owner');
    run('UPDATE items SET topic_id = ?, topic_hint = NULL WHERE id = ?', topicId, itemId);
    reindex(itemId);
    return changed(itemId);
  }

  // ---------------------------------------------------------------- full-text index

  function reindex(id: number): void {
    const row = rowOf(id);
    run('DELETE FROM items_fts WHERE rowid = ?', id);
    if (!row || row.deleted_at) return;
    const meta = row.meta ? (JSON.parse(row.meta) as ItemMeta) : {};
    const item = toItem(row);
    run(
      'INSERT INTO items_fts (rowid, title, label, summary, keywords, body, extracted, file_name, host) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      item.title,
      row.label ?? '',
      row.summary ?? '',
      [row.keywords ?? '', row.topic_name ?? '', meta.siteName ?? '', meta.description ?? ''].join(' '),
      [row.text ?? '', meta.note ?? ''].join('\n'),
      (row.extracted ?? '').slice(0, 50_000),
      row.file_name ?? '',
      row.url ? `${hostOf(row.url)} ${row.url}` : '',
    );
  }

  // ---------------------------------------------------------------- search

  function ftsQuery(query: string, mode: 'and' | 'or'): string | null {
    const terms = query
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1 || /\d/.test(t))
      .slice(0, 12);
    if (!terms.length) return null;
    // Words are prefixes, so the singular finds the plural; for the plural to find the singular, try the stem too
    // ("laptops" → laptop, "portàtils" → portàtil, "portátiles" → portátil).
    const forms = (t: string) => {
      const clean = t.replace(/"/g, '');
      const stems = new Set([clean]);
      if (clean.length >= 5 && clean.endsWith('s')) stems.add(clean.slice(0, -1));
      if (clean.length >= 6 && clean.endsWith('es')) stems.add(clean.slice(0, -2));
      const list = [...stems].map((s) => `"${s}"*`);
      return list.length === 1 ? list[0] : `(${list.join(' OR ')})`;
    };
    return terms.map(forms).join(mode === 'and' ? ' AND ' : ' OR ');
  }

  /**
   * Full-text search ranked by relevance and freshness together: an old perfect match still wins over a new weak one,
   * but between two good matches the newer is first. Faded items are included and simply rank lower.
   */
  function search(query: string, filters: ListFilters = {}): SearchHit[] {
    const now = clock.now();
    const run_ = (mode: 'and' | 'or') => {
      const match = ftsQuery(query, mode);
      if (!match) return [];
      const where = ['items.deleted_at IS NULL'];
      const params: SQLInputValue[] = [match];
      where.push('items.lane = ?');
      params.push(filters.lane ?? 'keep');
      if (filters.kinds?.length) {
        where.push(`items.kind IN (${filters.kinds.map(() => '?').join(',')})`);
        params.push(...filters.kinds);
      }
      if (filters.topicId !== undefined && filters.topicId !== null) {
        where.push('items.topic_id = ?');
        params.push(filters.topicId);
      }
      if (filters.since) {
        where.push('items.touched_at >= ?');
        params.push(filters.since);
      }
      if (filters.until) {
        where.push('items.touched_at < ?');
        params.push(filters.until);
      }
      return q<ItemRow & { rank: number }>(
        `SELECT items.*, topics.name AS topic_name, bm25(items_fts, 8.0, 7.0, 3.0, 3.0, 1.5, 1.0, 4.0, 2.0) AS rank
         FROM items_fts JOIN items ON items.id = items_fts.rowid LEFT JOIN topics ON topics.id = items.topic_id
         WHERE items_fts MATCH ? AND ${where.join(' AND ')} ORDER BY rank LIMIT 200`,
        ...params,
      );
    };
    let rows = run_('and');
    if (rows.length === 0) rows = run_('or');
    const hits = rows.map((row) => {
      const age = Math.max(0, daysBetween(row.touched_at, now));
      const recency = 0.3 + 0.7 * Math.exp(-age / 120);
      const score = -row.rank * recency * (row.pinned ? 1.3 : 1);
      return { item: toItem(row, now), score };
    });
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, filters.limit ?? 30);
  }

  // ---------------------------------------------------------------- capture

  function insertItem(fields: Record<string, SQLInputValue>): number {
    const keys = Object.keys(fields);
    return Number(
      run(`INSERT INTO items (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => fields[k] ?? null))
        .lastInsertRowid,
    );
  }

  function earlySensitivity(input: { text: string; label: string | null; fileName: string | null }) {
    const verdict = checkSensitivity({ ...input, extracted: null });
    return { sensitive: verdict.sensitive ? 1 : 0, sensitive_reasons: verdict.reasons.join(',') || null };
  }

  function changed(id: number): Item | null {
    const item = get(id, { includeDeleted: true });
    if (item) events.emit({ type: 'item', item });
    return item;
  }

  /** The most recent kept item from a device, sent within a window of `at`. */
  function neighbour(source: string, at: Date, windowMs: number, direction: 'before' | 'after'): ItemRow | undefined {
    const from = direction === 'before' ? iso(new Date(at.getTime() - windowMs)) : iso(at);
    const to = direction === 'before' ? iso(at) : iso(new Date(at.getTime() + windowMs));
    return one<ItemRow>(
      `${ITEM_SELECT} WHERE items.source = ? AND items.lane = 'keep' AND items.deleted_at IS NULL
       AND items.created_at >= ? AND items.created_at <= ? ORDER BY items.created_at DESC, items.id DESC LIMIT 1`,
      source,
      from,
      to,
    );
  }

  function capture(input: CaptureInput): CaptureResult {
    const at = input.at ?? clock.now();
    const lane: Lane = input.lane ?? 'keep';
    const text = input.text?.replace(/\r\n?/g, '\n').trim() || null;
    const meta: ItemMeta = {};
    if (input.forwarded) meta.forwarded = true;
    if (input.source.startsWith('whatsapp:')) meta.chat = input.source.slice('whatsapp:'.length);

    let kind: Kind;
    let url: string | null = input.url?.trim() || null;
    let body: string | null = text;
    let file: { sha: string; name: string; mime: string; size: number } | null = null;
    let dedupeKey: string | null = null;

    if (input.file) {
      const mime = mimeOf(input.file.name, input.file.mime);
      const stored = files.put(input.file.bytes, input.file.name);
      file = { sha: stored.sha, name: cleanFileName(input.file.name), mime, size: stored.size };
      kind = fileKind(mime);
      dedupeKey = `sha:${stored.sha}`;
    } else {
      if (!url && text) {
        const sole = soleUrl(text);
        if (sole) {
          url = sole.url;
          body = sole.rest || null;
        }
      }
      if (url) {
        kind = linkKind(url);
        dedupeKey = `url:${normalizeUrl(url)}`;
        if (body && body === text) body = null;
      } else if (body) {
        kind = 'note';
        dedupeKey = `note:${sha256(body.toLowerCase().replace(/\s+/g, ' '))}`;
      } else {
        throw new Error('Nothing to capture: send text, a link or a file.');
      }
    }

    // A short text right after something from the same device is that thing's label.
    if (lane === 'keep' && kind === 'note' && body && isShortText(body)) {
      // Seen before (a re-import, a double send): it is already the label of a neighbour.
      const labelled = one<ItemRow>(
        `${ITEM_SELECT} WHERE items.source = ? AND items.lane = 'keep' AND items.created_at >= ? AND items.created_at <= ?
         AND items.label IS NOT NULL AND (items.label = ? OR items.label LIKE ? OR items.label LIKE ?) LIMIT 1`,
        input.source,
        iso(new Date(at.getTime() - LABEL_AFTER_MS)),
        iso(new Date(at.getTime() + LABEL_AFTER_MS)),
        body,
        `${body} · %`,
        `% · ${body}`,
      );
      if (labelled) return { item: toItem(labelled), outcome: 'bumped' };
      const previous = neighbour(input.source, at, LABEL_AFTER_MS, 'before');
      if (previous && !previous.label && !(previous.kind === 'note' && isShortText(previous.text ?? ''))) {
        run('UPDATE items SET label = ? WHERE id = ?', body, previous.id);
        if (previous.enrich_state !== 'pending') markForEnrichment(previous.id);
        reindex(previous.id);
        return { item: changed(previous.id)!, outcome: 'labelled' };
      }
    }

    let label: string | null = null;
    if (lane === 'keep' && kind !== 'note') {
      // …and a short text right before a link or file is its label too ("fin claude limits", then the reel).
      const previous = neighbour(input.source, at, LABEL_BEFORE_MS, 'before');
      if (previous && previous.kind === 'note' && !previous.label && !previous.pinned && isShortText(previous.text ?? '')) {
        label = previous.text;
        hardDelete(previous.id);
      }
      if (body && kind !== 'link' && kind !== 'video' && isShortText(body)) {
        // A caption on a photo or file is its label.
        label = label ? `${label} · ${body}` : body;
        body = null;
      } else if (body && (kind === 'link' || kind === 'video')) {
        if (isShortText(body)) label = label ? `${label} · ${body}` : body;
        else meta.note = body;
        body = null;
      }
    }

    // The same link, file or note again: bump it instead of storing a second copy.
    if (lane === 'keep' && dedupeKey) {
      const existing = one<ItemRow>(`${ITEM_SELECT} WHERE items.dedupe_key = ? AND items.lane = 'keep'`, dedupeKey);
      if (existing) {
        const touched = existing.touched_at > iso(at) ? existing.touched_at : iso(at);
        run(
          'UPDATE items SET touched_at = ?, deleted_at = NULL, label = COALESCE(label, ?) WHERE id = ?',
          touched,
          label,
          existing.id,
        );
        reindex(existing.id);
        return { item: changed(existing.id)!, outcome: 'bumped' };
      }
    }

    const id = insertItem({
      kind,
      lane,
      text: body,
      url,
      dedupe_key: lane === 'keep' ? dedupeKey : null,
      file_sha: file?.sha ?? null,
      file_name: file?.name ?? null,
      file_mime: file?.mime ?? null,
      file_size: file?.size ?? null,
      label,
      meta: JSON.stringify(meta),
      private_override: input.private ? 1 : null,
      // A first look right away, so nothing announces a password before enrichment has read it (push, the companion,
      // open pages). Enrichment looks again with the file's text.
      ...earlySensitivity({ text: [body, url, meta.note].filter(Boolean).join('\n'), label, fileName: file?.name ?? null }),
      source: input.source,
      target: input.target ?? null,
      created_at: iso(at),
      touched_at: iso(at),
      enrich_state: 'pending',
    });
    reindex(id);
    kick();
    return { item: changed(id)!, outcome: 'created' };
  }

  function markForEnrichment(id: number): void {
    run("UPDATE items SET enrich_state = 'pending', enrich_error = NULL WHERE id = ?", id);
    kick();
  }

  // ---------------------------------------------------------------- owner actions

  function open(id: number): Item | null {
    const now = iso(clock.now());
    run('UPDATE items SET opened_at = ?, touched_at = MAX(touched_at, ?) WHERE id = ? AND deleted_at IS NULL', now, now, id);
    return changed(id);
  }

  function pin(id: number, pinned: boolean): Item | null {
    const now = iso(clock.now());
    run('UPDATE items SET pinned = ?, touched_at = CASE WHEN ? THEN MAX(touched_at, ?) ELSE touched_at END WHERE id = ?', pinned ? 1 : 0, pinned ? 1 : 0, now, id);
    return changed(id);
  }

  function setPrivate(id: number, value: boolean | null): Item | null {
    run('UPDATE items SET private_override = ? WHERE id = ?', value === null ? null : value ? 1 : 0, id);
    const row = rowOf(id);
    if (row && !value && row.enrich_state === 'local' && !(row.sensitive && value === null)) markForEnrichment(id);
    if (row && value) {
      // Made private: drop what the model wrote, keep local text.
      run("UPDATE items SET summary = NULL, keywords = NULL, title = NULL, topic_id = ?, enrich_state = 'local' WHERE id = ?", ensureTopic(PRIVATE_TOPIC, 'system'), id);
    }
    reindex(id);
    return changed(id);
  }

  function setLabel(id: number, label: string | null): Item | null {
    run('UPDATE items SET label = ? WHERE id = ?', label?.trim() || null, id);
    reindex(id);
    return changed(id);
  }

  function remove(id: number): Item | null {
    run('UPDATE items SET deleted_at = ? WHERE id = ?', iso(clock.now()), id);
    reindex(id);
    const item = get(id, { includeDeleted: true });
    events.emit({ type: 'removed', id });
    return item;
  }

  function restore(id: number): Item | null {
    run('UPDATE items SET deleted_at = NULL WHERE id = ?', id);
    reindex(id);
    return changed(id);
  }

  function hardDelete(id: number): void {
    const row = rowOf(id);
    run('DELETE FROM items_fts WHERE rowid = ?', id);
    run('DELETE FROM items WHERE id = ?', id);
    if (row?.file_sha) {
      const others = one<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE file_sha = ?', row.file_sha);
      if (!others?.n) files.remove(row.file_sha, row.file_name ?? '');
    }
    events.emit({ type: 'removed', id });
  }

  /** Transit → Keep: the owner wants a transfer kept for good. */
  function keep(id: number): Item | null {
    const row = rowOf(id);
    if (!row || row.lane !== 'transit') return get(id);
    const key = row.file_sha
      ? `sha:${row.file_sha}`
      : row.url
        ? `url:${normalizeUrl(row.url)}`
        : row.text
          ? `note:${sha256(row.text.toLowerCase().replace(/\s+/g, ' '))}`
          : null;
    const existing = key ? one<{ id: number }>("SELECT id FROM items WHERE dedupe_key = ? AND lane = 'keep'", key) : undefined;
    if (existing) {
      hardDelete(id);
      run('UPDATE items SET touched_at = ?, deleted_at = NULL WHERE id = ?', iso(clock.now()), existing.id);
      return changed(existing.id);
    }
    run("UPDATE items SET lane = 'keep', dedupe_key = ?, touched_at = ?, enrich_state = 'pending' WHERE id = ?", key, iso(clock.now()), id);
    reindex(id);
    kick();
    return changed(id);
  }

  // ---------------------------------------------------------------- transit

  function sendToDevice(input: CaptureInput & { target: string }): Item {
    return capture({ ...input, lane: 'transit' }).item;
  }

  function sendItem(id: number, target: string, source: string): Item | null {
    const row = rowOf(id);
    if (!row) return null;
    const created = insertItem({
      kind: row.kind,
      lane: 'transit',
      text: row.text,
      url: row.url,
      file_sha: row.file_sha,
      file_name: row.file_name,
      file_mime: row.file_mime,
      file_size: row.file_size,
      label: row.label,
      title: row.title,
      meta: row.meta,
      source,
      target,
      created_at: iso(clock.now()),
      touched_at: iso(clock.now()),
      enrich_state: 'done',
      private_override: row.private_override,
      sensitive: row.sensitive,
    });
    return changed(created);
  }

  function transit(target?: string): Item[] {
    const since = iso(new Date(clock.now().getTime() - TRANSIT_VISIBLE_MS));
    const rows = target
      ? q<ItemRow>(`${ITEM_SELECT} WHERE items.lane = 'transit' AND items.deleted_at IS NULL AND items.created_at >= ? AND (items.target = ? OR items.target = 'all') ORDER BY items.created_at DESC`, since, target)
      : q<ItemRow>(`${ITEM_SELECT} WHERE items.lane = 'transit' AND items.deleted_at IS NULL AND items.created_at >= ? ORDER BY items.created_at DESC`, since);
    return rows.map((r) => toItem(r));
  }

  function delivered(id: number): Item | null {
    run('UPDATE items SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ?', iso(clock.now()), id);
    return changed(id);
  }

  // ---------------------------------------------------------------- enrichment

  let wake: (() => void) | null = null;
  function kick(): void {
    wake?.();
  }

  function spentThisMonthUsd(): number {
    const now = clock.now();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    return one<{ total: number | null }>('SELECT SUM(cost_usd) AS total FROM usage WHERE at >= ?', start)?.total ?? 0;
  }

  function modelAvailable(): boolean {
    return options.model !== null && spentThisMonthUsd() < spendCap;
  }

  async function enrichOne(id: number): Promise<Item | null> {
    const row = rowOf(id);
    if (!row || row.deleted_at) return null;
    const meta: ItemMeta = row.meta ? JSON.parse(row.meta) : {};
    let extracted = row.extracted;
    const path = row.file_sha ? files.pathOf(row.file_sha, row.file_name ?? '') : null;

    // 1. The privacy gate on what's known before touching the network.
    const early = checkSensitivity({ text: [row.text, row.url].filter(Boolean).join('\n'), label: row.label, fileName: row.file_name });
    const privateHost = row.url ? isPrivateHost(row.url) : false;
    // A link the owner marked private isn't fetched either: the site would see it opened again.
    const mayFetch = !early.sensitive && !privateHost && row.private_override !== 1 && row.lane === 'keep';

    // 2. Local extraction.
    try {
      if (path && existsSync(path)) {
        if (row.kind === 'image' && extracted === null) extracted = (await extractors.ocr(path)).trim();
        if (row.kind === 'pdf' && extracted === null) {
          const pdf = await extractors.pdf(path);
          extracted = pdf.text.trim();
          if (pdf.pages) meta.pages = pdf.pages;
        }
        if ((row.kind === 'audio' || row.kind === 'clip') && extracted === null) extracted = (await extractors.transcribe(path)).trim();
        if ((row.kind === 'image' || row.kind === 'pdf' || row.kind === 'clip') && !meta.thumb) {
          meta.thumb = await extractors.thumbnail(path, row.file_mime ?? '', files.thumbPath(row.file_sha!));
        }
      }
      if (row.url && mayFetch && !meta.siteName && !meta.description) {
        const unfurl = await extractors.unfurl(row.url);
        if (unfurl) {
          if (unfurl.title) meta.siteName = unfurl.siteName ?? hostOf(row.url);
          if (unfurl.description) meta.description = unfurl.description.slice(0, 500);
          if (unfurl.image) meta.image = unfurl.image;
          if (unfurl.title) (meta as ItemMeta & { pageTitle?: string }).description ??= undefined;
          (meta as Record<string, unknown>).pageTitle = unfurl.title;
        }
      }
      // Copy the link's picture home: hotlinks break, and Instagram's expire within days.
      if (meta.image && !meta.linkThumb && mayFetch) {
        const name = sha256(meta.image);
        if (await extractors.picture(meta.image, files.thumbPath(name))) meta.linkThumb = name;
      }
    } catch (error) {
      log(`extraction failed for item ${id}: ${(error as Error).message}`);
    }

    // 3. The privacy gate again, now with the text read out of the file.
    const verdict = checkSensitivity({
      text: [row.text, row.url, meta.note].filter(Boolean).join('\n'),
      label: row.label,
      fileName: row.file_name,
      extracted,
    });
    const isPrivate = row.private_override === null ? verdict.sensitive : row.private_override === 1;
    run(
      'UPDATE items SET extracted = ?, meta = ?, sensitive = ?, sensitive_reasons = ? WHERE id = ?',
      extracted ?? null,
      JSON.stringify(meta),
      verdict.sensitive ? 1 : 0,
      verdict.reasons.join(',') || null,
      id,
    );

    // 4. The model, only for what may leave the house.
    if (isPrivate || row.lane === 'transit' || !modelAvailable()) {
      const topicId = isPrivate ? ensureTopic(PRIVATE_TOPIC, 'system') : row.topic_id;
      // Kept while the model was away (no key yet, or the month's cap): catchUp() reads it once the model is back.
      const waiting = !isPrivate && row.lane === 'keep' ? 1 : 0;
      run(
        "UPDATE items SET enrich_state = 'local', enriched_at = ?, topic_id = ?, waiting_for_model = ? WHERE id = ?",
        iso(clock.now()),
        topicId,
        waiting,
        id,
      );
      reindex(id);
      return changed(id);
    }

    try {
      let image: { mime: string; base64: string } | null = null;
      if (row.kind === 'image' && path && existsSync(path)) {
        const small = await extractors.shrink(path);
        if (small) image = { mime: 'image/jpeg', base64: Buffer.from(small).toString('base64') };
      }
      const result = await options.model!.enrich({
        kind: row.kind,
        text: row.text,
        url: row.url,
        label: row.label,
        fileName: row.file_name,
        extracted: extracted ? extracted.slice(0, 6000) : null,
        unfurl: { title: (meta as Record<string, string | undefined>).pageTitle, description: meta.description, siteName: meta.siteName },
        image,
        topics: topicNames(),
        hints: looseHints(),
        now: clock.now(),
      });
      let topicId: number | null = row.topic_id;
      let hint: string | null = null;
      if (topicId === null || rowOf(id)?.topic_id === null) {
        const existing = result.topic ? topicByName(result.topic) : undefined;
        if (existing && existing.name !== PRIVATE_TOPIC) topicId = existing.id;
        else hint = (result.newTopic ?? result.topic)?.trim().slice(0, 40) || null;
      }
      run(
        `UPDATE items SET title = ?, summary = ?, keywords = ?, topic_id = ?, topic_hint = ?, due_at = ?,
         enrich_state = 'done', enrich_error = NULL, enriched_at = ? WHERE id = ?`,
        result.title.slice(0, 120),
        result.summary.slice(0, 600),
        result.keywords.map((k) => k.replace(/,/g, ' ').trim()).filter(Boolean).slice(0, 16).join(','),
        topicId,
        topicId === null ? hint : null,
        result.dueAt,
        iso(clock.now()),
        id,
      );
      if (topicId === null) clusterLoose();
    } catch (error) {
      log(`model enrichment failed for item ${id}: ${(error as Error).message}`);
      run("UPDATE items SET enrich_state = 'failed', enrich_error = ? WHERE id = ?", String((error as Error).message).slice(0, 300), id);
    }
    reindex(id);
    return changed(id);
  }

  /** Loose items whose hints agree become a topic once there are enough of them. */
  function clusterLoose(): void {
    const groups = q<{ hint: string; n: number }>(
      `SELECT topic_hint AS hint, COUNT(*) AS n FROM items
       WHERE topic_id IS NULL AND topic_hint IS NOT NULL AND deleted_at IS NULL AND lane = 'keep'
       GROUP BY lower(topic_hint) HAVING n >= ?`,
      TOPIC_MIN_ITEMS,
    );
    for (const group of groups) {
      const topicId = ensureTopic(group.hint, 'model');
      const ids = q<{ id: number }>('SELECT id FROM items WHERE topic_id IS NULL AND lower(topic_hint) = lower(?)', group.hint);
      run('UPDATE items SET topic_id = ?, topic_hint = NULL WHERE topic_id IS NULL AND lower(topic_hint) = lower(?)', topicId, group.hint);
      for (const { id } of ids) reindex(id);
      events.emit({ type: 'topic-created', name: group.hint, count: ids.length });
    }
  }

  /** Consolidate the hints of loose items (and existing model topics) into a tidy topic list. Used after an import. */
  async function planTopics(): Promise<{ topics: string[] }> {
    if (!modelAvailable()) {
      clusterLoose();
      return { topics: topicNames() };
    }
    const hints = q<{ hint: string; count: number }>(
      `SELECT topic_hint AS hint, COUNT(*) AS count FROM items WHERE topic_id IS NULL AND topic_hint IS NOT NULL
       AND deleted_at IS NULL AND lane = 'keep' GROUP BY lower(topic_hint) ORDER BY count DESC`,
    ).map((h) => ({
      ...h,
      examples: q<{ title: string }>(
        "SELECT title FROM items WHERE lower(topic_hint) = lower(?) AND title IS NOT NULL ORDER BY touched_at DESC LIMIT 4",
        h.hint,
      ).map((r) => r.title),
    }));
    if (!hints.length) return { topics: topicNames() };
    const plan = await options.model!.planTopics({ hints, topics: topicNames() });
    transaction(db, () => {
      for (const topic of plan.topics) {
        if (topic.name.trim().toLowerCase() === PRIVATE_TOPIC.toLowerCase()) continue;
        const topicId = ensureTopic(topic.name, 'model');
        for (const hint of topic.hints) {
          run('UPDATE items SET topic_id = ?, topic_hint = NULL WHERE topic_id IS NULL AND lower(topic_hint) = lower(?)', topicId, hint);
        }
      }
    });
    for (const { id } of q<{ id: number }>('SELECT id FROM items')) reindex(id);
    events.emit({ type: 'topics' });
    return { topics: topicNames() };
  }

  async function enrichPending(limit = Infinity, concurrency = 2): Promise<number> {
    let done = 0;
    const take = () =>
      one<{ id: number }>("SELECT id FROM items WHERE enrich_state = 'pending' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")?.id;
    const inFlight = new Set<number>();
    const worker = async () => {
      while (done < limit) {
        const id = q<{ id: number }>(
          "SELECT id FROM items WHERE enrich_state = 'pending' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 8",
        ).find((r) => !inFlight.has(r.id))?.id;
        if (id === undefined) return;
        inFlight.add(id);
        try {
          await enrichOne(id);
        } finally {
          inFlight.delete(id);
        }
        done++;
      }
    };
    void take;
    await Promise.all(Array.from({ length: concurrency }, worker));
    return done;
  }

  /** Queue what was only read locally because the model was away; nothing private is ever queued. */
  function catchUp(): number {
    if (!modelAvailable()) return 0;
    return Number(
      run(
        `UPDATE items SET enrich_state = 'pending', waiting_for_model = 0
         WHERE waiting_for_model = 1 AND enrich_state = 'local' AND deleted_at IS NULL AND lane = 'keep'
         AND sensitive = 0 AND (private_override IS NULL OR private_override = 0)`,
      ).changes,
    );
  }

  /** Retry failed enrichments (a model outage, a timeout) once the model is back. */
  function retryFailed(): number {
    return Number(run("UPDATE items SET enrich_state = 'pending' WHERE enrich_state = 'failed' AND deleted_at IS NULL").changes);
  }

  let stopped = false;
  function startWorker(): () => void {
    stopped = false;
    const loop = async () => {
      // After a catch-up of many items (the import read before the key existed), tidy the topics once, as an import does.
      let replan = false;
      while (!stopped) {
        try {
          if (catchUp() >= 10) replan = true;
          const n = await enrichPending(20);
          if (n > 0) continue;
          if (replan) {
            replan = false;
            await planTopics();
          }
        } catch (error) {
          log(`enrichment worker: ${(error as Error).message}`);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 60_000);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
        });
      }
    };
    void loop();
    return () => {
      stopped = true;
      kick();
    };
  }

  // ---------------------------------------------------------------- housekeeping

  function maintain(): { transitDeleted: number; trashPurged: number } {
    const now = clock.now().getTime();
    const oldTransit = q<{ id: number }>("SELECT id FROM items WHERE lane = 'transit' AND created_at < ?", iso(new Date(now - TRANSIT_DELETE_MS)));
    for (const { id } of oldTransit) hardDelete(id);
    const trash = q<{ id: number }>('SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?', iso(new Date(now - TRASH_PURGE_MS)));
    for (const { id } of trash) hardDelete(id);
    clusterLoose();
    return { transitDeleted: oldTransit.length, trashPurged: trash.length };
  }

  function stats() {
    const counts = one<{ items: number; pending: number; failed: number; private: number }>(
      `SELECT COUNT(*) AS items,
        SUM(enrich_state = 'pending') AS pending, SUM(enrich_state = 'failed') AS failed,
        SUM(COALESCE(private_override, sensitive) = 1) AS private
       FROM items WHERE deleted_at IS NULL AND lane = 'keep'`,
    )!;
    return { ...counts, spentThisMonthUsd: spentThisMonthUsd(), spendCapUsd: spendCap, model: options.model?.name ?? null };
  }

  function fileOf(item: Item): { path: string; mime: string; name: string } | null {
    if (!item.file) return null;
    return { path: files.pathOf(item.file.sha, item.file.name), mime: item.file.mime, name: item.file.name };
  }

  function thumbOf(item: Item): string | null {
    const name = item.file && item.meta.thumb ? item.file.sha : item.meta.linkThumb;
    if (!name) return null;
    const path = files.thumbPath(name);
    return existsSync(path) ? path : null;
  }

  function readText(item: Item): string | null {
    const file = fileOf(item);
    if (!file || !/^text\//.test(file.mime)) return null;
    return readFileSync(file.path, 'utf8');
  }

  return {
    db,
    events,
    clock,
    capture,
    get,
    list,
    recent,
    upcoming,
    search,
    topics,
    topicNames,
    renameTopic,
    mergeTopics,
    createTopic,
    deleteTopic,
    setTopic,
    open,
    pin,
    setPrivate,
    setLabel,
    remove,
    restore,
    keep,
    sendToDevice,
    sendItem,
    transit,
    delivered,
    enrichOne,
    enrichPending,
    retryFailed,
    planTopics,
    clusterLoose,
    startWorker,
    catchUp,
    maintain,
    stats,
    spentThisMonthUsd,
    fileOf,
    thumbOf,
    readText,
    modelAvailable,
    reindexAll: () => q<{ id: number }>('SELECT id FROM items').forEach(({ id }) => reindex(id)),
  };
}

// ---------------------------------------------------------------- helpers

/** "00000019-GEI_1r1rSem.pdf" → "GEI_1r1rSem.pdf" (WhatsApp's export prefix), with URL escapes undone. */
export function cleanFileName(name: string): string {
  let clean = basename(name.replace(/\\/g, '/'));
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* keep it as it is */
  }
  return clean.replace(/^\d{8}-/, '').replace(/\.pdf\.pdf$/i, '.pdf');
}

function prettyFileName(name: string): string {
  return name
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrivateHost(raw: string): boolean {
  const host = hostOf(raw);
  return (
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host) ||
    host.endsWith('.ts.net') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  );
}

/** A title made without the model: from the label, the page, the file name or the first line. */
function localTitle(row: Pick<ItemRow, 'kind' | 'text' | 'url' | 'label' | 'file_name' | 'extracted'>, meta: ItemMeta): string {
  const firstLine = (s: string | null | undefined) => (s ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  const pageTitle = (meta as Record<string, string | undefined>).pageTitle;
  switch (row.kind) {
    case 'note':
      return clip(firstLine(row.text) || 'Note');
    case 'link':
    case 'video': {
      if (row.label) return clip(row.label);
      if (pageTitle) return clip(pageTitle);
      const host = row.url ? hostOf(row.url) : '';
      if (/instagram\.com/.test(host)) return 'Instagram reel';
      if (/youtu/.test(host)) return 'YouTube video';
      if (row.url) {
        try {
          const u = new URL(row.url);
          const path = decodeURIComponent(u.pathname).replace(/[-_/]+/g, ' ').trim();
          return clip(path ? `${host} · ${path}` : host);
        } catch {
          return clip(row.url);
        }
      }
      return 'Link';
    }
    case 'image':
      return clip(row.label || 'Image');
    case 'pdf':
    case 'file':
      return clip(row.label || prettyFileName(row.file_name ?? 'Document'));
    case 'audio':
      return clip(row.label || (row.extracted ? `Voice note: ${firstLine(row.extracted)}` : 'Voice note'));
    case 'clip':
      return clip(row.label || 'Video');
  }
}
