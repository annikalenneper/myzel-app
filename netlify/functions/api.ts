// Netlify Function: alle Server-Funktionen der App unter /api/<aktion> (ANFORDERUNGEN 7.2).
// Prüft den Supabase-Login (Bearer-Token) und führt die Aktion mit dieser Person aus – nie mit einer mitgeschickten ID.
import { createClient } from '@supabase/supabase-js';
import type { Config, Context } from '@netlify/functions';
import type { Login } from '../../server/api/handle';
import { bearerToken, respond } from '../../server/api/http';
import { database } from '../../server/db/connection';

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const auth =
  supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey, { auth: { persistSession: false } }) : null;

/** Login aus dem Token prüfen; ohne gültiges Token bleibt die Person anonym */
async function loginFrom(req: Request): Promise<Login | null> {
  const token = bearerToken(req);
  if (!token || !auth) return null;
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  // nur eine bestätigte Mail-Adresse darf ein Mitglied verknüpfen
  const confirmed = !!data.user.email_confirmed_at || data.user.app_metadata?.provider === 'google';
  return { authUserId: data.user.id, email: confirmed ? (data.user.email ?? null) : null };
}

export default async (req: Request, context: Context): Promise<Response> =>
  respond(req, context.params.action ?? '', database, loginFrom);

export const config: Config = { path: '/api/:action' };
