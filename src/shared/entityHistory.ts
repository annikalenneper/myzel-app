// Verlauf von Veranstaltungen, Terminen und Partnern in lesbaren Sätzen (16.3). Geänderte Felder stehen mit alt → neu;
// lange Texte wie die Beschreibung gekürzt, vorher und nachher.
import type { HistoryChanges, HistoryEntry } from './schema';

export interface EntityLookup {
  memberName(id: string): string;
  /** Namen für Thema und Veranstaltung – ohne: nur „das Thema geändert“ */
  topicName?(id: string): string;
  eventTitle?(id: string): string;
}

export type EntityNoun = 'Veranstaltung' | 'Termin' | 'Partner';

// Feld → [Bezeichnung mit Artikel im Akkusativ, Art der Darstellung]
type Shape = 'value' | 'text' | 'plain' | 'topic' | 'event' | 'member';
const FIELD: Record<string, [label: string, shape: Shape]> = {
  title: ['den Titel', 'value'],
  name: ['den Namen', 'value'],
  description: ['die Beschreibung', 'text'],
  notes: ['die Notizen', 'text'],
  starts_at: ['den Beginn', 'plain'],
  ends_at: ['das Ende', 'plain'],
  format: ['das Format', 'plain'],
  location: ['den Ort', 'value'],
  online_url: ['den Link', 'value'],
  event_id: ['die Veranstaltung', 'event'],
  type: ['die Art', 'plain'],
  kind: ['die Art', 'plain'],
  setup_at: ['den Aufbau', 'plain'],
  teardown_at: ['den Abbau', 'plain'],
  contact_person: ['die Ansprechperson', 'value'],
  email: ['die E-Mail', 'value'],
  phone: ['die Telefonnummer', 'value'],
  website: ['die Website', 'value'],
  internal_contact_member_id: ['die interne Kontaktperson', 'member'],
  topic_id: ['das Thema', 'topic'],
  urgency: ['die Dringlichkeit', 'plain'],
};

const short = (v: unknown, max = 80) => {
  const text = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** „von „A“ auf „B“ geändert“, „ergänzt: „B““ oder „entfernt (vorher: „A“)“ – Texte gekürzt (16.3: vorher → nachher) */
export function oldToNew(label: string, old: unknown, next: unknown, max = 80): string {
  const a = short(old, max);
  const b = short(next, max);
  if (!a) return `${label} ergänzt: „${b}“`;
  if (!b) return `${label} entfernt (vorher: „${a}“)`;
  return `${label} von „${a}“ auf „${b}“ geändert`;
}

/** bearbeiteter Kommentar: „einen Kommentar von „A“ auf „B“ geändert“ */
export const commentEdited = (c: HistoryChanges) =>
  c.body ? oldToNew('einen Kommentar', c.body.old, c.body.new, 60) : 'einen Kommentar bearbeitet';

/**
 * „den Titel von „A“ auf „B“ geändert und die Beschreibung von „…“ auf „…“ geändert“ – für jede Art gleich (3.10).
 * Leer, wenn keine bekannten Felder dabei sind.
 */
export function describeFieldChanges(
  c: HistoryChanges,
  look?: Omit<EntityLookup, 'memberName'> & Partial<EntityLookup>,
): string {
  const parts: string[] = [];
  for (const [key, change] of Object.entries(c)) {
    const field = FIELD[key];
    if (!field) continue;
    const [label, shape] = field;
    const name = (id: unknown, of?: (id: string) => string) => (id && of ? of(String(id)) : '');
    if (shape === 'value') parts.push(oldToNew(label, change.old, change.new));
    else if (shape === 'text') parts.push(oldToNew(label, change.old, change.new, 120));
    else if (shape === 'topic' && look?.topicName)
      parts.push(oldToNew(label, name(change.old, look.topicName), name(change.new, look.topicName)));
    else if (shape === 'event' && look?.eventTitle)
      parts.push(oldToNew(label, name(change.old, look.eventTitle), name(change.new, look.eventTitle)));
    else if (shape === 'member' && look?.memberName)
      parts.push(oldToNew(label, name(change.old, look.memberName), name(change.new, look.memberName)));
    else parts.push(`${label} geändert`);
  }
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}`;
}

export function entityHistorySentence(entry: HistoryEntry, noun: EntityNoun, look: EntityLookup): string {
  const who = look.memberName(entry.actor_member_id);
  const c = entry.changes;
  const the =
    noun === 'Veranstaltung' ? 'die Veranstaltung' : noun === 'Termin' ? 'den Termin' : 'den Partner';
  switch (entry.action) {
    case 'created':
      // WF-TER-12: nur ausgewählte Personen eingeladen
      return typeof c.invitees?.new === 'number'
        ? `${who} hat ${the} angelegt und ${c.invitees.new === 1 ? 'eine Person' : `${c.invitees.new} Personen`} eingeladen.`
        : `${who} hat ${the} angelegt.`;
    case 'updated': {
      const fields = describeFieldChanges(c, look);
      return fields ? `${who} hat ${fields}.` : `${who} hat ${the} geändert.`;
    }
    case 'status':
      return `${who} hat den Status geändert.`;
    case 'rsvp':
      return c.rsvp?.new === 'ja'
        ? `${who} hat zugesagt.`
        : c.rsvp?.new === 'nein'
          ? `${who} hat abgesagt.`
          : `${who} hat die Antwort zurückgenommen.`;
    case 'attendee_added':
    case 'attendee_removed': {
      const person = look.memberName(String(c.attendee?.new ?? c.attendee?.old ?? ''));
      const late = c.after_close?.new ? ' – nachträglich, nach dem Abschluss' : '';
      return entry.action === 'attendee_added'
        ? `${who} hat ${person} als anwesend eingetragen${late}.`
        : `${who} hat ${person} als nicht anwesend eingetragen${late}.`;
    }
    case 'protocol':
      return `${who} hat das Protokoll geändert.`;
    case 'closed':
      return `${who} hat das Plenum abgeschlossen.`;
    case 'archived':
      return `${who} hat ${the} archiviert.`;
    case 'restored':
      return `${who} hat ${the} wiederhergestellt.`;
    case 'comment_added':
      return `${who} hat kommentiert.`;
    case 'comment_edited':
      return `${who} hat ${commentEdited(c)}.`;
    case 'document_linked':
      return `${who} hat das Dokument „${String(c.document?.new)}“ verknüpft.`;
    case 'document_unlinked':
      return `${who} hat die Verknüpfung mit „${String(c.document?.old)}“ gelöst.`;
    case 'undo':
      return `${who} hat rückgängig gemacht: ${String(c.undone?.old ?? 'letzte Aktion')}.`;
    default:
      return `${who} hat ${the} geändert.`;
  }
}
