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
      workbox: { globPatterns: ['**/*.{js,css,html,png,woff2}'] },
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
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
