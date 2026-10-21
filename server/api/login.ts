// Welche Supabase-Logins ein Mitglied verknüpfen dürfen: nur mit bestätigter Mail-Adresse. Supabase setzt
// email_confirmed_at beim Mail-Link nach dem Klick und bei Google nur, wenn Google die Adresse als bestätigt meldet.
import type { User } from '@supabase/supabase-js';
import type { Login } from './handle';

export function loginFromUser(user: Pick<User, 'id' | 'email' | 'email_confirmed_at'>): Login {
  return { authUserId: user.id, email: user.email_confirmed_at ? (user.email ?? null) : null };
}
