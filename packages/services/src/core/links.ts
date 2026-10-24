import { hmacSha256, safeEqual } from '@gynx/shared';

/**
 * Short-lived signed links (e.g. transcript downloads posted to staff channels).
 * The link is still served only to an authenticated dashboard session with the
 * right permission — the signature limits lifetime and prevents ID guessing,
 * it is not a bearer credential on its own.
 */
export function signResourceLink(secret: string, resource: string, expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const sig = hmacSha256(secret, `${resource}:${exp}`);
  return `exp=${exp}&sig=${sig}`;
}

export function verifyResourceLink(
  secret: string,
  resource: string,
  exp: string | null,
  sig: string | null,
  now: Date,
): boolean {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < now.getTime()) return false;
  return safeEqual(hmacSha256(secret, `${resource}:${exp}`), sig);
}
