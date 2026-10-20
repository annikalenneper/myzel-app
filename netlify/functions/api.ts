// Netlify Function: alle Server-Funktionen der App unter /api/<aktion> (ANFORDERUNGEN 7.2).
// Prüft den Supabase-Login (Bearer-Token) und führt die Aktion mit dieser Person aus – nie mit einer mitgeschickten ID.
import { createClient } from '@supabase/supabase-js';
import type { Config, Context } from '@netlify/functions';
import { errorBody, handleAction, type Login } from '../../server/api/handle';
import { database } from '../../server/db/connection';

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const auth =
  supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey, { auth: { persistSession: false } }) : null;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** Login aus dem Token prüfen; ohne gültiges Token bleibt die Person anonym */
async function loginFrom(req: Request): Promise<Login | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !auth) return null;
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  // nur eine bestätigte Mail-Adresse darf ein Mitglied verknüpfen
  const confirmed = !!data.user.email_confirmed_at || data.user.app_metadata?.provider === 'google';
  return { authUserId: data.user.id, email: confirmed ? (data.user.email ?? null) : null };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: { code: 'rule', message: 'Nur POST.' } });
  const action = context.params.action ?? '';
  let args: unknown[] = [];
  try {
    const body = (await req.json()) as { args?: unknown };
    if (Array.isArray(body.args)) args = body.args;
  } catch {
    return json(400, { error: { code: 'validation', message: 'Die Anfrage ist unvollständig.' } });
  }
  try {
    const result = await handleAction(database(), await loginFrom(req), action, args, new Date());
    return json(200, { result: result ?? null });
  } catch (e) {
    const { status, body } = errorBody(e);
    return json(status, body);
  }
};

export const config: Config = { path: '/api/:action' };
