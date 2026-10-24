/**
 * Cookie names and flags (pure, testable). The session cookie is HttpOnly,
 * SameSite=Lax (needed for the top-level OAuth redirect back from Discord) and
 * Secure in production.
 */
export const SESSION_COOKIE = 'gynx_session';

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(isProduction: boolean, ttlHours: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ttlHours * 3600),
  };
}

export function oauthCookieOptions(isProduction: boolean, ttlSeconds: number): CookieOptions {
  return { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api/auth', maxAge: ttlSeconds };
}

/** Options that delete a cookie set with the given path. */
export function clearedCookieOptions(isProduction: boolean, path = '/'): CookieOptions {
  return { httpOnly: true, secure: isProduction, sameSite: 'lax', path, maxAge: 0 };
}

/** Serialise a Set-Cookie header value (used where Next's cookie API is unavailable). */
export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${o.path}`,
    `Max-Age=${o.maxAge}`,
    `SameSite=${o.sameSite === 'lax' ? 'Lax' : 'Strict'}`,
  ];
  if (o.httpOnly) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Read one cookie from a raw Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
