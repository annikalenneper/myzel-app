import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Schriften gehören in den Cache, damit die App ohne Netz gleich aussieht
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
        // Web-Push: Anzeigen und Tippen (public/push-sw.js)
        importScripts: ['push-sw.js'],
        // Server-Funktionen nie aus dem Cache beantworten
        navigateFallbackDenylist: [/^\/api\//, /^\/jobs\//, /^\/telegram\//],
      },
      includeAssets: ['myzel-logo.png', 'icon-192.png'],
      manifest: {
        name: 'Myzel',
        short_name: 'Myzel',
        description: 'Aufgaben, Termine und Dokumente des Kollektivs an einem Ort.',
        lang: 'de',
        display: 'standalone',
        start_url: '/',
        background_color: '#0C0A12',
        theme_color: '#0C0A12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    // Datenbank-Tests legen je Test ein frisches Postgres (PGlite) an – unter voller Last dauert das
    hookTimeout: 30_000,
    // wie die Server-Funktionen (server/core/berlin.ts) und die Playwright-Tests: Kölner Zeit, auch in der CI
    env: { TZ: 'Europe/Berlin' },
    testTimeout: 30_000,
    projects: [
      { extends: true, test: { name: 'app', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] } },
      // dieselben Phase-1-Tests gegen die Server-Funktionen (Schritt C)
      {
        extends: true,
        test: {
          name: 'server',
          include: [
            'src/data/mock/mockApi.test.ts',
            'src/data/mock/notify.test.ts',
            'src/data/mock/appointments.test.ts',
            'src/data/mock/plenum.test.ts',
            'src/data/mock/knowledge.test.ts',
            'src/data/mock/events.test.ts',
            'src/data/mock/partners.test.ts',
            'src/data/mock/templates.test.ts',
          ],
          env: { MYZEL_API: 'server', TZ: 'Europe/Berlin' },
        },
      },
    ],
  },
});
