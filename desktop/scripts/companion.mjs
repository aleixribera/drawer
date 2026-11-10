// The app shares its clipboard, capture and delivery code with the command-line companion: copy it in before a run
// or a build, so the packaged app carries the same file.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../companion/drawer.mjs', import.meta.url));
const to = fileURLToPath(new URL('../src/companion.mjs', import.meta.url));
copyFileSync(from, to);
