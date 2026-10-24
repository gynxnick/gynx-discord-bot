import { describe, expect, it } from 'vitest';
import { checkCsrf, isSafeMethod } from './csrf';
import {
  clearedCookieOptions,
  oauthCookieOptions,
  readCookie,
  serializeCookie,
  sessionCookieOptions,
} from './cookies';

const TOKEN = 'csrf-token-0123456789abcdef0123456789';
const ORIGIN = 'https://dash.gynx.gg';
const h = (init: Record<string, string>) => new Headers(init);

describe('checkCsrf', () => {
  it('accepts a matching token from the dashboard origin', () => {
    expect(
      checkCsrf({
        headers: h({ 'x-csrf-token': TOKEN, origin: ORIGIN }),
        sessionCsrfToken: TOKEN,
        allowedOrigin: `${ORIGIN}/`,
      }),
    ).toEqual({ ok: true });
  });

  it('falls back to the Referer when Origin is absent', () => {
    expect(
      checkCsrf({
        headers: h({ 'x-csrf-token': TOKEN, referer: `${ORIGIN}/security/reports` }),
        sessionCsrfToken: TOKEN,
        allowedOrigin: ORIGIN,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a missing or wrong token', () => {
    expect(
      checkCsrf({ headers: h({ origin: ORIGIN }), sessionCsrfToken: TOKEN, allowedOrigin: ORIGIN }),
    ).toEqual({ ok: false, reason: 'missing_token' });
    expect(
      checkCsrf({
        headers: h({ 'x-csrf-token': `${TOKEN}x`, origin: ORIGIN }),
        sessionCsrfToken: TOKEN,
        allowedOrigin: ORIGIN,
      }),
    ).toEqual({ ok: false, reason: 'bad_token' });
    expect(
      checkCsrf({
        headers: h({ 'x-csrf-token': 'X'.repeat(TOKEN.length), origin: ORIGIN }),
        sessionCsrfToken: TOKEN,
        allowedOrigin: ORIGIN,
      }),
    ).toEqual({ ok: false, reason: 'bad_token' });
  });

  it('rejects cross-origin, look-alike, null and missing origins', () => {
    const base = { sessionCsrfToken: TOKEN, allowedOrigin: ORIGIN };
    expect(
      checkCsrf({ ...base, headers: h({ 'x-csrf-token': TOKEN, origin: 'https://evil.example' }) }),
    ).toEqual({ ok: false, reason: 'bad_origin' });
    expect(
      checkCsrf({
        ...base,
        headers: h({ 'x-csrf-token': TOKEN, origin: 'https://dash.gynx.gg.evil.example' }),
      }),
    ).toEqual({ ok: false, reason: 'bad_origin' });
    expect(
      checkCsrf({ ...base, headers: h({ 'x-csrf-token': TOKEN, origin: 'http://dash.gynx.gg' }) }),
    ).toEqual({ ok: false, reason: 'bad_origin' });
    expect(checkCsrf({ ...base, headers: h({ 'x-csrf-token': TOKEN, origin: 'null' }) })).toEqual({
      ok: false,
      reason: 'bad_origin',
    });
    expect(checkCsrf({ ...base, headers: h({ 'x-csrf-token': TOKEN }) })).toEqual({
      ok: false,
      reason: 'missing_origin',
    });
    expect(
      checkCsrf({
        ...base,
        headers: h({ 'x-csrf-token': TOKEN, referer: 'https://evil.example/https://dash.gynx.gg' }),
      }),
    ).toEqual({ ok: false, reason: 'bad_origin' });
  });

  it('classifies safe methods', () => {
    expect(isSafeMethod('GET')).toBe(true);
    expect(isSafeMethod('head')).toBe(true);
    expect(isSafeMethod('POST')).toBe(false);
    expect(isSafeMethod('DELETE')).toBe(false);
  });
});

describe('cookie flags', () => {
  it('session cookie is HttpOnly + SameSite=Lax everywhere, Secure only in production', () => {
    const prod = sessionCookieOptions(true, 12);
    const dev = sessionCookieOptions(false, 12);
    expect(prod).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 43_200 });
    expect(dev.secure).toBe(false);
    expect(dev.httpOnly).toBe(true);
    expect(serializeCookie('gynx_session', 'tok', prod)).toBe(
      'gynx_session=tok; Path=/; Max-Age=43200; SameSite=Lax; HttpOnly; Secure',
    );
    expect(serializeCookie('gynx_session', 'tok', dev)).not.toContain('Secure');
  });

  it('oauth cookie is scoped to /api/auth and short-lived; cleared cookies expire immediately', () => {
    expect(oauthCookieOptions(true, 600)).toMatchObject({
      path: '/api/auth',
      maxAge: 600,
      httpOnly: true,
      secure: true,
    });
    expect(clearedCookieOptions(true).maxAge).toBe(0);
  });

  it('reads a cookie from a header', () => {
    expect(readCookie('a=1; gynx_session=abc%3D; b=2', 'gynx_session')).toBe('abc=');
    expect(readCookie('xgynx_session=nope', 'gynx_session')).toBeUndefined();
    expect(readCookie(null, 'gynx_session')).toBeUndefined();
  });
});
