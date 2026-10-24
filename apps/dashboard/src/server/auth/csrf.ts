import { timingSafeEqual } from 'node:crypto';

export const CSRF_HEADER = 'x-csrf-token';

export type CsrfResult =
  { ok: true } | { ok: false; reason: 'missing_token' | 'bad_token' | 'missing_origin' | 'bad_origin' };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method.toUpperCase());

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

function equalTokens(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * CSRF defence for state-changing requests (defence in depth on top of
 * SameSite=Lax cookies):
 *  1. `x-csrf-token` must equal the session's CSRF token (constant-time), and
 *  2. the Origin header (or, if absent, the Referer) must be the dashboard origin.
 */
export function checkCsrf(input: {
  headers: Headers;
  sessionCsrfToken: string;
  allowedOrigin: string;
}): CsrfResult {
  const token = input.headers.get(CSRF_HEADER);
  if (!token) return { ok: false, reason: 'missing_token' };
  if (!equalTokens(token, input.sessionCsrfToken)) return { ok: false, reason: 'bad_token' };

  const allowed = originOf(input.allowedOrigin);
  const origin = input.headers.get('origin');
  const source = origin && origin !== 'null' ? originOf(origin) : originOf(input.headers.get('referer'));
  if (!source) return { ok: false, reason: origin === 'null' ? 'bad_origin' : 'missing_origin' };
  if (!allowed || source !== allowed) return { ok: false, reason: 'bad_origin' };
  return { ok: true };
}
