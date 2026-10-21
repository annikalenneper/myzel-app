// Welche Datenschicht die Oberfläche nutzt: ohne Weiteres die Testdaten-Schicht (Schritt A, Vorschau, E2E-Tests);
// mit VITE_MYZEL_BACKEND=supabase (Netlify) oder lokal `npx netlify dev` (Modus „backend“) das echte Backend
// (Supabase-Login und Netlify Functions, Schritt C).
// Die Oberfläche kennt nur die Schnittstelle MyzelApi – sonst ändert sich nichts.
import type { DemoTools, MyzelApi } from './api';
import { createMockApi } from './mock/mockApi';
import { createRemoteApi } from './remote/remoteApi';

const env = import.meta.env;
const backend = env.VITE_MYZEL_BACKEND?.trim() === 'supabase' || env.MODE === 'backend';

export const api: MyzelApi = backend
  ? createRemoteApi({
      supabaseUrl: env.VITE_SUPABASE_URL ?? '',
      anonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
      vapidPublicKey: env.VITE_VAPID_PUBLIC_KEY || undefined,
    })
  : createMockApi({ storage: window.localStorage, latency: 80 });

declare global {
  interface Window {
    /** Demo-Werkzeuge der Testdaten-Schicht, auch für die Playwright-Tests */
    __myzelDemo?: DemoTools;
  }
}
window.__myzelDemo = api.demo;
