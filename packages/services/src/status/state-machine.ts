import type { GuildConfig, MonitoredService, ServiceState } from '@gynx/database';
import type { CheckResult } from './types';

/**
 * Pure monitoring state machine. No I/O: given the persisted service snapshot,
 * one check result, thresholds and the clock, compute the next persisted state,
 * an optional transition and whether an alert must be emitted.
 *
 * Rules
 *  - OUTAGE only after `failureThreshold` consecutive failures.
 *  - DEGRADED after `failureThreshold` consecutive degraded-but-ok results
 *    (or `recoveryThreshold` ok results when recovering from OUTAGE).
 *  - OPERATIONAL after `recoveryThreshold` consecutive clean successes. From
 *    UNKNOWN (fresh / after maintenance) a single clean success is enough.
 *  - MAINTENANCE while an in-progress window covers the service: no alerts.
 *  - Alert dedupe: only when the state differs from `lastAlertState` (null is
 *    treated as OPERATIONAL, so a fresh service coming up healthy is silent),
 *    and the cooldown has elapsed — except a recovery after an alerted outage /
 *    degradation, which is always announced. An alert suppressed by cooldown is
 *    emitted on a later check once the cooldown elapses if the state persists.
 */

export interface Thresholds {
  failureThreshold: number;
  recoveryThreshold: number;
  cooldownMs: number;
}

export type ServiceSnapshot = Pick<
  MonitoredService,
  'state' | 'consecutiveFailures' | 'consecutiveSuccesses' | 'lastStateChangeAt' | 'lastAlertAt' | 'lastAlertState'
>;

export interface ApplyOptions {
  /** An IN_PROGRESS maintenance window covers this service. */
  inMaintenance?: boolean;
  /**
   * Previous results, most recent first (excluding the current one). Used to
   * tell clean successes from degraded ones; when omitted every ok result in
   * the current streak is assumed to have the same quality as this one.
   */
  previous?: ReadonlyArray<Pick<CheckResult, 'ok' | 'degraded'>>;
}

export interface StateUpdate {
  state: ServiceState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: Date;
  lastStateChangeAt: Date | null;
  lastAlertAt: Date | null;
  lastAlertState: ServiceState | null;
}

export interface ApplyOutcome {
  update: StateUpdate;
  transition: { from: ServiceState; to: ServiceState; at: Date } | null;
  /** Emit an alert for `update.state`; dedupe on `update.lastStateChangeAt`. */
  alert: { state: ServiceState; previousAlertState: ServiceState | null; recovery: boolean } | null;
}

/** Per-service thresholds override guild defaults. */
export function resolveThresholds(
  service: Pick<MonitoredService, 'failureThreshold' | 'recoveryThreshold'>,
  cfg: Pick<GuildConfig, 'statusFailureThreshold' | 'statusRecoveryThreshold' | 'statusAlertCooldownMinutes'>,
): Thresholds {
  return {
    failureThreshold: Math.max(1, service.failureThreshold ?? cfg.statusFailureThreshold),
    recoveryThreshold: Math.max(1, service.recoveryThreshold ?? cfg.statusRecoveryThreshold),
    cooldownMs: Math.max(0, cfg.statusAlertCooldownMinutes) * 60_000,
  };
}

/** Severity rank: higher is worse. Used for "recovery" detection and overall status. */
export const STATE_RANK: Record<ServiceState, number> = {
  OPERATIONAL: 0,
  UNKNOWN: 1,
  MAINTENANCE: 2,
  DEGRADED: 3,
  OUTAGE: 4,
};

const ALERTABLE: ReadonlySet<ServiceState> = new Set(['OPERATIONAL', 'DEGRADED', 'OUTAGE']);

function sameQualityStreak(result: CheckResult, okStreak: number, previous?: ApplyOptions['previous']): number {
  if (!previous) return okStreak;
  let n = 1;
  for (const p of previous) {
    if (n >= okStreak) break;
    if (!p.ok || p.degraded !== result.degraded) break;
    n++;
  }
  return Math.min(n, okStreak);
}

function nextState(current: ServiceState, result: CheckResult, t: Thresholds, failStreak: number, okStreak: number, qualityStreak: number): ServiceState {
  // A window that ended without the end job running yet behaves like UNKNOWN.
  const base: ServiceState = current === 'MAINTENANCE' ? 'UNKNOWN' : current;
  if (!result.ok) {
    return failStreak >= t.failureThreshold ? 'OUTAGE' : base;
  }
  if (result.degraded) {
    if (base === 'DEGRADED') return 'DEGRADED';
    if (base === 'OUTAGE') return okStreak >= t.recoveryThreshold ? 'DEGRADED' : 'OUTAGE';
    return qualityStreak >= t.failureThreshold ? 'DEGRADED' : base;
  }
  // clean success
  if (base === 'OPERATIONAL') return 'OPERATIONAL';
  if (base === 'UNKNOWN') return 'OPERATIONAL';
  return qualityStreak >= t.recoveryThreshold ? 'OPERATIONAL' : base;
}

export function applyCheckResult(
  service: ServiceSnapshot,
  result: CheckResult,
  thresholds: Thresholds,
  now: Date,
  opts: ApplyOptions = {},
): ApplyOutcome {
  const failStreak = result.ok ? 0 : service.consecutiveFailures + 1;
  const okStreak = result.ok ? service.consecutiveSuccesses + 1 : 0;
  const quality = result.ok ? sameQualityStreak(result, okStreak, opts.previous) : 0;

  const to: ServiceState = opts.inMaintenance ? 'MAINTENANCE' : nextState(service.state, result, thresholds, failStreak, okStreak, quality);
  const changed = to !== service.state;
  const lastStateChangeAt = changed ? now : service.lastStateChangeAt;

  const update: StateUpdate = {
    state: to,
    consecutiveFailures: failStreak,
    consecutiveSuccesses: okStreak,
    lastCheckedAt: now,
    lastStateChangeAt,
    lastAlertAt: service.lastAlertAt,
    lastAlertState: service.lastAlertState,
  };

  let alert: ApplyOutcome['alert'] = null;
  if (ALERTABLE.has(to)) {
    const baseline: ServiceState = service.lastAlertState ?? 'OPERATIONAL';
    if (to !== baseline) {
      const recovery = (baseline === 'OUTAGE' || baseline === 'DEGRADED') && STATE_RANK[to] < STATE_RANK[baseline];
      const cooldownElapsed = !service.lastAlertAt || now.getTime() - service.lastAlertAt.getTime() >= thresholds.cooldownMs;
      if (recovery || cooldownElapsed) {
        alert = { state: to, previousAlertState: service.lastAlertState, recovery };
        update.lastAlertAt = now;
        update.lastAlertState = to;
      }
    }
  }

  return { update, transition: changed ? { from: service.state, to, at: now } : null, alert };
}
