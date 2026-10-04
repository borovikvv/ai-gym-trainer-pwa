import { defineConfig } from '@playwright/test'

// E2E smoke runs in the app's local (no-API) mode: history is read/written to
// localStorage, the program falls back to bundled mock data. Empty env vars
// are forced so a developer's `.env.local` (with a real VITE_API_BASE_URL or
// Supabase config) cannot leak into the run — process.env wins over dotfiles
// in Vite, so an empty string overrides the file.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:4300',
  },
  webServer: {
    command: 'npm run dev -- --port 4300 --strictPort',
    url: 'http://localhost:4300',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_API_BASE_URL: '',
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
})
