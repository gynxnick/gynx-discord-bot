/** Pure form → payload helpers for the community/marketing editors (unit tested). */

/** Add comma-separated tags to a list (trimmed, de-duplicated, bounded). */
export function addTags(
  current: readonly string[],
  raw: string,
  opts: { max?: number; maxLength?: number; lowercase?: boolean } = {},
): string[] {
  const max = opts.max ?? 20;
  const maxLength = opts.maxLength ?? 40;
  const out = [...current];
  for (const part of raw.split(',')) {
    let t = part.trim().slice(0, maxLength);
    if (opts.lowercase !== false) t = t.toLowerCase();
    if (t && !out.includes(t) && out.length < max) out.push(t);
  }
  return out;
}

/** Client-side mirror of the services' https rule (the server re-validates). */
export function httpsProblem(url: string): string | null {
  const v = url.trim();
  if (!v) return 'Enter a URL.';
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return 'Not a valid URL.';
  }
  if (u.protocol !== 'https:') return 'Links must use https://';
  return null;
}

export interface LinkRow {
  label: string;
  url: string;
}

/** Validate a links list; returns per-row errors keyed like the API issues (`links.0.url`). */
export function linkErrors(links: readonly LinkRow[]): Record<string, string> {
  const errs: Record<string, string> = {};
  links.forEach((l, i) => {
    if (!l.label.trim()) errs[`links.${i}.label`] = 'Add a label.';
    else if (l.label.trim().length > 80) errs[`links.${i}.label`] = 'At most 80 characters.';
    const p = httpsProblem(l.url);
    if (p) errs[`links.${i}.url`] = p;
  });
  return errs;
}

/** Empty string → null; otherwise trimmed. */
export const nullIfBlank = (v: string): string | null => (v.trim() ? v.trim() : null);

/** Empty string → undefined; otherwise trimmed. */
export const undefinedIfBlank = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);

/** Parse an integer input; returns null for blank or invalid. */
export function intOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Duration in ms from an amount + unit. */
export function durationMs(amount: number, unit: 'minutes' | 'hours' | 'days'): number {
  const m = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[unit];
  return Math.round(amount * m);
}

/** Simple lowercase substring search across a few text fields. */
export function matchesQuery(
  q: string | undefined,
  ...fields: Array<string | null | undefined | readonly string[]>
): boolean {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) =>
    Array.isArray(f)
      ? f.some((x) => x.toLowerCase().includes(needle))
      : typeof f === 'string' && f.toLowerCase().includes(needle),
  );
}
