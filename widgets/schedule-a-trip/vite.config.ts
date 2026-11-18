/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { boWidget } from '@vulog/bo-widget-vite';
import { basename, dirname } from 'node:path';
import { defineConfig } from 'vite';
import widget from './widget.config.ts';

/** Chunk names that several features use: prefixed with their feature (`prepayment-dialogs`). */
const GENERIC_NAMES = new Set(['cards', 'dialogs', 'index']);

/**
 * The readable name of a chunk: its module, prefixed with its feature when the name alone is
 * ambiguous (`core-cards`, `prepayment-cards`, `write-dialogs`, `prepayment-dialogs`).
 */
function chunkName(name: string, facade: string | null): string {
  if (!facade || !GENERIC_NAMES.has(name)) return name;
  const folder = basename(dirname(facade));
  // `prepayment/dialogs/index.ts`: the folder is the name, its parent is the feature.
  return folder === name ? `${basename(dirname(dirname(facade)))}-${name}` : `${folder}-${name}`;
}

export default defineConfig({
  plugins: [react(), boWidget(widget)],
  // Dev server only: scan every source file up front, so that the dependencies of the chunks loaded on demand (the
  // drawer, the dialogs, the map, the languages) are pre-bundled at start. Otherwise Vite finds them at the first use,
  // re-optimizes and reloads the whole page (a one-off « refresh » at the first click on a booking).
  optimizeDeps: { entries: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/test/**'] },
  build: {
    rolldownOptions: {
      output: {
        // The lazy parts (`import()`) are chunks next to `index.js`, with stable, readable names.
        chunkFileNames: (chunk) => `assets/${chunkName(chunk.name, chunk.facadeModuleId)}-[hash].js`,
        // Everything `index.js` needs at once in one chunk (`shell`), instead of a dozen small
        // shared chunks: the lazy chunks import it, so each module is loaded once.
        codeSplitting: { groups: [{ name: 'shell', tags: ['$initial'] }] },
        // Library mode keeps the whitespace (for the bundlers of a library's users): a widget is
        // never bundled again, so minify it fully.
        minify: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['src/test/setup.ts'],
    // The CI runner is slower than a laptop: rendering, lazy chunks and fake back office round trips can take a few
    // seconds, and vi.waitFor waits up to 5 s (src/test/setup.ts).
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
