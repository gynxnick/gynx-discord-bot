import { zonedParts } from '@gynx/shared';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Wall-clock value for `<input type="datetime-local">` ("YYYY-MM-DDTHH:MM") of
 * `date` in the guild time zone. Server-side only (callers pass strings to the client).
 */
export function toZonedInput(date: Date | string | null | undefined, tz: string): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p = zonedParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DDTHH:MM" → "YYYY-MM-DD HH:MM" (the services' wall-clock format). */
export function inputToWallClock(v: string): string {
  return v.trim().replace('T', ' ').slice(0, 16);
}
