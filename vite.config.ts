import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Манифест за авторизацией (Caddy forward_auth): без этого браузер
      // запрашивает его без учётных данных — редирект на вход вместо манифеста
      // (#401).
      useCredentials: true,
      // Issue #406: собственный service worker. Прежний generateSW регистрировал
      // NavigationRoute, который отдавал на любую навигацию кэшированную
      // оболочку: без сессии браузер не видел редирект на портал входа, а
      // чанки оболочки собирались в несовместимый набор — пустой экран.
      // Логика навигации «сеть → откат в кэш» — в src/sw.ts.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html}'],
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
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
