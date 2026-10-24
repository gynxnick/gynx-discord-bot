import { describe, expect, it } from 'vitest';
import {
  addDaysToKey,
  averageDaily,
  compare,
  countActiveMembers,
  dateKeysBetween,
  formatComparison,
  formatMetric,
  fromSource,
  incidentDurationMs,
  memberFlow,
  periodClicks,
  previousPeriod,
  topN,
  uptimePercent,
  withPrevious,
} from './metrics';
import { mergeSection } from './collect';

describe('member flow', () => {
  it('computes joins, leaves and net growth', () => {
    expect(memberFlow([{ type: 'JOIN', count: 12 }, { type: 'LEAVE', count: 5 }])).toEqual({ joins: 12, leaves: 5, net: 7 });
    expect(memberFlow([{ type: 'LEAVE', count: 3 }])).toEqual({ joins: 0, leaves: 3, net: -3 });
    expect(memberFlow([])).toEqual({ joins: 0, leaves: 0, net: 0 });
  });
});

describe('active members threshold', () => {
  const rows = [
    { userId: 'a', messages: 1 },
    { userId: 'b', messages: 3 },
    { userId: 'c', messages: 5 },
    { userId: 'a', messages: 2 }, // summed with the first row → 3
  ];
  it('counts users whose summed messages meet the threshold', () => {
    expect(countActiveMembers(rows, 1)).toBe(3);
    expect(countActiveMembers(rows, 3)).toBe(3);
    expect(countActiveMembers(rows, 4)).toBe(1);
    expect(countActiveMembers(rows, 6)).toBe(0);
  });
  it('clamps a threshold below 1 to 1', () => {
    expect(countActiveMembers([{ userId: 'x', messages: 0 }], 0)).toBe(0);
  });
});

describe('comparisons', () => {
  it('computes delta and percentage', () => {
    expect(compare(120, 100)).toEqual({ delta: 20, pct: 20 });
    expect(compare(50, 100)).toEqual({ delta: -50, pct: -50 });
    expect(compare(1, 3)).toEqual({ delta: -2, pct: -66.7 });
  });
  it('is null-safe for missing or zero previous', () => {
    expect(compare(10, undefined)).toEqual({ delta: null, pct: null });
    expect(compare(10, null)).toEqual({ delta: null, pct: null });
    expect(compare(10, 0)).toEqual({ delta: 10, pct: null });
    expect(formatComparison(compare(10, 0))).toBe('+10 (n/a)');
    expect(formatComparison(compare(10, undefined))).toBe('n/a');
    expect(formatComparison(compare(5, 10))).toBe('-5 (-50%)');
  });
});

describe('unavailable vs zero semantics', () => {
  it('a source with no rows ever is unavailable, never 0', () => {
    const m = fromSource(false, 0, 'no data yet');
    expect(m).toEqual({ available: false, reason: 'no data yet' });
    expect(formatMetric(m)).toBe('Not available — no data yet');
  });
  it('a source with rows but none in the period is a real 0', () => {
    expect(fromSource(true, 0, 'unused')).toEqual({ available: true, value: 0 });
  });
  it('previous is attached only when both periods are available', () => {
    expect(withPrevious(fromSource(true, 5, 'r'), fromSource(true, 3, 'r'))).toEqual({ available: true, value: 5, previous: 3 });
    expect(withPrevious(fromSource(true, 5, 'r'), fromSource(false, 0, 'r'))).toEqual({ available: true, value: 5 });
    expect(withPrevious(fromSource(false, 0, 'r'), fromSource(true, 3, 'r'))).toEqual({ available: false, reason: 'r' });
  });
  it('mergeSection attaches previous to metrics, skips lists and keeps plain fields', () => {
    const cur = { a: fromSource(true, 2, 'r'), list: fromSource(true, [1], 'r'), n: 7 };
    const prev = { a: fromSource(true, 1, 'r'), list: fromSource(true, [2], 'r'), n: 9 };
    const merged = mergeSection(cur, prev);
    expect(merged.a).toEqual({ available: true, value: 2, previous: 1 });
    expect(merged.list).toEqual({ available: true, value: [1] });
    expect(merged.n).toBe(7);
  });
});

describe('uptime', () => {
  it('reports no data (null) without checks', () => {
    expect(uptimePercent(0, 0)).toBeNull();
  });
  it('computes a percentage with two decimals', () => {
    expect(uptimePercent(999, 1000)).toBe(99.9);
    expect(uptimePercent(2, 3)).toBe(66.67);
    expect(uptimePercent(10, 10)).toBe(100);
  });
});

describe('incident duration', () => {
  const period = { start: new Date('2026-10-01T00:00:00Z'), end: new Date('2026-10-08T00:00:00Z') };
  it('clips incidents to the period and treats open incidents as ongoing until asOf', () => {
    const asOf = new Date('2026-10-08T00:00:00Z');
    const ms = incidentDurationMs(
      [
        { startedAt: new Date('2026-09-30T23:00:00Z'), resolvedAt: new Date('2026-10-01T01:00:00Z') }, // 1h inside
        { startedAt: new Date('2026-10-03T10:00:00Z'), resolvedAt: new Date('2026-10-03T10:30:00Z') }, // 30m
        { startedAt: new Date('2026-10-07T23:00:00Z'), resolvedAt: null }, // open → 1h until period end
        { startedAt: new Date('2026-09-01T00:00:00Z'), resolvedAt: new Date('2026-09-02T00:00:00Z') }, // outside
      ],
      period,
      asOf,
    );
    expect(ms).toBe(2.5 * 3_600_000);
  });
  it('does not count beyond now for the current period', () => {
    const asOf = new Date('2026-10-02T00:00:00Z');
    expect(incidentDurationMs([{ startedAt: new Date('2026-10-01T12:00:00Z'), resolvedAt: null }], period, asOf)).toBe(12 * 3_600_000);
  });
});

describe('tracked link clicks', () => {
  it('uses the difference between snapshots', () => {
    expect(periodClicks(100, 140)).toEqual({ available: true, value: 40 });
  });
  it('labels the first period as cumulative when no baseline exists', () => {
    expect(periodClicks(null, 140)).toEqual({ available: true, value: 140, note: 'first period, cumulative' });
  });
  it('is unavailable without an end snapshot', () => {
    expect(periodClicks(100, null).available).toBe(false);
  });
});

describe('periods and date keys', () => {
  it('builds the previous equal-length period', () => {
    const p = previousPeriod({ start: new Date('2026-10-19T09:00:00Z'), end: new Date('2026-10-26T09:00:00Z') });
    expect(p.start.toISOString()).toBe('2026-10-12T09:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-19T09:00:00.000Z');
  });
  it('enumerates date keys half-open and across month ends', () => {
    expect(dateKeysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(dateKeysBetween('2026-10-30', '2026-10-30')).toEqual([]);
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('averages distinct daily users including silent days', () => {
    expect(averageDaily(new Map([['2026-10-01', 4], ['2026-10-02', 2]]), ['2026-10-01', '2026-10-02', '2026-10-03'])).toBe(2);
    expect(averageDaily(new Map(), [])).toBe(0);
  });
  it('ranks top entries deterministically', () => {
    expect(topN(new Map([['b', 2], ['a', 2], ['c', 5]]), 2)).toEqual([{ id: 'c', count: 5 }, { id: 'a', count: 2 }]);
  });
});
