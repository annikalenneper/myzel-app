// Testdaten-Schicht, Phase 4: Kooperationspartner – zentral gespeichert, an Veranstaltungen verknüpft
// (ANFORDERUNGEN 3.5, F-VER-05, WF-VER-10, WF-VER-13; E-11)
import { AppError } from '../../shared/errors';
import { partnerCreateSchema, partnerUpdateSchema, type Partner } from '../../shared/schema';
import type { PartnerDetail, PartnerListItem, Undoable } from '../api';
import {
  checkVersion,
  findEvent,
  isMarked,
  notFound,
  parse,
  registerUndo,
  rule,
  touch,
  writeHistory,
  type Ctx,
  type Db,
} from './server';

const uuid = () => crypto.randomUUID();

export function findPartner(db: Db, id: string): Partner {
  const partner = db.partners.find((p) => p.id === id);
  if (!partner) throw notFound('Diesen Partner');
  return partner;
}

function listItem(db: Db, p: Partner): PartnerListItem {
  return {
    ...p,
    event_count: db.event_partners.filter((ep) => ep.partner_id === p.id).length,
    marked: isMarked(db, 'partner', p.id),
  };
}

export function listPartners(db: Db): PartnerListItem[] {
  return db.partners
    .filter((p) => !p.archived_at)
    .map((p) => listItem(db, p))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** WF-VER-13: Detail zeigt, bei welchen Veranstaltungen der Partner schon beteiligt war */
export function getPartner(db: Db, id: string): PartnerDetail {
  const partner = findPartner(db, id);
  const events = db.event_partners
    .filter((ep) => ep.partner_id === id)
    .map((ep) => {
      const e = db.events.find((x) => x.id === ep.event_id)!;
      return { id: e.id, title: e.title, starts_at: e.starts_at, status: e.status, role_note: ep.role_note };
    })
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { ...listItem(db, partner), events };
}

function assertContact(db: Db, memberId: string | null): void {
  if (!memberId) return;
  const member = db.members.find((m) => m.id === memberId);
  if (!member || member.is_system || !member.active)
    throw new AppError('validation', 'Als Kontaktperson geht nur ein aktives Mitglied.', {
      field: 'internal_contact_member_id',
    });
}

function assertUniqueName(db: Db, name: string, exceptId?: string): void {
  if (db.partners.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase()))
    throw new AppError('validation', `Den Partner „${name}“ gibt es schon.`, { field: 'name' });
}

export function createPartner(ctx: Ctx, raw: unknown): { id: string } {
  const input = parse(partnerCreateSchema, raw);
  assertUniqueName(ctx.db, input.name);
  assertContact(ctx.db, input.internal_contact_member_id);
  const now = ctx.now.toISOString();
  const partner: Partner = {
    id: uuid(),
    ...input,
    archived_at: null,
    created_at: now,
    updated_at: now,
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.partners.push(partner);
  writeHistory(ctx, 'partner', partner.id, 'created', { name: { old: null, new: partner.name } });
  return { id: partner.id };
}

/** Mail und Telefon von Partnern stehen nicht in der Historie, nur dass sie geändert wurden (Entscheidung 22.10.2026) */
const HIDDEN_IN_HISTORY = new Set(['email', 'phone']);
const hiddenChange = { old: '(nicht gespeichert)', new: '(geändert)' };

export function updatePartner(ctx: Ctx, id: string, raw: unknown): void {
  const input = parse(partnerUpdateSchema, raw);
  const partner = findPartner(ctx.db, id);
  checkVersion(ctx, 'partner', partner, input.version);
  assertUniqueName(ctx.db, input.name, id);
  if (input.internal_contact_member_id !== partner.internal_contact_member_id)
    assertContact(ctx.db, input.internal_contact_member_id);
  const changes: Record<string, { old: unknown; new: unknown }> = {};
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
    (partner[key] as unknown) = input[key];
  }
  if (Object.keys(changes).length === 0) return;
  touch(ctx, partner);
  writeHistory(ctx, 'partner', id, 'updated', changes);
}

// ── Verknüpfung mit Veranstaltungen (WF-VER-10), eintragsweise ───────────────

export function linkPartner(ctx: Ctx, eventId: string, partnerId: string, roleNote: string | null): Undoable {
  const event = findEvent(ctx.db, eventId);
  const partner = findPartner(ctx.db, partnerId);
  if (partner.archived_at) throw rule('Dieser Partner ist archiviert.');
  if (ctx.db.event_partners.some((ep) => ep.event_id === eventId && ep.partner_id === partnerId))
    return { undo_token: '' };
  const note = roleNote?.trim() || null;
  if (note && note.length > 200)
    throw new AppError('validation', 'Höchstens 200 Zeichen.', { field: 'role_note' });
  ctx.db.event_partners.push({
    event_id: eventId,
    partner_id: partnerId,
    role_note: note,
    added_by: ctx.actor.id,
    added_at: ctx.now.toISOString(),
  });
  ctx.inverse.push({ kind: 'event_partner_remove', event_id: eventId, partner_id: partnerId });
  writeHistory(ctx, 'event', eventId, 'partner_added', { partner: { old: null, new: partner.name } });
  return registerUndo(ctx, 'event', event, `Partner verknüpft: ${partner.name}`);
}

export function unlinkPartner(ctx: Ctx, eventId: string, partnerId: string): Undoable {
  const event = findEvent(ctx.db, eventId);
  const row = ctx.db.event_partners.find((ep) => ep.event_id === eventId && ep.partner_id === partnerId);
  if (!row) return { undo_token: '' };
  const partner = findPartner(ctx.db, partnerId);
  ctx.db.event_partners = ctx.db.event_partners.filter((ep) => ep !== row);
  ctx.inverse.push({ kind: 'event_partner_restore', row });
  writeHistory(ctx, 'event', eventId, 'partner_removed', { partner: { old: partner.name, new: null } });
  return registerUndo(ctx, 'event', event, `Partner entfernt: ${partner.name}`);
}

/** „Mitglied deaktivieren“ ab P4: als interne Kontaktperson austragen (WF-ADM-03), Teil der Transaktion */
export function dropPartnerContacts(ctx: Ctx, memberId: string): number {
  const partners = ctx.db.partners.filter((p) => p.internal_contact_member_id === memberId);
  for (const p of partners) {
    p.internal_contact_member_id = null;
    touch(ctx, p);
    writeHistory(ctx, 'partner', p.id, 'contact_removed_deactivated', {
      internal_contact_member_id: { old: memberId, new: null },
    });
  }
  return partners.length;
}
