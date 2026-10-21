// Smoke-Tests gegen das echte Backend (7.4 Nr. 6): gebaute App im Modus „backend“, Server-Funktionen auf PGlite.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;

export default defineConfig({
  testDir: 'e2e/smoke',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    testIdAttribute: 'data-wf',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'mobil', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: 'npm run build:smoke && tsx e2e/smoke/start.ts',
    url: `http://127.0.0.1:${PORT}`,
    // ein Login-Dienst, den es nicht gibt: supabase-js liest nur die abgelegte Sitzung
    env: {
      VITE_SUPABASE_URL: `http://127.0.0.1:${PORT}/auth`,
      VITE_SUPABASE_ANON_KEY: 'smoke',
      TELEGRAM_BOT_USERNAME: 'myzel_smoke_bot',
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
