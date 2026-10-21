// Anmeldung (F-LOG-01, -02; WF-LOG-01 bis -03): Wer sich bei Supabase anmeldet (Google oder Mail-Link), wird über die
// bestätigte Mail-Adresse mit dem Mitglied verknüpft – beim ersten Login einmalig, danach über auth_user_id.
// Wer nicht auf der Mitgliederliste steht oder deaktiviert ist, bekommt keinen Zugriff.
import type { Kysely } from 'kysely';
import type { Session } from '../../src/data/api';
import type { Member } from '../../src/shared/schema';
import type { Database, MemberRow } from '../db/types';

const toMember = (row: MemberRow): Member => ({ ...row, notify_own_status: false });

export async function sessionFor(
  db: Kysely<Database>,
  login: { authUserId: string; email: string | null } | null,
): Promise<Session> {
  if (!login) return { state: 'anonymous' };
  const linked = await db
    .selectFrom('members')
    .selectAll()
    .where('auth_user_id', '=', login.authUserId)
    .where('is_system', '=', false)
    .executeTakeFirst();
  if (linked)
    return linked.active
      ? { state: 'member', member: toMember(linked) }
      : { state: 'no_access', email: linked.email ?? '' };
  if (!login.email) return { state: 'no_access', email: '' };
  // erster Login: Mitglied mit dieser Mail, das noch mit keinem Login verknüpft ist – oder gerade eben von einer
  // gleichzeitigen Anfrage desselben Logins verknüpft wurde (die App fragt beim Start mehrfach parallel)
  const byEmail = await db
    .updateTable('members')
    .set({ auth_user_id: login.authUserId })
    .where((eb) => eb(eb.fn('lower', ['email']), '=', login.email!.toLowerCase()))
    .where((eb) => eb.or([eb('auth_user_id', 'is', null), eb('auth_user_id', '=', login.authUserId)]))
    .where('is_system', '=', false)
    .returningAll()
    .executeTakeFirst();
  if (byEmail?.active) return { state: 'member', member: toMember(byEmail) };
  return { state: 'no_access', email: login.email };
}
