import { zonedToUtc } from '@gynx/shared';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Inclusive calendar-day range in the guild time zone → UTC instants.
 * `from` is the start of that day, `to` the last millisecond of that day.
 * Malformed values are ignored (undefined).
 */
export function dayRange(
  from: string | undefined,
  to: string | undefined,
  tz: string,
): { from?: Date; to?: Date } {
  const parse = (v: string | undefined, endOfDay: boolean): Date | undefined => {
    const m = v ? DAY_RE.exec(v) : null;
    if (!m) return undefined;
    const [y, mo, d] = m.slice(1).map(Number) as [number, number, number];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
    if (!endOfDay) return zonedToUtc(y, mo, d, 0, 0, tz);
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    return new Date(
      zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz).getTime() - 1,
    );
  };
  return { from: parse(from, false), to: parse(to, true) };
}
