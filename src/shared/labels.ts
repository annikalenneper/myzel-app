// Deutsche Bezeichnungen und Farben der Enums (ANFORDERUNGEN 8.1). Status steht immer auch als Text da.
import type { EventStatus, EventType, Priority, TaskStatus } from './schema';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  neu: 'Neu',
  geplant: 'Geplant',
  in_arbeit: 'In Arbeit',
  blockiert: 'Blockiert',
  erledigt: 'Erledigt',
  verworfen: 'Verworfen',
};

export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  neu: '#8C86A0',
  geplant: '#E2DCF0',
  in_arbeit: '#4FD1E0',
  blockiert: '#FF5D6C',
  erledigt: '#3DD68C',
  verworfen: '#4A4360',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  hoch: 'Hoch',
  mittel: 'Mittel',
  niedrig: 'Niedrig',
};
export const PRIORITY_BARS: Record<Priority, number> = { hoch: 3, mittel: 2, niedrig: 1 };

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  party: 'Party',
  workshop: 'Workshop',
  soli: 'Soli',
  sonstiges: 'Sonstiges',
};

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  idee: 'Idee',
  in_planung: 'In Planung',
  bestaetigt: 'Bestätigt',
  in_nachbereitung: 'In Nachbereitung',
  abgeschlossen: 'Abgeschlossen',
  abgesagt: 'Abgesagt',
};

export const EVENT_STATUS_COLOR: Record<EventStatus, string> = {
  idee: '#8C86A0',
  in_planung: '#E2DCF0',
  bestaetigt: '#4FD1E0',
  in_nachbereitung: '#F5B544',
  abgeschlossen: '#3DD68C',
  abgesagt: '#FF5D6C',
};

/** Farben der Initialen-Blasen wie im Prototyp, stabil aus der Mitglieds-ID abgeleitet. */
const BUBBLE_COLORS = ['#F062C0', '#9D6EF0', '#5B7FFF'] as const;
export function bubbleColor(memberId: string): string {
  let hash = 0;
  for (const ch of memberId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return BUBBLE_COLORS[hash % BUBBLE_COLORS.length]!;
}
