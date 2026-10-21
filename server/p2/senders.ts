// Versand in Betrieb (6.3, 6.4): Web-Push mit VAPID-Schlüsseln und Telegram über die Bot-API.
// Jede Nachricht nennt Titel, Datum und einen Direktlink; Telegram bekommt den Link als volle Adresse.
import webpush from 'web-push';
import type { Senders } from './notify';

/** Adresse der App für Links in Telegram – Netlify setzt URL selbst, lokal APP_URL */
export const appUrl = () =>
  (process.env.URL || process.env.APP_URL || 'http://localhost:8888').replace(/\/$/, '');

export function telegramApi(method: string, body: unknown): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN fehlt.');
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Eine Nachricht in einen Chat; Fehler der Bot-API werden zu Fehlern (der Joblauf versucht es noch einmal) */
export async function sendTelegram(chatId: string, text: string): Promise<void> {
  const response = await telegramApi('sendMessage', {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  });
  if (!response.ok) throw new Error(`Telegram antwortet ${response.status}.`);
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
          { TTL: 24 * 3600 },
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
      await sendTelegram(chatId, `${message.text}\n${appUrl()}${message.link}`);
    },
  };
}
