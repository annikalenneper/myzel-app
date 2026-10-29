// Termine (ANFORDERUNGEN 3.6, 4.3): Status, Zu- und Absagen, Nachrichten an Zusagen und ohne Antwort
import { formatDayMonth, formatTime } from '../format';
import type {
  Appointment,
  AppointmentFormat,
  AppointmentRsvp,
  AppointmentStatus,
  NotificationEvent,
} from '../schema';
import type { Message } from './notifications';

export const FORMAT_LABEL: Record<AppointmentFormat, string> = {
  vor_ort: 'Vor Ort',
  online: 'Online',
  hybrid: 'Hybrid',
};

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  geplant: 'Geplant',
  stattgefunden: 'Stattgefunden',
  abgeschlossen: 'Abgeschlossen',
  abgesagt: 'Abgesagt',
};

export const APPOINTMENT_STATUS_COLOR: Record<AppointmentStatus, string> = {
  geplant: '#E2DCF0',
  stattgefunden: '#3DD68C',
  abgeschlossen: '#3DD68C',
  abgesagt: '#FF5D6C',
};

type Timed = Pick<Appointment, 'starts_at' | 'status'>;

export const hasStarted = (a: Timed, now: Date) => new Date(a.starts_at).getTime() <= now.getTime();

/** Zu- und Absage: nur im Status geplant und solange der Termin nicht vorbei ist (WF-TER-03). */
export const canRsvp = (a: Timed, now: Date) => a.status === 'geplant' && !hasStarted(a, now);

/** „Hat stattgefunden“: erst nach Beginn (WF-TER-06). */
export const canMarkHappened = (a: Timed, now: Date) => a.status === 'geplant' && hasStarted(a, now);

/** Bis wann ein Termin als „kommend“ zählt: bis zum Ende, ohne Ende bis zum Ende seines Tages. */
export function appointmentEnd(a: Pick<Appointment, 'starts_at' | 'ends_at'>): number {
  if (a.ends_at) return new Date(a.ends_at).getTime();
  const day = new Date(a.starts_at);
  day.setHours(23, 59, 59, 999);
  return day.getTime();
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
export const appointmentLink = (id: string) => `/termine/${id}`;

/** „Sa, 21.11., 10 Uhr“ */
export function whenText(iso: string): string {
  const d = new Date(iso);
  const time = d.getMinutes() === 0 ? `${d.getHours()} Uhr` : `${formatTime(d)} Uhr`;
  return `${WEEKDAYS[d.getDay()]}, ${formatDayMonth(d)}, ${time}`;
}

type AppointmentRef = Pick<Appointment, 'id' | 'title' | 'starts_at' | 'format' | 'online_url'>;

/**
 * Eingeladen sind alle aktiven Mitglieder oder – wenn beim Anlegen Personen ausgewählt wurden – nur diese und die
 * anlegende Person (Phase 12).
 */
export function invitedIds(
  activeMemberIds: readonly string[],
  inviteeIds: readonly string[],
  createdBy: string,
): string[] {
  if (inviteeIds.length === 0) return [...activeMemberIds];
  const chosen = new Set([...inviteeIds, createdBy]);
  return activeMemberIds.filter((id) => chosen.has(id));
}

/** Termin-Einladung: an alle Eingeladenen außer der anlegenden Person (6.2). */
export function invitationMessages(
  a: AppointmentRef,
  memberIds: readonly string[],
  actorId: string,
): Message[] {
  return memberIds
    .filter((id) => id !== actorId)
    .map((member_id) => ({
      member_id,
      event_type: 'termin_einladung' as const,
      text: `${a.title} am ${whenText(a.starts_at)} (${a.format === 'vor_ort' ? 'vor Ort' : FORMAT_LABEL[a.format].toLowerCase()}) – kommst du?`,
      link: appointmentLink(a.id),
      dedupe_key: `termin_einladung:${a.id}:${member_id}`,
    }));
}

/**
 * Wer bei Absage, Verschiebung und Erinnerung Bescheid bekommt: Zusagen und alle Eingeladenen ohne Antwort
 * (ohne Auswahl sind alle aktiven Mitglieder eingeladen).
 */
export function yesAndOpen(
  rsvps: readonly Pick<AppointmentRsvp, 'member_id' | 'answer'>[],
  activeMemberIds: readonly string[],
  invited: readonly string[] = activeMemberIds,
): string[] {
  const answers = new Map(rsvps.map((r) => [r.member_id, r.answer]));
  const isInvited = new Set(invited);
  return activeMemberIds.filter((id) => (answers.has(id) ? answers.get(id) === 'ja' : isInvited.has(id)));
}

export function changeMessages(
  a: AppointmentRef,
  kind: 'abgesagt' | 'verschoben' | 'findet_statt',
  recipientIds: readonly string[],
  actorId: string,
  at: string,
): Message[] {
  const text =
    kind === 'abgesagt'
      ? `${a.title} am ${formatDayMonth(new Date(a.starts_at))} fällt aus.`
      : kind === 'findet_statt'
        ? `${a.title} findet doch statt: ${whenText(a.starts_at)}.`
        : `${a.title} wurde geändert: jetzt ${whenText(a.starts_at)}.`;
  return recipientIds
    .filter((id) => id !== actorId)
    .map((member_id) => ({
      member_id,
      event_type: 'termin_geaendert' as const,
      text,
      link: appointmentLink(a.id),
      dedupe_key: `termin_${kind}:${a.id}:${member_id}:${at}`,
    }));
}

/** Termin-Erinnerung 3 Tage und 1 Stunde vorher, bei online mit Link (6.2). */
export function appointmentReminderMessages(
  items: readonly {
    appointment: AppointmentRef & Pick<Appointment, 'status'>;
    recipientIds: readonly string[];
  }[],
  now: Date,
): Message[] {
  const out: Message[] = [];
  const event: NotificationEvent = 'termin_erinnerung';
  for (const { appointment: a, recipientIds } of items) {
    if (a.status !== 'geplant') continue;
    const minutes = (new Date(a.starts_at).getTime() - now.getTime()) / 60_000;
    if (minutes <= 0) continue;
    const kind = minutes <= 60 ? 'stunde' : minutes <= 3 * 24 * 60 ? 'tage' : null;
    if (!kind) continue;
    const link = a.format !== 'vor_ort' && a.online_url ? ` Link: ${a.online_url}` : '';
    const text =
      kind === 'stunde'
        ? `Gleich: ${a.title} um ${formatTime(new Date(a.starts_at))} Uhr.${link}`
        : `Nicht vergessen: ${a.title} am ${whenText(a.starts_at)}.${link}`;
    for (const member_id of recipientIds)
      out.push({
        member_id,
        event_type: event,
        text,
        link: appointmentLink(a.id),
        dedupe_key: `termin_erinnerung_${kind}:${a.id}:${member_id}:${a.starts_at}`,
      });
  }
  return out;
}
