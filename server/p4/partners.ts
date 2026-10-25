// Phase 4: Kooperationspartner – zentral gespeichert, an Veranstaltungen verknüpft (ANFORDERUNGEN 3.5, F-VER-05,
// WF-VER-10, WF-VER-13). Wie die Testdaten-Schicht (src/data/mock/partners.ts).
import type { PartnerDetail, PartnerListItem, Undoable } from '../../src/data/api';
import { AppError } from '../../src/shared/errors';
import { partnerCreateSchema, partnerUpdateSchema, type HistoryChanges } from '../../src/shared/schema';
import {
  checkVersion,
  iso,
  notFound,
  parse,
  registerUndo,
  rule,
  updatedOne,
  writeHistory,
  type Ctx,
  type Db,
} from '../core/context';
import type { PartnerRow } from '../db/types';
import { findEvent } from '../p1/events';

export async function findPartner(trx: Db, id: string, lock = true): Promise<PartnerRow> {
  const partner = await trx
    .selectFrom('partners')
    .selectAll()
    .where('id', '=', id)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!partner) throw notFound('Diesen Partner');
  return partner;
}

async function listItems(trx: Db, rows: PartnerRow[]): Promise<PartnerListItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);
  const links = await trx
    .selectFrom('event_partners')
    .select('partner_id')
    .where('partner_id', 'in', ids)
    .execute();
  return rows.map((p) => ({
    ...p,
    event_count: links.filter((l) => l.partner_id === p.id).length,
  }));
}

export async function listPartners(trx: Db): Promise<PartnerListItem[]> {
  const rows = await trx.selectFrom('partners').selectAll().where('archived_at', 'is', null).execute();
  rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return listItems(trx, rows);
}

/** WF-VER-13: Detail zeigt, bei welchen Veranstaltungen der Partner schon beteiligt war */
export async function getPartner(trx: Db, id: string): Promise<PartnerDetail> {
  const partner = await findPartner(trx, id, false);
  const [[item], events] = await Promise.all([
    listItems(trx, [partner]),
    trx
      .selectFrom('event_partners as ep')
      .innerJoin('events as e', 'e.id', 'ep.event_id')
      .select(['e.id', 'e.title', 'e.starts_at', 'e.status', 'ep.role_note'])
      .where('ep.partner_id', '=', id)
      .orderBy('e.starts_at', 'desc')
      .execute(),
  ]);
  return { ...item!, events };
}

async function assertContact(ctx: Ctx, memberId: string | null): Promise<void> {
  if (!memberId) return;
  const member = await ctx.trx
    .selectFrom('members')
    .select(['active', 'is_system'])
    .where('id', '=', memberId)
    .forShare()
    .executeTakeFirst();
  if (!member || member.is_system || !member.active)
    throw new AppError('validation', 'Als Kontaktperson geht nur ein aktives Mitglied.', {
      field: 'internal_contact_member_id',
    });
}

async function assertUniqueName(ctx: Ctx, name: string, exceptId?: string): Promise<void> {
  const clash = await ctx.trx
    .selectFrom('partners')
    .select('id')
    .where((eb) => eb(eb.fn('lower', ['name']), '=', name.toLowerCase()))
    .$if(!!exceptId, (q) => q.where('id', '<>', exceptId!))
    .executeTakeFirst();
  if (clash) throw new AppError('validation', `Den Partner „${name}“ gibt es schon.`, { field: 'name' });
}

export async function createPartner(ctx: Ctx, raw: unknown): Promise<{ id: string }> {
  const input = parse(partnerCreateSchema, raw);
  await assertUniqueName(ctx, input.name);
  await assertContact(ctx, input.internal_contact_member_id);
  const now = iso(ctx);
  const partner = await ctx.trx
    .insertInto('partners')
    .values({ ...input, archived_at: null, created_at: now, updated_at: now, created_by: ctx.actor.id })
    .returning('id')
    .executeTakeFirstOrThrow();
  await writeHistory(ctx, 'partner', partner.id, 'created', { name: { old: null, new: input.name } });
  return { id: partner.id };
}

async function touchPartner(ctx: Ctx, partner: PartnerRow, set: Partial<PartnerRow>): Promise<void> {
  const result = await ctx.trx
    .updateTable('partners')
    .set({ ...set, version: partner.version + 1, updated_at: iso(ctx) } as never)
    .where('id', '=', partner.id)
    .where('version', '=', partner.version)
    .executeTakeFirst();
  await updatedOne(ctx, result, 'partner', partner);
}

/** Mail und Telefon von Partnern stehen nicht in der Historie, nur dass sie geändert wurden (Entscheidung 22.10.2026) */
const HIDDEN_IN_HISTORY = new Set(['email', 'phone']);
const hiddenChange = { old: '(nicht gespeichert)', new: '(geändert)' };

export async function updatePartner(ctx: Ctx, id: string, raw: unknown): Promise<void> {
  const input = parse(partnerUpdateSchema, raw);
  const partner = await findPartner(ctx.trx, id);
  await checkVersion(ctx, 'partner', partner, input.version);
  await assertUniqueName(ctx, input.name, id);
  if (input.internal_contact_member_id !== partner.internal_contact_member_id)
    await assertContact(ctx, input.internal_contact_member_id);
  const changes: HistoryChanges = {};
  const set: Partial<PartnerRow> = {};
  for (const key of [
    'name',
    'kind',
    'description',
    'contact_person',
    'email',
    'phone',
    'website',
    'notes',
    'internal_contact_member_id',
  ] as const) {
    if (partner[key] === input[key]) continue;
    changes[key] = HIDDEN_IN_HISTORY.has(key) ? hiddenChange : { old: partner[key], new: input[key] };
    (set as Record<string, unknown>)[key] = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  await touchPartner(ctx, partner, set);
  await writeHistory(ctx, 'partner', id, 'updated', changes);
}

// ── Verknüpfung mit Veranstaltungen (WF-VER-10), eintragsweise ───────────────

export async function linkPartner(
  ctx: Ctx,
  eventId: string,
  partnerId: string,
  roleNote: unknown,
): Promise<Undoable> {
  if (roleNote !== null && roleNote !== undefined && typeof roleNote !== 'string')
    throw new AppError('validation', 'Höchstens 200 Zeichen.', { field: 'role_note' });
  const event = await findEvent(ctx, eventId);
  const partner = await findPartner(ctx.trx, partnerId);
  if (partner.archived_at) throw rule('Dieser Partner ist archiviert.');
  const note = (roleNote as string | null | undefined)?.trim() || null;
  if (note && note.length > 200)
    throw new AppError('validation', 'Höchstens 200 Zeichen.', { field: 'role_note' });
  const inserted = await ctx.trx
    .insertInto('event_partners')
    .values({
      event_id: eventId,
      partner_id: partnerId,
      role_note: note,
      added_by: ctx.actor.id,
      added_at: iso(ctx),
    })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  if (Number(inserted.numInsertedOrUpdatedRows ?? 0) === 0) return { undo_token: '' };
  ctx.inverse.push({ kind: 'event_partner_remove', event_id: eventId, partner_id: partnerId });
  await writeHistory(ctx, 'event', eventId, 'partner_added', { partner: { old: null, new: partner.name } });
  return registerUndo(ctx, 'event', event, `Partner verknüpft: ${partner.name}`);
}

export async function unlinkPartner(ctx: Ctx, eventId: string, partnerId: string): Promise<Undoable> {
  const event = await findEvent(ctx, eventId);
  const row = await ctx.trx
    .deleteFrom('event_partners')
    .where('event_id', '=', eventId)
    .where('partner_id', '=', partnerId)
    .returningAll()
    .executeTakeFirst();
  if (!row) return { undo_token: '' };
  const partner = await findPartner(ctx.trx, partnerId, false);
  ctx.inverse.push({ kind: 'event_partner_restore', row });
  await writeHistory(ctx, 'event', eventId, 'partner_removed', { partner: { old: partner.name, new: null } });
  return registerUndo(ctx, 'event', event, `Partner entfernt: ${partner.name}`);
}

/** „Mitglied deaktivieren“ ab P4: als interne Kontaktperson austragen (WF-ADM-03), Teil der Transaktion */
export async function dropPartnerContacts(ctx: Ctx, memberId: string): Promise<number> {
  const partners = await ctx.trx
    .selectFrom('partners')
    .selectAll()
    .where('internal_contact_member_id', '=', memberId)
    .forUpdate()
    .execute();
  for (const p of partners) {
    await touchPartner(ctx, p, { internal_contact_member_id: null });
    await writeHistory(ctx, 'partner', p.id, 'contact_removed_deactivated', {
      internal_contact_member_id: { old: memberId, new: null },
    });
  }
  return partners.length;
}

export async function partnerContactCount(trx: Db, memberId: string): Promise<number> {
  return (
    await trx.selectFrom('partners').select('id').where('internal_contact_member_id', '=', memberId).execute()
  ).length;
}
