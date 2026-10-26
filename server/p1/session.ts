// Anmeldung (F-LOG-01, -02; WF-LOG-01 bis -03): Wer sich bei Supabase anmeldet (Google oder Mail-Link), wird über die
// bestätigte Mail-Adresse mit dem Mitglied verknüpft – beim ersten Login einmalig, danach über auth_user_id.
// Weitere Adressen (member_emails) sind eigene Logins mit eigener Verknüpfung.
// Wer nicht auf der Mitgliederliste steht oder deaktiviert ist, bekommt keinen Zugriff.
import { sql, type Kysely } from 'kysely';
import type { Session } from '../../src/data/api';
import {
  PLENUM_DEFAULT_HOURS,
  SESSION_PLENUM_LOOKAHEAD_MS,
  type SessionPlenum,
} from '../../src/shared/rules/plenum';
import { memberForLogin } from '../core/context';
import type { Database, MemberRow } from '../db/types';

/**
 * Das laufende oder nächste Plenum der kommenden 24 Stunden (16.2), mit der Angabe, ob die Person auf der
 * Teilnehmerliste steht – die App fragt damit vor einer Änderung nach.
 */
async function sessionPlenum(
  db: Kysely<Database>,
  memberId: string,
  now: Date,
): Promise<SessionPlenum | null> {
  const at = now.toISOString();
  const until = new Date(now.getTime() + SESSION_PLENUM_LOOKAHEAD_MS).toISOString();
  const end = sql<string>`coalesce(a.ends_at, a.starts_at + make_interval(hours => ${PLENUM_DEFAULT_HOURS}))`;
  const row = await db
    .selectFrom('appointments as a')
    .innerJoin('appointment_types as t', 't.id', 'a.type_id')
    .select((eb) => [
      'a.id',
      'a.title',
      'a.starts_at',
      end.as('ends_at'),
      eb
        .or([
          eb.exists(
            eb
              .selectFrom('appointment_rsvps as r')
              .select('r.member_id')
              .whereRef('r.appointment_id', '=', 'a.id')
              .where('r.member_id', '=', memberId)
              .where('r.answer', '=', 'ja'),
          ),
          eb.exists(
            eb
              .selectFrom('appointment_attendees as x')
              .select('x.member_id')
              .whereRef('x.appointment_id', '=', 'a.id')
              .where('x.member_id', '=', memberId),
          ),
        ])
        .as('participant'),
    ])
    .where('t.has_plenum_features', '=', true)
    .where('a.archived_at', 'is', null)
    .where('a.status', 'in', ['geplant', 'stattgefunden'])
    .where(sql<boolean>`${end} >= ${at}::timestamptz`)
    .where(sql<boolean>`a.starts_at <= ${until}::timestamptz`)
    // wie die Transaktion: ein laufendes zuerst (das zuletzt begonnene), sonst das nächste
    .orderBy(sql`a.starts_at <= ${at}::timestamptz`, 'desc')
    .orderBy(sql`case when a.starts_at <= ${at}::timestamptz then a.starts_at end`, 'desc')
    .orderBy('a.starts_at')
    .executeTakeFirst();
  return row
    ? { ...row, ends_at: new Date(row.ends_at).toISOString(), participant: !!row.participant }
    : null;
}

const asMember = async (db: Kysely<Database>, member: MemberRow, now: Date): Promise<Session> => ({
  state: 'member',
  member,
  plenum: await sessionPlenum(db, member.id, now),
});

export async function sessionFor(
  db: Kysely<Database>,
  login: { authUserId: string; email: string | null } | null,
  now: Date = new Date(),
): Promise<Session> {
  if (!login) return { state: 'anonymous' };
  const linked = await memberForLogin(db, login.authUserId);
  if (linked)
    return linked.active ? asMember(db, linked, now) : { state: 'no_access', email: linked.email ?? '' };
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
  if (byEmail?.active) return asMember(db, byEmail, now);
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
    if (member?.active && !member.is_system) return asMember(db, member, now);
  }
  return { state: 'no_access', email: login.email };
}
