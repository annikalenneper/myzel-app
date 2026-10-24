// Mitgliederliste einspielen (Einrichtung, Frage 4): `npm run db:import-members` liest mitgliederliste.md (nur lokal,
// nie im Repo) – je Zeile „Name  mail@example.org  (admin)“. Legt Fehlende über dieselbe Server-Funktion an wie der
// Admin-Bereich (mit Historie, handelnde Person: die Admin-Person aus MYZEL_FIRST_ADMIN_EMAIL); Vorhandene bekommen
// Name und Admin-Rechte aus der Liste. Mehrfach ausführbar.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import { inTransaction } from '../core/context';
import { createMember, updateMember } from '../p1/members';
import type { Database } from './types';

export interface ListedMember {
  name: string;
  email: string;
  admin: boolean;
}

export function parseMemberList(text: string): ListedMember[] {
  const out: ListedMember[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(.+?)\s+(\S+@\S+?)\s*(\(admin\))?$/i.exec(line);
    if (!m) throw new Error(`Diese Zeile verstehe ich nicht: „${line}“`);
    out.push({ name: m[1]!.trim(), email: m[2]!.toLowerCase(), admin: !!m[3] });
  }
  return out;
}

/** Kürzel aus dem Namen: erst die ersten zwei Buchstaben, sonst der erste mit einem späteren */
function shortFor(name: string, taken: Set<string>): string {
  const letters = name.replace(/[^\p{L}]/gu, '').toUpperCase();
  for (let i = 1; i < letters.length; i++) {
    const short = letters[0]! + letters[i]!;
    if (!taken.has(short)) return short;
  }
  for (let n = 1; n < 10; n++) if (!taken.has(`${letters[0] ?? 'M'}${n}`)) return `${letters[0] ?? 'M'}${n}`;
  throw new Error(`Kein freies Kürzel für „${name}“.`);
}

export async function importMembers(
  db: Kysely<Database>,
  list: ListedMember[],
  adminEmail: string,
  now: Date,
): Promise<string[]> {
  const admin = await db
    .selectFrom('members')
    .select('auth_user_id')
    .where((eb) => eb(eb.fn('lower', ['email']), '=', adminEmail.trim().toLowerCase()))
    .where('active', '=', true)
    .where('is_admin', '=', true)
    .executeTakeFirst();
  if (!admin?.auth_user_id)
    throw new Error('Die Admin-Person aus MYZEL_FIRST_ADMIN_EMAIL muss sich vorher einmal angemeldet haben.');
  return inTransaction(db, admin.auth_user_id, now, async (ctx) => {
    const existing = await ctx.trx.selectFrom('members').selectAll().where('is_system', '=', false).execute();
    const taken = new Set(existing.map((m) => m.short.toUpperCase()));
    const report: string[] = [];
    for (const person of list) {
      const found = existing.find((m) => m.email?.toLowerCase() === person.email);
      if (!found) {
        const short = shortFor(person.name, taken);
        taken.add(short);
        await createMember(ctx, {
          display_name: person.name,
          email: person.email,
          short,
          is_admin: person.admin,
        });
        report.push(`angelegt: ${person.name} (${short})${person.admin ? ', Admin' : ''}`);
      } else if (found.display_name !== person.name || found.is_admin !== person.admin) {
        await updateMember(ctx, found.id, {
          display_name: person.name,
          email: found.email,
          short: found.short,
          is_admin: person.admin,
          version: found.version,
        });
        report.push(`aktualisiert: ${person.name}${person.admin ? ', Admin' : ''}`);
      } else report.push(`schon da: ${person.name}`);
    }
    return report;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { database } = await import('./connection');
  const db = database();
  try {
    const list = parseMemberList(await readFile('mitgliederliste.md', 'utf8'));
    const report = await importMembers(db, list, process.env.MYZEL_FIRST_ADMIN_EMAIL ?? '', new Date());
    console.log(report.join('\n'));
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
