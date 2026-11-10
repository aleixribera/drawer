import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/lib/server/db';
import { createDrawer, type DrawerOptions } from '../src/lib/server/drawer';
import { createFileStore } from '../src/lib/server/files';
import { fixedClock } from '../src/lib/server/time';
import type { EnrichRequest, EnrichResult, Extractors, Model, TopicPlan, TopicPlanRequest } from '../src/lib/server/types';

/** Local tools for tests: a test file's bytes are its text, so "OCR" of a fake photo is whatever the test wrote in it. */
export function fakeExtractors(): Extractors & { unfurled: string[] } {
  const byName = (path: string) => readFileSync(path, 'utf8');
  const unfurled: string[] = [];
  return {
    unfurled,
    pdf: async (path) => ({ text: byName(path), pages: 1 }),
    ocr: async (path) => byName(path),
    transcribe: async (path) => byName(path),
    unfurl: async (url) => {
      unfurled.push(url);
      return { title: `Page at ${new URL(url).hostname}` };
    },
    thumbnail: async () => false,
    picture: async () => false,
    shrink: async () => null,
  };
}

/** A model that files by rules the test gives, and records every request it saw. */
export function fakeModel(
  file: (request: EnrichRequest) => Partial<EnrichResult> = () => ({}),
  plan: (request: TopicPlanRequest) => TopicPlan = (r) => ({ topics: r.hints.map((h) => ({ name: h.hint, hints: [h.hint] })) }),
): Model & { seen: EnrichRequest[]; plans: TopicPlanRequest[] } {
  const seen: EnrichRequest[] = [];
  const plans: TopicPlanRequest[] = [];
  return {
    name: 'fake',
    seen,
    plans,
    async enrich(request) {
      seen.push(request);
      const base = request.label ?? request.text ?? request.fileName ?? request.url ?? 'item';
      return {
        title: base.split('\n')[0]!.slice(0, 60),
        summary: `About ${base.slice(0, 40)}`,
        keywords: [],
        topic: null,
        newTopic: null,
        dueAt: null,
        ...file(request),
      };
    },
    async planTopics(request) {
      plans.push(request);
      return plan(request);
    },
  };
}

export function testDrawer(overrides: Partial<DrawerOptions> & { start?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'drawer-test-'));
  const db = openDatabase(':memory:');
  const files = createFileStore(dir);
  const clock = fixedClock(overrides.start ?? '2026-11-10T10:00:00Z');
  const drawer = createDrawer({ db, files, clock, extractors: fakeExtractors(), model: null, ...overrides });
  return { drawer, db, files, clock, dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
