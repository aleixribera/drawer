import { afterEach, describe, expect, it } from 'vitest';
import { createLibrarian, safeHistory } from '../src/lib/server/librarian';
import { localChat, parseJson, stripThinking } from '../src/lib/server/local';
import { createLocalModel, parseDue } from '../src/lib/server/model';
import { OWNER_TIME_ZONE, zonedToUtc } from '../src/lib/server/time';
import { fakeModel, testDrawer } from './helpers';

let cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
});

type Body = { model: string; messages: { role: string; content: unknown; tool_calls?: unknown }[]; tools?: { function: { name: string } }[]; response_format?: unknown };

/** An OpenAI-compatible server in a function: answers each request with the next scripted reply, and keeps the requests. */
function fakeServer(replies: ((body: Body) => Record<string, unknown>)[]) {
  const seen: Body[] = [];
  const doFetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Body;
    seen.push(body);
    if (!String(url).endsWith('/v1/chat/completions')) return new Response('not found', { status: 404 });
    const next = replies.shift();
    if (!next) return Response.json({ error: { message: 'no more replies' } }, { status: 500 });
    return Response.json({ choices: [{ message: next(body), finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20 } });
  }) as typeof fetch;
  return { doFetch, seen };
}

describe('a local model', () => {
  it('files an item from JSON, even wrapped in a code fence, and costs nothing', async () => {
    const t = testDrawer();
    cleanups.push(t.cleanup);
    const { doFetch, seen } = fakeServer([
      () => ({
        content:
          '```json\n{"title":"Logitech G305 mouse","summary":"A light wireless mouse.","keywords":["Mouse","g305"],"topic":null,"newTopic":"Laptop Shopping","dueAt":null}\n```',
      }),
    ]);
    const model = createLocalModel({ baseUrl: 'http://localhost:11434/v1/', model: 'qwen3.5:9b', fetch: doFetch, db: t.db, clock: t.clock });
    const out = await model.enrich({
      kind: 'link',
      text: null,
      url: 'https://example.com/g305',
      label: 'mice for laptop',
      fileName: null,
      extracted: null,
      unfurl: null,
      image: null,
      topics: [],
      hints: [],
      now: t.clock.now(),
    } as unknown as Parameters<typeof model.enrich>[0]);
    expect(out).toMatchObject({ title: 'Logitech G305 mouse', keywords: ['mouse', 'g305'], newTopic: 'Laptop Shopping' });
    expect(seen[0]!.model).toBe('qwen3.5:9b');
    expect(seen[0]!.response_format).toMatchObject({ type: 'json_schema' });
    const usage = t.db.prepare('SELECT model, cost_usd FROM usage').all() as { model: string; cost_usd: number }[];
    expect(usage).toEqual([{ model: 'qwen3.5:9b', cost_usd: 0 }]);
  });

  it('says so when the answer is not a filing', async () => {
    const t = testDrawer();
    cleanups.push(t.cleanup);
    const { doFetch } = fakeServer([() => ({ content: 'I cannot help with that.' })]);
    const model = createLocalModel({ baseUrl: 'http://x/v1', model: 'm', fetch: doFetch, db: t.db, clock: t.clock });
    await expect(model.planTopics({ topics: [], hints: [] })).rejects.toThrow(/no usable topic plan/);
  });

  it('answers questions with the drawer’s tools, private items still a bare number', async () => {
    const t = testDrawer({ model: fakeModel() });
    cleanups.push(t.cleanup);
    const mouse = t.drawer.capture({ text: 'Logitech G305 for the laptop', source: 'pc' }).item;
    const secret = t.drawer.capture({ text: 'G305 receipt, card PIN 4821', source: 'pc', private: true }).item;
    const { doFetch, seen } = fakeServer([
      () => ({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"query":"G305"}' } }] }),
      (body) => {
        const result = body.messages.at(-1)!.content as string;
        expect(result).toContain(`#${mouse.id}`);
        expect(result).not.toContain('4821');
        return { content: `<think>the first one</think>The Logitech G305 [#${mouse.id}]; there is a private one too [#${secret.id}].` };
      },
    ]);
    const librarian = createLibrarian({
      drawer: t.drawer,
      db: t.db,
      clock: t.clock,
      client: null,
      local: { chat: localChat({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3.5:9b', fetch: doFetch }), model: 'qwen3.5:9b' },
    });
    const result = await librarian.ask('which mouse did I want?');
    expect(result).toMatchObject({ mode: 'librarian', ids: [mouse.id, secret.id], costUsd: 0 });
    expect(result.answer).toBe(`The Logitech G305 [#${mouse.id}]; there is a private one too [#${secret.id}].`);
    expect(seen[0]!.tools!.map((x) => x.function.name)).toContain('search');
    expect(seen[1]!.messages.at(-1)).toMatchObject({ role: 'tool' });
  });

  it('reads JSON out of chatter around it', () => {
    expect(parseJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(parseJson('nope')).toBeNull();
  });

  it('reads a date without an offset as the owner’s local time, not UTC', () => {
    expect(parseDue('2026-12-03T17:30:00')).toBe(zonedToUtc(2026, 12, 3, 17, 30, 0).toISOString());
    if (OWNER_TIME_ZONE === 'Europe/Madrid') expect(parseDue('2026-12-03T17:30')).toBe('2026-12-03T16:30:00.000Z');
    expect(parseDue('2026-12-03T17:30:00Z')).toBe('2026-12-03T17:30:00.000Z');
    expect(parseDue('2026-12-03T17:30:00+01:00')).toBe('2026-12-03T16:30:00.000Z');
    expect(parseDue('2026-12-03')).toBe(zonedToUtc(2026, 12, 3, 0, 0, 0).toISOString());
    expect(parseDue('next tuesday')).toBeNull();
    expect(parseDue(null)).toBeNull();
  });

  it('rejects impossible dates instead of rolling them over', () => {
    expect(parseDue('2026-02-30T10:00')).toBeNull();
    expect(parseDue('2026-13-45')).toBeNull();
    expect(parseDue('2026-12-03T25:99')).toBeNull();
    expect(parseDue('2028-02-29')).not.toBeNull();
  });

  it('drops thinking out loud, closed, half-open or cut off', () => {
    expect(stripThinking('<think>hmm</think>The answer [#3]')).toBe('The answer [#3]');
    expect(stripThinking('reasoning first…</think>\nThe answer')).toBe('The answer');
    expect(stripThinking('The answer <think>and then it ran out')).toBe('The answer');
    expect(parseJson('Let me think {about} it.\n{"title":"x"}')).toEqual({ title: 'x' });
    expect(parseJson('<think>{maybe}</think>{"a":2}')).toEqual({ a: 2 });
  });

  it('never lets a private earlier question ride along in the history', () => {
    const history = [
      { role: 'user' as const, text: 'what is the wifi password: hunter22' },
      { role: 'assistant' as const, text: 'That question looks like it holds something private.' },
      { role: 'user' as const, text: 'which mouse did I want?' },
      { role: 'assistant' as const, text: 'The G305 [#1].' },
      { role: 'assistant' as const, text: 'a stray answer' },
      { role: 'user' as const, text: 'a question with no answer yet' },
    ];
    expect(safeHistory(history)).toEqual([
      { role: 'user', text: 'which mouse did I want?' },
      { role: 'assistant', text: 'The G305 [#1].' },
    ]);
  });

  it('survives malformed tool calls and runs nothing on the last round', async () => {
    const t = testDrawer({ model: fakeModel() });
    cleanups.push(t.cleanup);
    const mouse = t.drawer.capture({ text: 'Logitech G305 for the laptop', source: 'pc' }).item;
    const odd = [
      { function: { name: 'read', arguments: { id: String(mouse.id) } } }, // no id, object arguments, a number as text
      { id: 'x', type: 'function' }, // no function at all
      { id: 'y', type: 'function', function: { name: 'shred', arguments: '{}' } },
    ];
    const send = { id: 's', type: 'function', function: { name: 'send_to_device', arguments: JSON.stringify({ id: mouse.id, device: 'iphone' }) } };
    const { doFetch, seen } = fakeServer([
      () => ({ content: null, tool_calls: odd }),
      ...Array.from({ length: 5 }, () => () => ({ content: 'still looking', tool_calls: [send] })),
    ]);
    const librarian = createLibrarian({
      drawer: t.drawer,
      db: t.db,
      clock: t.clock,
      client: null,
      local: { chat: localChat({ baseUrl: 'http://localhost:11434/v1', model: 'm', fetch: doFetch }), model: 'm' },
    });
    const result = await librarian.ask('the mouse', [
      { role: 'user', text: 'my card PIN 4821 is what?' },
      { role: 'assistant', text: 'It stayed on the server.' },
    ]);
    const results = seen[1]!.messages.filter((m) => m.role === 'tool').slice(-3) as unknown as { content: string; tool_call_id: string }[];
    expect(results[0]!.content).toContain('G305');
    expect(results[0]!.tool_call_id).toBe('call-0-0');
    expect(results[1]!.content).toMatch(/no tool called \(no name\)/);
    expect(results[2]!.content).toMatch(/no tool called shred/);
    expect(JSON.stringify(seen[0]!.messages)).not.toContain('4821');
    expect(seen).toHaveLength(6);
    expect(seen[5]!.tools).toBeUndefined();
    // Four sends ran in rounds 1–4; the last round's call did not.
    expect(result.sent.length).toBe(4);
    expect(result.answer).toBe('still looking');
  });

  it('gives up on a slow local model and answers by search', async () => {
    const t = testDrawer({ model: fakeModel() });
    cleanups.push(t.cleanup);
    t.drawer.capture({ text: 'Logitech G305 for the laptop', source: 'pc' });
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
    const librarian = createLibrarian({
      drawer: t.drawer,
      db: t.db,
      clock: t.clock,
      client: null,
      localAskMs: 50,
      local: { chat: localChat({ baseUrl: 'http://x/v1', model: 'm', fetch: slow }), model: 'm' },
    });
    const result = await librarian.ask('G305');
    expect(result.mode).toBe('search');
    expect(result.answer).toMatch(/took too long/);
    expect(result.ids).toHaveLength(1);
  });
});
