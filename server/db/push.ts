// Migrationen aus supabase/migrations in die Datenbank aus DATABASE_URL einspielen (`npm run db:push`).
// Die Supabase CLI fragt vor dem Einspielen nach und zeigt, welche Migrationen neu sind.
import { spawnSync } from 'node:child_process';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt in der .env.');
  process.exit(1);
}
// Windows findet npx nur über die Shell – dort die Adresse in Anführungszeichen, damit & und ? nichts auslösen
const windows = process.platform === 'win32';
const result = spawnSync('npx', ['supabase', 'db', 'push', '--db-url', windows ? `"${url}"` : url], {
  stdio: 'inherit',
  shell: windows,
});
process.exit(result.status ?? 1);
