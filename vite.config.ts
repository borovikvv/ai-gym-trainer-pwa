import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Issue #39: cache static assets (exercise images, fonts) for offline use.
        // API requests are handled separately via IndexedDB offline queue
        // (src/lib/offlineQueue.ts) because the API is on a different origin.
        runtimeCaching: [
          {
            // Exercise guide images — large, rarely change, needed offline.
            urlPattern: /^https?:\/\/.*\/exercise-guides\/.*\.(png|svg|jpg)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'exercise-guides-v2',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            // Lucide icons and other static assets from same origin.
            urlPattern: /^https?:\/\/.*\/assets\/.*\.(js|css|woff2?)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'app-assets',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
      },
      manifest: {
        name: 'AI Gym Trainer',
        short_name: 'Gym Coach',
        description: 'Персональный тренер для зала',
        theme_color: '#f8f4ec',
        background_color: '#f8f4ec',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/pwa-512x512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8910',
    },
  },
  preview: {
    allowedHosts: (process.env.VITE_PREVIEW_ALLOWED_HOSTS ?? 'trainer.borovikvv.ru').split(','),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    testTimeout: 30000,
  },
})
