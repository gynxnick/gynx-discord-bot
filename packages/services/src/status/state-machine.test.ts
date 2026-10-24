import { describe, expect, it } from 'vitest';
import { applyCheckResult, resolveThresholds, type ApplyOutcome, type ServiceSnapshot, type Thresholds } from './state-machine';
import type { CheckResult } from './types';

const T: Thresholds = { failureThreshold: 3, recoveryThreshold: 2, cooldownMs: 15 * 60_000 };
const FAIL: CheckResult = { ok: false, degraded: false, latencyMs: null, errorClass: 'TIMEOUT' };
const OK: CheckResult = { ok: true, degraded: false, latencyMs: 40 };
const SLOW: CheckResult = { ok: true, degraded: true, latencyMs: 4000 };

const fresh = (over: Partial<ServiceSnapshot> = {}): ServiceSnapshot => ({
  state: 'UNKNOWN',
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  lastStateChangeAt: null,
  lastAlertAt: null,
  lastAlertState: null,
  ...over,
});

/** Feed a sequence of results one minute apart; returns the final snapshot and every outcome. */
function run(start: ServiceSnapshot, results: CheckResult[], opts: { t?: Thresholds; startAt?: number; stepMs?: number; inMaintenance?: boolean } = {}) {
  let s = start;
  const history: CheckResult[] = [];
  const outcomes: ApplyOutcome[] = [];
  let at = opts.startAt ?? Date.UTC(2026, 0, 1);
  for (const r of results) {
    const out = applyCheckResult(s, r, opts.t ?? T, new Date(at), { inMaintenance: opts.inMaintenance, previous: [...history].reverse() });
    outcomes.push(out);
    history.push(r);
    s = { ...s, ...out.update };
    at += opts.stepMs ?? 60_000;
  }
  return { s, outcomes, alerts: outcomes.filter((o) => o.alert).map((o) => o.alert!.state), endAt: at };
}

describe('status state machine', () => {
  it('a fresh service becomes OPERATIONAL on the first clean success without alerting', () => {
    const { s, alerts, outcomes } = run(fresh(), [OK]);
    expect(s.state).toBe('OPERATIONAL');
    expect(outcomes[0]!.transition).toMatchObject({ from: 'UNKNOWN', to: 'OPERATIONAL' });
    expect(alerts).toEqual([]);
  });

  it('declares OUTAGE only after failureThreshold consecutive failures, alerting once', () => {
    const { s, outcomes, alerts } = run(fresh({ state: 'OPERATIONAL' }), [FAIL, FAIL, FAIL, FAIL, FAIL]);
    expect(outcomes.map((o) => o.update.state)).toEqual(['OPERATIONAL', 'OPERATIONAL', 'OUTAGE', 'OUTAGE', 'OUTAGE']);
    expect(alerts).toEqual(['OUTAGE']);
    expect(s.consecutiveFailures).toBe(5);
    expect(s.lastAlertState).toBe('OUTAGE');
  });

  it('a success resets the failure streak (no outage on intermittent failures)', () => {
    const { s, alerts } = run(fresh({ state: 'OPERATIONAL' }), [FAIL, FAIL, OK, FAIL, FAIL, OK]);
    expect(s.state).toBe('OPERATIONAL');
    expect(alerts).toEqual([]);
  });

  it('recovers only after recoveryThreshold consecutive successes, and always announces recovery', () => {
    const down = run(fresh({ state: 'OPERATIONAL' }), [FAIL, FAIL, FAIL]);
    // Recovery inside the cooldown window is still announced.
    const up = run(down.s, [OK, FAIL, OK, OK], { startAt: down.endAt, stepMs: 1000 });
    expect(up.outcomes.map((o) => o.update.state)).toEqual(['OUTAGE', 'OUTAGE', 'OUTAGE', 'OPERATIONAL']);
    expect(up.alerts).toEqual(['OPERATIONAL']);
    expect(up.outcomes[3]!.alert!.recovery).toBe(true);
  });

  it('per-service thresholds override guild defaults', () => {
    const cfg = { statusFailureThreshold: 3, statusRecoveryThreshold: 2, statusAlertCooldownMinutes: 15 };
    expect(resolveThresholds({ failureThreshold: null, recoveryThreshold: null }, cfg)).toEqual({ failureThreshold: 3, recoveryThreshold: 2, cooldownMs: 900_000 });
    const t = resolveThresholds({ failureThreshold: 1, recoveryThreshold: 5 }, cfg);
    expect(t).toMatchObject({ failureThreshold: 1, recoveryThreshold: 5 });
    const { s } = run(fresh({ state: 'OPERATIONAL' }), [FAIL], { t });
    expect(s.state).toBe('OUTAGE');
  });

  it('flapping inside the cooldown does not spam alerts; a persisting state is alerted once the cooldown elapses', () => {
    const t = { ...T, cooldownMs: 10 * 60_000 };
    // outage(alert) → recovery(alert, always) → outage again within cooldown (suppressed)
    const seq = [FAIL, FAIL, FAIL, OK, OK, FAIL, FAIL, FAIL];
    const a = run(fresh({ state: 'OPERATIONAL' }), seq, { t });
    expect(a.alerts).toEqual(['OUTAGE', 'OPERATIONAL']);
    expect(a.s.state).toBe('OUTAGE');
    expect(a.s.lastAlertState).toBe('OPERATIONAL');

    // still down 10+ minutes after the last alert → deferred OUTAGE alert, exactly once
    const b = run(a.s, Array(12).fill(FAIL), { t, startAt: a.endAt });
    expect(b.alerts).toEqual(['OUTAGE']);
  });

  it('flapping up/down rapidly never alerts more than once per cooldown for the same direction', () => {
    const t = { ...T, failureThreshold: 1, recoveryThreshold: 1, cooldownMs: 60 * 60_000 };
    const seq = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? FAIL : OK));
    const { alerts } = run(fresh({ state: 'OPERATIONAL' }), seq, { t });
    // first outage + its recovery; everything after is suppressed by the cooldown
    expect(alerts).toEqual(['OUTAGE', 'OPERATIONAL']);
  });

  it('DEGRADED requires failureThreshold consecutive degraded results and recovers after recoveryThreshold clean ones', () => {
    const { outcomes, alerts, s } = run(fresh({ state: 'OPERATIONAL' }), [SLOW, OK, SLOW, SLOW, SLOW, OK, OK]);
    expect(outcomes.map((o) => o.update.state)).toEqual(['OPERATIONAL', 'OPERATIONAL', 'OPERATIONAL', 'OPERATIONAL', 'DEGRADED', 'DEGRADED', 'OPERATIONAL']);
    expect(alerts).toEqual(['DEGRADED', 'OPERATIONAL']);
    expect(s.state).toBe('OPERATIONAL');
  });

  it('a degraded-but-ok service recovering from OUTAGE goes to DEGRADED', () => {
    const down = run(fresh({ state: 'OPERATIONAL' }), [FAIL, FAIL, FAIL]);
    const up = run(down.s, [SLOW, SLOW], { startAt: down.endAt });
    expect(up.s.state).toBe('DEGRADED');
    expect(up.alerts).toEqual(['DEGRADED']);
  });

  it('MAINTENANCE suppresses outage alerts while a window is in progress', () => {
    const { s, alerts, outcomes } = run(fresh({ state: 'OPERATIONAL' }), [FAIL, FAIL, FAIL, FAIL], { inMaintenance: true });
    expect(s.state).toBe('MAINTENANCE');
    expect(outcomes.filter((o) => o.transition)).toHaveLength(1);
    expect(alerts).toEqual([]);
    expect(s.consecutiveFailures).toBe(4); // counters keep running
  });

  it('after maintenance (state reset to UNKNOWN) the next clean check sets the real state silently', () => {
    const { s, alerts } = run(fresh({ state: 'UNKNOWN', lastAlertState: 'OPERATIONAL', lastAlertAt: new Date(0) }), [OK]);
    expect(s.state).toBe('OPERATIONAL');
    expect(alerts).toEqual([]);
  });

  it('a MAINTENANCE state left behind after the window ended behaves like UNKNOWN', () => {
    const { s } = run(fresh({ state: 'MAINTENANCE' }), [OK]);
    expect(s.state).toBe('OPERATIONAL');
  });

  it('never alerts for UNKNOWN or MAINTENANCE', () => {
    const out = applyCheckResult(fresh({ state: 'OPERATIONAL', lastAlertState: 'OUTAGE' }), FAIL, T, new Date(), { inMaintenance: true });
    expect(out.update.state).toBe('MAINTENANCE');
    expect(out.alert).toBeNull();
  });
});
