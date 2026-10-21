// Nur bestätigte Mail-Adressen verknüpfen ein Mitglied – auch bei Google keine Ausnahme.
import { describe, expect, it } from 'vitest';
import { loginFromUser } from './login';

describe('Login aus Supabase', () => {
  it('bestätigte Mail wird weitergegeben', () => {
    expect(
      loginFromUser({ id: 'u1', email: 'lea@example.org', email_confirmed_at: '2026-10-21T10:00:00Z' }),
    ).toEqual({ authUserId: 'u1', email: 'lea@example.org' });
  });

  it('unbestätigte Mail (auch von Google) verknüpft nichts', () => {
    expect(loginFromUser({ id: 'u2', email: 'lea@example.org', email_confirmed_at: undefined })).toEqual({
      authUserId: 'u2',
      email: null,
    });
  });
});
