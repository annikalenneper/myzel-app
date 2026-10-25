// Nur bestätigte Mail-Adressen verknüpfen ein Mitglied – auch bei Google keine Ausnahme.
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { loginFromUser, tokenVerifier } from './login';

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

describe('Token lokal prüfen', async () => {
  const url = 'https://projekt.supabase.co';
  const issuer = `${url}/auth/v1`;
  const own = await generateKeyPair('ES256');
  const foreign = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(own.publicKey)), kid: 'k1', alg: 'ES256' };
  const verify = tokenVerifier(`${url}/`, createLocalJWKSet({ keys: [jwk] }));
  const token = (key: CryptoKey, claims: { iss?: string; aud?: string; sub?: string; exp?: string } = {}) => {
    const jwt = new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(claims.iss ?? issuer)
      .setAudience(claims.aud ?? 'authenticated')
      .setExpirationTime(claims.exp ?? '1h');
    if (claims.sub !== '') jwt.setSubject(claims.sub ?? 'login-1');
    return jwt.sign(key);
  };

  it('gültiges Token liefert die Login-ID', async () => {
    expect(await verify(await token(own.privateKey))).toBe('login-1');
  });

  it('fremder Schlüssel, falsches Projekt, falsche Zielgruppe, abgelaufen oder ohne Person: kein Login', async () => {
    expect(await verify(await token(foreign.privateKey))).toBeNull();
    expect(
      await verify(await token(own.privateKey, { iss: 'https://anderes.supabase.co/auth/v1' })),
    ).toBeNull();
    expect(await verify(await token(own.privateKey, { aud: 'anon' }))).toBeNull();
    expect(await verify(await token(own.privateKey, { exp: '-1m' }))).toBeNull();
    expect(await verify(await token(own.privateKey, { sub: '' }))).toBeNull();
    expect(await verify('kein-token')).toBeNull();
  });
});
