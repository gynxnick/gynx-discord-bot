import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, secureSample } from './crypto';
import { MemoryRateLimiter } from './rate-limit';

const KEY = 'ab'.repeat(32);

describe('secret encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('api-key-123', KEY);
    const b = encryptSecret('api-key-123', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('api-key-123');
  });

  it('detects tampering and wrong keys', () => {
    const env = encryptSecret('secret', KEY);
    const parts = env.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow();
    expect(() => decryptSecret(env, 'cd'.repeat(32))).toThrow();
  });
});

describe('secureSample', () => {
  it('returns distinct items and never more than available', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const picked = secureSample(items, 10);
    expect(new Set(picked).size).toBe(10);
    expect(secureSample([1, 2], 5)).toHaveLength(2);
    expect(secureSample([], 3)).toEqual([]);
  });

  it('is approximately uniform', () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 8000; i++) counts[secureSample([0, 1, 2, 3], 1)[0]!]!++;
    for (const c of counts) expect(c).toBeGreaterThan(1700);
  });
});

describe('MemoryRateLimiter', () => {
  it('blocks after the limit and recovers after the window', async () => {
    let t = 0;
    const rl = new MemoryRateLimiter(() => t);
    for (let i = 0; i < 3; i++) expect((await rl.consume('k', 3, 10)).allowed).toBe(true);
    const blocked = await rl.consume('k', 3, 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    t = 10_001;
    expect((await rl.consume('k', 3, 10)).allowed).toBe(true);
  });

  it('isolates keys', async () => {
    const rl = new MemoryRateLimiter();
    await rl.consume('a', 1, 60);
    expect((await rl.consume('b', 1, 60)).allowed).toBe(true);
  });
});
