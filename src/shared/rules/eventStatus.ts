// Statusmodell Veranstaltung (ANFORDERUNGEN 4.2):
// idee → in_planung → bestaetigt → in_nachbereitung → abgeschlossen, jederzeit → abgesagt
import type { EventStatus } from '../schema';

const FLOW: readonly EventStatus[] = [
  'idee',
  'in_planung',
  'bestaetigt',
  'in_nachbereitung',
  'abgeschlossen',
];

export function isFinalEventStatus(status: EventStatus): boolean {
  return status === 'abgeschlossen' || status === 'abgesagt';
}

export function allowedEventTransitions(from: EventStatus): EventStatus[] {
  if (isFinalEventStatus(from)) return [];
  const next = FLOW[FLOW.indexOf(from) + 1];
  return next ? [next, 'abgesagt'] : ['abgesagt'];
}

export function canTransitionEvent(from: EventStatus, to: EventStatus): boolean {
  return allowedEventTransitions(from).includes(to);
}
