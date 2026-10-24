import { describe, expect, it } from 'vitest';
import { detectRaid, isNewAccount, raidBucket } from './raid';

const now = new Date('2026-10-24T12:00:00Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe('detectRaid', () => {
  it('flags when joins within the window reach the threshold', () => {
    const joins = Array.from({ length: 10 }, (_, n) => ago(n * 5));
    expect(detectRaid(joins, now, 10, 60)).toMatchObject({ isRaid: true, joinsInWindow: 10 });
  });

  it('does not flag below the threshold', () => {
    const joins = Array.from({ length: 9 }, (_, n) => ago(n));
    expect(detectRaid(joins, now, 10, 60)).toMatchObject({ isRaid: false, joinsInWindow: 9 });
  });

  it('ignores joins outside the window and in the future', () => {
    const joins = [...Array.from({ length: 5 }, (_, n) => ago(n)), ago(60), ago(61), ago(3600), new Date(now.getTime() + 5000)];
    expect(detectRaid(joins, now, 6, 60)).toMatchObject({ isRaid: false, joinsInWindow: 5 });
  });

  it('never flags with a non-positive threshold or no joins', () => {
    expect(detectRaid([], now, 1, 60).isRaid).toBe(false);
    expect(detectRaid([now], now, 0, 60).isRaid).toBe(false);
  });
});

describe('isNewAccount', () => {
  it('compares account age to the minimum', () => {
    expect(isNewAccount(ago(86_400 * 2), now, 7)).toBe(true);
    expect(isNewAccount(ago(86_400 * 8), now, 7)).toBe(false);
    expect(isNewAccount(ago(60), now, 0)).toBe(false);
  });
});

describe('raidBucket', () => {
  it('is stable within a window and changes across windows', () => {
    const w = 60;
    const b = raidBucket(now, w);
    expect(raidBucket(new Date(now.getTime() + 59_000), w)).toBe(b);
    expect(raidBucket(new Date(now.getTime() + 60_000), w)).toBe(b + 1);
  });
});
