import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { citedIds, createLibrarian, describeItem, librarianTools } from '../src/lib/server/librarian';
import { fakeModel, testDrawer } from './helpers';

let cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
});

function setup(withModel = true) {
  const t = testDrawer(withModel ? { model: fakeModel() } : {});
  cleanups.push(t.cleanup);
  return t;
}

interface FakeTool {
  name: string;
  run: (input: unknown) => Promise<unknown> | unknown;
}

/**
 * Stands in for client.beta.messages.toolRunner: plays a script of tool calls against the real tools, then answers
 * with whatever the script makes of their results. Records what the model would have been shown.
 */
function fakeClient(script: (call: (name: string, input: unknown) => Promise<string>) => Promise<string>) {
  const shown: string[] = [];
  const client = {
    beta: {
      messages: {
        toolRunner(params: { tools: FakeTool[]; messages: { content: string }[]; system: { text: string }[] }) {
          shown.push(params.system.map((s) => s.text).join('\n'), ...params.messages.map((m) => String(m.content)));
          const call = async (name: string, input: unknown) => {
            const tool = params.tools.find((t) => t.name === name);
            if (!tool) throw new Error(`no tool ${name}`);
            const out = String(await tool.run(input));
            shown.push(out);
            return out;
          };
          return (async function* () {
            const text = await script(call);
            yield {
              content: [{ type: 'text', text }],
              usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0 },
              stop_reason: 'end_turn',
            };
          })();
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, shown };
}

describe('librarian tools', () => {
  it('show a private item as a bare number, in search, recent and read', () => {
    const { drawer, clock } = setup(false);
    const secret = drawer.capture({ text: 'bank login pin 4821 for the uni card', source: 'pc', private: true }).item;
    const plain = drawer.capture({ text: 'uni card office opens at 9', source: 'pc' }).item;
    const tools = librarianTools(drawer, clock, 'web');
    for (const out of [tools.search({ query: 'uni card' }), tools.recent({ days: 1 }), tools.read({ id: secret.id })]) {
      expect(out).toContain(`#${secret.id} · private`);
      expect(out).not.toContain('4821');
      expect(out).not.toContain('bank login');
    }
    expect(tools.search({ query: 'uni card' })).toContain('opens at 9');
    expect(describeItem(drawer.get(plain.id)!)).toContain(`#${plain.id}`);
  });

  it('sends an item to a device and reports it', () => {
    const { drawer, clock } = setup(false);
    const pdf = drawer.capture({ text: 'timetable https://example.com/horari.pdf', source: 'pc' }).item;
    const tools = librarianTools(drawer, clock, 'iphone');
    expect(tools.send({ id: pdf.id, device: 'fedora' })).toContain('Sent');
    expect(drawer.transit('fedora')).toHaveLength(1);
    expect(tools.sent).toHaveLength(1);
    expect(tools.send({ id: 9999, device: 'pc' })).toContain('no item');
  });

  it('reads item numbers out of an answer, once each, in order', () => {
    expect(citedIds('The G305 [#12] beat the Viper [#7]; see also #12 and [#40].')).toEqual([12, 7, 40]);
    expect(citedIds('No items here, 2026 is a year.')).toEqual([]);
  });
});

describe('ask', () => {
  it('answers with the librarian, citing real items only, and logs the cost', async () => {
    const { drawer, db, clock } = setup();
    const mouse = drawer.capture({ text: 'logitech g305 wireless mouse for the laptop', source: 'pc' }).item;
    const { client, shown } = fakeClient(async (call) => {
      const found = await call('search', { query: 'mouse' });
      expect(found).toContain(`#${mouse.id}`);
      return `You saved the Logitech G305 [#${mouse.id}]. Not to be confused with [#99999].`;
    });
    const librarian = createLibrarian({ drawer, db, clock, client });
    const result = await librarian.ask('which mouse did I want for the laptop?');
    expect(result.mode).toBe('librarian');
    expect(result.ids).toEqual([mouse.id]);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(shown.join('\n')).toContain('which mouse did I want');
    const logged = db.prepare("SELECT COUNT(*) AS n FROM usage WHERE purpose = 'ask'").get() as { n: number };
    expect(logged.n).toBe(1);
  });

  it('keeps a sensitive question on the server and answers by search', async () => {
    const { drawer, db, clock } = setup();
    drawer.capture({ text: 'rent transfer details', source: 'pc' });
    const { client, shown } = fakeClient(async () => 'should not be called');
    const librarian = createLibrarian({ drawer, db, clock, client });
    const result = await librarian.ask('where did I save IBAN ES91 2100 0418 4502 0005 1332');
    expect(result.mode).toBe('search');
    expect(shown).toHaveLength(0);
    expect(result.answer).toMatch(/private/i);
  });

  it('falls back to search when there is no model', async () => {
    const { drawer, db, clock } = setup(false);
    const note = drawer.capture({ text: 'ramen place near sants station', source: 'pc' }).item;
    const librarian = createLibrarian({ drawer, db, clock, client: null });
    const result = await librarian.ask('ramen');
    expect(result.mode).toBe('search');
    expect(result.ids).toEqual([note.id]);
  });
});
