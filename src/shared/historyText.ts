// Historie einer Aufgabe in lesbaren Sätzen (F-AUF-05):
// „Lea hat den Status von Geplant auf In Arbeit geändert.“
import { formatDayMonth } from './format';
import { PRIORITY_LABEL, TASK_STATUS_LABEL } from './labels';
import type { HistoryEntry, Priority, TaskStatus } from './schema';

export interface HistoryLookup {
  memberName(id: string): string;
  topicName(id: string): string;
  eventTitle(id: string): string;
  taskTitle(id: string): string;
}

const q = (s: unknown) => `„${String(s)}“`;
const day = (iso: unknown) => {
  const [y, m, d] = String(iso).split('-').map(Number) as [number, number, number];
  return formatDayMonth(new Date(y, m - 1, d));
};

function fieldSentences(entry: HistoryEntry, who: string, look: HistoryLookup): string[] {
  const c = entry.changes;
  const out: string[] = [];
  if (c.title) out.push(`${who} hat den Titel von ${q(c.title.old)} auf ${q(c.title.new)} geändert.`);
  if (c.topic_id)
    out.push(
      `${who} hat das Thema von ${look.topicName(String(c.topic_id.old))} auf ${look.topicName(String(c.topic_id.new))} geändert.`,
    );
  if (c.priority)
    out.push(
      `${who} hat die Priorität von ${PRIORITY_LABEL[c.priority.old as Priority]} auf ${PRIORITY_LABEL[c.priority.new as Priority]} geändert.`,
    );
  if (c.due_date) {
    const { old, new: next } = c.due_date;
    if (!next) out.push(`${who} hat die Frist entfernt.`);
    else if (!old) out.push(`${who} hat die Frist auf ${day(next)} gesetzt.`);
    else out.push(`${who} hat die Frist von ${day(old)} auf ${day(next)} geändert.`);
  }
  if (c.event_id) {
    const { old, new: next } = c.event_id;
    if (!next) out.push(`${who} hat die Veranstaltung ${look.eventTitle(String(old))} entfernt.`);
    else out.push(`${who} hat die Veranstaltung ${look.eventTitle(String(next))} zugeordnet.`);
  }
  if (c.appointment_id)
    out.push(
      c.appointment_id.new ? `${who} hat einen Termin zugeordnet.` : `${who} hat den Termin entfernt.`,
    );
  if (c.description) out.push(`${who} hat die Beschreibung geändert.`);
  return out;
}

function statusSentence(entry: HistoryEntry, who: string): string {
  const c = entry.changes;
  const from = TASK_STATUS_LABEL[c.status!.old as TaskStatus];
  const to = TASK_STATUS_LABEL[c.status!.new as TaskStatus];
  let text = `${who} hat den Status von ${from} auf ${to} geändert.`;
  if (c.block_reason?.new) text += ` Grund: ${String(c.block_reason.new)}`;
  if (c.discard_reason?.new) text += ` Grund: ${String(c.discard_reason.new)}`;
  if (c.assignee?.new) text += ` ${who} ist jetzt eingetragen.`;
  return text;
}

const markSuffix = (entry: HistoryEntry) =>
  entry.changes.plenum_mark && entry.changes.plenum_mark.old === true && entry.action !== 'unmarked'
    ? ' Die Markierung „Fürs Plenum“ wurde dabei entfernt.'
    : '';

export function taskHistorySentence(entry: HistoryEntry, look: HistoryLookup): string {
  const who = look.memberName(entry.actor_member_id);
  const c = entry.changes;
  const person = (key: 'assignee' | 'follower', side: 'old' | 'new') => String(c[key]?.[side]);
  const isSelf = (id: string) => id === entry.actor_member_id;

  switch (entry.action) {
    case 'created': {
      const extras = [
        c.assignee?.new ? 'sich eingetragen' : null,
        c.plenum_mark?.new ? 'sie fürs Plenum markiert' : null,
      ].filter(Boolean);
      return extras.length
        ? `${who} hat die Aufgabe angelegt und ${extras.join(' und ')}.`
        : `${who} hat die Aufgabe angelegt.`;
    }
    case 'updated':
      return fieldSentences(entry, who, look).join(' ') || `${who} hat die Aufgabe bearbeitet.`;
    case 'status':
      return statusSentence(entry, who) + markSuffix(entry);
    case 'assignee_added': {
      const id = person('assignee', 'new');
      return isSelf(id) ? `${who} hat sich eingetragen.` : `${who} hat ${look.memberName(id)} zugewiesen.`;
    }
    case 'assignee_removed': {
      const id = person('assignee', 'old');
      const name = look.memberName(id);
      let text = isSelf(id) ? `${who} hat sich ausgetragen.` : `${who} hat ${name} ausgetragen.`;
      if (c.reason?.new === 'deactivated')
        text = `${who} hat ${name} deaktiviert – ${name} wurde ausgetragen.`;
      if (c.status)
        text += ` Der Status ging von ${TASK_STATUS_LABEL[c.status.old as TaskStatus]} zurück auf ${TASK_STATUS_LABEL[c.status.new as TaskStatus]}, weil niemand mehr eingetragen ist.`;
      return text + markSuffix(entry);
    }
    case 'follower_added': {
      // selbst folgen und entfolgen stehen nicht in der Historie
      return `${who} hat ${look.memberName(person('follower', 'new'))} bei den Folgenden eingetragen.`;
    }
    case 'follower_removed': {
      const id = person('follower', 'old');
      const name = look.memberName(id);
      if (c.reason?.new === 'deactivated')
        return `${who} hat ${name} deaktiviert – ${name} folgt nicht mehr.`;
      return `${who} hat ${name} bei den Folgenden entfernt.`;
    }
    case 'blocker_added':
      return `${who} hat eingetragen: wartet auf ${q(look.taskTitle(String(c.blocker?.new)))}.`;
    case 'blocker_removed':
      return `${who} hat entfernt: wartet auf ${q(look.taskTitle(String(c.blocker?.old)))}.`;
    case 'marked':
      return `${who} hat die Aufgabe fürs Plenum markiert.`;
    case 'unmarked':
      return `${who} hat die Markierung „Fürs Plenum“ entfernt.`;
    case 'comment_added':
      return `${who} hat kommentiert.`;
    case 'comment_edited':
      return `${who} hat einen eigenen Kommentar bearbeitet.`;
    case 'archived':
      return `${who} hat die Aufgabe archiviert.` + markSuffix(entry);
    case 'restored':
      return `${who} hat die Aufgabe wiederhergestellt.`;
    case 'document_linked':
      return `${who} hat das Dokument „${String(c.document?.new)}“ verknüpft.`;
    case 'document_unlinked':
      return `${who} hat die Verknüpfung mit „${String(c.document?.old)}“ gelöst.`;
    case 'undo':
      return `${who} hat rückgängig gemacht: ${String(c.undone?.old ?? 'letzte Aktion')}.`;
    default:
      return `${who} hat die Aufgabe geändert.`;
  }
}
