// Server der Smoke-Tests gegen das echte Backend (7.4 Nr. 6): die gebaute App im Modus „backend“ und dieselbe
// HTTP-Schicht wie die Netlify Function, gegen echtes Postgres (PGlite) mit den Testdaten. Nur die Login-Prüfung
// ist nachgestellt: das Token „smoke:<auth_user_id>:<mail>“ steht für einen von Supabase geprüften Login.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { bearerToken, respond } from '../../server/api/http';
import { createLocalDb } from '../../server/db/localDb';
import { seedFromMock } from '../../server/db/seedFromMock';

const PORT = Number(process.env.SMOKE_PORT ?? 4174);
const ROOT = join(import.meta.dirname, '../../dist-smoke');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const local = await createLocalDb();
await seedFromMock(local.db, new Date());

async function loginFrom(req: Request) {
  const [kind, authUserId, email] = (bearerToken(req) ?? '').split(':');
  return kind === 'smoke' && authUserId ? { authUserId, email: email || null } : null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const api = url.pathname.match(/^\/api\/([A-Za-z]+)$/);
  if (api) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    });
    const response = await respond(request, api[1]!, () => local.db, loginFrom);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }
  // statische Dateien, sonst index.html (Unterseiten der App)
  const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  const file = path.startsWith(ROOT) && extname(path) ? path : join(ROOT, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Smoke-Server auf http://127.0.0.1:${PORT}`));
