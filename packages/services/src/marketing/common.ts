import { randomInt } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { isBlockedAddress, isValidHostname } from '@gynx/shared';

export const snowflakeSchema = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /\.lan$/i, /\.home\.arpa$/i, /^metadata(\.|$)/i];

/**
 * Validate an outbound URL that the bot will show to members (embed images,
 * tracked-link redirects): https only, no embedded credentials, a valid public
 * hostname, and never a literal private/loopback/link-local IP.
 * Returns a reason string when invalid, null when acceptable.
 */
export function publicHttpsUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return 'Not a valid URL.';
  }
  if (url.protocol !== 'https:') return 'Links must use https://';
  if (url.username || url.password) return 'Links must not contain credentials.';
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host || !isValidHostname(host)) return 'That hostname is not valid.';
  if (isIP(host)) {
    if (isBlockedAddress(host)) return 'That destination is not allowed.';
  } else {
    if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) return 'That destination is not allowed.';
    if (!host.includes('.')) return 'That hostname is not valid.';
  }
  if (url.port && url.port !== '443') return 'Custom ports are not allowed.';
  return null;
}

export const publicHttpsUrl = z
  .string()
  .trim()
  .max(1000)
  .superRefine((v, c) => {
    const problem = publicHttpsUrlProblem(v);
    if (problem) c.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

export const hexColor = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #22D3EE')
  .transform((v) => (v.startsWith('#') ? v : `#${v}`).toUpperCase());

export const hexToInt = (hex: string | null | undefined): number | undefined => {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  return parseInt(hex.replace('#', ''), 16);
};

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Cryptographically random base62 string (tracked-link slugs). */
export function randomBase62(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(0, BASE62.length)];
  return out;
}

export const SLUG_RE = /^[0-9A-Za-z]{8}$/;
