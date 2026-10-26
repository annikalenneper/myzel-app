// Testdaten-Schicht, Phase 6: Serien (ANFORDERUNGEN 3.6, F-TER-02, -03, WF-TER-09, -10).
// Der Joblauf legt Einzeltermine rollierend 3 Monate im Voraus an – je Serie und Tag höchstens einmal – und lädt
// etwa 2 Wochen vorher ein. Serienänderungen wirken nur auf künftige Nicht-Ausnahmen; Zusagen bleiben erhalten.
import { changeMessages, hasStarted, invitationMessages, yesAndOpen } from '../../shared/rules/appointments';
import { toIsoDate } from '../../shared/rules/due';
import {
  ruleAnchor,
  ruleLabel,
  SERIES_INVITE_DAYS,
  seriesDates,
  seriesHorizon,
} from '../../shared/rules/series';
import {
  seriesCreateSchema,
  seriesUpdateSchema,
  type Appointment,
  type AppointmentSeries,
  type HistoryChanges,
} from '../../shared/schema';
import type { SeriesDetail } from '../api';
import { activeIds, checkRefs } from './appointments';
import { enqueue } from './notify';
import { checkVersion, notFound, parse, rule, touch, writeHistory, type Ctx, type Db } from './server';

const iso = (ctx: Ctx) => ctx.now.toISOString();

/** Tag + Uhrzeit (Ortszeit) als Zeitstempel – in Schritt C fest Europe/Berlin */
export function atClock(isoDate: string, clock: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const [h, min] = clock.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, d, h, min).toISOString();
}

export function findSeries(db: Db, id: string): AppointmentSeries {
  const series = db.appointment_series.find((s) => s.id === id);
  if (!series) throw notFound('Diese Serie');
  return series;
}

export function seriesDetail(db: Db, id: string, now: Date): SeriesDetail {
  const s = findSeries(db, id);
  return {
    ...s,
    label: ruleLabel(s.rrule),
    upcoming: db.appointments
      .filter((a) => a.series_id === id && !a.archived_at && a.status === 'geplant' && !hasStarted(a, now))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((a) => ({ id: a.id, starts_at: a.starts_at, is_exception: a.is_exception })),
  };
}

/** Werte, die ein Serientermin von seiner Serie übernimmt */
const fromSeries = (s: AppointmentSeries, date: string) => ({
  title: s.title,
  starts_at: atClock(date, s.start_time),
  ends_at: s.end_time ? atClock(date, s.end_time) : null,
  format: s.format,
  location: s.format === 'online' ? null : s.location,
  online_url: s.format === 'vor_ort' ? null : s.online_url,
});

const invited = (db: Db, a: Appointment) =>
  db.notification_outbox.some((o) => o.dedupe_key.startsWith(`termin_einladung:${a.id}:`));

/** Tage, für die die Serie gerade Termine haben soll: ab heute (frühestens ab Beginn) bis zum Horizont */
function plannedDates(s: AppointmentSeries, today: string): string[] {
  const from = s.valid_from > today ? s.valid_from : today;
  return seriesDates(s.rrule, s.anchor_date, from, seriesHorizon(today, s.valid_until));
}

/**
 * Wer von einer Änderung an einem Serientermin erfährt: nach der Einladung Zusagen und alle ohne Antwort, davor nur,
 * wer schon zugesagt hat – die übrigen haben noch nichts von dem Termin gehört und bekommen später die Einladung.
 */
function concerned(ctx: Ctx, a: Appointment): string[] {
  const rsvps = ctx.db.appointment_rsvps.filter((r) => r.appointment_id === a.id);
  const yes = rsvps.filter((r) => r.answer === 'ja').map((r) => r.member_id);
  // eingeladen und ohne Antwort – nicht, wer nie eingeladen wurde (die anlegende Person, später Dazugekommene)
  const invitedOpen = yesAndOpen(rsvps, activeIds(ctx.db)).filter((m) =>
    ctx.db.notification_outbox.some((o) => o.dedupe_key.startsWith(`termin_einladung:${a.id}:${m}:`)),
  );
  return [...new Set([...yes, ...invitedOpen])].filter((m) => m !== ctx.actor.id);
}

/** Zeit oder Ort eines Serientermins geändert (6.2, 3.6) – oder ein abgesagter findet doch statt */
function notifyMoved(ctx: Ctx, a: Appointment, kind: 'verschoben' | 'findet_statt' = 'verschoben'): number {
  const recipients = concerned(ctx, a);
  enqueue(ctx.db, ctx.now, changeMessages(a, kind, recipients, ctx.actor.id, iso(ctx)), (ctx.outbox ??= []));
  return recipients.length;
}

/** Künftige Termine der Serie, die sie noch selbst verwaltet: geplant, nicht begonnen, keine Ausnahme */
const managed = (db: Db, s: AppointmentSeries, now: Date) =>
  db.appointments.filter(
    (a) =>
      a.series_id === s.id &&
      !a.archived_at &&
      !a.is_exception &&
      a.status === 'geplant' &&
      !hasStarted(a, now),
  );

/**
 * Termine bis zum Horizont anlegen (idempotent über Serie + Tag) und zu allem einladen, was in den nächsten
 * 2 Wochen liegt. Läuft beim Anlegen und Ändern einer Serie und in jedem Joblauf.
 */
export function generateSeries(ctx: Ctx, only?: string): number {
  const { db, now } = ctx;
  const today = toIsoDate(now);
  let created = 0;
  for (const s of db.appointment_series) {
    if (!s.active || (only && s.id !== only)) continue;
    for (const date of plannedDates(s, today)) {
      const fields = fromSeries(s, date);
      if (new Date(fields.starts_at).getTime() <= now.getTime()) continue;
      const existing = db.appointments.find((a) => a.series_id === s.id && a.series_date === date);
      if (existing) {
        // von der Serie selbst entfernt (Regel geändert, „Bis“ verkürzt) und jetzt wieder vorgesehen: zurückholen.
        // Einzeln abgesagte oder geänderte Ausnahmen bleiben, wie sie sind.
        if (!existing.is_exception && (existing.archived_at || existing.status === 'abgesagt'))
          restoreOccurrence(ctx, existing, s);
        continue;
      }
      const a: Appointment = {
        id: crypto.randomUUID(),
        type_id: s.type_id,
        topic_id: s.topic_id,
        event_id: null,
        description: null,
        ...fields,
        status: 'geplant',
        series_id: s.id,
        series_date: date,
        is_exception: false,
        protocol_document_id: null,
        protocol_member_id: null,
        notes: null,
        archived_at: null,
        created_at: iso(ctx),
        updated_at: iso(ctx),
        created_by: ctx.actor.id,
        version: 1,
      };
      db.appointments.push(a);
      writeHistory(ctx, 'appointment', a.id, 'created', {
        title: { old: null, new: a.title },
        series_id: { old: null, new: s.id },
      });
      created += 1;
    }
  }
  // Einladung ca. 2 Wochen vorher (6.2) an alle ohne Antwort – nicht an die Person, die die Serie angelegt hat
  // (wie bei einzelnen Terminen); der dedupe_key verhindert doppelte Einladungen
  const inviteUntil = now.getTime() + SERIES_INVITE_DAYS * 86_400_000;
  for (const a of db.appointments) {
    if (!a.series_id || (only && a.series_id !== only) || a.archived_at || a.status !== 'geplant') continue;
    const at = new Date(a.starts_at).getTime();
    if (at <= now.getTime() || at > inviteUntil) continue;
    const answered = new Set(
      db.appointment_rsvps.filter((r) => r.appointment_id === a.id).map((r) => r.member_id),
    );
    const creator = db.appointment_series.find((x) => x.id === a.series_id)?.created_by ?? ctx.actor.id;
    const open = activeIds(db).filter((m) => !answered.has(m));
    enqueue(db, now, invitationMessages(a, open, creator), (ctx.outbox ??= []));
  }
  return created;
}

/** Ein von der Serie entfernter Termin ist wieder vorgesehen – mit dem aktuellen Stand der Serie */
function restoreOccurrence(ctx: Ctx, a: Appointment, s: AppointmentSeries): void {
  const changes: HistoryChanges = {};
  if (a.archived_at) changes.archived_at = { old: a.archived_at, new: null };
  if (a.status !== 'geplant') changes.status = { old: a.status, new: 'geplant' };
  const wasCancelled = a.status === 'abgesagt';
  Object.assign(a, fromSeries(s, a.series_date!), { archived_at: null, status: 'geplant' });
  touch(ctx, a);
  writeHistory(ctx, 'appointment', a.id, 'restored', { ...changes, series_id: { old: s.id, new: s.id } });
  // wer die Absage bekommen hat, erfährt, dass der Termin doch stattfindet
  if (wasCancelled) notifyMoved(ctx, a, 'findet_statt');
}

/** WF-TER-09: Serie anlegen; die ersten Termine entstehen sofort */
export function createSeries(ctx: Ctx, raw: unknown): { id: string; created: number } {
  const input = parse(seriesCreateSchema, raw);
  const type = checkRefs(ctx, { type_id: input.type_id, event_id: null }, true);
  const s: AppointmentSeries = {
    id: crypto.randomUUID(),
    ...input,
    anchor_date: ruleAnchor(input.rrule, input.valid_from),
    location: input.format === 'online' ? null : input.location,
    online_url: input.format === 'vor_ort' ? null : input.online_url,
    topic_id: type.default_topic_id,
    active: true,
    created_at: iso(ctx),
    updated_at: iso(ctx),
    created_by: ctx.actor.id,
    version: 1,
  };
  ctx.db.appointment_series.push(s);
  writeHistory(ctx, 'appointment_series', s.id, 'created', {
    title: { old: null, new: s.title },
    rrule: { old: null, new: s.rrule },
  });
  return { id: s.id, created: generateSeries(ctx, s.id) };
}

/**
 * Ein Serientermin fällt weg (Regel geändert oder Serie beendet): Wer schon eingeladen ist oder geantwortet hat,
 * bekommt eine Absage. Ist er mit nichts verbunden (keine Antworten, Aufgaben, Dokumente), verschwindet
 * er still (archiviert).
 */
function dropOccurrence(ctx: Ctx, a: Appointment): number {
  const rsvps = ctx.db.appointment_rsvps.filter((r) => r.appointment_id === a.id);
  const linked =
    ctx.db.tasks.some((t) => t.appointment_id === a.id && !t.archived_at) ||
    ctx.db.document_links.some((l) => l.target_type === 'appointment' && l.target_id === a.id);
  if (!invited(ctx.db, a) && rsvps.length === 0 && !linked) {
    const changes: HistoryChanges = { archived_at: { old: null, new: iso(ctx) } };
    a.archived_at = iso(ctx);
    touch(ctx, a);
    writeHistory(ctx, 'appointment', a.id, 'archived', changes);
    return 0;
  }
  const changes: HistoryChanges = { status: { old: 'geplant', new: 'abgesagt' } };
  a.status = 'abgesagt';
  touch(ctx, a);
  writeHistory(ctx, 'appointment', a.id, 'status', changes);
  const recipients = concerned(ctx, a);
  enqueue(
    ctx.db,
    ctx.now,
    changeMessages(a, 'abgesagt', recipients, ctx.actor.id, iso(ctx)),
    (ctx.outbox ??= []),
  );
  return recipients.length;
}

/** WF-TER-09: Serie bearbeiten – wirkt nur auf künftige Nicht-Ausnahmen; Zusagen bleiben erhalten */
export function updateSeries(ctx: Ctx, id: string, raw: unknown): { notified: number } {
  const s = findSeries(ctx.db, id);
  if (!s.active) throw rule('Diese Serie ist beendet und lässt sich nicht mehr bearbeiten.');
  const input = parse(seriesUpdateSchema, raw);
  checkVersion(ctx, 'appointment_series', s, input.version);
  if (input.type_id !== s.type_id) throw rule('Die Terminart einer Serie lässt sich nicht ändern.');
  if (input.valid_from !== s.valid_from) throw rule('Der Beginn einer Serie lässt sich nicht ändern.');
  const next = {
    title: input.title,
    format: input.format,
    location: input.format === 'online' ? null : input.location,
    online_url: input.format === 'vor_ort' ? null : input.online_url,
    start_time: input.start_time,
    end_time: input.end_time,
    rrule: input.rrule,
    valid_until: input.valid_until,
  };
  const changes: HistoryChanges = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (s[key] === next[key]) continue;
    changes[key] = { old: s[key], new: next[key] };
    (s[key] as unknown) = next[key];
  }
  if (Object.keys(changes).length === 0) return { notified: 0 };
  const today = toIsoDate(ctx.now);
  if (changes.rrule) {
    // neuer Takt ab dem nächsten anstehenden Termin – nach ihm bietet das Formular die Regeln an (SeriesSheet);
    // sonst kippte „alle 2 Wochen“ je nach Beginn der Serie
    const next = seriesDetail(ctx.db, id, ctx.now).upcoming.find((u) => !u.is_exception);
    const base = next ? toIsoDate(new Date(next.starts_at)) : s.valid_from > today ? s.valid_from : today;
    const anchor = ruleAnchor(s.rrule, base);
    changes.anchor_date = { old: s.anchor_date, new: anchor };
    s.anchor_date = anchor;
  }
  touch(ctx, s);
  writeHistory(ctx, 'appointment_series', id, 'updated', changes);

  const keep = new Set(plannedDates(s, today));
  let notified = 0;
  for (const a of managed(ctx.db, s, ctx.now)) {
    if (!a.series_date || !keep.has(a.series_date)) {
      notified += dropOccurrence(ctx, a);
      continue;
    }
    const target = fromSeries(s, a.series_date);
    const diff: HistoryChanges = {};
    for (const key of Object.keys(target) as (keyof typeof target)[]) {
      const same =
        key === 'starts_at' || key === 'ends_at'
          ? (a[key] ? new Date(a[key]).getTime() : null) ===
            (target[key] ? new Date(target[key]).getTime() : null)
          : a[key] === target[key];
      if (same) continue;
      diff[key] = { old: a[key], new: target[key] };
      (a[key] as unknown) = target[key];
    }
    if (Object.keys(diff).length === 0) continue;
    touch(ctx, a);
    writeHistory(ctx, 'appointment', a.id, 'updated', { ...diff, series_id: { old: s.id, new: s.id } });
    // wie WF-TER-04: bei geänderter Zeit oder geändertem Ort bekommen Zusagen (und Eingeladene ohne Antwort) Bescheid
    const moved = ['starts_at', 'ends_at', 'format', 'location', 'online_url'].some((k) => k in diff);
    if (moved) notified += notifyMoved(ctx, a);
  }
  generateSeries(ctx, id);
  return { notified };
}

/** WF-TER-09: Serie beenden – künftige Termine der Serie entfallen, einzeln geänderte bleiben (Annahme A60) */
export function endSeries(ctx: Ctx, id: string, version: number): { notified: number } {
  const s = findSeries(ctx.db, id);
  checkVersion(ctx, 'appointment_series', s, version);
  if (!s.active) return { notified: 0 };
  const today = toIsoDate(ctx.now);
  const changes: HistoryChanges = { active: { old: true, new: false } };
  // „Bis“ nie vor dem Beginn: eine Serie, die noch nicht angefangen hat, endet an ihrem ersten Tag
  const until = s.valid_from > today ? s.valid_from : today;
  if (!s.valid_until || s.valid_until > until) {
    changes.valid_until = { old: s.valid_until, new: until };
    s.valid_until = until;
  }
  s.active = false;
  touch(ctx, s);
  writeHistory(ctx, 'appointment_series', id, 'ended', changes);
  let notified = 0;
  // ein Termin von heute, der noch bevorsteht, findet wie geplant statt
  for (const a of managed(ctx.db, s, ctx.now))
    if (!a.series_date || a.series_date > until) notified += dropOccurrence(ctx, a);
  return { notified };
}
