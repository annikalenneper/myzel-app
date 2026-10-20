import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  // Smoke-Tests gegen das echte Backend: eigene Konfiguration (playwright.smoke.config.ts)
  testIgnore: 'smoke/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    testIdAttribute: 'data-wf',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobil',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // immer die Testdaten-Schicht, egal was in der .env steht
    env: { VITE_MYZEL_BACKEND: 'mock' },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
