// Versand in Betrieb (6.3, 6.4): Web-Push mit VAPID-Schlüsseln und Telegram über die Bot-API.
// Jede Nachricht nennt Titel, Datum und einen Direktlink; Telegram bekommt den Link als volle Adresse.
// Jeder Aufruf nach außen hat eine Zeitgrenze, damit ein hängender Dienst den Joblauf nicht aufhält.
import webpush from 'web-push';
import { telegramHtml } from '../../src/shared/rules/telegram';
import { RetryLater, type Senders } from './notify';

const TIMEOUT_MS = 4_000;

/** Adresse der App für Links in Telegram – Netlify setzt URL selbst, lokal APP_URL */
export const appUrl = () =>
  (process.env.URL || process.env.APP_URL || 'http://localhost:8888').replace(/\/$/, '');

/** Der Bot-Token steckt in der Adresse – er darf in keiner Fehlermeldung landen (Log, Systemstatus) */
const hideToken = (text: string) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token ? text.split(token).join('<token>') : text;
};

export async function telegramApi(method: string, body: unknown): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN fehlt.');
  try {
    return await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // bewusst ohne cause: der ursprüngliche Fehler kann die Adresse mit dem Token enthalten
    // eslint-disable-next-line preserve-caught-error
    throw new Error(hideToken(`Telegram nicht erreichbar: ${e instanceof Error ? e.message : 'unbekannt'}`));
  }
}

/**
 * Eine Nachricht in einen Chat. „gone“: Bot blockiert oder Chat gibt es nicht mehr (403, 400 „chat not found“);
 * 429 heißt später noch einmal; andere Fehler werden wiederholt.
 */
export async function sendTelegram(chatId: string, text: string): Promise<'ok' | 'gone'> {
  const response = await telegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
  if (response.ok) return 'ok';
  const body = (await response.json().catch(() => ({}))) as { description?: string };
  const description = body.description ?? '';
  if (response.status === 403 || (response.status === 400 && /chat not found/i.test(description)))
    return 'gone';
  if (response.status === 429) throw new RetryLater('Telegram: zu viele Nachrichten, später noch einmal.');
  throw new Error(hideToken(`Telegram antwortet ${response.status}.`));
}

export function liveSenders(): Senders {
  const publicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (publicKey && privateKey && subject) webpush.setVapidDetails(subject, publicKey, privateKey);
  return {
    async push(sub, message) {
      if (!publicKey || !privateKey || !subject) throw new Error('VAPID-Schlüssel fehlen.');
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: 'Myzel', body: message.text, link: message.link }),
          { TTL: 24 * 3600, timeout: TIMEOUT_MS },
        );
        return 'ok';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // ungültige Abos (404/410) werden entfernt (6.1)
        if (status === 404 || status === 410) return 'gone';
        throw new Error(`Push-Dienst antwortet ${status ?? 'nicht'}.`, { cause: e });
      }
    },
    async telegram(chatId, message) {
      return sendTelegram(chatId, telegramHtml(message.text, `${appUrl()}${message.link}`));
    },
  };
}
