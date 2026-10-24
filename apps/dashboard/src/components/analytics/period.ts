import { z } from 'zod';
import { isValidTimeZone, zonedToUtc } from '@gynx/shared';

/**
 * Analytics period selection via URL search params:
 *   ?range=7d | 30d | 90d                       (preset, ends now)
 *   ?range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD (calendar days in the guild timezone, end inclusive)
 * Pure; used by pages and API routes (server side — imports @gynx/shared).
 */

export const PERIOD_PRESETS = ['7d', '30d', '90d'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const PRESET_LABELS: Record<PeriodPreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

/** Longest custom range in calendar days (inclusive). Keeps DST-shifted ranges inside the service's 366-day cap. */
export const MAX_CUSTOM_DAYS = 365;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const periodQuerySchema = z.object({
  range: z.enum([...PERIOD_PRESETS, 'custom']).optional(),
  start: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
  end: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
});
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

/** The service's range input: a preset or explicit instants. */
export type ResolvedRange = PeriodPreset | { start: Date; end: Date };

export interface PeriodSelection {
  kind: PeriodPreset | 'custom';
  /** Echo of the custom inputs (for re-filling the form). */
  start?: string;
  end?: string;
  /** What to pass to the analytics services. Falls back to 7d when the custom input is invalid. */
  range: ResolvedRange;
  error: string | null;
}

function parseDateKey(s: string): { y: number; m: number; d: number } | null {
  const match = DATE_RE.exec(s);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

const dayNumber = (k: { y: number; m: number; d: number }) =>
  Math.round(Date.UTC(k.y, k.m - 1, k.d) / 86_400_000);

/** Resolve raw search params into a period. Never throws. */
export function resolvePeriod(raw: Record<string, string | undefined>, timezone: string): PeriodSelection {
  const tz = isValidTimeZone(timezone) ? timezone : 'UTC';
  const range = raw.range;
  if (range === undefined || range === '' || (PERIOD_PRESETS as readonly string[]).includes(range)) {
    const kind = (range || '7d') as PeriodPreset;
    return { kind, range: kind, error: null };
  }
  if (range !== 'custom')
    return { kind: '7d', range: '7d', error: 'Unknown period. Showing the last 7 days.' };

  const start = raw.start ?? '';
  const end = raw.end ?? '';
  const fail = (error: string): PeriodSelection => ({
    kind: 'custom',
    start,
    end,
    range: '7d',
    error: `${error} Showing the last 7 days.`,
  });
  const s = parseDateKey(start);
  const e = parseDateKey(end);
  if (!s || !e) return fail('Enter a valid start and end date.');
  const days = dayNumber(e) - dayNumber(s) + 1;
  if (days < 1) return fail('The end date must be on or after the start date.');
  if (days > MAX_CUSTOM_DAYS) return fail(`Custom ranges are limited to ${MAX_CUSTOM_DAYS} days.`);
  return {
    kind: 'custom',
    start,
    end,
    range: { start: zonedToUtc(s.y, s.m, s.d, 0, 0, tz), end: zonedToUtc(e.y, e.m, e.d + 1, 0, 0, tz) },
    error: null,
  };
}

/** Search-param object for links that keep the current period. */
export function periodParams(sel: Pick<PeriodSelection, 'kind' | 'start' | 'end'>): Record<string, string> {
  if (sel.kind !== 'custom') return sel.kind === '7d' ? {} : { range: sel.kind };
  return {
    range: 'custom',
    ...(sel.start ? { start: sel.start } : {}),
    ...(sel.end ? { end: sel.end } : {}),
  };
}

export function periodLabel(sel: PeriodSelection): string {
  if (sel.kind !== 'custom' || sel.error)
    return PRESET_LABELS[typeof sel.range === 'string' ? sel.range : '7d'];
  return `${sel.start} to ${sel.end}`;
}
