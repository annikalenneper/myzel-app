// Laufendes Plenum in der App (16.2): Wer auf der Teilnehmerliste steht, dessen Änderungen gehören automatisch dazu;
// alle anderen fragt die App einmal je Plenum („Gehört das zum Plenum?“). Die Antwort gilt in diesem Tab.
import { api } from '../data';
import type { Session } from '../data/api';
import type { SessionPlenum } from '../shared/rules/plenum';

const answers = new Map<string, boolean>();

export function rememberPlenumAnswer(plenumId: string, belongs: boolean): void {
  answers.set(plenumId, belongs);
  api.setPlenumAnswer(plenumId, belongs);
}

/** beim Wechsel der angemeldeten Person: neu fragen */
export function forgetPlenumAnswers(): void {
  for (const plenumId of answers.keys()) api.setPlenumAnswer(plenumId, false);
  answers.clear();
}

/** das Plenum, das gerade läuft – sonst null */
export function runningPlenum(session: Session | undefined, now: Date): SessionPlenum | null {
  if (session?.state !== 'member' || !session.plenum) return null;
  const p = session.plenum;
  const t = now.getTime();
  return new Date(p.starts_at).getTime() <= t && t <= new Date(p.ends_at).getTime() ? p : null;
}

/** Gehört, was ich jetzt ändere, zum Plenum? undefined: noch nicht gefragt */
export function belongsToPlenum(p: SessionPlenum): boolean | undefined {
  return p.participant ? true : answers.get(p.id);
}
