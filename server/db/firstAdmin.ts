// Erste Admin-Person anlegen (Einrichtung, F-LOG-01): Ohne sie kann sich niemand anmelden, und Mitglieder legt nur
// eine Admin-Person an. Läuft einmalig per `npm run db:first-admin` mit MYZEL_FIRST_ADMIN_EMAIL aus der .env,
// als „Myzel (automatisch)“ mit Historie – und nur, solange es noch kein Mitglied gibt.
import { pathToFileURL } from 'node:url';
import type { Kysely } from 'kysely';
import { memberCreateSchema } from '../../src/shared/schema';
import type { Database } from './types';

export async function createFirstAdmin(
  db: Kysely<Database>,
  rawEmail: string | undefined,
  now: Date,
): Promise<{ created: boolean; message: string }> {
  const email = (rawEmail ?? '').trim();
  // Name und Kürzel vorläufig aus der Mail; der Name lässt sich danach im Profil ändern
  const local = email.toLowerCase().split('@')[0] ?? '';
  const parsed = memberCreateSchema.safeParse({
    email,
    display_name: local.slice(0, 1).toUpperCase() + local.slice(1),
    short: local.replace(/[^a-z]/gi, '').slice(0, 2) || 'AD',
    is_admin: true,
  });
  if (!parsed.success)
    return { created: false, message: 'MYZEL_FIRST_ADMIN_EMAIL fehlt oder ist keine gültige Mail-Adresse.' };
  const input = parsed.data;
  return db.transaction().execute(async (trx) => {
    const members = await trx
      .selectFrom('members')
      .select('id')
      .where('is_system', '=', false)
      .forUpdate()
      .execute();
    if (members.length > 0)
      return {
        created: false,
        message: 'Es gibt schon Mitglieder – weitere legt eine Admin-Person in der App an.',
      };
    const system = await trx
      .selectFrom('members')
      .select('id')
      .where('is_system', '=', true)
      .executeTakeFirstOrThrow();
    const at = now.toISOString();
    const member = await trx
      .insertInto('members')
      .values({ ...input, created_at: at, updated_at: at, created_by: system.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('history')
      .values({
        id: crypto.randomUUID(),
        entity_type: 'member',
        entity_id: member.id,
        actor_member_id: system.id,
        action: 'created',
        changes: JSON.stringify({ display_name: { old: null, new: input.display_name } }),
        created_at: at,
      })
      .execute();
    return {
      created: true,
      message: `Admin-Person „${input.display_name}“ angelegt. Anmelden mit dieser Mail.`,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { database } = await import('./connection');
  const db = database();
  const result = await createFirstAdmin(db, process.env.MYZEL_FIRST_ADMIN_EMAIL, new Date());
  await db.destroy();
  console.log(result.message);
  process.exitCode = result.created ? 0 : 1;
}
