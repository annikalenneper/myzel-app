// Telegram-Bot (6.4), Phase 2: nur Verknüpfen per /start <code> und Hinweise; Buttons kommen mit P6.
// Unverknüpfte Chats bekommen nur einen Hinweis. Antworten gehen über `reply`, damit der Ablauf testbar bleibt.
import type { Kysely } from 'kysely';
import { AppError } from '../../src/shared/errors';
import type { Database } from '../db/types';
import { memberForChat, redeemTelegramCode } from './notify';

export interface TelegramUpdate {
  message?: { chat?: { id?: number | string; type?: string }; text?: string };
}

export async function handleTelegramUpdate(
  db: Kysely<Database>,
  update: TelegramUpdate,
  now: Date,
  appUrl: string,
  reply: (chatId: string, text: string) => Promise<void>,
): Promise<void> {
  const message = update.message;
  const chatId = message?.chat?.id;
  if (chatId === undefined || chatId === null) return;
  const chat = String(chatId);
  // nur persönliche Nachrichten (6.4) – in Gruppen bleibt der Bot still
  if (message?.chat?.type && message.chat.type !== 'private') return;
  const text = message?.text?.trim() ?? '';
  const start = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/);
  if (start) {
    try {
      const name = await redeemTelegramCode(db, now, start[1]!, chat);
      await reply(
        chat,
        `Hallo ${name}, Telegram ist jetzt mit Myzel verbunden. Hier kommen deine Erinnerungen.`,
      );
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      await reply(chat, `${e.message}\n${appUrl}/profil`);
    }
    return;
  }
  const name = await memberForChat(db, chat);
  await reply(
    chat,
    name
      ? `Hier kommen deine Erinnerungen aus Myzel. Antworten und Bearbeiten geht in der App: ${appUrl}`
      : `Dieser Chat ist nicht mit Myzel verbunden. Verknüpfen kannst du ihn im Profil der App: ${appUrl}/profil`,
  );
}
