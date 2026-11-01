// Statuswechsel mit Rückfrage (Nutzerin, 31.10.2026): vor jedem Wechsel erklärt die App, was der neue Status heißt
// und was danach passiert. Die Sätze stehen hier, damit Aufgaben, Veranstaltungen und Fragen gleich sprechen.
import { EVENT_STATUS_LABEL, TASK_STATUS_LABEL } from '../labels';
import type { EventStatus, TaskStatus } from '../schema';
import { isActiveTaskStatus } from './taskStatus';

export interface StatusHelp {
  /** „Status ändern: Geplant → Erledigt?“ */
  title: string;
  /** was der neue Status heißt und was danach passiert */
  text: string;
  /** Knopf zum Bestätigen */
  confirm: string;
}

const change = (from: string, to: string) => `Status ändern: ${from} → ${to}?`;

const TASK_MEANS: Record<TaskStatus, string> = {
  neu: 'Die Aufgabe ist angelegt, aber noch nicht eingeplant.',
  geplant: 'Die Aufgabe ist eingeplant, aber noch nicht begonnen.',
  in_arbeit: 'Jemand arbeitet gerade daran. Zugeordnet wird dadurch niemand – das geht nur ausdrücklich.',
  blockiert:
    'Es geht gerade nicht weiter. Gib einen Grund an oder wähle eine Aufgabe, auf die gewartet wird.',
  erledigt: 'Die Aufgabe ist fertig. Wer auf sie wartet, erfährt es.',
  verworfen: 'Die Aufgabe wird nicht gemacht.',
};

export function taskStatusHelp(from: TaskStatus, to: TaskStatus): StatusHelp {
  const parts = [TASK_MEANS[to]];
  if (from === 'blockiert' && to !== 'blockiert')
    parts.push('Die Blockade ist damit gelöst; der Grund bleibt im Verlauf.');
  if (!isActiveTaskStatus(from) && isActiveTaskStatus(to))
    parts.push('Die Aufgabe wird wieder geöffnet und steht wieder unter „Aktuell“.');
  if (isActiveTaskStatus(from) && !isActiveTaskStatus(to))
    parts.push('Sie steht danach unter „Abgeschlossen“; wieder öffnen geht jederzeit.');
  parts.push('Bearbeitende und Folgende werden benachrichtigt, und du folgst der Aufgabe.');
  return {
    title: change(TASK_STATUS_LABEL[from], TASK_STATUS_LABEL[to]),
    text: parts.join(' '),
    confirm: `Auf „${TASK_STATUS_LABEL[to]}“ setzen`,
  };
}

const EVENT_MEANS: Record<EventStatus, string> = {
  idee: 'Erst eine Idee – noch nichts ist geplant.',
  in_planung: 'Die Veranstaltung wird vorbereitet.',
  bestaetigt: 'Die Veranstaltung findet sicher statt.',
  in_nachbereitung: 'Die Veranstaltung ist vorbei; jetzt wird nachbereitet.',
  abgeschlossen: 'Alles ist erledigt.',
  abgesagt: 'Die Veranstaltung findet nicht statt und steht danach unter „Abgesagt“.',
};

/** Veranstaltungen gehen nur vorwärts – zurück geht es nur gleich danach über „Rückgängig“ (4.2) */
export function eventStatusHelp(from: EventStatus, to: EventStatus, openTasks = 0): StatusHelp {
  const parts = [EVENT_MEANS[to]];
  if (to === 'abgeschlossen' && openTasks > 0)
    parts.push(
      `${openTasks === 1 ? '1 Aufgabe ist' : `${openTasks} Aufgaben sind`} noch offen. Sie ${
        openTasks === 1 ? 'bleibt' : 'bleiben'
      } offen und an der Veranstaltung hängen.`,
    );
  parts.push(
    to === 'abgeschlossen' || to === 'abgesagt'
      ? 'Danach lässt sich der Status nicht mehr ändern.'
      : 'Einen Schritt zurück gibt es nur gleich danach über „Rückgängig“.',
  );
  return {
    title: change(EVENT_STATUS_LABEL[from], EVENT_STATUS_LABEL[to]),
    text: parts.join(' '),
    confirm:
      to === 'abgeschlossen'
        ? 'Abschließen'
        : to === 'abgesagt'
          ? 'Absagen'
          : `Auf „${EVENT_STATUS_LABEL[to]}“ setzen`,
  };
}

/** Fragen: Verwerfen und Wieder öffnen (Beantworten hat einen eigenen Dialog) */
export function questionStatusHelp(to: 'verworfen' | 'offen'): StatusHelp {
  return to === 'verworfen'
    ? {
        title: 'Frage verwerfen?',
        text: 'Die Frage wird nicht weiter verfolgt und steht danach unter „Abgeschlossen“. Wieder öffnen geht jederzeit.',
        confirm: 'Verwerfen',
      }
    : {
        title: 'Frage wieder öffnen?',
        text: 'Die Frage ist wieder offen und steht wieder auf der Agenda. Antwort und Ergebnisse bleiben erhalten.',
        confirm: 'Wieder öffnen',
      };
}
