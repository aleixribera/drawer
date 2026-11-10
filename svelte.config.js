import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // The API is posted to by the iPhone Shortcut and the companion, which have no Origin; hooks.server.ts guards
    // cross-site form posts to the pages instead.
    csrf: { trustedOrigins: ['*'] },
    typescript: { config: (config) => ({ ...config, include: [...config.include, '../scripts/**/*.ts', '../tests/**/*.ts'] }) },
  },
};
