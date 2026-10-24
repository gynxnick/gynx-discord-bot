import { describe, expect, it } from 'vitest';
import { dayRange } from './dates';

describe('dayRange', () => {
  it('maps guild-local calendar days to an inclusive UTC range', () => {
    const r = dayRange('2026-07-01', '2026-07-31', 'Europe/London');
    expect(r.from?.toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(r.to?.toISOString()).toBe('2026-07-31T22:59:59.999Z');
  });

  it('handles month ends and ignores malformed input', () => {
    expect(dayRange(undefined, '2026-12-31', 'UTC').to?.toISOString()).toBe('2026-12-31T23:59:59.999Z');
    expect(dayRange('yesterday', '2026-13-01', 'UTC')).toEqual({ from: undefined, to: undefined });
  });
});
