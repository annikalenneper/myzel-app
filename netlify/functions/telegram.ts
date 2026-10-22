// Netlify Function: Webhook des Telegram-Bots (6.4). Telegram schickt das Secret im Header
// „X-Telegram-Bot-Api-Secret-Token“ mit (gesetzt per `npm run telegram:webhook`); ohne passendes Secret passiert nichts.
import '../../server/core/berlin';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from '@netlify/functions';
import { database } from '../../server/db/connection';
import { appUrl, sendTelegram } from '../../server/p2/senders';
import { handleTelegramUpdate, type TelegramUpdate } from '../../server/p2/telegramBot';

function authorized(req: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (secret.length < 16 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST' || !authorized(req)) return new Response('Nicht berechtigt.', { status: 401 });
  try {
    const update = (await req.json()) as TelegramUpdate;
    await handleTelegramUpdate(database(), update, new Date(), appUrl(), async (chat, text) => {
      await sendTelegram(chat, text);
    });
  } catch (e) {
    // Telegram wiederholt sonst dieselbe Nachricht immer wieder – Fehler nur ins Log
    console.error(e);
  }
  return new Response('ok');
};

export const config: Config = { path: '/telegram/webhook' };
