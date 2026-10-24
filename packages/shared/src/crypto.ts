import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * AES-256-GCM envelope for integration credentials stored in the database.
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
export function encryptSecret(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(envelope: string, hexKey: string): string {
  const [version, ivB64, tagB64, ctB64] = envelope.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !ctB64) throw new Error('Unsupported secret envelope');
  const key = Buffer.from(hexKey, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

export const hmacSha256 = (secret: string, input: string): string =>
  createHmac('sha256', secret).update(input).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Cryptographically secure, unbiased sample of `count` distinct items using a
 * partial Fisher–Yates shuffle driven by crypto.randomInt (uniform by
 * rejection sampling). `rng` is injectable for deterministic tests only.
 */
export function secureSample<T>(
  items: readonly T[],
  count: number,
  rng: (max: number) => number = (max) => randomInt(max),
): T[] {
  const pool = items.slice();
  const n = Math.max(0, Math.min(count, pool.length));
  for (let i = 0; i < n; i++) {
    const j = i + rng(pool.length - i);
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, n);
}
