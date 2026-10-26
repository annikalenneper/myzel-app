// Plenum (ANFORDERUNGEN 16.2): wann ein Plenum läuft, welche Änderungen dazugehören und wie das Ergebnis aussieht.
// Gemeinsam für Testdaten-Schicht und Server – beide sammeln die Daten selbst und formatieren hier.
import { formatDayMonth } from '../format';
import { EVENT_STATUS_LABEL, TASK_STATUS_LABEL } from '../labels';
import type {
  Appointment,
  Decision,
  DocumentRow,
  EventRow,
  HistoryEntityType,
  Partner,
  Question,
  ResultGroup,
  Task,
} from '../schema';
import { APPOINTMENT_STATUS_LABEL } from './appointments';

/** Plenum ohne Ende: so lange zählt es als laufend (Annahme U4) */
export const PLENUM_DEFAULT_HOURS = 3;

type Window = Pick<Appointment, 'starts_at' | 'ends_at'>;

/** Ende des Zeitraums „während des Plenums“ */
export function plenumEnd(p: Window): string {
  return (
    p.ends_at ?? new Date(new Date(p.starts_at).getTime() + PLENUM_DEFAULT_HOURS * 3_600_000).toISOString()
  );
}

/** Läuft das Plenum gerade? Abgeschlossene und abgesagte zählen nie (längstens bis zum Abschließen). */
export function isPlenumRunning(p: Window & Pick<Appointment, 'status'>, now: Date): boolean {
  if (p.status !== 'geplant' && p.status !== 'stattgefunden') return false;
  const t = now.getTime();
  return new Date(p.starts_at).getTime() <= t && t <= new Date(plenumEnd(p)).getTime();
}

/** Was die Sitzung über das laufende bzw. nächste Plenum weiß – die App fragt damit vor einer Änderung nach. */
export interface SessionPlenum {
  id: string;
  title: string;
  starts_at: string;
  /** Ende des Zeitraums (ohne Ende: Beginn + 3 Stunden) */
  ends_at: string;
  /** auf der Teilnehmerliste: Zusage „ja“ oder als anwesend abgehakt – dann zählt alles automatisch */
  participant: boolean;
}

/** So weit im Voraus kennt die Sitzung das nächste Plenum */
export const SESSION_PLENUM_LOOKAHEAD_MS = 24 * 3_600_000;

/**
 * Profil und Verwaltung gehören nie zum Plenum – auch nicht bei Personen auf der Teilnehmerliste (F1, Nutzerin
 * 30.10.2026). Sonst landete z. B. das Austragen einer deaktivierten Person aus ihren Aufgaben im Ergebnis.
 */
export const OUTSIDE_PLENUM_ACTIONS: ReadonlySet<string> = new Set([
  'updateOwnName',
  'createMember',
  'updateMember',
  'deactivateMember',
  'reactivateMember',
  'addMemberEmail',
  'removeMemberEmail',
  'createTopic',
  'updateTopic',
  'archiveTopic',
  'restoreTopic',
  'deleteTopic',
  'savePushSubscription',
  'removePushSubscription',
  'setPush',
  'startTelegramLink',
  'unlinkTelegram',
  'setNotificationPreference',
  'setReminderLeadDays',
  'createAppointmentType',
  'updateAppointmentType',
  'archiveAppointmentType',
  'restoreAppointmentType',
  'deleteAppointmentType',
  'createTemplateItem',
  'updateTemplateItem',
  'removeTemplateItem',
  'createAppReport',
]);

/** Welche Historie zum Plenum gehört: Änderungen an Artefakten, keine Zu- und Absagen, nicht das Plenum selbst. */
export const PLENUM_ENTITY_TYPES: readonly HistoryEntityType[] = [
  'task',
  'event',
  'appointment',
  'decision',
  'question',
  'document',
  'partner',
];
export function countsForPlenum(
  type: HistoryEntityType,
  id: string,
  action: string,
  plenumId: string,
): boolean {
  if (!PLENUM_ENTITY_TYPES.includes(type)) return false;
  if (action === 'rsvp') return false;
  return !(type === 'appointment' && id === plenumId);
}

// ── Ergebnis (F-PLE-04, 16.2): je Artefakt eine Zeile ──────────────────────

export interface ResultItem {
  text: string;
  /** Ziel in der App */
  link: string;
}
export interface ResultGroupItems {
  group: ResultGroup;
  items: ResultItem[];
}

export const RESULT_TITLE: Record<ResultGroup, string> = {
  beschluesse: 'Entscheidungen & Fakten',
  aufgaben: 'Aufgaben',
  fragen: 'Fragen',
  termine: 'Veranstaltungen & Termine',
  besprochen: 'Dokumente & Partner',
};

const RESULT_ORDER: readonly ResultGroup[] = ['beschluesse', 'aufgaben', 'fragen', 'termine', 'besprochen'];

/** Ein Artefakt im Ergebnis, mit dem, was die Zeile braucht */
export type ResultSubject =
  | {
      type: 'decision';
      row: Pick<Decision, 'id' | 'title' | 'kind' | 'status' | 'consensus_until' | 'source_question_id'>;
      created: boolean;
      question_title: string | null;
      successor_title: string | null;
    }
  | {
      type: 'task';
      row: Pick<Task, 'id' | 'title' | 'status' | 'due_date'>;
      created: boolean;
      assignee_names: string[];
    }
  | { type: 'question'; row: Pick<Question, 'id' | 'title' | 'status' | 'answer'>; created: boolean }
  | { type: 'event'; row: Pick<EventRow, 'id' | 'title' | 'status'>; created: boolean }
  | { type: 'appointment'; row: Pick<Appointment, 'id' | 'title' | 'status' | 'starts_at'>; created: boolean }
  | { type: 'document'; row: Pick<DocumentRow, 'id' | 'title' | 'url'>; created: boolean }
  | { type: 'partner'; row: Pick<Partner, 'id' | 'name'>; created: boolean };

/** eine Zeile, höchstens max Zeichen – lange Antworten sprengen sonst Telegram und Push */
const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const dueText = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return formatDayMonth(new Date(y, m - 1, d));
};

function line(s: ResultSubject): { group: ResultGroup; item: ResultItem } {
  switch (s.type) {
    case 'decision': {
      const noun = s.row.kind === 'fakt' ? 'Fakt' : 'Entscheidung';
      // 16.4: eine offene Entscheidung gilt erst nach Bestätigung
      const pending =
        s.row.status === 'offen' && s.row.consensus_until
          ? ` – gilt erst nach Bestätigung, bis ${dueText(s.row.consensus_until)}`
          : '';
      const text =
        s.row.status === 'aufgehoben'
          ? `${noun} aufgehoben: ${s.row.title}`
          : s.row.status === 'ersetzt'
            ? `${noun} ersetzt: ${s.row.title}${s.successor_title ? ` → ${s.successor_title}` : ''}`
            : s.created
              ? `${s.row.kind === 'fakt' ? 'Neuer Fakt' : 'Neue Entscheidung'}: ${s.row.title}${pending}`
              : `${noun}: ${s.row.title}${pending}`;
      return { group: 'beschluesse', item: { text, link: `/agenda/eintrag/${s.row.id}` } };
    }
    case 'task': {
      const parts = [
        `${s.created ? 'Neu: ' : ''}${s.row.title}`,
        TASK_STATUS_LABEL[s.row.status],
        s.assignee_names.join(', '),
        s.row.due_date && `bis ${dueText(s.row.due_date)}`,
      ];
      return {
        group: 'aufgaben',
        item: { text: parts.filter(Boolean).join(' · '), link: `/agenda/${s.row.id}` },
      };
    }
    case 'question':
      return { group: 'fragen', item: { text: questionText(s), link: `/agenda/frage/${s.row.id}` } };
    case 'event':
      return {
        group: 'termine',
        item: {
          text: `${s.created ? 'Neu: ' : ''}${s.row.title} · ${EVENT_STATUS_LABEL[s.row.status]}`,
          link: `/events/${s.row.id}`,
        },
      };
    case 'appointment':
      return {
        group: 'termine',
        item: {
          text: `${s.created ? 'Neu: ' : ''}${s.row.title} · ${formatDayMonth(new Date(s.row.starts_at))} · ${APPOINTMENT_STATUS_LABEL[s.row.status]}`,
          link: `/termine/${s.row.id}`,
        },
      };
    case 'document':
      return { group: 'besprochen', item: { text: `Dokument: ${s.row.title}`, link: s.row.url } };
    case 'partner':
      return { group: 'besprochen', item: { text: `Partner: ${s.row.name}`, link: `/partner/${s.row.id}` } };
  }
}

type QuestionSubject = Extract<ResultSubject, { type: 'question' }>;
type DecisionSubject = Extract<ResultSubject, { type: 'decision' }>;

/** „Entscheidung „A“ (zu bestätigen bis 04.11.)“ – ein Ergebnis in der Zeile seiner Frage */
function resultText(d: DecisionSubject): string {
  const note =
    d.row.status === 'offen' && d.row.consensus_until
      ? ` (zu bestätigen bis ${dueText(d.row.consensus_until)})`
      : d.row.status === 'ersetzt' || d.row.status === 'aufgehoben'
        ? ` (${d.row.status})`
        : '';
  return `${d.row.kind === 'fakt' ? 'Fakt' : 'Entscheidung'} „${d.row.title}“${note}`;
}

/**
 * Eine Frage mit dem, was aus ihr wurde (F2, Nutzerin 30.10.2026): „Frage: X – Antwort: Y“ bei einer Antwort als
 * Notiz, „Frage: X – daraus entstanden: Entscheidung „A“, Fakt „B““ bei Ergebnissen; beides, wenn es beides gibt.
 */
function questionText(s: QuestionSubject, results: readonly DecisionSubject[] = []): string {
  const parts = [
    s.row.answer ? `Antwort: ${oneLine(s.row.answer, 120)}` : null,
    results.length ? `daraus entstanden: ${results.map(resultText).join(', ')}` : null,
  ].filter(Boolean);
  if (parts.length) return [`Frage: ${s.row.title}`, ...parts].join(' – ');
  if (s.row.status === 'verworfen') return `Verworfen: ${s.row.title}`;
  return `${s.created ? 'Neue Frage' : 'Offen'}: ${s.row.title}`;
}

/**
 * Ergebnis in fester Reihenfolge der Gruppen; innerhalb einer Gruppe in der Reihenfolge der Änderungen. Entscheidungen
 * und Fakten aus einer Frage stehen in der Zeile ihrer Frage, an der Stelle, an der die Frage zuerst vorkommt.
 */
export function buildResults(subjects: readonly ResultSubject[]): ResultGroupItems[] {
  const questions = new Map<string, { subject: QuestionSubject; results: DecisionSubject[] }>();
  const ordered: (ResultSubject | { type: 'question-line'; id: string })[] = [];
  const questionEntry = (id: string, fallback: () => QuestionSubject) => {
    let entry = questions.get(id);
    if (!entry) {
      entry = { subject: fallback(), results: [] };
      questions.set(id, entry);
      ordered.push({ type: 'question-line', id });
    }
    return entry;
  };
  for (const s of subjects) {
    if (s.type === 'question') questionEntry(s.row.id, () => s).subject = s;
    else if (s.type === 'decision' && s.row.source_question_id)
      questionEntry(s.row.source_question_id, () => ({
        type: 'question',
        // die Frage selbst wurde im Plenum nicht geändert: nur Titel und ihre Ergebnisse
        row: {
          id: s.row.source_question_id!,
          title: s.question_title ?? 'Frage',
          status: 'offen',
          answer: null,
        },
        created: false,
      })).results.push(s);
    else ordered.push(s);
  }
  const lines = ordered.map((s) => {
    if (s.type !== 'question-line') return line(s);
    const { subject, results } = questions.get(s.id)!;
    return {
      group: 'fragen' as const,
      item: { text: questionText(subject, results), link: `/agenda/frage/${s.id}` },
    };
  });
  return RESULT_ORDER.map((group) => ({
    group,
    items: lines.filter((l) => l.group === group).map((l) => l.item),
  })).filter((g) => g.items.length > 0);
}

/** Zusammenfassung an alle (F-PLE-04): erste Zeile Überschrift, dann je Gruppe Überschrift und Aufzählung */
export function summaryText(plenumTitle: string, groups: readonly ResultGroupItems[]): string {
  if (groups.length === 0)
    return `${plenumTitle} ist abgeschlossen – es wurde nichts angelegt oder geändert.`;
  const parts = groups.map((g) =>
    [`${RESULT_TITLE[g.group]}:`, ...g.items.map((i) => `• ${i.text}`)].join('\n'),
  );
  return [`${plenumTitle} ist abgeschlossen.`, ...parts].join('\n\n');
}
