import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { toCard } from '../src/lib/server/cards';
import { createDrawer } from '../src/lib/server/drawer';
import { DAY } from '../src/lib/server/time';
import { fakeExtractors, fakeModel, testDrawer } from './helpers';

const bytes = (text: string) => new TextEncoder().encode(text);
let cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.forEach((c) => c());
  cleanups = [];
});
function setup(options: Parameters<typeof testDrawer>[0] = {}) {
  const t = testDrawer(options);
  cleanups.push(t.cleanup);
  return t;
}
const at = (iso: string) => new Date(iso);

describe('capture', () => {
  it('tells notes, links, videos and files apart', () => {
    const { drawer } = setup();
    expect(drawer.capture({ text: 'buy filament', source: 'pc' }).item.kind).toBe('note');
    expect(drawer.capture({ text: 'https://example.com/a', source: 'pc' }).item.kind).toBe('link');
    expect(drawer.capture({ text: 'https://youtu.be/dQw4w9WgXcQ', source: 'pc' }).item.kind).toBe('video');
    expect(drawer.capture({ file: { name: 'shot.jpg', bytes: bytes('x') }, source: 'pc' }).item.kind).toBe('image');
    expect(drawer.capture({ file: { name: '00000019-GEI_1r1rSem.pdf', bytes: bytes('y') }, source: 'pc' }).item.file?.name).toBe(
      'GEI_1r1rSem.pdf',
    );
  });

  it('keeps a long share-sheet preamble as the note on a link', () => {
    const { drawer } = setup();
    const item = drawer.capture({
      text: 'Check out this long thing I found while reading about mechanical keyboards and switches, worth a look later on - https://example.com/kb',
      source: 'iphone',
    }).item;
    expect(item.kind).toBe('link');
    expect(item.url).toBe('https://example.com/kb');
    expect(item.meta.note).toMatch(/^Check out this long thing/);
  });

  it('refuses an empty capture', () => {
    const { drawer } = setup();
    expect(() => drawer.capture({ text: '   ', source: 'pc' })).toThrow();
  });
});

describe('labels', () => {
  it('a short text right after a link from the same device becomes its label', () => {
    const { drawer } = setup();
    const reel = drawer.capture({ text: 'https://www.instagram.com/reel/ABC123/?igsh=xyz', source: 'iphone', at: at('2026-11-01T10:00:00Z') }).item;
    const result = drawer.capture({ text: 'claude limits trick', source: 'iphone', at: at('2026-11-01T10:00:40Z') });
    expect(result.outcome).toBe('labelled');
    expect(drawer.get(reel.id)!.label).toBe('claude limits trick');
    expect(drawer.recent()).toHaveLength(1);
  });

  it('a short text right before a link labels it too, and does not stay as a note', () => {
    const { drawer } = setup();
    drawer.capture({ text: 'fin claude limits', source: 'whatsapp:You', at: at('2026-11-01T10:00:00Z') });
    const reel = drawer.capture({ text: 'https://www.instagram.com/reel/XYZ/', source: 'whatsapp:You', at: at('2026-11-01T10:00:01Z') }).item;
    expect(reel.label).toBe('fin claude limits');
    expect(drawer.recent().map((i) => i.id)).toEqual([reel.id]);
  });

  it('does not pair across devices, after the window, or onto a note', () => {
    const { drawer } = setup();
    drawer.capture({ text: 'https://example.com/one', source: 'pc', at: at('2026-11-01T10:00:00Z') });
    expect(drawer.capture({ text: 'from the phone', source: 'iphone', at: at('2026-11-01T10:00:10Z') }).outcome).toBe('created');
    expect(drawer.capture({ text: 'much later', source: 'pc', at: at('2026-11-01T10:10:00Z') }).outcome).toBe('created');
    expect(drawer.capture({ text: 'and a third', source: 'pc', at: at('2026-11-01T10:10:30Z') }).outcome).toBe('created');
    expect(drawer.recent()).toHaveLength(4);
  });

  it('importing the same chat twice adds nothing', () => {
    const { drawer } = setup();
    const chat = () => {
      drawer.capture({ text: 'https://www.instagram.com/reel/AAA/', source: 'whatsapp:You', at: at('2026-11-01T10:00:00Z') });
      drawer.capture({ text: 'label after', source: 'whatsapp:You', at: at('2026-11-01T10:00:30Z') });
      drawer.capture({ text: 'label before', source: 'whatsapp:You', at: at('2026-11-01T11:00:00Z') });
      drawer.capture({ text: 'https://www.instagram.com/reel/BBB/', source: 'whatsapp:You', at: at('2026-11-01T11:00:01Z') });
    };
    chat();
    const first = drawer.recent().map((i) => [i.url, i.label]);
    chat();
    expect(drawer.recent().map((i) => [i.url, i.label])).toEqual(first);
    expect(first).toEqual([
      ['https://www.instagram.com/reel/BBB/', 'label before'],
      ['https://www.instagram.com/reel/AAA/', 'label after'],
    ]);
  });

  it('a caption on a photo is its label', () => {
    const { drawer } = setup();
    const item = drawer.capture({ text: 'cargo rocket setup', file: { name: 'a.jpg', bytes: bytes('img') }, source: 'pc' }).item;
    expect(item.label).toBe('cargo rocket setup');
    expect(item.title).toBe('cargo rocket setup');
  });
});

describe('duplicates', () => {
  it('the same link again bumps the item instead of storing a copy', () => {
    const { drawer, clock } = setup();
    const first = drawer.capture({ text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', source: 'pc' }).item;
    clock.advance(40 * DAY);
    const again = drawer.capture({ text: 'https://youtu.be/dQw4w9WgXcQ?si=share', source: 'iphone' });
    expect(again.outcome).toBe('bumped');
    expect(again.item.id).toBe(first.id);
    expect(again.item.touchedAt).toBe(clock.now().toISOString());
    expect(again.item.freshness).toBe('fresh');
  });

  it('the same file twice is one item; a deleted one comes back', () => {
    const { drawer } = setup();
    const first = drawer.capture({ file: { name: 'a.pdf', bytes: bytes('same') }, source: 'pc' }).item;
    drawer.remove(first.id);
    const again = drawer.capture({ file: { name: 'copy.pdf', bytes: bytes('same') }, source: 'pc' });
    expect(again.outcome).toBe('bumped');
    expect(drawer.get(first.id)).not.toBeNull();
  });

  it('transit items are never merged', () => {
    const { drawer } = setup();
    drawer.capture({ text: 'https://example.com/x', source: 'pc' });
    const sent = drawer.capture({ text: 'https://example.com/x', source: 'pc', lane: 'transit', target: 'iphone' });
    expect(sent.outcome).toBe('created');
    expect(sent.item.lane).toBe('transit');
  });
});

describe('freshness and the recent page', () => {
  it('newest first; old items fade unless pinned; opening refreshes', () => {
    const { drawer, clock } = setup({ start: '2024-01-01T10:00:00Z' });
    const guide = drawer.capture({ text: 'old game guide', source: 'pc' }).item;
    clock.advance(60_000);
    const pinned = drawer.capture({ text: 'wifi at the flat is on the router', source: 'pc' }).item;
    drawer.pin(pinned.id, true);
    clock.set('2026-11-10T10:00:00Z');
    const fresh = drawer.capture({ text: 'today', source: 'pc' }).item;
    expect(drawer.get(guide.id)!.freshness).toBe('faded');
    expect(drawer.get(pinned.id)!.freshness).toBe('recent');
    expect(drawer.recent().map((i) => i.id)).toEqual([fresh.id, pinned.id, guide.id]);
    clock.advance(60_000);
    drawer.open(guide.id);
    expect(drawer.get(guide.id)!.freshness).toBe('fresh');
    expect(drawer.recent()[0]!.id).toBe(guide.id);
  });
});

describe('search', () => {
  it('finds the singular when asked in the plural, in English, Spanish and Catalan', () => {
    const { drawer } = setup();
    const laptop = drawer.capture({ text: 'ThinkPad laptop with 32 GB', source: 'pc' }).item;
    const portatil = drawer.capture({ text: 'portàtil per a la uni', source: 'pc' }).item;
    const recipe = drawer.capture({ text: 'mixing recipe for the cuke', source: 'pc' }).item;
    expect(drawer.search('laptops').map((h) => h.item.id)).toEqual([laptop.id]);
    expect(drawer.search('portàtils').map((h) => h.item.id)).toEqual([portatil.id]);
    expect(drawer.search('recipes cuke').map((h) => h.item.id)).toEqual([recipe.id]);
  });

  it('matches across text and extracted text, without accents, newer first among equals', async () => {
    const { drawer, clock } = setup({ start: '2025-01-01T10:00:00Z' });
    const old = drawer.capture({ text: 'Horari de classes del primer quadrimestre', source: 'pc' }).item;
    clock.set('2026-11-01T10:00:00Z');
    const pdf = drawer.capture({ file: { name: 'GEI_1r1rSem.pdf', bytes: bytes('Horari: Dilluns Càlcul, Dimarts Física') }, source: 'pc' }).item;
    await drawer.enrichPending();
    expect(drawer.search('horari').map((h) => h.item.id)).toEqual([pdf.id, old.id]);
    expect(drawer.search('fisica')[0]!.item.id).toBe(pdf.id);
    expect(drawer.search('calcul')[0]!.item.id).toBe(pdf.id);
  });

  it('a strong old match beats a weak new one, and the OR fallback finds partial matches', () => {
    const { drawer, clock } = setup({ start: '2025-06-01T10:00:00Z' });
    const guide = drawer.capture({ text: 'Factorio cargo rocket guide', source: 'pc' }).item;
    clock.set('2026-11-01T10:00:00Z');
    drawer.capture({ text: 'rocket emoji idea', source: 'pc' });
    expect(drawer.search('factorio rocket')[0]!.item.id).toBe(guide.id);
    expect(drawer.search('factorio spaceship').length).toBeGreaterThan(0);
  });

  it('finds links by host and prefix', () => {
    const { drawer } = setup();
    const link = drawer.capture({ text: 'https://www.pccomponentes.com/logitech-g305', source: 'pc' }).item;
    expect(drawer.search('pccomp')[0]!.item.id).toBe(link.id);
    expect(drawer.search('logitech')[0]!.item.id).toBe(link.id);
  });

  it('never returns deleted items', () => {
    const { drawer } = setup();
    const item = drawer.capture({ text: 'secret plan for the trip', source: 'pc' }).item;
    drawer.remove(item.id);
    expect(drawer.search('trip')).toEqual([]);
  });
});

describe('enrichment and the privacy gate', () => {
  it('files with the model and stores title, summary, keywords and a topic hint', async () => {
    const model = fakeModel(() => ({ title: 'Filament to buy', keywords: ['pla', 'filamento'], newTopic: '3D Printing' }));
    const { drawer } = setup({ model });
    const item = drawer.capture({ text: 'buy filament', source: 'pc' }).item;
    await drawer.enrichPending();
    const done = drawer.get(item.id)!;
    expect(done.enrichState).toBe('done');
    expect(done.title).toBe('Filament to buy');
    expect(done.topicHint).toBe('3D Printing');
    expect(drawer.search('filamento')[0]!.item.id).toBe(item.id);
  });

  it('never sends a sensitive item to the model, even when the secret is only inside the file', async () => {
    const model = fakeModel();
    const { drawer } = setup({ model });
    const code = drawer.capture({ text: 'office key 4XK7M-QP2RT-9WZ8B', source: 'pc' }).item;
    const scan = drawer.capture({ file: { name: 'scan.jpg', bytes: bytes('IBAN ES91 2100 0418 4502 0005 1332') }, source: 'pc' }).item;
    const permit = drawer.capture({ file: { name: 'autorizacion.pdf', bytes: bytes('nothing') }, source: 'pc' }).item;
    const plain = drawer.capture({ text: 'buy filament', source: 'iphone' }).item;
    await drawer.enrichPending();
    expect(model.seen.map((r) => r.text)).toEqual(['buy filament']);
    for (const id of [code.id, scan.id, permit.id]) {
      const item = drawer.get(id)!;
      expect(item.private).toBe(true);
      expect(item.enrichState).toBe('local');
      expect(item.topic?.name).toBe('Private');
    }
    expect(drawer.get(plain.id)!.private).toBe(false);
  });

  it('an item the owner marked private stays local; unmarking sends it to the model', async () => {
    const model = fakeModel();
    const { drawer } = setup({ model });
    const item = drawer.capture({ text: 'gift idea for mum', source: 'pc', private: true }).item;
    await drawer.enrichPending();
    expect(model.seen).toHaveLength(0);
    drawer.setPrivate(item.id, false);
    await drawer.enrichPending();
    expect(model.seen).toHaveLength(1);
  });

  it('does not unfurl private hosts or sensitive links', async () => {
    const extractors = fakeExtractors();
    const { drawer } = setup({ extractors });
    drawer.capture({ text: 'https://box.tailnet.ts.net/admin', source: 'pc' });
    drawer.capture({ text: 'http://192.168.1.20:8080', source: 'pc' });
    drawer.capture({ text: 'https://pair.example.app/connect#token=Zx81Qa77Kp', source: 'pc' });
    drawer.capture({ text: 'https://example.com/fine', source: 'pc' });
    await drawer.enrichPending();
    expect(extractors.unfurled).toEqual(['https://example.com/fine']);
  });

  it('copies a link picture home once, and serves it from the drawer', async () => {
    const extractors = fakeExtractors();
    const fetched: string[] = [];
    extractors.unfurl = async (url) => ({ title: 'A reel', image: `https://cdn.example.net/${new URL(url).pathname.slice(1)}.jpg` });
    extractors.picture = async (url, out) => {
      fetched.push(url);
      writeFileSync(out, 'webp');
      return true;
    };
    const { drawer } = setup({ extractors });
    const reel = drawer.capture({ text: 'https://www.instagram.com/reel/abc', source: 'iphone' }).item;
    const hidden = drawer.capture({ text: 'https://example.com/mine', source: 'pc', private: true }).item;
    await drawer.enrichPending();
    const item = drawer.get(reel.id)!;
    expect(fetched).toEqual(['https://cdn.example.net/reel/abc.jpg']);
    expect(item.meta.linkThumb).toMatch(/^[0-9a-f]{64}$/);
    expect(drawer.thumbOf(item)).toBeTruthy();
    expect(toCard(item).picture).toBe(`/thumb/${reel.id}?v=${item.meta.linkThumb!.slice(0, 8)}`);
    expect(toCard(drawer.get(hidden.id)!).picture).toBeNull();
  });

  it('runs local-only over the monthly cap, and marks failures for retry', async () => {
    let fail = true;
    const model = fakeModel(() => {
      if (fail) throw new Error('overloaded');
      return {};
    });
    const { drawer, db } = setup({ model, spendCapUsd: 1 });
    const item = drawer.capture({ text: 'note one', source: 'pc' }).item;
    await drawer.enrichPending();
    expect(drawer.get(item.id)!.enrichState).toBe('failed');
    fail = false;
    drawer.retryFailed();
    await drawer.enrichPending();
    expect(drawer.get(item.id)!.enrichState).toBe('done');
    db.prepare("INSERT INTO usage (at, purpose, model, input_tokens, output_tokens, cost_usd) VALUES (?, 'enrich', 'x', 0, 0, 2)").run(
      drawer.clock.now().toISOString(),
    );
    const second = drawer.capture({ text: 'note two', source: 'pc' }).item;
    await drawer.enrichPending();
    expect(drawer.get(second.id)!.enrichState).toBe('local');
  });
});

describe('topics', () => {
  it('three loose items with the same hint become a topic; later ones join it', async () => {
    const model = fakeModel((r) =>
      /factorio/i.test(r.text ?? '') ? (r.topics.includes('Factorio') ? { topic: 'Factorio' } : { newTopic: 'Factorio' }) : {},
    );
    const { drawer } = setup({ model });
    drawer.capture({ text: 'factorio: oil setup', source: 'pc' });
    drawer.capture({ text: 'factorio: train signals', source: 'pc' });
    await drawer.enrichPending();
    expect(drawer.topics()).toEqual([]);
    drawer.capture({ text: 'factorio: rocket', source: 'pc' });
    await drawer.enrichPending();
    const [topic] = drawer.topics();
    expect(topic).toMatchObject({ name: 'Factorio', count: 3, dormant: false });
    const later = drawer.capture({ text: 'factorio: quality modules', source: 'pc' }).item;
    await drawer.enrichPending();
    expect(drawer.get(later.id)!.topic?.name).toBe('Factorio');
  });

  it('planTopics folds the hints into the planned topics and never makes a Private topic', async () => {
    const model = fakeModel(
      (r) => ({ newTopic: r.text!.split(':')[0]! }),
      () => ({ topics: [{ name: 'Games', hints: ['factorio', 'schedule 1'] }, { name: 'Private', hints: ['laptops'] }] }),
    );
    const { drawer } = setup({ model });
    for (const text of ['factorio: a', 'schedule 1: b', 'laptops: c']) drawer.capture({ text, source: 'pc' });
    await drawer.enrichPending();
    await drawer.planTopics();
    expect(drawer.topics().map((t) => [t.name, t.count])).toEqual([['Games', 2]]);
  });

  it('a topic with nothing new for three months is dormant; renaming onto an existing name merges', () => {
    const { drawer, clock } = setup({ start: '2026-01-01T10:00:00Z' });
    const a = drawer.capture({ text: 'mouse options', source: 'pc' }).item;
    drawer.setTopic(a.id, 'Mice');
    const b = drawer.capture({ text: 'laptop options', source: 'pc' }).item;
    drawer.setTopic(b.id, 'Laptops');
    clock.set('2026-06-01T10:00:00Z');
    expect(drawer.topics().every((t) => t.dormant)).toBe(true);
    drawer.renameTopic(drawer.topics().find((t) => t.name === 'Mice')!.id, 'laptops');
    expect(drawer.topics().map((t) => [t.name, t.count])).toEqual([['Laptops', 2]]);
  });
});

describe('transit', () => {
  it('shows for a day, keeps on request, and is deleted after a week', () => {
    const { drawer, clock } = setup();
    const sent = drawer.capture({ text: 'https://example.com/slides.pdf', source: 'pc', lane: 'transit', target: 'iphone' }).item;
    const other = drawer.capture({ text: 'for the laptop', source: 'pc', lane: 'transit', target: 'fedora' }).item;
    expect(drawer.transit('iphone').map((i) => i.id)).toEqual([sent.id]);
    expect(drawer.recent()).toEqual([]);
    clock.advance(2 * DAY);
    expect(drawer.transit('iphone')).toEqual([]);
    drawer.keep(other.id);
    expect(drawer.recent().map((i) => i.id)).toEqual([other.id]);
    clock.advance(6 * DAY);
    expect(drawer.maintain().transitDeleted).toBe(1);
    expect(drawer.get(sent.id, { includeDeleted: true })).toBeNull();
    expect(drawer.get(other.id)).not.toBeNull();
  });
});

describe('catching up', () => {
  it('reads what was kept while the model was away, once it is back, and never the private things', async () => {
    const first = setup();
    const { item } = first.drawer.capture({ text: 'Ryzen 7 laptops to compare for uni', source: 'pc' });
    const { item: secret } = first.drawer.capture({ text: 'the code for the bike lock', source: 'pc', private: true });
    await first.drawer.enrichPending();
    expect(first.drawer.get(item.id)!.enrichState).toBe('local');

    const model = fakeModel(() => ({ title: 'Laptops for uni' }));
    const again = createDrawer({ db: first.db, files: first.files, clock: first.clock, extractors: fakeExtractors(), model });
    expect(again.catchUp()).toBe(1);
    await again.enrichPending();
    expect(again.get(item.id)).toMatchObject({ enrichState: 'done', title: 'Laptops for uni' });
    expect(again.get(secret.id)!.enrichState).toBe('local');
    expect(model.seen.map((r) => r.text)).toEqual(['Ryzen 7 laptops to compare for uni']);
    expect(again.catchUp()).toBe(0);
  });
});
