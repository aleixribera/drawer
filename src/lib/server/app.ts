import { env } from '$env/dynamic/private';
import { bootDrawer } from './boot';
import type { Drawer } from './drawer';
import type { Librarian } from './librarian';
import { createPush, vapidKeys, vapidSubject, webPushSender, type Push } from './push';
import type { Extractors } from './types';

/**
 * The one Drawer the server runs, started on first use: it opens the database, starts the enrichment worker and the
 * hourly housekeeping. Kept on globalThis so a dev-server reload doesn't start a second worker.
 */

interface Running {
  drawer: Drawer;
  librarian: Librarian;
  extractors: Extractors;
  dataDir: string;
  push: Push;
  stop: () => void;
}

const KEY = Symbol.for('drawer.app');
const store = globalThis as unknown as Record<symbol, Running | undefined>;

export function app(): Running {
  let running = store[KEY];
  if (!running) {
    const { drawer, librarian, extractors, dataDir } = bootDrawer({
      dataDir: env.DRAWER_DATA,
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      whisperUrl: env.WHISPER_URL ?? null,
      spendCapUsd: env.DRAWER_SPEND_CAP_USD ? Number(env.DRAWER_SPEND_CAP_USD) : undefined,
      useModel: env.DRAWER_NO_MODEL !== '1',
    });
    let keys: { publicKey: string; privateKey: string } | null = null;
    try {
      keys = vapidKeys(dataDir, { publicKey: env.DRAWER_VAPID_PUBLIC, privateKey: env.DRAWER_VAPID_PRIVATE });
    } catch (error) {
      console.warn(`[drawer] push is off: ${(error as Error).message}`);
    }
    const push = createPush({
      db: drawer.db,
      publicKey: keys?.publicKey ?? null,
      clock: drawer.clock,
      send: keys ? webPushSender(keys.publicKey, keys.privateKey, vapidSubject(env.DRAWER_VAPID_SUBJECT, env.ORIGIN)) : null,
      log: (m) => console.warn(`[drawer] ${m}`),
    });
    const stopPush = drawer.events.subscribe(push.onEvent);
    const stopWorker = env.DRAWER_NO_WORKER === '1' ? () => {} : drawer.startWorker();
    const housekeeping = setInterval(() => {
      try {
        drawer.maintain();
        if (drawer.modelAvailable()) drawer.retryFailed();
      } catch (error) {
        console.error('[drawer] housekeeping', error);
      }
    }, 60 * 60_000);
    housekeeping.unref();
    running = {
      drawer,
      librarian,
      extractors,
      dataDir,
      push,
      stop: () => {
        stopPush();
        stopWorker();
        clearInterval(housekeeping);
      },
    };
    store[KEY] = running;
  }
  return running;
}

export const drawer = (): Drawer => app().drawer;
