// Verlauf von Veranstaltungen, Terminen und Partnern in lesbaren Sätzen (16.3). Geänderte Felder stehen mit alt → neu;
// lange Texte wie die Beschreibung gekürzt mit ihrem vorherigen Stand.
import type { HistoryChanges, HistoryEntry } from './schema';

export interface EntityLookup {
  memberName(id: string): string;
}

export type EntityNoun = 'Veranstaltung' | 'Termin' | 'Partner';

const FIELD: Record<string, string> = {
  title: 'Titel',
  name: 'Namen',
  description: 'Beschreibung',
  starts_at: 'Beginn',
  ends_at: 'Ende',
  format: 'Format',
  location: 'Ort',
  online_url: 'Link',
  event_id: 'Veranstaltung',
  type: 'Art',
  kind: 'Art',
  setup_at: 'Aufbau',
  teardown_at: 'Abbau',
  contact_person: 'Ansprechperson',
  email: 'E-Mail',
  phone: 'Telefon',
  website: 'Website',
  notes: 'Notizen',
  internal_contact_member_id: 'interne Kontaktperson',
  topic_id: 'Thema',
  urgency: 'Dringlichkeit',
};

const short = (v: unknown, max = 80) => {
  const text = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * „den Titel von „A“ auf „B“ geändert und die Beschreibung geändert (vorher: „…“)“ – für jede Art gleich (3.10).
 * Leer, wenn keine bekannten Felder dabei sind.
 */
export function describeFieldChanges(c: HistoryChanges): string {
  const parts: string[] = [];
  for (const [key, change] of Object.entries(c)) {
    const label = FIELD[key];
    if (!label) continue;
    if (key === 'title' || key === 'name')
      parts.push(`den ${label} von „${short(change.old)}“ auf „${short(change.new)}“ geändert`);
    else if (key === 'description' || key === 'notes')
      parts.push(
        change.old
          ? `die ${label} geändert (vorher: „${short(change.old)}“)`
          : `die ${label} ergänzt: „${short(change.new)}“`,
      );
    else parts.push(`${key.endsWith('_at') || key === 'format' ? 'den' : 'die'} ${label} geändert`);
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
      return `${who} hat ${the} angelegt.`;
    case 'updated': {
      const fields = describeFieldChanges(c);
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
      return `${who} hat einen Kommentar bearbeitet.`;
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
