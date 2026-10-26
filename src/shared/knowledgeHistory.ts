// Verlauf von Entscheidungen/Fakten und Fragen in lesbaren Sätzen (E-10, F-PLE-05 „im Plenum vom …“)
import type { HistoryEntry } from './schema';

export interface KnowledgeLookup {
  memberName(id: string): string;
  /** „im Plenum September“ – leer, wenn das Plenum unbekannt ist */
  plenumTitle(id: string): string;
}

export function knowledgeHistorySentence(
  entry: HistoryEntry,
  noun: 'Entscheidung' | 'Fakt' | 'Frage',
  look: KnowledgeLookup,
): string {
  const who = look.memberName(entry.actor_member_id);
  const c = entry.changes;
  const the = noun === 'Fakt' ? 'den Fakt' : `die ${noun}`;
  const plenumId = (c.plenum_id?.new ?? c.source_plenum_id?.new) as string | undefined;
  const title = plenumId ? look.plenumTitle(plenumId) : '';
  const inPlenum = title ? ` im ${title}` : '';
  const mark =
    c.plenum_mark?.old === true && entry.action !== 'unmarked'
      ? ' Die Markierung „Fürs Plenum“ wurde dabei entfernt.'
      : '';
  switch (entry.action) {
    case 'created':
      return noun === 'Frage'
        ? `${who} hat die Frage${inPlenum} gestellt${c.plenum_mark?.new ? ' und fürs Plenum markiert' : ''}.`
        : `${who} hat ${the}${inPlenum} angelegt.`;
    case 'created_as_replacement':
      return `${who} hat ${the}${inPlenum} als neue Fassung angelegt.`;
    case 'created_from_question':
      return `${who} hat ${the}${inPlenum} aus einer geklärten Frage angelegt.`;
    case 'replaced':
      return `${who} hat ${the}${inPlenum} ersetzt.${mark}`;
    case 'revoked':
      return `${who} hat ${the}${inPlenum} aufgehoben.${c.note?.new ? ` Notiz: ${String(c.note.new)}` : ''}${mark}`;
    case 'clarified':
      return `${who} hat die Frage${inPlenum} als beantwortet markiert.${mark}`;
    case 'result_added':
      return `${who} hat${inPlenum} ${c.kind?.new === 'fakt' ? 'einen Fakt' : 'eine Entscheidung'} festgehalten: „${String(c.title?.new ?? '')}“.`;
    case 'reopened':
      return `${who} hat die Frage${inPlenum} wieder geöffnet.`;
    case 'discarded':
      return `${who} hat die Frage${inPlenum} verworfen.${mark}`;
    case 'discussed':
      return `Besprochen${inPlenum || ' im Plenum'} – ohne Änderung.`;
    case 'marked':
      return `${who} hat ${the} fürs Plenum markiert.`;
    case 'unmarked':
      return `${who} hat die Markierung „Fürs Plenum“ entfernt.`;
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
