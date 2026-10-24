import { describe, expect, it } from 'vitest';
import { latestDueOccurrence, nextRunFor, reportFileName, reportPeriodFor } from './reports';

describe('report schedule', () => {
  it('computes the next run in the definition timezone', () => {
    // Wednesday 21 Oct 2026 → next Monday 26 Oct 09:00 London; UK DST ended 25 Oct → GMT → 09:00 UTC
    expect(
      nextRunFor(
        { day: 'MONDAY', time: '09:00', timezone: 'Europe/London' },
        new Date('2026-10-21T12:00:00Z'),
      ).toISOString(),
    ).toBe('2026-10-26T09:00:00.000Z');
    // A week earlier the UK is still on BST (UTC+1) → 08:00 UTC
    expect(
      nextRunFor(
        { day: 'MONDAY', time: '09:00', timezone: 'Europe/London' },
        new Date('2026-10-14T12:00:00Z'),
      ).toISOString(),
    ).toBe('2026-10-19T08:00:00.000Z');
    expect(
      nextRunFor(
        { day: 'FRIDAY', time: '17:30', timezone: 'America/New_York' },
        new Date('2026-10-21T12:00:00Z'),
      ).toISOString(),
    ).toBe('2026-10-23T21:30:00.000Z');
  });

  it('falls back to UTC for an invalid stored timezone', () => {
    expect(
      nextRunFor(
        { day: 'MONDAY', time: '09:00', timezone: 'Mars/Base' },
        new Date('2026-10-21T12:00:00Z'),
      ).toISOString(),
    ).toBe('2026-10-26T09:00:00.000Z');
  });

  it('picks the latest due occurrence after downtime (missed weeks are skipped)', () => {
    const stored = new Date('2026-10-05T09:00:00Z');
    const now = new Date('2026-10-21T12:00:00Z');
    expect(latestDueOccurrence(stored, now, 'MONDAY', '09:00', 'UTC').toISOString()).toBe(
      '2026-10-19T09:00:00.000Z',
    );
    // Exactly due → itself
    expect(
      latestDueOccurrence(
        new Date('2026-10-19T09:00:00Z'),
        new Date('2026-10-19T09:00:00Z'),
        'MONDAY',
        '09:00',
        'UTC',
      ).toISOString(),
    ).toBe('2026-10-19T09:00:00.000Z');
  });

  it('builds a DST-safe report period of N calendar days at the same wall-clock time', () => {
    // Ends Monday 26 Oct 09:00 GMT; starts Monday 19 Oct 09:00 BST (= 08:00 UTC): 7 days + 1h of wall-clock-consistent time.
    const p = reportPeriodFor(new Date('2026-10-26T09:00:00Z'), 7, 'Europe/London');
    expect(p.start.toISOString()).toBe('2026-10-19T08:00:00.000Z');
    expect(p.end.toISOString()).toBe('2026-10-26T09:00:00.000Z');
    const utc = reportPeriodFor(new Date('2026-10-26T09:00:00Z'), 30, 'UTC');
    expect(utc.start.toISOString()).toBe('2026-09-26T09:00:00.000Z');
  });

  it('names report files by local period dates', () => {
    expect(
      reportFileName(
        { periodStart: new Date('2026-10-19T08:00:00Z'), periodEnd: new Date('2026-10-26T09:00:00Z') },
        'Europe/London',
      ),
    ).toBe('gynx-report-2026-10-19_2026-10-26.md');
  });
});
