import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** GitHub Pages serves project sites at /<repo>/; user sites (<name>.github.io) at /. */
export function pagesBase(repository = process.env.GITHUB_REPOSITORY): string {
  const repo = repository?.split('/')[1]
  if (!repo || repo.endsWith('.github.io')) return '/'
  return `/${repo}/`
}

export default defineConfig({
  base: pagesBase(),
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'wordsolv',
        short_name: 'wordsolv',
        description: 'Wordle / Quordle solver assistant (EN + RU)',
        theme_color: '#6aaa64',
        background_color: '#121213',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}', 'dict/ru-5.txt', 'dict/en-5.txt', 'dict/*.m0.bin', 'dict/SOURCES.md'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/dict\/[a-z]{2}-\d\.txt$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'dict-assets' },
          },
          {
            urlPattern: /\/dict\/[a-z]{2}-\d\.m1\.bin\.gz$/,
            handler: 'CacheFirst',
            options: { cacheName: 'move1-books', expiration: { maxEntries: 6 } },
          },
        ],
      },
    }),
  ],
})
