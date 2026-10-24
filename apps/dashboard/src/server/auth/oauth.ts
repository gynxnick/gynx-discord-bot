import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Pure helpers for the Discord OAuth2 authorization-code + PKCE flow.
 * No Next.js imports so they are unit-testable.
 */

export const OAUTH_COOKIE = 'gynx_oauth';
export const OAUTH_STATE_TTL_SECONDS = 600;
export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
export const DISCORD_REVOKE_URL = 'https://discord.com/api/oauth2/token/revoke';
export const DISCORD_ME_URL = 'https://discord.com/api/users/@me';

const b64url = (buf: Buffer): string => buf.toString('base64url');

export function randomUrlToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** RFC 7636 S256 code challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier, 'ascii').digest());
}

/** 43–128 char verifier from the unreserved alphabet (base64url of 32 random bytes = 43 chars). */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomUrlToken(32);
  return { verifier, challenge: pkceChallenge(verifier) };
}

export interface OAuthStatePayload {
  state: string;
  verifier: string;
  /** Unix seconds. */
  exp: number;
  /** Validated same-origin path to return to after login. */
  returnTo: string;
}

function sign(secret: string, data: string): string {
  return b64url(createHmac('sha256', secret).update(`oauth-state.v1.${data}`).digest());
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still spend comparable time so length differences are not a fast path.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function signOAuthState(secret: string, payload: OAuthStatePayload): string {
  const data = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${data}.${sign(secret, data)}`;
}

export type StateVerifyResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_signature' | 'expired' | 'state_mismatch' };

/**
 * Verify the signed state cookie and that the `state` query parameter matches
 * it (both comparisons constant-time).
 */
export function verifyOAuthState(
  secret: string,
  cookieValue: string | undefined | null,
  stateParam: string | undefined | null,
  now: Date,
): StateVerifyResult {
  if (!cookieValue || !stateParam) return { ok: false, reason: 'missing' };
  const parts = cookieValue.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [data, sig] = parts as [string, string];
  if (!constantTimeEqual(sign(secret, data), sig)) return { ok: false, reason: 'bad_signature' };

  let payload: OAuthStatePayload;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Partial<OAuthStatePayload>;
    if (
      typeof parsed.state !== 'string' ||
      typeof parsed.verifier !== 'string' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.returnTo !== 'string'
    ) {
      return { ok: false, reason: 'malformed' };
    }
    payload = parsed as OAuthStatePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp * 1000 < now.getTime()) return { ok: false, reason: 'expired' };
  if (!constantTimeEqual(payload.state, stateParam)) return { ok: false, reason: 'state_mismatch' };
  return { ok: true, payload: { ...payload, returnTo: safeReturnTo(payload.returnTo) } };
}

/**
 * Only allow same-origin absolute paths (prevents open redirects such as
 * `//evil.example`, `/\evil.example` or `https://evil.example`).
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '/';
  if (value.length > 512) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.includes('\\') || [...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f))
    return '/';
  if (value.startsWith('/api/') || value === '/login' || value.startsWith('/login?')) return '/';
  return value;
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const u = new URL(DISCORD_AUTHORIZE_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('scope', 'identify');
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('state', opts.state);
  u.searchParams.set('code_challenge', opts.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export const callbackUrl = (dashboardUrl: string): string =>
  `${dashboardUrl.replace(/\/+$/, '')}/api/auth/callback`;

/** Login error codes surfaced on /login?error=… (never contain details). */
export const LOGIN_ERRORS = {
  cancelled: 'Sign-in was cancelled.',
  state: 'Your sign-in attempt expired or could not be verified. Please try again.',
  oauth: 'Discord sign-in failed. Please try again in a moment.',
  not_member: 'Your Discord account is not a member of the GYNX.GG server.',
  no_access:
    'Your account does not have dashboard access. Ask an administrator if you believe this is a mistake.',
  unavailable: 'The dashboard could not verify your membership right now. Please try again shortly.',
  rate_limited: 'Too many sign-in attempts. Please wait a minute and try again.',
  expired: 'Your session has ended. Please sign in again.',
} as const;
export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

export const isLoginErrorCode = (v: unknown): v is LoginErrorCode =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(LOGIN_ERRORS, v);
