// Anmeldung (F-LOG-01, -02; WF-LOG-01 bis -03): Wer sich bei Supabase anmeldet (Google oder Mail-Link), wird über die
// bestätigte Mail-Adresse mit dem Mitglied verknüpft – beim ersten Login einmalig, danach über auth_user_id.
// Weitere Adressen (member_emails) sind eigene Logins mit eigener Verknüpfung.
// Wer nicht auf der Mitgliederliste steht oder deaktiviert ist, bekommt keinen Zugriff.
import type { Kysely } from 'kysely';
import type { Session } from '../../src/data/api';
import { memberForLogin } from '../core/context';
import type { Database } from '../db/types';

export async function sessionFor(
  db: Kysely<Database>,
  login: { authUserId: string; email: string | null } | null,
): Promise<Session> {
  if (!login) return { state: 'anonymous' };
  const linked = await memberForLogin(db, login.authUserId);
  if (linked)
    return linked.active
      ? { state: 'member', member: linked }
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
  if (byEmail?.active) return { state: 'member', member: byEmail };
  if (byEmail) return { state: 'no_access', email: login.email };
  // sonst: eine weitere Adresse eines Mitglieds
  const extra = await db
    .updateTable('member_emails')
    .set({ auth_user_id: login.authUserId })
    .where((eb) => eb(eb.fn('lower', ['email']), '=', login.email!.toLowerCase()))
    .where((eb) => eb.or([eb('auth_user_id', 'is', null), eb('auth_user_id', '=', login.authUserId)]))
    .returning('member_id')
    .executeTakeFirst();
  if (extra) {
    const member = await db
      .selectFrom('members')
      .selectAll()
      .where('id', '=', extra.member_id)
      .executeTakeFirst();
    if (member?.active && !member.is_system) return { state: 'member', member };
  }
  return { state: 'no_access', email: login.email };
}
