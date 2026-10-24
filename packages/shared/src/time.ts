/**
 * Time-zone helpers. Everything is stored in UTC; zones are applied only when
 * computing schedules and formatting for display. Uses Intl only (no deps).
 */

export const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD_SHORT: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, tz: string): ZonedParts {
  const parts = Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WD_SHORT[parts.weekday as string] ?? 0,
  };
}

/** Offset of `tz` from UTC at instant `date`, in minutes. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Convert a wall-clock time in `tz` to a UTC Date (handles DST by re-checking the offset). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let offset = tzOffsetMinutes(new Date(guess), tz);
  let result = guess - offset * 60000;
  const offset2 = tzOffsetMinutes(new Date(result), tz);
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60000;
  }
  return new Date(result);
}

/** Start of the calendar day containing `date` in `tz`, as a UTC instant. */
export function startOfDayInZone(date: Date, tz: string): Date {
  const p = zonedParts(date, tz);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

/** Calendar date key (YYYY-MM-DD) of `date` in `tz`. */
export function dateKeyInZone(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Next occurrence (strictly after `now`) of `weekday` at `HH:MM` wall-clock time in `tz`.
 */
export function nextWeeklyOccurrence(now: Date, weekday: Weekday, time: string, tz: string): Date {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const target = WEEKDAYS.indexOf(weekday);
  const p = zonedParts(now, tz);
  for (let addDays = 0; addDays <= 7; addDays++) {
    const base = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
    if (base.getUTCDay() !== target) continue;
    const candidate = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hh, mm, tz);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  // Same weekday, time already passed → one week later
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + 7));
  return zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hh, mm, tz);
}

export function formatInZone(date: Date, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
    ...opts,
  }).format(date);
}

/** Discord timestamp markup — renders in each viewer's local zone. */
export const discordTimestamp = (date: Date, style: 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R' = 'f'): string =>
  `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;

/**
 * Parse durations like "30m", "2h", "7d", "1w", "1h30m". Returns milliseconds or null.
 */
export function parseDuration(input: string): number | null {
  const re = /(\d+)\s*(s|m|h|d|w)/gi;
  const unit: Record<string, number> = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7, w: 6.048e8 };
  let total = 0;
  let matched = '';
  for (const m of input.matchAll(re)) {
    total += Number(m[1]) * unit[m[2]!.toLowerCase()]!;
    matched += m[0];
  }
  if (!total || matched.replace(/\s/g, '').length !== input.replace(/\s/g, '').length) return null;
  return total;
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}
