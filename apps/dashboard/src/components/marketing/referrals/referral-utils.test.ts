import { describe, expect, it } from 'vitest';
import {
  aggregateAttributionCounts,
  needsReview,
  parsePeriod,
  reviewOptions,
  reviewProblems,
} from './referral-utils';

describe('referral review options', () => {
  it('allows VALID only for confirmed attributions with a referrer', () => {
    expect(
      reviewOptions({ confidence: 'CONFIRMED', referrerId: '123456789012345678' }).find(
        (o) => o.status === 'VALID',
      )?.disabled,
    ).toBe(false);
    for (const row of [
      { confidence: 'CONFIRMED', referrerId: null },
      { confidence: 'AMBIGUOUS', referrerId: null },
      { confidence: 'UNKNOWN', referrerId: '123456789012345678' },
    ]) {
      const valid = reviewOptions(row).find((o) => o.status === 'VALID');
      expect(valid?.disabled).toBe(true);
      expect(valid?.reason).toMatch(/confirmed/i);
    }
    expect(
      reviewOptions({ confidence: 'UNKNOWN', referrerId: null })
        .filter((o) => !o.disabled)
        .map((o) => o.status),
    ).toEqual(['INVALID', 'DISPUTED']);
  });

  it('validates the decision and note length like the service', () => {
    expect(reviewProblems('', 'ok ok')).toHaveProperty('status');
    expect(reviewProblems('FLAGGED', 'ok ok')).toHaveProperty('status');
    expect(reviewProblems('INVALID', '  a ')).toHaveProperty('note');
    expect(reviewProblems('INVALID', 'x'.repeat(501))).toHaveProperty('note');
    expect(reviewProblems('VALID', 'Looks legit')).toEqual({});
  });

  it('marks flagged and disputed rows for review', () => {
    expect(['VALID', 'FLAGGED', 'DISPUTED', 'INVALID'].filter(needsReview)).toEqual(['FLAGGED', 'DISPUTED']);
  });
});

describe('attribution counts', () => {
  it('folds groupBy rows into explicit totals', () => {
    const c = aggregateAttributionCounts([
      { confidence: 'CONFIRMED', status: 'VALID', _count: { _all: 10 } },
      { confidence: 'CONFIRMED', status: 'FLAGGED', _count: { _all: 3 } },
      { confidence: 'CONFIRMED', status: 'DISPUTED', _count: { _all: 1 } },
      { confidence: 'AMBIGUOUS', status: 'VALID', _count: { _all: 4 } },
      { confidence: 'UNKNOWN', status: 'VALID', _count: { _all: 7 } },
      { confidence: 'UNKNOWN', status: 'INVALID', _count: { _all: 2 } },
    ]);
    expect(c.total).toBe(27);
    expect(c.counted).toBe(10);
    expect(c.underReview).toBe(4);
    expect(c.byConfidence).toEqual({ CONFIRMED: 14, AMBIGUOUS: 4, UNKNOWN: 9 });
    expect(c.byStatus).toEqual({ VALID: 21, FLAGGED: 3, DISPUTED: 1, INVALID: 2 });
  });

  it('handles no data', () => {
    expect(aggregateAttributionCounts([])).toMatchObject({ total: 0, counted: 0, underReview: 0 });
  });

  it('defaults the leaderboard period to 30 days', () => {
    expect(parsePeriod('7')).toBe('7');
    expect(parsePeriod('all')).toBe('all');
    expect(parsePeriod(undefined)).toBe('30');
    expect(parsePeriod('365')).toBe('30');
  });
});
