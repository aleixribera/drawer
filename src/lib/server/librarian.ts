import type Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Drawer } from './drawer';
import { jsonSchema, stripThinking, type ChatMessage, type LocalChat, type ToolCall, type ToolSpec } from './local';
import { aboutOwner, MODEL_ID, recordUsage } from './model';
import { checkSensitivity } from './sensitivity';
import { DAY, OWNER_TIME_ZONE, type Clock } from './time';
import type { Item, Kind } from './types';

/**
 * The librarian: Haiku with read access to the drawer through a few local tools, answering questions in a sentence or
 * two and pointing at the items it used. Private items reach it as a bare number and nothing else, so it can say
 * "there's a private one, #45" without ever seeing it. A question that itself looks sensitive never leaves the server.
 */

export const DEVICE_TARGETS = ['iphone', 'pc', 'fedora'] as const;
const KIND_GROUPS: Record<string, Kind[]> = {
  link: ['link'],
  video: ['video', 'clip'],
  image: ['image'],
  document: ['pdf', 'file'],
  note: ['note', 'audio'],
};

export interface AskTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskResult {
  answer: string;
  /** The items the answer is about, in the order it names them. */
  ids: number[];
  /** "librarian" when Haiku answered, "search" when the drawer answered on its own. */
  mode: 'librarian' | 'search';
  /** Items sent to a device while answering. */
  sent: number[];
  costUsd: number;
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: OWNER_TIME_ZONE });

/** How an item reads to the model: one line of facts, or a bare number when it's private. */
export function describeItem(item: Item): string {
  if (item.private) return `#${item.id} · private (contents hidden; the owner can open it in the app)`;
  const parts = [`#${item.id}`, item.kind, day(item.createdAt)];
  if (item.touchedAt.slice(0, 10) !== item.createdAt.slice(0, 10)) parts.push(`saved again ${day(item.touchedAt)}`);
  if (item.topic) parts.push(`topic: ${item.topic.name}`);
  if (item.pinned) parts.push('pinned');
  if (item.lane === 'transit') parts.push(`in transit to ${item.target}`);
  let line = `${parts.join(' · ')}\n  ${item.label ? `“${item.label}” — ` : ''}${item.title}`;
  if (item.summary) line += `\n  ${item.summary.slice(0, 280)}`;
  else if (item.text && item.kind === 'note') line += `\n  ${item.text.slice(0, 280).replace(/\s+/g, ' ')}`;
  if (item.url) line += `\n  ${item.url}`;
  return line;
}

function readItem(item: Item): string {
  if (item.private) return describeItem(item);
  const lines = [describeItem(item)];
  if (item.text && item.kind !== 'note') lines.push(`Sent with it: ${item.text.slice(0, 2000)}`);
  if (item.kind === 'note' && item.text) lines.push(`Full text:\n${item.text.slice(0, 4000)}`);
  if (item.meta.description) lines.push(`Page description: ${item.meta.description}`);
  if (item.file) lines.push(`File: ${item.file.name}${item.meta.pages ? `, ${item.meta.pages} pages` : ''}`);
  if (item.extracted) lines.push(`Text read from the file:\n${item.extracted.slice(0, 6000)}`);
  if (item.keywords.length) lines.push(`Keywords: ${item.keywords.join(', ')}`);
  if (item.dueAt) lines.push(`Date in it: ${item.dueAt}`);
  return lines.join('\n');
}

/** The tools as plain functions over the drawer, so they can be tested without the model. */
export function librarianTools(drawer: Drawer, clock: Clock, source: string) {
  const sent: number[] = [];
  return {
    sent,
    search(input: { query: string; kind?: string; from?: string; to?: string }): string {
      const hits = drawer.search(input.query, {
        kinds: input.kind ? KIND_GROUPS[input.kind] : undefined,
        since: input.from ? new Date(input.from).toISOString() : undefined,
        until: input.to ? new Date(new Date(input.to).getTime() + DAY).toISOString() : undefined,
        limit: 10,
      });
      if (!hits.length) return `Nothing in the drawer matches “${input.query}”. Try other words, a synonym or another language.`;
      return hits.map((h) => describeItem(h.item)).join('\n');
    },
    recent(input: { days: number; kind?: string; topic?: string }): string {
      const since = new Date(clock.now().getTime() - Math.min(Math.max(input.days, 1), 3650) * DAY).toISOString();
      const topic = input.topic ? drawer.topics().find((t) => t.name.toLowerCase() === input.topic!.toLowerCase()) : undefined;
      if (input.topic && !topic) return `There is no topic called “${input.topic}”. Topics: ${drawer.topicNames().join(', ')}`;
      const items = drawer.list({ since, kinds: input.kind ? KIND_GROUPS[input.kind] : undefined, topicId: topic?.id, limit: 25 });
      if (!items.length) return 'Nothing was kept in that window.';
      return items.map(describeItem).join('\n');
    },
    topics(): string {
      const topics = drawer.topics();
      if (!topics.length) return 'There are no topics yet.';
      return topics
        .map((t) => `${t.name}: ${t.count} items, last ${t.lastActivity ? day(t.lastActivity) : 'never'}${t.dormant ? ' (quiet)' : ''}`)
        .join('\n');
    },
    read(input: { id: number }): string {
      const item = drawer.get(input.id);
      return item ? readItem(item) : `There is no item #${input.id}.`;
    },
    send(input: { id: number; device: (typeof DEVICE_TARGETS)[number] }): string {
      const copy = drawer.sendItem(input.id, input.device, source);
      if (!copy) return `There is no item #${input.id}.`;
      sent.push(copy.id);
      return `Sent #${input.id} to ${input.device}; it is waiting there now.`;
    },
  };
}

/** The item numbers an answer names, as [#12] or #12, in order and without repeats. */
export function citedIds(answer: string): number[] {
  return [...new Set([...answer.matchAll(/#(\d{1,7})\b/g)].map((m) => Number(m[1])))];
}

function systemPrompt(now: Date): string {
  const today = now.toLocaleString('en-GB', { timeZone: OWNER_TIME_ZONE, dateStyle: 'full', timeStyle: 'short' });
  return `You are the librarian of Drawer, the owner's own place for everything they send themselves. ${aboutOwner()}
It is their memory: newer things matter more than old ones.

It is ${today} (${OWNER_TIME_ZONE}). Devices: "iphone" (their phone), "pc" (their desktop), "fedora" (their laptop).

How to answer:
- Look before you answer. Search with the words they would have used, then synonyms and other languages they
  write in. Use recent for "what did I save yesterday/this week". Read an item when the answer
  is inside it (a recipe, a timetable, a PDF).
- Answer in one to three short sentences, in the language of the question, ready to be read aloud: no headings, no
  lists unless they ask for several things, no markdown links.
- Name every item you rely on as [#id] right after the words it supports. Never invent items, numbers or facts; if the
  drawer doesn't have it, say so plainly and suggest what they could search instead.
- When several items match, prefer the newest unless they ask otherwise, and mention there are older ones.
- A private item shows only its number: say it exists and that they can open it, never guess what is in it.
- Only send something to a device when they ask for it in this question.`;
}

export interface LibrarianOptions {
  drawer: Drawer;
  db: DatabaseSync;
  clock: Clock;
  client: Anthropic | null;
  /** A model served locally (see local.ts), used when there is no Anthropic client. */
  local?: { chat: LocalChat; model: string } | null;
  /** How long a local model gets for one whole question, all its rounds together. */
  localAskMs?: number;
  model?: string;
}

export function createLibrarian(options: LibrarianOptions) {
  const { drawer, db, clock } = options;
  const model = options.model ?? MODEL_ID;

  /** The drawer answering on its own: a plain search, said as a sentence. */
  function bySearch(question: string, why: string): AskResult {
    const hits = drawer.search(question, { limit: 8 });
    const ids = hits.map((h) => h.item.id);
    const answer = hits.length
      ? `${why} Search found ${hits.length === 8 ? 'these' : hits.length === 1 ? 'one thing' : `${hits.length} things`}.`
      : `${why} Search found nothing for that either.`;
    return { answer, ids, mode: 'search', sent: [], costUsd: 0 };
  }

  async function ask(question: string, history: AskTurn[] = [], source = 'web'): Promise<AskResult> {
    const q = question.trim().slice(0, 2000);
    if (!q) return { answer: 'Ask me about anything you kept.', ids: [], mode: 'search', sent: [], costUsd: 0 };
    if (checkSensitivity({ text: q }).sensitive) {
      return bySearch(q, 'That question looks like it holds something private, so it stayed on the server.');
    }
    if ((!options.client && !options.local) || !drawer.modelAvailable()) {
      return bySearch(q, 'The librarian is off right now (no model set up, or this month’s budget is used up).');
    }

    const tools = librarianTools(drawer, clock, source);
    const specs = [
      tool({
        name: 'search',
        description:
          'Full-text search over everything kept: titles, labels, summaries, note text, link titles and the words read out of PDFs, images and voice notes. Prefix matching; ranks good and recent matches first.',
        schema: z.object({
          query: z.string().describe('A few search words, not a sentence'),
          kind: z.enum(['link', 'video', 'image', 'document', 'note']).optional(),
          from: z.string().optional().describe('Only items kept on or after this date, YYYY-MM-DD'),
          to: z.string().optional().describe('Only items kept on or before this date, YYYY-MM-DD'),
        }),
        run: (input) => tools.search(input),
      }),
      tool({
        name: 'recent',
        description: 'What was kept in the last N days, newest first, optionally of one kind or in one topic.',
        schema: z.object({
          days: z.coerce.number().int().describe('How many days back, e.g. 1 for today and yesterday, 7 for the week'),
          kind: z.enum(['link', 'video', 'image', 'document', 'note']).optional(),
          topic: z.string().optional().describe('Exact topic name'),
        }),
        run: (input) => tools.recent(input),
      }),
      tool({
        name: 'topics',
        description: 'The topics the drawer has grouped things into, with counts and when each was last added to.',
        schema: z.object({}),
        run: () => tools.topics(),
      }),
      tool({
        name: 'read',
        description: 'Everything about one item: its full text, the text read from its file, its link and keywords.',
        schema: z.object({ id: z.coerce.number().int() }),
        run: (input) => tools.read(input),
      }),
      tool({
        name: 'send_to_device',
        description: 'Put an item on its way to one of his devices, where it pops up. Only when he asks for it.',
        schema: z.object({ id: z.coerce.number().int(), device: z.enum(DEVICE_TARGETS) }),
        run: (input) => tools.send(input),
      }),
    ];

    const turns = safeHistory(history)
      .slice(-6)
      .map((turn) => ({ role: turn.role, content: turn.text.slice(0, 2000) }));
    if (!options.client) return askLocally(q, turns, specs, tools.sent);

    const runnable = specs.map((t) => betaZodTool({ name: t.name, description: t.description, inputSchema: t.schema, run: t.run }));


    const messages: Anthropic.Beta.BetaMessageParam[] = [...turns, { role: 'user', content: q }];

    let costUsd = 0;
    let last: Anthropic.Beta.BetaMessage | null = null;
    const runner = options.client.beta.messages.toolRunner({
      model,
      max_tokens: 1200,
      max_iterations: 6,
      system: [{ type: 'text', text: systemPrompt(clock.now()), cache_control: { type: 'ephemeral' } }],
      tools: runnable,
      messages,
    });
    for await (const message of runner) {
      costUsd += recordUsage(db, clock, 'ask', model, message.usage);
      last = message;
    }
    const answer =
      last?.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim() ?? '';
    if (!answer) return { ...bySearch(q, 'The librarian came back empty-handed.'), costUsd };
    const known = citedIds(answer).filter((id) => drawer.get(id));
    return { answer, ids: known, mode: 'librarian', sent: tools.sent, costUsd };
  }

  /** The same conversation with a local model: its tool calls run here, up to six rounds, within one time limit. */
  async function askLocally(q: string, turns: { role: AskTurn['role']; content: string }[], specs: Tool[], sent: number[]): Promise<AskResult> {
    try {
      return await localRounds(q, turns, specs, sent, AbortSignal.timeout(options.localAskMs ?? 90_000));
    } catch (error) {
      if ((error as Error).name === 'TimeoutError' || (error as Error).name === 'AbortError') {
        return bySearch(q, 'The local model took too long to answer.');
      }
      throw error;
    }
  }

  async function localRounds(q: string, turns: { role: AskTurn['role']; content: string }[], specs: Tool[], sent: number[], signal: AbortSignal): Promise<AskResult> {
    const local = options.local!;
    const toolSpecs: ToolSpec[] = specs.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: jsonSchema(t.schema) },
    }));
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(clock.now()) },
      ...turns.map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
      { role: 'user', content: q },
    ];
    // Small local models often answer "I searched…" without calling anything, so the first search is done for them,
    // shown as their own call: they answer from real items either way, and can still search again.
    const search = specs.find((t) => t.name === 'search')!;
    const words = q.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim();
    messages.push(
      { role: 'assistant', content: null, tool_calls: [{ id: 'first-look', type: 'function', function: { name: 'search', arguments: JSON.stringify({ query: words }) } }] },
      { role: 'tool', tool_call_id: 'first-look', content: await search.run({ query: words }) },
    );
    let answer = '';
    const ROUNDS = 6;
    for (let round = 0; round < ROUNDS; round++) {
      const last = round === ROUNDS - 1;
      const reply = await local.chat({ messages, tools: last ? undefined : toolSpecs, maxTokens: 1500, signal });
      recordUsage(db, clock, 'ask', local.model, reply.usage, true);
      const calls = (reply.message.tool_calls ?? []).map((call, i) => normalCall(call, `call-${round}-${i}`));
      // Out of rounds: whatever it says is the answer, and no tool runs (sending included).
      if (!calls.length || last) {
        answer = reply.message.content ?? '';
        break;
      }
      messages.push({ role: 'assistant', content: reply.message.content, tool_calls: calls });
      for (const call of calls) {
        const spec = specs.find((t) => t.name === call.function.name);
        let result: string;
        try {
          if (!spec) throw new Error(`there is no tool called ${call.function.name || '(no name)'}`);
          const input = spec.schema.safeParse(JSON.parse(call.function.arguments || '{}'));
          result = input.success ? await spec.run(input.data) : `Bad input: ${input.error.message}`;
        } catch (error) {
          result = `That call failed: ${(error as Error).message}`;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
    }
    // Some local models think aloud in <think> tags; only the answer is kept.
    answer = stripThinking(answer);
    if (!answer) return bySearch(q, 'The librarian came back empty-handed.');
    const known = citedIds(answer).filter((id) => drawer.get(id));
    return { answer, ids: known, mode: 'librarian', sent, costUsd: 0 };
  }

  return { ask };
}

/**
 * Earlier turns the model may see. An exchange whose question or answer looks private is left out whole, so a
 * question kept on the server never reaches the API inside the next one's history. Turns alternate, owner first.
 */
export function safeHistory(history: AskTurn[]): AskTurn[] {
  const out: AskTurn[] = [];
  const flagged = (turn: AskTurn) => checkSensitivity({ text: turn.text }).sensitive;
  for (let i = 0; i < history.length; i++) {
    const turn = history[i]!;
    if (turn.role !== 'user') continue; // an answer without its question
    const reply = history[i + 1]?.role === 'assistant' ? history[i + 1]! : null;
    if (reply) i++;
    if (flagged(turn) || (reply && flagged(reply))) continue;
    out.push(turn);
    if (reply) out.push(reply);
  }
  return out.length && out.at(-1)!.role === 'user' ? out.slice(0, -1) : out;
}

/** A tool call as a local server sent it, made safe to run and to send back: a name, string arguments, an id. */
function normalCall(call: Partial<ToolCall> | null | undefined, fallbackId: string): ToolCall {
  const fn = (call?.function ?? {}) as { name?: unknown; arguments?: unknown };
  const args = typeof fn.arguments === 'string' ? fn.arguments : fn.arguments && typeof fn.arguments === 'object' ? JSON.stringify(fn.arguments) : '{}';
  return { id: typeof call?.id === 'string' && call.id ? call.id : fallbackId, type: 'function', function: { name: typeof fn.name === 'string' ? fn.name : '', arguments: args } };
}

interface Tool {
  name: string;
  description: string;
  schema: z.ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool's own input, checked by its schema
  run: (input: any) => string | Promise<string>;
}

/** One tool, typed by its schema. */
function tool<S extends z.ZodType>(t: { name: string; description: string; schema: S; run: (input: z.infer<S>) => string | Promise<string> }): Tool {
  return t;
}

export type Librarian = ReturnType<typeof createLibrarian>;
