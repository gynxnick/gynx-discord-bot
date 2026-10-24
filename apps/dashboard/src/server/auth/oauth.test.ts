import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeUrl,
  callbackUrl,
  createPkcePair,
  pkceChallenge,
  safeReturnTo,
  signOAuthState,
  verifyOAuthState,
  type OAuthStatePayload,
} from './oauth';

const SECRET = 'test-session-secret-test-session-secret';
const now = new Date('2026-01-01T12:00:00Z');
const payload = (over: Partial<OAuthStatePayload> = {}): OAuthStatePayload => ({
  state: 'state-abc-123',
  verifier: 'v'.repeat(43),
  exp: Math.floor(now.getTime() / 1000) + 600,
  returnTo: '/security/reports',
  ...over,
});

describe('OAuth state cookie', () => {
  it('round-trips a signed state', () => {
    const cookie = signOAuthState(SECRET, payload());
    const r = verifyOAuthState(SECRET, cookie, 'state-abc-123', now);
    expect(r).toEqual({ ok: true, payload: payload() });
  });

  it('rejects a tampered payload', () => {
    const cookie = signOAuthState(SECRET, payload());
    const [, sig] = cookie.split('.');
    const forged = Buffer.from(JSON.stringify(payload({ returnTo: '/settings/permissions' }))).toString(
      'base64url',
    );
    expect(verifyOAuthState(SECRET, `${forged}.${sig}`, 'state-abc-123', now)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered signature and a different secret', () => {
    const cookie = signOAuthState(SECRET, payload());
    const flipped = cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A');
    expect(verifyOAuthState(SECRET, flipped, 'state-abc-123', now)).toMatchObject({
      ok: false,
      reason: 'bad_signature',
    });
    expect(
      verifyOAuthState('another-secret-another-secret-12345', cookie, 'state-abc-123', now),
    ).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('rejects expired state', () => {
    const cookie = signOAuthState(SECRET, payload({ exp: Math.floor(now.getTime() / 1000) - 1 }));
    expect(verifyOAuthState(SECRET, cookie, 'state-abc-123', now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a state parameter that does not match the cookie', () => {
    const cookie = signOAuthState(SECRET, payload());
    expect(verifyOAuthState(SECRET, cookie, 'state-abc-124', now)).toEqual({
      ok: false,
      reason: 'state_mismatch',
    });
    expect(verifyOAuthState(SECRET, cookie, 'short', now)).toEqual({ ok: false, reason: 'state_mismatch' });
  });

  it('rejects missing and malformed input', () => {
    expect(verifyOAuthState(SECRET, undefined, 'x', now)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyOAuthState(SECRET, 'abc', null, now)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyOAuthState(SECRET, 'no-dot', 'x', now)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyOAuthState(SECRET, 'a.b.c', 'x', now)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('re-sanitises returnTo even from a validly signed cookie', () => {
    const cookie = signOAuthState(SECRET, payload({ returnTo: '//evil.example' }));
    const r = verifyOAuthState(SECRET, cookie, 'state-abc-123', now);
    expect(r.ok && r.payload.returnTo).toBe('/');
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('creates verifiers in the allowed alphabet and length', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toBe(pkceChallenge(verifier));
    expect(createPkcePair().verifier).not.toBe(verifier);
  });
});

describe('authorize URL', () => {
  it('requests only the identify scope with S256 PKCE', () => {
    const u = new URL(
      buildAuthorizeUrl({
        clientId: '123456789012345678',
        redirectUri: callbackUrl('https://dash.gynx.gg/'),
        state: 's',
        challenge: 'c',
      }),
    );
    expect(u.origin + u.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(u.searchParams.get('scope')).toBe('identify');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe('https://dash.gynx.gg/api/auth/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/security/reports?status=NEW', '/security/reports?status=NEW'],
    ['/', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/api/auth/logout', '/'],
    ['/login', '/'],
    ['/ok\nSet-Cookie: x', '/'],
    [null, '/'],
    ['', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
