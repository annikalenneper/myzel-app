// Telegram-Buttons [P6] (ANFORDERUNGEN 6.4): welche Nachricht welche Buttons bekommt. Jede Aktion nutzt dieselbe
// Server-Logik wie die App, steht mit Person in der Historie, ist idempotent und wird im Chat bestätigt.
// „Blockiert“ gibt es bewusst nicht als Button, weil ein Grund nötig ist.
import type { NotificationEvent } from '../schema';

export type TelegramButtonKey =
  | 'uebernehme'
  | 'passt_nicht'
  | 'erledigt'
  | 'bin_dran'
  | 'neue_frist'
  | 'antworten'
  | 'weiter'
  | 'komme'
  | 'komme_nicht';

export interface TelegramButton {
  key: TelegramButtonKey;
  label: string;
  /** link: öffnet die App (Direktlink der Nachricht) statt etwas zu speichern */
  kind: 'action' | 'link';
}

const B = (
  key: TelegramButtonKey,
  label: string,
  kind: TelegramButton['kind'] = 'action',
): TelegramButton => ({
  key,
  label,
  kind,
});

const BUTTONS: Partial<Record<NotificationEvent, TelegramButton[]>> = {
  zuweisung: [B('uebernehme', 'Übernehme ich'), B('passt_nicht', 'Passt nicht')],
  frist_naht: [B('erledigt', 'Erledigt'), B('bin_dran', 'Bin dran')],
  frist_heute: [B('erledigt', 'Erledigt'), B('bin_dran', 'Bin dran')],
  frist_ueberschritten: [B('neue_frist', 'Neue Frist', 'link')],
  kommentar: [B('antworten', 'In App antworten', 'link')],
  blockade_aufgehoben: [B('weiter', 'Weiter geht’s')],
  termin_einladung: [B('komme', 'Komme'), B('komme_nicht', 'Komme nicht')],
  termin_erinnerung: [B('komme', 'Komme'), B('komme_nicht', 'Komme nicht')],
};

export function telegramButtons(event: NotificationEvent): TelegramButton[] {
  return BUTTONS[event] ?? [];
}

/** Ziel der Nachricht aus ihrem Direktlink: /aufgaben/<id> oder /termine/<id> */
export function linkTarget(link: string): { kind: 'task' | 'appointment'; id: string } | null {
  const m = /^\/(aufgaben|termine)\/([0-9a-f-]{36})$/.exec(link);
  if (!m) return null;
  return { kind: m[1] === 'aufgaben' ? 'task' : 'appointment', id: m[2]! };
}
