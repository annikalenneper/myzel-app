import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const dbTests = [
  'server/api/handle.test.ts',
  'server/db/firstAdmin.test.ts',
  'server/db/importMembers.test.ts',
  'server/db/migrations.test.ts',
  'server/integrity/checks.test.ts',
  'server/p2/notify.test.ts',
  'server/p5/drive.test.ts',
];

export default defineConfig({
  // Version und Deploy der App (16.5): Profil und „Was ist neu?“
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(process.env.COMMIT_REF?.slice(0, 7) ?? 'lokal'),
  },
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
    // unter voller Last (alle Projekte parallel) braucht das Anlegen der Datenbank-Vorlage länger
    testTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: { name: 'app', include: ['src/**/*.test.ts', 'server/**/*.test.ts'], exclude: dbTests },
      },
      // Datenbank-Tests (PGlite): vorerst nicht in `npm run check`, nur mit `npm run test:db` (25.10.2026)
      { extends: true, test: { name: 'db', include: dbTests } },
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
            'src/data/mock/drive.test.ts',
            'src/data/mock/grundfunktionen.test.ts',
            'src/data/mock/konsens.test.ts',
            'src/data/mock/rueckmeldung.test.ts',
          ],
          env: { MYZEL_API: 'server', TZ: 'Europe/Berlin' },
        },
      },
    ],
  },
});
