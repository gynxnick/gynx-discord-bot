import { describe, expect, it } from 'vitest';
import {
  attachmentDisposition,
  breakdownEntries,
  computeDelta,
  deliveryStatus,
  displayMetric,
  formatDelta,
  formatMinutes,
  parseStaffSort,
  sortStaffRows,
  uptimeText,
} from './format';
import { periodParams, resolvePeriod } from './period';

describe('delta formatting', () => {
  it('formats signed deltas with percentage', () => {
    expect(formatDelta(computeDelta(12, 8))).toBe('+4 (+50%)');
    expect(formatDelta(computeDelta(5, 10))).toBe('-5 (-50%)');
    expect(formatDelta(computeDelta(3, 3))).toBe('0 (0%)');
  });

  it('renders n/a without a baseline and n/a percentage for a zero baseline', () => {
    expect(formatDelta(computeDelta(5, undefined))).toBe('n/a');
    expect(formatDelta(computeDelta(5, null))).toBe('n/a');
    expect(formatDelta(computeDelta(5, 0))).toBe('+5 (n/a)');
  });
});

describe('metric display', () => {
  it('never shows 0 for an unavailable metric', () => {
    const d = displayMetric({ available: false, reason: 'no giveaways have been created yet' });
    expect(d).toEqual({
      available: false,
      value: 'Not available — no giveaways have been created yet',
      note: null,
      delta: null,
      direction: null,
    });
    expect(d.value).not.toMatch(/\b0\b/);
    expect(displayMetric(undefined).value).toMatch(/^Not available — /);
  });

  it('shows value, note and delta for available metrics', () => {
    expect(
      displayMetric({ available: true, value: 1234, previous: 1000, note: 'observed message activity' }),
    ).toEqual({
      available: true,
      value: '1,234',
      note: 'observed message activity',
      delta: '+234 (+23.4%)',
      direction: 'up',
    });
    expect(displayMetric({ available: true, value: 0 })).toMatchObject({
      value: '0',
      delta: 'n/a',
      direction: null,
    });
    expect(displayMetric({ available: true, value: 4, previous: 4 }, '%').direction).toBe('flat');
  });

  it('sorts breakdown entries and keeps keys only present previously', () => {
    expect(breakdownEntries({ available: true, value: { WARN: 2, BAN: 5 }, previous: { KICK: 1 } })).toEqual([
      { key: 'BAN', label: 'Ban', value: 5, previous: 0 },
      { key: 'WARN', label: 'Warn', value: 2, previous: 0 },
      { key: 'KICK', label: 'Kick', value: 0, previous: 1 },
    ]);
    expect(breakdownEntries({ available: false, reason: 'x' })).toBeNull();
  });

  it('formats uptime, durations and delivery status', () => {
    expect(uptimeText(null)).toBe('no data');
    expect(uptimeText(99.5)).toBe('99.5%');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(60 * 26)).toBe('1d 2h');
    expect(deliveryStatus({ deliveredAt: new Date(), deliveryError: null }).label).toBe('Delivered');
    expect(deliveryStatus({ deliveredAt: null, deliveryError: 'Missing Access' })).toEqual({
      label: 'Delivery failed',
      tone: 'danger',
    });
    expect(deliveryStatus({ deliveredAt: null, deliveryError: null }).tone).toBe('neutral');
  });
});

describe('staff sorting', () => {
  const rows = [
    {
      userId: '2',
      moderationActions: 1,
      reportsClaimed: 0,
      reportsResolved: 0,
      incidentUpdates: 0,
      partnerReviews: 0,
      total: 1,
    },
    {
      userId: '1',
      moderationActions: 5,
      reportsClaimed: 0,
      reportsResolved: 0,
      incidentUpdates: 0,
      partnerReviews: 0,
      total: 5,
    },
  ];
  it('parses and applies sort params with safe defaults', () => {
    expect(parseStaffSort(undefined, undefined)).toEqual({ key: 'total', dir: 'desc' });
    expect(parseStaffSort('evil', 'sideways')).toEqual({ key: 'total', dir: 'desc' });
    expect(parseStaffSort('userId', undefined)).toEqual({ key: 'userId', dir: 'asc' });
    expect(sortStaffRows(rows, 'total', 'desc').map((r) => r.userId)).toEqual(['1', '2']);
    expect(sortStaffRows(rows, 'userId', 'desc').map((r) => r.userId)).toEqual(['2', '1']);
  });
});

describe('downloads', () => {
  it('builds an attachment disposition with a sanitised filename', () => {
    expect(attachmentDisposition('weekly-ceo-report-2026-10-19.csv')).toBe(
      `attachment; filename="weekly-ceo-report-2026-10-19.csv"; filename*=UTF-8''weekly-ceo-report-2026-10-19.csv`,
    );
    expect(attachmentDisposition('a"b\r\nc.md')).toBe(
      `attachment; filename="a-b-c.md"; filename*=UTF-8''a-b-c.md`,
    );
  });
});

describe('period selection', () => {
  it('defaults to 7 days and accepts presets', () => {
    expect(resolvePeriod({}, 'UTC')).toMatchObject({ kind: '7d', range: '7d', error: null });
    expect(resolvePeriod({ range: '90d' }, 'UTC')).toMatchObject({ kind: '90d', range: '90d' });
    expect(resolvePeriod({ range: 'bogus' }, 'UTC').error).toMatch(/Unknown period/);
  });

  it('converts custom calendar days in the guild timezone (end inclusive)', () => {
    const sel = resolvePeriod({ range: 'custom', start: '2026-07-01', end: '2026-07-07' }, 'Europe/London');
    expect(sel.error).toBeNull();
    expect(typeof sel.range).toBe('object');
    if (typeof sel.range === 'object') {
      expect(sel.range.start.toISOString()).toBe('2026-06-30T23:00:00.000Z');
      expect(sel.range.end.toISOString()).toBe('2026-07-07T23:00:00.000Z');
    }
    expect(periodParams(sel)).toEqual({ range: 'custom', start: '2026-07-01', end: '2026-07-07' });
  });

  it('rejects invalid, reversed and over-long custom ranges', () => {
    expect(resolvePeriod({ range: 'custom', start: '2026-02-30', end: '2026-03-01' }, 'UTC').error).toMatch(
      /valid/,
    );
    expect(resolvePeriod({ range: 'custom', start: '2026-03-02', end: '2026-03-01' }, 'UTC').error).toMatch(
      /on or after/,
    );
    expect(resolvePeriod({ range: 'custom', start: '2025-01-01', end: '2026-01-01' }, 'UTC').error).toMatch(
      /365 days/,
    );
    expect(
      resolvePeriod({ range: 'custom', start: '2025-01-02', end: '2026-01-01' }, 'UTC').error,
    ).toBeNull();
    expect(resolvePeriod({ range: 'custom', start: '2026-03-02', end: '2026-03-01' }, 'UTC').range).toBe(
      '7d',
    );
  });
});
