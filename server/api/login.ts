// Welche Supabase-Logins ein Mitglied verknüpfen dürfen: nur mit bestätigter Mail-Adresse. Supabase setzt
// email_confirmed_at beim Mail-Link nach dem Klick und bei Google nur, wenn Google die Adresse als bestätigt meldet.
import type { User } from '@supabase/supabase-js';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Login } from './handle';

export function loginFromUser(user: Pick<User, 'id' | 'email' | 'email_confirmed_at'>): Login {
  return { authUserId: user.id, email: user.email_confirmed_at ? (user.email ?? null) : null };
}

/**
 * Login-Prüfung ohne Rückfrage bei Supabase (16.6): das Token ist mit dem Schlüssel des Projekts signiert; die
 * öffentlichen Schlüssel holt die Function einmal und behält sie. Liefert die Login-ID oder null.
 * Ein abgemeldetes Token gilt so bis zu seinem Ablauf (Supabase: 1 Stunde) – wer deaktiviert ist, scheitert trotzdem
 * an der Mitgliederprüfung (resolveActor).
 */
export function tokenVerifier(
  supabaseUrl: string,
  keys?: JWTVerifyGetKey,
): (token: string) => Promise<string | null> {
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const getKey = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, getKey, { issuer, audience: 'authenticated' });
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  };
}
