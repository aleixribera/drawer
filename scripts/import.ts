/**
 * Imports WhatsApp self-chat exports into Drawer.
 *
 *   npm run import -- import/media-self import/media-notes            # import, enrich with the model if a key is set
 *   npm run import -- --no-model import/media-self                     # local titles only
 *   npm run import -- --data /srv/drawer import/media-self             # into another data folder
 *
 * Each folder is one unzipped export (`_chat.txt` plus its media). The chat's name comes from the folder unless
 * `--chat NAME` is given. Running it twice is safe: the same links, files and notes bump instead of duplicating.
 * Prints counts only, never the content.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { bootDrawer } from '../src/lib/server/boot';
import { parseWhatsAppChat } from '../src/lib/server/import/whatsapp';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};

const noModel = flag('--no-model');
const dataDir = option('--data');
const chatName = option('--chat');
const folders = args;
if (!folders.length) {
  console.error('usage: npm run import -- [--no-model] [--data DIR] [--chat NAME] EXPORT_FOLDER...');
  process.exit(1);
}

const { drawer, dataDir: usedData } = bootDrawer({ dataDir, useModel: !noModel, log: () => {} });
const counts: Record<string, number> = {};
const bump = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);

for (const folder of folders) {
  const chatFile = join(folder, '_chat.txt');
  if (!existsSync(chatFile)) {
    console.error(`no _chat.txt in ${folder}`);
    process.exit(1);
  }
  const name = chatName ?? guessChat(folder);
  const source = `whatsapp:${name}`;
  const present = new Set(readdirSync(folder));
  const messages = parseWhatsAppChat(readFileSync(chatFile, 'utf8'));
  console.log(`${basename(folder)}: ${messages.length} messages as ${source}`);
  for (const message of messages) {
    try {
      if (message.attachment) {
        if (/\.zip$/i.test(message.attachment)) {
          bump('skipped zip');
          continue;
        }
        if (!present.has(message.attachment)) {
          bump('missing attachment');
          if (!message.text) continue;
          drawer.capture({ text: message.text, source, at: message.at, forwarded: message.forwarded });
          continue;
        }
        const bytes = new Uint8Array(readFileSync(join(folder, message.attachment)));
        const result = drawer.capture({
          text: message.text,
          file: { name: message.attachment, bytes },
          source,
          at: message.at,
          forwarded: message.forwarded,
        });
        bump(result.outcome);
      } else if (message.text) {
        const result = drawer.capture({ text: message.text, source, at: message.at, forwarded: message.forwarded });
        bump(result.outcome);
      } else {
        bump('omitted media');
      }
    } catch (error) {
      bump('error');
      console.error(`  message at ${message.at.toISOString()}: ${(error as Error).message}`);
    }
  }
}
console.log('captured:', counts);

const pending = drawer.stats().pending ?? 0;
console.log(`enriching ${pending} items (${drawer.modelAvailable() ? 'model' : 'local only'})…`);
let done = 0;
const timer = setInterval(() => console.log(`  ${done}/${pending}`), 15_000);
while (true) {
  const n = await drawer.enrichPending(25, 4);
  done += n;
  if (n === 0) break;
}
clearInterval(timer);
if (drawer.modelAvailable()) {
  console.log('planning topics…');
  await drawer.planTopics();
}
drawer.clusterLoose();
const stats = drawer.stats();
console.log(
  `done: ${stats.items} items, ${stats.private} private, ${stats.failed} failed, ${drawer.topics().length} topics, ` +
    `$${stats.spentThisMonthUsd.toFixed(4)} spent this month; data in ${usedData}`,
);

function guessChat(folder: string): string {
  const base = basename(folder).toLowerCase();
  if (base.includes('notes')) return 'Notes';
  return 'You';
}
