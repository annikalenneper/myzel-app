// Netlify Function: alle Server-Funktionen der App unter /api/<aktion> (ANFORDERUNGEN 7.2).
// Prüft den Supabase-Login (Bearer-Token) und führt die Aktion mit dieser Person aus – nie mit einer mitgeschickten ID.
import '../../server/core/berlin';
import { createClient } from '@supabase/supabase-js';
import type { Config, Context } from '@netlify/functions';
import type { Login } from '../../server/api/handle';
import { bearerToken, respond } from '../../server/api/http';
import { loginFromUser, tokenVerifier } from '../../server/api/login';
import { database } from '../../server/db/connection';

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const auth =
  supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey, { auth: { persistSession: false } }) : null;
const verifyToken = supabaseUrl ? tokenVerifier(supabaseUrl) : null;

/**
 * Login aus dem Token prüfen; ohne gültiges Token bleibt die Person anonym. Die Anmeldung (getSession) fragt
 * Supabase, weil nur dort die bestätigte Mail-Adresse für die erste Verknüpfung steht; alle anderen Aktionen prüfen
 * das Token lokal (16.6) – die Person ist dann schon verknüpft.
 */
async function loginFrom(req: Request, action: string): Promise<Login | null> {
  const token = bearerToken(req);
  if (!token || !auth || !verifyToken) return null;
  if (action !== 'getSession') {
    const authUserId = await verifyToken(token);
    return authUserId ? { authUserId, email: null } : null;
  }
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  return loginFromUser(data.user);
}

export default async (req: Request, context: Context): Promise<Response> =>
  respond(req, context.params.action ?? '', database, loginFrom);

export const config: Config = { path: '/api/:action' };
