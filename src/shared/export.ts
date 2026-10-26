// Nächtlicher Export [P6] (ANFORDERUNGEN E-08, 10.6): alle Daten als YAML, gegen JSON-Schema geprüft, für ein
// privates Git-Repo – ohne E-Mails, Telefonnummern, Telegram-Chat-IDs und Push-Daten. Ohne Browser-Abhängigkeit,
// damit die nächtliche Function in Schritt C dieselbe Funktion nutzt.
import { stringify } from 'yaml';
import { z } from 'zod';
import {
  appointmentAttendeeSchema,
  appointmentRsvpSchema,
  appointmentSchema,
  appointmentSeriesSchema,
  appointmentTypeSchema,
  commentSchema,
  decisionSchema,
  decisionVoteSchema,
  documentLinkSchema,
  documentSchema,
  eventBookingSchema,
  eventDetailsSchema,
  eventLeadSchema,
  eventPartnerSchema,
  eventSchema,
  eventTemplateItemSchema,
  eventTemplateSchema,
  historySchema,
  memberSchema,
  partnerSchema,
  plenumMarkSchema,
  questionSchema,
  taskAssigneeSchema,
  taskBlockerSchema,
  taskFollowerSchema,
  taskSchema,
  templateApplicationSchema,
  topicSchema,
} from './schema';

/** 2: Umbau 10/2026 – Markierungen nur an Entscheidungen, Ergebnisse einer Frage über decisions.source_question_id */
// 4: Entscheidungen im Konsens – Status „offen“, consensus_until, decision_votes (16.4)
export const EXPORT_FORMAT_VERSION = 4;

/** Felder, die nie in den Export gehören – auch nicht als alter oder neuer Wert in der Historie */
export const EXPORT_EXCLUDED_FIELDS = [
  'email',
  'phone',
  'auth_user_id',
  'chat_id',
  'endpoint',
  // Kontakt der Location und eines Acts (Detailbereiche, Booking): meist Telefon oder Mail
  'contact',
  'location.contact',
  'booking.contact',
] as const;

const exportedMember = memberSchema.omit({ email: true, auth_user_id: true });
const exportedPartner = partnerSchema.omit({ email: true, phone: true });
const exportedHistory = historySchema.extend({
  changes: z.record(
    z.string(),
    z.object({ old: z.unknown(), new: z.unknown() }).or(z.object({ changed: z.literal(true) })),
  ),
});

export const exportSchema = z.object({
  format: z.literal('myzel-export'),
  version: z.literal(EXPORT_FORMAT_VERSION),
  exported_at: z.iso.datetime({ offset: true }),
  members: z.array(exportedMember),
  topics: z.array(topicSchema),
  tasks: z.array(taskSchema),
  task_assignees: z.array(taskAssigneeSchema),
  task_followers: z.array(taskFollowerSchema),
  task_blockers: z.array(taskBlockerSchema),
  comments: z.array(commentSchema),
  plenum_marks: z.array(plenumMarkSchema),
  events: z.array(eventSchema),
  event_details: z.array(eventDetailsSchema),
  event_bookings: z.array(eventBookingSchema),
  event_leads: z.array(eventLeadSchema),
  partners: z.array(exportedPartner),
  event_partners: z.array(eventPartnerSchema),
  event_templates: z.array(eventTemplateSchema),
  event_template_items: z.array(eventTemplateItemSchema),
  template_applications: z.array(templateApplicationSchema),
  appointment_types: z.array(appointmentTypeSchema),
  appointment_series: z.array(appointmentSeriesSchema),
  appointments: z.array(appointmentSchema),
  appointment_rsvps: z.array(appointmentRsvpSchema),
  appointment_attendees: z.array(appointmentAttendeeSchema),
  decisions: z.array(decisionSchema),
  decision_votes: z.array(decisionVoteSchema),
  questions: z.array(questionSchema),
  documents: z.array(documentSchema),
  document_links: z.array(documentLinkSchema),
  history: z.array(exportedHistory),
});
export type MyzelExport = z.infer<typeof exportSchema>;

/** Was der Export liest: die Tabellen der Datenbank (Benachrichtigungen, Abos, Jobläufe und Drive-Cache fehlen) */
export type ExportSource = {
  [
    K in Exclude<keyof MyzelExport, 'format' | 'version' | 'exported_at' | 'members' | 'partners' | 'history'>
  ]: readonly MyzelExport[K][number][];
} & {
  members: readonly z.infer<typeof memberSchema>[];
  partners: readonly z.infer<typeof partnerSchema>[];
  history: readonly z.infer<typeof historySchema>[];
};

const omit = <T extends object>(row: T, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));

/** Baut den Export und prüft ihn gegen das Schema – ein ungültiger Export wird nicht geschrieben. */
export function buildExport(db: ExportSource, now: Date): MyzelExport {
  const excluded: readonly string[] = EXPORT_EXCLUDED_FIELDS;
  const data = {
    format: 'myzel-export' as const,
    version: EXPORT_FORMAT_VERSION,
    exported_at: now.toISOString(),
    members: db.members.map((m) => omit(m, excluded)),
    topics: db.topics,
    tasks: db.tasks,
    task_assignees: db.task_assignees,
    task_followers: db.task_followers,
    task_blockers: db.task_blockers,
    comments: db.comments,
    plenum_marks: db.plenum_marks,
    events: db.events,
    // Kontaktfelder bleiben leer: die Struktur passt weiter zum Schema, der Inhalt fehlt
    event_details: db.event_details.map((d) => ({ ...d, location: { ...d.location, contact: null } })),
    event_bookings: db.event_bookings.map((b) => ({ ...b, contact: null })),
    event_leads: db.event_leads,
    partners: db.partners.map((p) => omit(p, excluded)),
    event_partners: db.event_partners,
    event_templates: db.event_templates,
    event_template_items: db.event_template_items,
    template_applications: db.template_applications,
    appointment_types: db.appointment_types,
    appointment_series: db.appointment_series,
    appointments: db.appointments,
    appointment_rsvps: db.appointment_rsvps,
    appointment_attendees: db.appointment_attendees,
    decisions: db.decisions,
    decision_votes: db.decision_votes,
    questions: db.questions,
    documents: db.documents,
    document_links: db.document_links,
    // in der Historie bleibt sichtbar, dass sich ein Kontaktfeld geändert hat – nicht, wie es lautet
    history: db.history.map((h) => ({
      ...h,
      changes: Object.fromEntries(
        Object.entries(h.changes).map(([k, v]) => [k, excluded.includes(k) ? { changed: true } : v]),
      ),
    })),
  };
  const result = exportSchema.safeParse(data);
  if (!result.success)
    throw new Error(
      `Der Export passt nicht zum Schema: ${result.error.issues[0]?.path.join('.')} – ${result.error.issues[0]?.message}`,
    );
  return result.data;
}

export function exportToYaml(data: MyzelExport): string {
  return stringify(data, { lineWidth: 0 });
}
