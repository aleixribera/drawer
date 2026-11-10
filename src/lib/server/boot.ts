import Anthropic from '@anthropic-ai/sdk';
import { join, resolve } from 'node:path';
import { openDatabase } from './db';
import { createDrawer, type Drawer } from './drawer';
import { createExtractors } from './extractors';
import { createFileStore } from './files';
import { createLibrarian, type Librarian } from './librarian';
import { localChat } from './local';
import { createHaikuModel, createLocalModel } from './model';
import { systemClock } from './time';
import type { Extractors } from './types';

/** Builds the real Drawer from the environment. Shared by the server and the scripts. */
export interface BootOptions {
  dataDir?: string;
  apiKey?: string | null;
  whisperUrl?: string | null;
  spendCapUsd?: number;
  useModel?: boolean;
  /** A model on your own machine instead of the API (see local.ts). */
  local?: { url?: string | null; model?: string | null; apiKey?: string | null; vision?: boolean } | null;
  log?: (message: string) => void;
}

export function bootDrawer(options: BootOptions = {}): { drawer: Drawer; librarian: Librarian; extractors: Extractors; dataDir: string } {
  const env = process.env;
  const dataDir = resolve(options.dataDir ?? env.DRAWER_DATA ?? 'data');
  const db = openDatabase(join(dataDir, 'drawer.db'));
  const files = createFileStore(dataDir);
  const log = options.log ?? ((m: string) => console.log(`[drawer] ${m}`));
  const apiKey = options.apiKey === undefined ? (env.ANTHROPIC_API_KEY ?? null) : options.apiKey;
  const useModel = options.useModel ?? true;
  const client = useModel && apiKey ? new Anthropic({ apiKey, maxRetries: 3, timeout: 60_000 }) : null;
  // Without an API key, a local model if one is named: DRAWER_LOCAL_MODEL, served at DRAWER_LOCAL_URL.
  const localName = options.local === undefined ? (env.DRAWER_LOCAL_MODEL ?? null) : (options.local?.model ?? null);
  const localSetup =
    useModel && !client && localName
      ? {
          baseUrl: (options.local?.url ?? env.DRAWER_LOCAL_URL) || 'http://localhost:11434/v1',
          model: localName,
          apiKey: options.local?.apiKey ?? env.DRAWER_LOCAL_KEY ?? null,
          vision: options.local?.vision ?? env.DRAWER_LOCAL_VISION === '1',
        }
      : null;
  const model = client && apiKey
    ? createHaikuModel({ apiKey, db, clock: systemClock, client })
    : localSetup
      ? createLocalModel({ ...localSetup, db, clock: systemClock })
      : null;
  const extractors = createExtractors({ whisperUrl: options.whisperUrl ?? env.WHISPER_URL ?? null, log });
  const drawer = createDrawer({
    db,
    files,
    clock: systemClock,
    model,
    extractors,
    spendCapUsd: options.spendCapUsd ?? Number(env.DRAWER_SPEND_CAP_USD ?? 10),
    log,
  });
  const local = localSetup ? { chat: localChat(localSetup), model: localSetup.model } : null;
  const librarian = createLibrarian({ drawer, db, clock: systemClock, client, local });
  if (localSetup) log(`using the local model ${localSetup.model} at ${localSetup.baseUrl}`);
  return { drawer, librarian, extractors, dataDir };
}
