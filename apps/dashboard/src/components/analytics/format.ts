/**
 * Pure display helpers for analytics metrics (safe on server and client).
 *
 * Rules (mirroring packages/services/src/analytics/metrics.ts):
 *  - An unavailable metric renders "Not available — <reason>", never 0.
 *  - A delta needs a previous value; without one it renders "n/a". A previous
 *    value of 0 gives an absolute delta but "n/a" for the percentage.
 */

export type MetricLike<T> =
  { available: true; value: T; previous?: T; note?: string } | { available: false; reason: string };

export interface Delta {
  delta: number | null;
  pct: number | null;
}

export function fmtNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function computeDelta(current: number | null | undefined, previous: number | null | undefined): Delta {
  if (current === null || current === undefined || previous === null || previous === undefined)
    return { delta: null, pct: null };
  const delta = current - previous;
  const pct = previous === 0 ? null : Math.round((delta / Math.abs(previous)) * 1000) / 10;
  return { delta, pct };
}

/** "+3 (+12.5%)", "-2 (n/a)" when previous was 0, or "n/a" without a baseline. */
export function formatDelta(d: Delta): string {
  if (d.delta === null) return 'n/a';
  const sign = d.delta > 0 ? '+' : '';
  const pct = d.pct === null ? 'n/a' : `${d.pct > 0 ? '+' : ''}${d.pct}%`;
  return `${sign}${fmtNum(d.delta)} (${pct})`;
}

export const unavailableText = (reason: string) => `Not available — ${reason}`;

export interface MetricDisplay {
  available: boolean;
  /** Main value text, or the "Not available — reason" sentence. */
  value: string;
  /** Qualifying note from the service (e.g. "observed message activity"). */
  note: string | null;
  /** Change vs previous period; null when the metric is unavailable. */
  delta: string | null;
  direction: 'up' | 'down' | 'flat' | null;
}

export function displayMetric(m: MetricLike<number> | undefined, suffix = ''): MetricDisplay {
  if (!m)
    return {
      available: false,
      value: unavailableText('not reported for this period'),
      note: null,
      delta: null,
      direction: null,
    };
  if (!m.available)
    return { available: false, value: unavailableText(m.reason), note: null, delta: null, direction: null };
  const d = computeDelta(m.value, m.previous);
  return {
    available: true,
    value: `${fmtNum(m.value)}${suffix}`,
    note: m.note ?? null,
    delta: formatDelta(d),
    direction: d.delta === null ? null : d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : 'flat',
  };
}

/** Breakdown record → entries sorted by count desc then key; null when unavailable. */
export function breakdownEntries(
  m: MetricLike<Record<string, number>> | undefined,
): Array<{ key: string; label: string; value: number; previous: number | null }> | null {
  if (!m || !m.available) return null;
  const prev = m.previous ?? null;
  const keys = new Set([...Object.keys(m.value), ...Object.keys(prev ?? {})]);
  return [...keys]
    .map((key) => ({
      key,
      label: humanise(key),
      value: m.value[key] ?? 0,
      previous: prev ? (prev[key] ?? 0) : null,
    }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

export const humanise = (v: string) =>
  v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase().replace(/_/g, ' ') : v;

export const uptimeText = (pct: number | null) => (pct === null ? 'no data' : `${pct}%`);

export function formatMinutes(min: number): string {
  if (min < 60) return `${fmtNum(min)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export type DeliveryTone = 'success' | 'danger' | 'neutral';
export function deliveryStatus(r: { deliveredAt: Date | string | null; deliveryError: string | null }): {
  label: string;
  tone: DeliveryTone;
} {
  if (r.deliveredAt) return { label: 'Delivered', tone: 'success' };
  if (r.deliveryError) return { label: 'Delivery failed', tone: 'danger' };
  return { label: 'Not delivered', tone: 'neutral' };
}

// ── Staff stats sorting ────────────────────────────────────────────────────

export const STAFF_SORT_KEYS = [
  'userId',
  'moderationActions',
  'reportsClaimed',
  'reportsResolved',
  'incidentUpdates',
  'partnerReviews',
  'total',
] as const;
export type StaffSortKey = (typeof STAFF_SORT_KEYS)[number];

export function parseStaffSort(
  sort: string | undefined,
  dir: string | undefined,
): { key: StaffSortKey; dir: 'asc' | 'desc' } {
  const key = (STAFF_SORT_KEYS as readonly string[]).includes(sort ?? '') ? (sort as StaffSortKey) : 'total';
  const d = dir === 'asc' || dir === 'desc' ? dir : key === 'userId' ? 'asc' : 'desc';
  return { key, dir: d };
}

export function sortStaffRows<T extends Record<StaffSortKey, string | number>>(
  rows: readonly T[],
  key: StaffSortKey,
  dir: 'asc' | 'desc',
): T[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    const c =
      typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return c * mul || String(a.userId).localeCompare(String(b.userId));
  });
}

// ── Downloads ──────────────────────────────────────────────────────────────

/** Content-Disposition for a download; the ASCII filename is restricted to a safe charset. */
export function attachmentDisposition(filename: string): string {
  const safe =
    filename
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'report';
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
