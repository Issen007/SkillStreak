import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-node (not adapter-auto/static): the /api/status route needs a
    // real Node process to read the host's network interfaces and probe the
    // backend's health endpoint — this can never be a static/edge build.
    // Running via `pnpm run dev` (plain Vite dev server) already works
    // without a build at all; this adapter only matters for the optional
    // `pnpm run build && pnpm start` path.
    adapter: adapter(),
  },
};

export default config;
