import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { jsonSchema, localChat, parseJson, type ChatContent, type LocalOptions } from './local';
import { OWNER_TIME_ZONE, zonedToUtc, type Clock } from './time';
import type { EnrichRequest, EnrichResult, Model, TopicPlan, TopicPlanRequest } from './types';

/**
 * The Haiku seam. Everything that reaches here has already passed the local privacy gate. Every call is logged with
 * its tokens and cost in the `usage` table, which is what the monthly cap reads.
 */

export const MODEL_ID = 'claude-haiku-5-5';

/** USD per million tokens for claude-haiku-5-5 (prompts up to 100K tokens). */
const PRICE = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costOf(usage: UsageLike): number {
  return (
    (usage.input_tokens * PRICE.input +
      usage.output_tokens * PRICE.output +
      (usage.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
    1_000_000
  );
}

/** Logs one call; a local model's calls are logged with their tokens and cost nothing. */
export function recordUsage(db: DatabaseSync, clock: Clock, purpose: string, model: string, usage: UsageLike, free = false): number {
  const cost = free ? 0 : costOf(usage);
  db.prepare(
    'INSERT INTO usage (at, purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(clock.now().toISOString(), purpose, model, usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0, cost);
  return cost;
}

/**
 * Who the drawer belongs to, for the prompts. DRAWER_ABOUT is the owner's own line about themselves (languages, what
 * they study or do, what they keep): it helps the filer pick titles and topics they would search for.
 */
export function aboutOwner(): string {
  const about = process.env.DRAWER_ABOUT?.trim();
  return `Drawer replaces the chat its owner used to send things to themselves: links, reels, screenshots, PDFs,
timetables, game notes, shopping candidates, quick reminders. It is not a source of truth, it is a drawer of quick
notes; what matters is finding things again.${about ? `\nAbout the owner: ${about}` : ''}`;
}

const enrichSystem = () => `${aboutOwner()}

You file one item. Return:
- title: what this is, as they would search for it. At most 8 words, no trailing period, no quotes, no emoji. Prefer
  concrete nouns ("Factorio cargo rocket setup", "Uni timetable Q1 2026", "Logitech G305 vs Razer Viper"). Their label, if
  any, is their own words for it: build the title around it.
- summary: one or two plain sentences on what is in it, with the details worth finding later (names, numbers,
  ingredients, prices, dates). Never invent facts the input does not show. For a link you could not read, say what the
  link and their label tell you and no more.
- keywords: 4 to 12 search words: synonyms, the English word AND the original-language word when they differ
  (e.g. "horari", "horario", "timetable"), product names, game names. Lowercase.
- topic: the name of the existing topic it belongs to, copied exactly from the list, or null.
- newTopic: when no existing topic fits, a short general topic it would belong to (1 to 3 words, Title Case, e.g.
  "Factorio", "Uni", "Laptop Shopping", "Recipes"). Reuse one of the pending hints when it fits. Null when topic is set.
- dueAt: an ISO 8601 date-time only when the item states a future deadline, appointment or event; otherwise null.
  Write it as local time in the owner's time zone, without an offset ("2026-12-03T17:30:00").`;

const EnrichSchema = z.object({
  title: z.string(),
  summary: z.string(),
  keywords: z.array(z.string()),
  topic: z.string().nullable(),
  newTopic: z.string().nullable(),
  dueAt: z.string().nullable(),
});

const planSystem = () => `${aboutOwner()}

You tidy the owner's topics. You get the hints the filer suggested for loose items (with counts and example titles) and the
topics that already exist. Group the hints into topics: merge synonyms and near-duplicates ("Factorio" and "Factorio
Builds"), fold one-off hints into a broader topic when one fits, prefer existing topic names, and keep names short
(1 to 3 words, Title Case). Aim for topics they would recognise at a glance, 5 to 25 in total. Every hint must appear in
exactly one topic's hints list, spelled exactly as given. Never create a topic called "Private".`;

const PlanSchema = z.object({
  topics: z.array(z.object({ name: z.string(), hints: z.array(z.string()) })),
});

function describe(request: EnrichRequest): string {
  const lines: string[] = [`Today is ${localDate(request.now)} (time zone ${OWNER_TIME_ZONE}).`, `Kind: ${request.kind}`];
  if (request.label) lines.push(`Their label: ${request.label}`);
  if (request.url) lines.push(`Link: ${request.url}`);
  if (request.unfurl?.title) lines.push(`Page title: ${request.unfurl.title}`);
  if (request.unfurl?.siteName) lines.push(`Site: ${request.unfurl.siteName}`);
  if (request.unfurl?.description) lines.push(`Page description: ${request.unfurl.description}`);
  if (request.fileName) lines.push(`File name: ${request.fileName}`);
  if (request.text) lines.push(`Text:\n${request.text.slice(0, 6000)}`);
  if (request.extracted) lines.push(`Text read from the file:\n${request.extracted}`);
  lines.push(`Existing topics: ${request.topics.length ? request.topics.join(' | ') : '(none yet)'}`);
  if (request.hints.length) lines.push(`Pending topic hints: ${request.hints.slice(0, 60).join(' | ')}`);
  return lines.join('\n');
}

export interface HaikuOptions {
  apiKey: string;
  db: DatabaseSync;
  clock: Clock;
  model?: string;
  client?: Anthropic;
}

export function createHaikuModel(options: HaikuOptions): Model {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 3, timeout: 60_000 });
  const model = options.model ?? MODEL_ID;

  return {
    name: model,

    async enrich(request) {
      const content: Anthropic.ContentBlockParam[] = [];
      if (request.image) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: request.image.mime as 'image/jpeg', data: request.image.base64 },
        });
      }
      content.push({ type: 'text', text: describe(request) });
      const response = await client.messages.parse({
        model,
        max_tokens: 1500,
        system: [{ type: 'text', text: enrichSystem(), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content }],
        output_config: { effort: 'low', format: zodOutputFormat(EnrichSchema) },
      });
      recordUsage(options.db, options.clock, 'enrich', model, response.usage);
      const out = response.parsed_output;
      if (!out) throw new Error(`The model returned no filing (stop reason ${response.stop_reason}).`);
      return cleanEnrich(out);
    },

    async planTopics(request: TopicPlanRequest): Promise<TopicPlan> {
      const text = planText(request);
      const response = await client.messages.parse({
        model,
        max_tokens: 6000,
        system: planSystem(),
        messages: [{ role: 'user', content: text }],
        output_config: { effort: 'medium', format: zodOutputFormat(PlanSchema) },
      });
      recordUsage(options.db, options.clock, 'topics', model, response.usage);
      const out = response.parsed_output;
      if (!out) throw new Error(`The model returned no topic plan (stop reason ${response.stop_reason}).`);
      return out;
    },
  };
}

function planText(request: TopicPlanRequest): string {
  return [
    `Existing topics: ${request.topics.length ? request.topics.join(' | ') : '(none)'}`,
    'Hints (count, then example titles):',
    ...request.hints.map((h) => `- ${h.hint} (${h.count}): ${h.examples.join('; ')}`),
  ].join('\n');
}

/** The same filer on a model served locally (see local.ts). */
export function createLocalModel(options: LocalOptions & { db: DatabaseSync; clock: Clock }): Model {
  const chat = localChat(options);
  const enrichSchema = jsonSchema(EnrichSchema);
  const planSchema = jsonSchema(PlanSchema);

  return {
    name: options.model,

    async enrich(request) {
      const content: ChatContent =
        options.vision && request.image
          ? [
              { type: 'image_url', image_url: { url: `data:${request.image.mime};base64,${request.image.base64}` } },
              { type: 'text', text: describe(request) },
            ]
          : describe(request);
      const reply = await chat({
        messages: [
          { role: 'system', content: `${enrichSystem()}\n\nAnswer with the JSON object only.` },
          { role: 'user', content },
        ],
        schema: { name: 'filing', schema: enrichSchema },
      });
      recordUsage(options.db, options.clock, 'enrich', options.model, reply.usage, true);
      const out = EnrichSchema.safeParse(parseJson(reply.message.content));
      if (!out.success) throw new Error(`The local model returned no usable filing (${reply.finish ?? 'no reason'}).`);
      return cleanEnrich(out.data);
    },

    async planTopics(request) {
      const reply = await chat({
        messages: [
          { role: 'system', content: `${planSystem()}\n\nAnswer with the JSON object only.` },
          { role: 'user', content: planText(request) },
        ],
        schema: { name: 'topics', schema: planSchema },
        maxTokens: 6000,
      });
      recordUsage(options.db, options.clock, 'topics', options.model, reply.usage, true);
      const out = PlanSchema.safeParse(parseJson(reply.message.content));
      if (!out.success) throw new Error(`The local model returned no usable topic plan (${reply.finish ?? 'no reason'}).`);
      return out.data;
    },
  };
}

const localDate = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: OWNER_TIME_ZONE });

/** A date the model read out of an item. Without an offset it is the owner's wall-clock time, not UTC. */
export function parseDue(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
  if (m) {
    const [y, mo, d, h, mi, se] = m.slice(1).map((part) => Number(part ?? 0)) as [number, number, number, number, number, number];
    // 30 February or 25:99 is a misreading, not a date to roll over into the next month.
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || se > 59) return null;
    const at = zonedToUtc(y, mo, d, h, mi, se);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

function cleanEnrich(out: z.infer<typeof EnrichSchema>): EnrichResult {
  const title = out.title.replace(/^["'“]+|["'”.]+$/g, '').trim();
  const due = parseDue(out.dueAt);
  return {
    title: title || 'Untitled',
    summary: out.summary.trim(),
    keywords: [...new Set(out.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))],
    topic: out.topic?.trim() || null,
    newTopic: out.newTopic?.trim() || null,
    dueAt: due,
  };
}
