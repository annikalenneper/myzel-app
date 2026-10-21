// Startet den Smoke-Server über Vites Modul-Runner: so gelten dieselben Importe wie in App und Tests
// (z. B. YAML-Vorlagen als `?raw`), ohne eigenen Build der Server-Funktionen.
import { createServer, createServerModuleRunner } from 'vite';

const vite = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  // nur Server-Code: keine Vorbündelung für den Browser
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: 'error',
});
const runner = createServerModuleRunner(vite.environments.ssr, { hmr: false });
await runner.import('/e2e/smoke/server.ts');
