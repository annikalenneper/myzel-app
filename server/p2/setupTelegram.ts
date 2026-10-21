// Einrichtung des Telegram-Bots (einmalig, `npm run telegram:webhook`): meldet den Webhook der App bei Telegram an,
// mit dem Secret aus TELEGRAM_WEBHOOK_SECRET, und zeigt den Namen des Bots für TELEGRAM_BOT_USERNAME.
import { appUrl, telegramApi } from './senders';

const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
if (secret.length < 16 || !/^[A-Za-z0-9_-]+$/.test(secret))
  throw new Error('TELEGRAM_WEBHOOK_SECRET fehlt (mindestens 16 Zeichen, nur Buchstaben, Ziffern, _ und -).');
const url = `${process.env.APP_URL?.replace(/\/$/, '') || appUrl()}/telegram/webhook`;
const set = await telegramApi('setWebhook', {
  url,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: true,
});
console.log(set.ok ? `Webhook gesetzt: ${url}` : `Telegram lehnt ab: ${set.status} ${await set.text()}`);
const me = (await (await telegramApi('getMe', {})).json()) as { result?: { username?: string } };
console.log(
  `Bot: @${me.result?.username ?? '?'} – diesen Namen (ohne @) als TELEGRAM_BOT_USERNAME eintragen.`,
);
