import { describe, expect, it } from 'vitest';
import { dateKeyInZone, formatDuration, isValidTimeZone, nextWeeklyOccurrence, parseDuration, zonedToUtc } from './time';

describe('time zones', () => {
  it('validates IANA zones', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('converts wall-clock time across DST', () => {
    // London: GMT in January, BST (+1) in July
    expect(zonedToUtc(2026, 1, 15, 9, 0, 'Europe/London').toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(zonedToUtc(2026, 7, 15, 9, 0, 'Europe/London').toISOString()).toBe('2026-07-15T08:00:00.000Z');
    expect(zonedToUtc(2026, 7, 15, 9, 0, 'America/New_York').toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('computes the next weekly report time strictly in the future', () => {
    const wed = new Date('2026-10-21T12:00:00Z'); // Wednesday
    expect(nextWeeklyOccurrence(wed, 'MONDAY', '09:00', 'UTC').toISOString()).toBe('2026-10-26T09:00:00.000Z');
    const monBefore = new Date('2026-10-26T08:59:00Z');
    expect(nextWeeklyOccurrence(monBefore, 'MONDAY', '09:00', 'UTC').toISOString()).toBe('2026-10-26T09:00:00.000Z');
    const monAfter = new Date('2026-10-26T09:00:00Z');
    expect(nextWeeklyOccurrence(monAfter, 'MONDAY', '09:00', 'UTC').toISOString()).toBe('2026-11-02T09:00:00.000Z');
  });

  it('respects the zone when picking the weekday', () => {
    // 2026-10-25 23:30 UTC is already Monday 26th 08:30 in Tokyo → next Monday 09:00 JST is that same day
    const now = new Date('2026-10-25T23:30:00Z');
    expect(nextWeeklyOccurrence(now, 'MONDAY', '09:00', 'Asia/Tokyo').toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(dateKeyInZone(now, 'Asia/Tokyo')).toBe('2026-10-26');
    expect(dateKeyInZone(now, 'UTC')).toBe('2026-10-25');
  });
});

describe('durations', () => {
  it('parses compound durations', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000);
    expect(parseDuration('1h30m')).toBe(90 * 60_000);
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('5x')).toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
    expect(formatDuration(0)).toBe('0m');
  });
});
