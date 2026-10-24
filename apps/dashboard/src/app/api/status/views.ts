import type { MonitoredService } from '@gynx/database';
import { zonedParts, zonedToUtc } from '@gynx/shared';

/**
 * Dashboard projection of a monitored service. The internal check `target`
 * and `port` are only included for holders of `status.manage`; everyone else
 * gets null plus `targetHidden: true`.
 */
export interface ServiceView {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  description: string | null;
  kind: MonitoredService['kind'];
  target: string | null;
  port: number | null;
  targetHidden: boolean;
  expectedStatus: number | null;
  timeoutMs: number;
  degradedLatencyMs: number | null;
  failureThreshold: number | null;
  recoveryThreshold: number | null;
  allowPrivate: boolean;
  enabled: boolean;
  public: boolean;
  sortOrder: number;
  state: MonitoredService['state'];
  lastCheckedAt: string | null;
  lastStateChangeAt: string | null;
}

export function toServiceView(s: MonitoredService, canSeeTarget: boolean): ServiceView {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    region: s.region,
    description: s.description,
    kind: s.kind,
    target: canSeeTarget ? s.target : null,
    port: canSeeTarget ? s.port : null,
    targetHidden: !canSeeTarget,
    expectedStatus: s.expectedStatus,
    timeoutMs: s.timeoutMs,
    degradedLatencyMs: s.degradedLatencyMs,
    failureThreshold: s.failureThreshold,
    recoveryThreshold: s.recoveryThreshold,
    allowPrivate: s.allowPrivate,
    enabled: s.enabled,
    public: s.public,
    sortOrder: s.sortOrder,
    state: s.state,
    lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
    lastStateChangeAt: s.lastStateChangeAt?.toISOString() ?? null,
  };
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/;

/** "YYYY-MM-DDTHH:MM" (or with a space) wall-clock time in `tz` → UTC Date, or null when malformed. */
export function fromLocalInput(value: string, tz: string): Date | null {
  const m = LOCAL_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = zonedToUtc(y, mo, d, h, mi, tz);
  // Reject impossible dates (e.g. 31 February rolls over).
  const back = zonedParts(date, tz);
  if (back.day !== d || back.month !== mo) return null;
  return date;
}

/** UTC Date → "YYYY-MM-DDTHH:MM" in `tz` (value for <input type="datetime-local">). */
export function toLocalInput(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour === 24 ? 0 : p.hour)}:${pad(p.minute)}`;
}
