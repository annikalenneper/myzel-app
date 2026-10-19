// Schritt A: die Oberfläche läuft gegen die Testdaten-Schicht. In Schritt C wird hier
// die Anbindung an Supabase und die Netlify Functions eingesetzt – sonst ändert sich nichts.
import type { DemoTools, MyzelApi } from './api';
import { createMockApi } from './mock/mockApi';

export const api: MyzelApi = createMockApi({ storage: window.localStorage, latency: 80 });

declare global {
  interface Window {
    /** Demo-Werkzeuge der Testdaten-Schicht, auch für die Playwright-Tests */
    __myzelDemo?: DemoTools;
  }
}
window.__myzelDemo = api.demo;
