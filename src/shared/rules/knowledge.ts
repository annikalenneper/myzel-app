// Wissen (ANFORDERUNGEN 3.7 bis 3.9, 4.4, 4.5): Entscheidungen und Fakten, offene Fragen, Dokumente
import type {
  Decision,
  DecisionKind,
  DecisionStatus,
  DocType,
  Priority,
  Question,
  QuestionStatus,
} from '../schema';

export const DECISION_KIND_LABEL = {
  entscheidung: 'Entscheidung',
  fakt: 'Fakt',
} as const satisfies Record<DecisionKind, string>;
export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  gueltig: 'Gültig',
  ersetzt: 'Ersetzt',
  aufgehoben: 'Aufgehoben',
};
export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  offen: 'Offen',
  geklaert: 'Geklärt',
  verworfen: 'Verworfen',
};
export const DOC_TYPE_LABEL: Record<DocType, string> = {
  protokoll: 'Protokoll',
  leitlinie: 'Leitlinie',
  vorlage: 'Vorlage',
  schichtplan: 'Schichtplan',
  sonstiges: 'Sonstiges',
};

/**
 * Darf `oldId` durch `successorId` ersetzt werden? Das Ziel muss gültig sein, und es darf kein
 * Kreis entstehen (4.5). Liefert den Grund als Satz oder null.
 */
export function canSupersede(
  decisions: readonly Pick<Decision, 'id' | 'status' | 'superseded_by_id'>[],
  oldId: string,
  successorId: string,
): string | null {
  if (oldId === successorId) return 'Ein Eintrag kann sich nicht selbst ersetzen.';
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const successor = byId.get(successorId);
  if (!successor) return 'Diesen Eintrag gibt es nicht mehr.';
  if (successor.status !== 'gueltig') return 'Die Nachfolgerin muss gültig sein.';
  // folgt die Kette der Nachfolgerin irgendwann wieder auf den alten Eintrag, wäre es ein Kreis
  const seen = new Set<string>();
  let current = successor.superseded_by_id;
  while (current && !seen.has(current)) {
    if (current === oldId) return 'Das wäre ein Kreis: Der gewählte Eintrag verweist schon auf diesen.';
    seen.add(current);
    current = byId.get(current)?.superseded_by_id ?? null;
  }
  return null;
}

const URGENCY_RANK: Record<Priority, number> = { hoch: 0, mittel: 1, niedrig: 2 };

/** Fragen nach Dringlichkeit und Alter: dringend zuerst, bei gleicher Dringlichkeit die ältere (F-FRA-01). */
export function sortQuestions<T extends Pick<Question, 'urgency' | 'created_at'>>(
  questions: readonly T[],
): T[] {
  return [...questions].sort(
    (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.created_at.localeCompare(b.created_at),
  );
}

/** Mindestens eine Quelle ist Pflicht (3.8). */
export function hasSource(s: {
  source_plenum_id?: string | null;
  source_document_id?: string | null;
  source_note?: string | null;
}): boolean {
  return !!(s.source_plenum_id || s.source_document_id || s.source_note?.trim());
}
