// Welche Datenschicht die Oberfläche nutzt: ohne Weiteres die Testdaten-Schicht (Schritt A, Vorschau, E2E-Tests);
// mit VITE_MYZEL_BACKEND=supabase (Netlify) oder lokal `npx netlify dev` (Modus „backend“) das echte Backend
// (Supabase-Login und Netlify Functions, Schritt C). Auch dort bleibt die Demo mit Testdaten erreichbar: „Demo
// ansehen“ auf der Anmeldeseite merkt sich das im Browser und lädt die Testdaten-Schicht – echte Daten nie.
// Die Oberfläche kennt nur die Schnittstelle MyzelApi – sonst ändert sich nichts.
import type { DemoTools, MyzelApi } from './api';
import { createMockApi } from './mock/mockApi';
import { createRemoteApi } from './remote/remoteApi';

const env = import.meta.env;
const backend = env.VITE_MYZEL_BACKEND?.trim() === 'supabase' || env.MODE === 'backend';
const DEMO_KEY = 'myzel:demo';

function readDemoFlag(): boolean {
  try {
    return window.localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

/** Demo mit Testdaten in der echten App (nur dann gibt es das Hinweisband) */
export const demoInProduction = backend && readDemoFlag();
/** Gibt es neben der Demo ein echtes Backend? Dann bietet die Anmeldeseite „Demo ansehen“ an. */
export const demoAvailable = backend && !demoInProduction;

/** Demo starten oder beenden: neu laden, damit die passende Datenschicht entsteht */
export function setDemo(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(DEMO_KEY, '1');
    else window.localStorage.removeItem(DEMO_KEY);
  } catch {
    // ohne Speicher im Browser gibt es keine Demo – die Anmeldeseite bleibt
  }
  window.location.assign('/');
}

export const api: MyzelApi =
  backend && !demoInProduction
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
