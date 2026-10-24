/**
 * Pure metric primitives for analytics and the weekly CEO report.
 *
 * Semantics that every calculator follows:
 *  - A metric whose data source has never recorded a single row is *unavailable*
 *    (`{ available: false, reason }`) — it is never silently reported as 0.
 *  - A source that has rows, just none in the period, yields a genuine 0.
 *  - Comparisons are always against the previous period of equal length and are
 *    null-safe: no previous value, or a previous value of 0, gives "n/a" for %.
 *  - Community activity numbers are *observed message activity* — Discord provides
 *    no view/impression data, so lurkers are invisible to these metrics.
 */

export type Metric<T> =
  { available: true; value: T; previous?: T; note?: string } | { available: false; reason: string };

export const available = <T>(value: T, note?: string): Metric<T> =>
  note === undefined ? { available: true, value } : { available: true, value, note };

export const unavailable = <T = never>(reason: string): Metric<T> => ({ available: false, reason });

/**
 * Build a metric from a data source. `hasAnyRows` = the source has at least one row
 * ever (for this guild). No rows ever → unavailable with `reason`; otherwise the value
 * (which may legitimately be 0).
 */
export function fromSource<T>(hasAnyRows: boolean, value: T, reason: string, note?: string): Metric<T> {
  return hasAnyRows ? available(value, note) : unavailable(reason);
}

/** Attach the previous period's value to a metric (only when both are available). */
export function withPrevious<T>(current: Metric<T>, previous: Metric<T> | undefined): Metric<T> {
  if (!current.available || !previous || !previous.available) return current;
  return { ...current, previous: previous.value };
}

export interface Comparison {
  delta: number | null;
  /** Percentage change, null when previous is missing or zero. */
  pct: number | null;
}

/** Null-safe comparison against the previous period. */
export function compare(current: number | null | undefined, previous: number | null | undefined): Comparison {
  if (current === null || current === undefined || previous === null || previous === undefined)
    return { delta: null, pct: null };
  const delta = current - previous;
  const pct = previous === 0 ? null : Math.round((delta / Math.abs(previous)) * 1000) / 10;
  return { delta, pct };
}

export function formatComparison(c: Comparison): string {
  if (c.delta === null) return 'n/a';
  const sign = c.delta > 0 ? '+' : '';
  const pct = c.pct === null ? 'n/a' : `${c.pct > 0 ? '+' : ''}${c.pct}%`;
  return `${sign}${fmtNum(c.delta)} (${pct})`;
}

export function fmtNum(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Render a scalar metric for humans; unavailable → "Not available — <reason>". */
export function formatMetric(m: Metric<number>, suffix = ''): string {
  if (!m.available) return `Not available — ${m.reason}`;
  return `${fmtNum(m.value)}${suffix}${m.note ? ` (${m.note})` : ''}`;
}

// ── Periods ────────────────────────────────────────────────────────────────

export interface Period {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** The previous period of equal length, ending where `p` starts. */
export function previousPeriod(p: Period): Period {
  const len = p.end.getTime() - p.start.getTime();
  return { start: new Date(p.start.getTime() - len), end: new Date(p.start.getTime()) };
}

/** Parse YYYY-MM-DD as a UTC calendar date (no zone semantics, just arithmetic). */
function keyToUtc(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDaysToKey(key: string, days: number): string {
  return new Date(keyToUtc(key) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar date keys from `startKey` (inclusive) to `endKey` (exclusive). */
export function dateKeysBetween(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  for (let t = keyToUtc(startKey), end = keyToUtc(endKey); t < end && out.length < 3700; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ── Community calculators ──────────────────────────────────────────────────

export interface MemberFlow {
  joins: number;
  leaves: number;
  net: number;
}

/** Joins, leaves and net growth from MemberEvent types observed in a period. */
export function memberFlow(events: ReadonlyArray<{ type: 'JOIN' | 'LEAVE'; count: number }>): MemberFlow {
  let joins = 0;
  let leaves = 0;
  for (const e of events) {
    if (e.type === 'JOIN') joins += e.count;
    else leaves += e.count;
  }
  return { joins, leaves, net: joins - leaves };
}

/**
 * Active members: distinct users whose summed message count across the period's
 * days is ≥ `minMessages` (GuildConfig.activeMemberMinMessages, clamped to ≥ 1).
 */
export function countActiveMembers(
  perUser: ReadonlyArray<{ userId: string; messages: number }>,
  minMessages: number,
): number {
  const threshold = Math.max(1, minMessages);
  const totals = new Map<string, number>();
  for (const r of perUser) totals.set(r.userId, (totals.get(r.userId) ?? 0) + r.messages);
  let n = 0;
  for (const v of totals.values()) if (v >= threshold) n++;
  return n;
}

/**
 * DAU = average number of distinct posting users per day across the period's days
 * (observed message activity). Days with no rows count as 0.
 */
export function averageDaily(
  distinctUsersByDate: ReadonlyMap<string, number>,
  periodKeys: readonly string[],
): number {
  if (periodKeys.length === 0) return 0;
  let sum = 0;
  for (const k of periodKeys) sum += distinctUsersByDate.get(k) ?? 0;
  return Math.round((sum / periodKeys.length) * 10) / 10;
}

/** Top-N entries of a count map, descending, ties broken by key for stability. */
export function topN(
  counts: ReadonlyMap<string, number> | Record<string, number>,
  n: number,
): Array<{ id: string; count: number }> {
  const entries = counts instanceof Map ? [...counts.entries()] : Object.entries(counts);
  return entries
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, n);
}

// ── Infrastructure calculators ─────────────────────────────────────────────

/** Uptime % from health checks (ok / total), or null when there are no checks ("no data"). */
export function uptimePercent(okChecks: number, totalChecks: number): number | null {
  if (totalChecks <= 0) return null;
  return Math.round((okChecks / totalChecks) * 10000) / 100;
}

/**
 * Total incident time inside the period: each incident contributes the overlap of
 * [startedAt, resolvedAt ?? asOf) with [period.start, min(period.end, asOf)).
 */
export function incidentDurationMs(
  incidents: ReadonlyArray<{ startedAt: Date; resolvedAt: Date | null }>,
  period: Period,
  asOf: Date,
): number {
  const windowEnd = Math.min(period.end.getTime(), asOf.getTime());
  let total = 0;
  for (const i of incidents) {
    const s = Math.max(i.startedAt.getTime(), period.start.getTime());
    const e = Math.min((i.resolvedAt ?? asOf).getTime(), windowEnd);
    if (e > s) total += e - s;
  }
  return total;
}

// ── Marketing calculators ──────────────────────────────────────────────────

/**
 * Tracked link clicks are a cumulative counter. Period clicks = end snapshot − baseline
 * snapshot (daily snapshots stored in AnalyticsDaily). Without a baseline the cumulative
 * total is returned and labelled "first period, cumulative".
 */
export function periodClicks(baseline: number | null, end: number | null): Metric<number> {
  if (end === null) return unavailable('no click snapshot exists for the end of this period');
  if (baseline === null) return available(end, 'first period, cumulative');
  // Counters only grow; a negative delta means links were deleted — clamp and say so.
  if (end < baseline) return available(0, 'links removed during period; clicks may be undercounted');
  return available(end - baseline);
}
