// Mitgliederliste einspielen (Einrichtung, Frage 4): `npm run db:import-members` liest mitgliederliste.md (nur lokal,
// nie im Repo) – je Zeile „Name  mail@example.org  (admin)“, weitere Login-Adressen dahinter, mit oder ohne „/“.
// Legt Fehlende über dieselbe Server-Funktion an wie der Admin-Bereich (mit Historie, handelnde Person: die
// Admin-Person aus MYZEL_FIRST_ADMIN_EMAIL); Vorhandene bekommen Name und Admin-Rechte aus der Liste, fehlende
// weitere Adressen werden ergänzt (nie entfernt). Mehrfach ausführbar.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import { inTransaction } from '../core/context';
import { addMemberEmail, createMember, updateMember } from '../p1/members';
import type { Database } from './types';

export interface ListedMember {
  name: string;
  /** Hauptadresse: die erste der Zeile */
  email: string;
  /** weitere Login-Adressen */
  extra: string[];
  admin: boolean;
}

const EMAIL = /[^\s/()]+@[^\s/()]+/g;

export function parseMemberList(text: string): ListedMember[] {
  const out: ListedMember[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.search(/\S+@/);
    const name = at > 0 ? line.slice(0, at).trim() : '';
    const rest = at > 0 ? line.slice(at) : '';
    const emails = (rest.match(EMAIL) ?? []).map((e) => e.toLowerCase());
    // außer Adressen nur „(admin)“ und Trenner
    const leftover = rest
      .replace(EMAIL, '')
      .replace(/\(admin\)/gi, '')
      .replace(/[\s/]/g, '');
    if (!name || emails.length === 0 || leftover)
      throw new Error(`Diese Zeile verstehe ich nicht: „${line}“`);
    const [email, ...extra] = emails;
    out.push({ name, email: email!, extra, admin: /\(admin\)/i.test(rest) });
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
      let id = found?.id;
      let line: string;
      if (!found) {
        const short = shortFor(person.name, taken);
        taken.add(short);
        ({ id } = await createMember(ctx, {
          display_name: person.name,
          email: person.email,
          short,
          is_admin: person.admin,
        }));
        line = `angelegt: ${person.name} (${short})${person.admin ? ', Admin' : ''}`;
      } else if (found.display_name !== person.name || found.is_admin !== person.admin) {
        await updateMember(ctx, found.id, {
          display_name: person.name,
          email: found.email,
          short: found.short,
          is_admin: person.admin,
          version: found.version,
        });
        line = `aktualisiert: ${person.name}${person.admin ? ', Admin' : ''}`;
      } else line = `schon da: ${person.name}`;
      const known = new Set(
        (
          await ctx.trx.selectFrom('member_emails').select('email').where('member_id', '=', id!).execute()
        ).map((e) => e.email.toLowerCase()),
      );
      const added = person.extra.filter((e) => !known.has(e));
      for (const email of added) await addMemberEmail(ctx, id!, email);
      report.push(
        added.length ? `${line}, weitere Adresse${added.length > 1 ? 'n' : ''}: ${added.length}` : line,
      );
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
