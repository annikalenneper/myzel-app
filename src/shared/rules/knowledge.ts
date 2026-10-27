// Wissen (ANFORDERUNGEN 3.7 bis 3.9, 4.4, 4.5, 16.4): Entscheidungen und Fakten, Konsens, offene Fragen, Dokumente
import { addDays } from './due';
import type {
  Decision,
  DecisionKind,
  DecisionStatus,
  DecisionVoteKind,
  MarkReason,
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
  offen: 'Offen',
  gueltig: 'Gültig',
  ersetzt: 'Ersetzt',
  aufgehoben: 'Aufgehoben',
};
/** Die Frage, die auf der Karte steht (Phase 12) */
export const MARK_REASON_LABEL: Record<MarkReason, string> = {
  stimmt_noch: 'Stimmt das noch?',
  aktion: 'Aktion erforderlich',
};

export const DECISION_VOTE_LABEL: Record<DecisionVoteKind, string> = {
  bestaetigt: 'Bestätigt',
  widerspruch: 'Widerspruch',
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
 * Darf `oldId` durch `successorId` ersetzt werden? Das Ziel muss gültig oder offen sein (16.4), und es darf kein
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
  if (!decisionActive(successor.status)) return 'Die Nachfolgerin muss gültig oder offen sein.';
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

// ── Entscheidungen im Konsens (16.4) ─────────────────────────────────────────

/** Standardfrist zum Bestätigen in Tagen; längstens erlaubt */
export const CONSENSUS_DEFAULT_DAYS = 7;
export const CONSENSUS_MAX_DAYS = 90;

/** Frist ohne Angabe: heute + 7 Tage (Datum in Berlin) */
export const defaultConsensusUntil = (today: string) => addDays(today, CONSENSUS_DEFAULT_DAYS);

/** Ist die gewählte Frist erlaubt? Liefert den Grund als Satz oder null. */
export function consensusUntilProblem(until: string, today: string): string | null {
  if (until < today) return 'Die Frist darf nicht in der Vergangenheit liegen.';
  if (until > addDays(today, CONSENSUS_MAX_DAYS))
    return `Die Frist darf höchstens ${CONSENSUS_MAX_DAYS} Tage in der Zukunft liegen.`;
  return null;
}

export interface ConsensusCount {
  confirmed: number;
  objected: number;
  /** aktive Mitglieder, die abstimmen können */
  total: number;
}

/** Stimmen aktiver Mitglieder zählen – Stimmen ausgetretener Personen zählen nicht mehr */
export function countVotes(
  votes: readonly { member_id: string; vote: DecisionVoteKind }[],
  activeIds: readonly string[],
): ConsensusCount {
  const active = new Set(activeIds);
  const counted = votes.filter((v) => active.has(v.member_id));
  return {
    confirmed: counted.filter((v) => v.vote === 'bestaetigt').length,
    objected: counted.filter((v) => v.vote === 'widerspruch').length,
    total: active.size,
  };
}

/**
 * Wird die offene Entscheidung jetzt gültig? Ja, wenn alle aktiven Mitglieder bestätigt haben, oder wenn die Frist
 * abgelaufen ist und niemand widerspricht – nicht abgegebene Stimmen verfallen. Ein Widerspruch hält sie offen.
 */
export function consensusReached(
  decision: Pick<Decision, 'status' | 'consensus_until'>,
  count: ConsensusCount,
  today: string,
): boolean {
  if (decision.status !== 'offen' || !decision.consensus_until) return false;
  if (count.objected > 0) return false;
  return count.confirmed >= count.total || today > decision.consensus_until;
}

/** Status beim Anlegen: Entscheidungen warten auf Bestätigung, Fakten gelten sofort */
export const initialDecisionStatus = (kind: DecisionKind): DecisionStatus =>
  kind === 'entscheidung' ? 'offen' : 'gueltig';

/** Lässt sich der Eintrag noch bearbeiten, ersetzen, aufheben oder auf die Agenda setzen? */
export const decisionActive = (status: DecisionStatus) => status === 'gueltig' || status === 'offen';
