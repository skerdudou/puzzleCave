import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { authorPlugin, type AuthorPluginState } from './vite-plugin-author';
import { levelsPlugin } from './vite-plugin-levels';

const levelsDir = fileURLToPath(new URL('../../levels', import.meta.url));
const author: { api?: AuthorPluginState } = {};

export default defineConfig({
  base: './',
  plugins: [
    levelsPlugin(levelsDir, () => author.api?.busy() ?? false),
    authorPlugin(levelsDir, author),
    VitePWA({
      // a new version waits until the game lets it in (src/pwa.ts): never in the middle of a
      // level; the registration comes from src/pwa.ts, nothing is injected
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'puzzleCave',
        short_name: 'puzzleCave',
        description: 'Turn-based puzzle game: blocks, keys, doors and water.',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#1d1b26',
        theme_color: '#1d1b26',
        start_url: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // the figure inside the safe circle (80 %) that Android may crop the icon to
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,mp3}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // the previous version's files are deleted once the new one takes over
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { target: 'es2022' },
});
