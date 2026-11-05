import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { authorPlugin, type AuthorPluginState } from './vite-plugin-author';
import { levelsPlugin, solutionsPlugin } from './vite-plugin-levels';

const levelsDir = fileURLToPath(new URL('../../levels', import.meta.url));
const envDir = fileURLToPath(new URL('.', import.meta.url));
const author: { api?: AuthorPluginState } = {};

/**
 * The preview of `main` (VITE_PREVIEW=1, src/preview.ts; DEVELOPMENT.md › Preview of `main`):
 * kept out of search engines, and named apart so that it never passes for the release.
 */
function previewHtmlPlugin(): Plugin {
  return {
    name: 'puzzlecave-preview-html',
    transformIndexHtml: (html) =>
      html
        .replace('<title>puzzleCave</title>', '<title>puzzleCave (preview)</title>')
        .replace(
          '<meta name="apple-mobile-web-app-title" content="puzzleCave" />',
          '<meta name="apple-mobile-web-app-title" content="puzzleCave (preview)" />',
        )
        .replace('</head>', '  <meta name="robots" content="noindex, nofollow" />\n  </head>'),
  };
}

export default defineConfig(({ mode }) => {
  const preview = loadEnv(mode, envDir, 'VITE_').VITE_PREVIEW === '1';
  const name = preview ? 'puzzleCave (preview)' : 'puzzleCave';
  return {
    base: './',
    plugins: [
      levelsPlugin(levelsDir, () => author.api?.busy() ?? false),
      authorPlugin(levelsDir, author),
      // the saved solutions, replayed by the preview's author mode (empty in the release)
      solutionsPlugin(levelsDir, preview),
      preview && previewHtmlPlugin(),
      VitePWA({
        // a new version waits until the game lets it in (src/pwa.ts): never in the middle of a
        // level; the registration comes from src/pwa.ts, nothing is injected
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
          // the preview: an app of its own, which cannot replace the installed release
          ...(preview && { id: 'puzzlecave-preview' }),
          name,
          short_name: name,
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
          globPatterns: ['**/*.{js,css,html,png,mp3,woff2}'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // the previous version's files are deleted once the new one takes over
          cleanupOutdatedCaches: true,
          // the release never answers a navigation into the preview's folder (published beside
          // it, preview-<secret>/) with its own index.html; the preview's worker, scoped to that
          // folder, needs no such rule (and must serve its own root offline)
          ...(!preview && { navigateFallbackDenylist: [/\/preview-[^/]+(\/|$)/] }),
        },
      }),
    ],
    build: { target: 'es2022' },
  };
});
