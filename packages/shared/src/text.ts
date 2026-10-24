/** Small text helpers shared across the bot and dashboard. */

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 1))}…`;
}

/** Human-readable sequential reference, e.g. formatRef('T', 42) → "T-0042". */
export function formatRef(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

/** Escape text for safe embedding inside HTML (transcripts, reports). */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Neutralise mass mentions in user-provided text before the bot echoes it. */
export function neutraliseMentions(input: string): string {
  return input.replace(/@(everyone|here)/gi, '@​$1').replace(/<@&(\d+)>/g, '@role');
}

/** Normalise text for duplicate detection / comparison. */
export function normaliseForCompare(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaccard similarity of word sets (0..1), used for suggestion duplicate detection. */
export function similarity(a: string, b: string): number {
  const sa = new Set(normaliseForCompare(a).split(' ').filter((w) => w.length > 2));
  const sb = new Set(normaliseForCompare(b).split(' ').filter((w) => w.length > 2));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Extract URLs from free text. */
export function extractUrls(input: string): string[] {
  return [...input.matchAll(/\bhttps?:\/\/[^\s<>()"']+/gi)].map((m) => m[0]);
}

/** Extract hostname from a URL safely (lowercased), or null. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
