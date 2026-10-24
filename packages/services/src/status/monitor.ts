import type { MonitoredService, Prisma } from '@gynx/database';
import { getGuildConfig } from '../core/config';
import { makeCtx, systemActor, type Ctx, type ServiceDeps } from '../core/context';
import { defaultAdapters } from './adapters';
import { ACTIVE_INCIDENT_STATUSES, addIncidentUpdateTx, createIncidentTx } from './incidents';
import { servicesInMaintenance } from './maintenance';
import { enqueueAlert } from './services';
import { applyCheckResult, resolveThresholds, type ApplyOutcome } from './state-machine';
import type { AdapterRegistry, CheckOptions, CheckResult } from './types';

export interface RunChecksOptions {
  adapters?: AdapterRegistry;
  checkOptions?: CheckOptions;
  concurrency?: number;
}

export interface RunChecksSummary {
  checked: number;
  failures: number;
  transitions: number;
  alerts: number;
  errors: number;
}

/** Run `fn` over items with at most `limit` in flight. Never rejects: per-item errors are returned. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const out: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx]!) };
      } catch (error) {
        out[idx] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** System ctx whose clock is the run's `now`, so incidents/audits line up with the check. */
function systemCtx(deps: ServiceDeps, guildId: string, now: Date): Ctx {
  return { ...makeCtx(deps, guildId, systemActor('worker')), now: () => now };
}

export const autoIncidentText = (name: string) => ({
  title: `Service disruption: ${name}`,
  description: `We're investigating issues affecting ${name}. Updates will follow here.`,
});

/**
 * OUTAGE on a public service: open an automatic incident unless an active one
 * already covers it (idempotent). If an automatic incident is MONITORING
 * (recovered earlier) it is moved back to INVESTIGATING.
 */
async function onOutage(tx: Prisma.TransactionClient, ctx: Ctx, svc: MonitoredService): Promise<void> {
  const existing = await tx.incident.findFirst({
    where: { guildId: ctx.guildId, status: { in: ACTIVE_INCIDENT_STATUSES }, services: { some: { id: svc.id } } },
    orderBy: { startedAt: 'desc' },
  });
  if (existing) {
    if (existing.autoCreated && existing.status === 'MONITORING') {
      await addIncidentUpdateTx(tx, ctx, existing, { status: 'INVESTIGATING', message: `We're seeing renewed issues affecting ${svc.name} and are investigating.` });
    }
    return;
  }
  const text = autoIncidentText(svc.name);
  await createIncidentTx(tx, ctx, {
    ...text,
    severity: 'MAJOR',
    status: 'INVESTIGATING',
    serviceIds: [svc.id],
    regions: svc.region ? [svc.region] : [],
    autoCreated: true,
  });
}

/** Recovery: automatic incidents whose services are all out of OUTAGE move to MONITORING. Staff resolve manually. */
async function onRecovery(tx: Prisma.TransactionClient, ctx: Ctx, svc: MonitoredService): Promise<void> {
  const incidents = await tx.incident.findMany({
    where: { guildId: ctx.guildId, autoCreated: true, status: { in: ['INVESTIGATING', 'IDENTIFIED'] }, services: { some: { id: svc.id } } },
    include: { services: { select: { state: true } } },
  });
  for (const { services, ...incident } of incidents) {
    if (services.some((s) => s.state === 'OUTAGE')) continue;
    await addIncidentUpdateTx(tx, ctx, incident, {
      status: 'MONITORING',
      message: `${svc.name} has recovered. We're monitoring to make sure it stays stable.`,
    });
  }
}

/** Persist one check result and apply the state machine atomically. */
export async function recordCheck(
  deps: ServiceDeps,
  service: MonitoredService,
  result: CheckResult,
  now: Date,
  opts: { inMaintenance: boolean; previous: Array<{ ok: boolean; degraded: boolean }> },
): Promise<ApplyOutcome | null> {
  const cfg = await getGuildConfig(deps.db, service.guildId);
  const ctx = systemCtx(deps, service.guildId, now);
  return deps.db.$transaction(async (tx) => {
    await tx.healthCheck.create({
      data: {
        serviceId: service.id,
        checkedAt: now,
        ok: result.ok,
        degraded: result.ok && result.degraded,
        latencyMs: typeof result.latencyMs !== 'number' ? null : Math.max(0, Math.round(result.latencyMs)),
        statusCode: result.statusCode ?? null,
        errorClass: result.ok ? null : (result.errorClass ?? null),
      },
    });
    // Re-read inside the transaction so counters are never applied to a stale snapshot.
    const fresh = await tx.monitoredService.findUnique({ where: { id: service.id } });
    if (!fresh || !fresh.enabled || fresh.kind === 'MANUAL') return null;

    const out = applyCheckResult(fresh, result, resolveThresholds(fresh, cfg), now, opts);
    const updated = await tx.monitoredService.update({ where: { id: fresh.id }, data: out.update });

    if (out.alert) {
      // `from` = what members were last told (null baseline = operational).
      await enqueueAlert(tx, fresh.guildId, fresh.id, out.alert.state, out.alert.previousAlertState ?? 'OPERATIONAL', out.update.lastStateChangeAt ?? now);
    }
    if (out.transition && updated.public) {
      const { from, to } = out.transition;
      if (to === 'OUTAGE') await onOutage(tx, ctx, updated);
      else if (from === 'OUTAGE' && (to === 'OPERATIONAL' || to === 'DEGRADED')) await onRecovery(tx, ctx, updated);
    }
    return out;
  });
}

/**
 * One monitoring pass for a guild: every enabled non-MANUAL service is checked
 * with bounded concurrency. A failing service (or a DB error for it) never
 * affects the others.
 */
export async function runStatusChecks(deps: ServiceDeps, guildId: string, now: Date, opts: RunChecksOptions = {}): Promise<RunChecksSummary> {
  const cfg = await getGuildConfig(deps.db, guildId);
  const summary: RunChecksSummary = { checked: 0, failures: 0, transitions: 0, alerts: 0, errors: 0 };
  if (!cfg.enabledModules.includes('status')) return summary;

  const adapters = opts.adapters ?? defaultAdapters;
  const services = await deps.db.monitoredService.findMany({ where: { guildId, enabled: true, kind: { not: 'MANUAL' } } });
  if (services.length === 0) return summary;
  const maintenance = await servicesInMaintenance(deps.db, guildId);

  const results = await mapPool(services, Math.max(1, opts.concurrency ?? 5), async (svc) => {
    const adapter = adapters[svc.kind];
    if (!adapter) return null;
    const window = Math.max(svc.failureThreshold ?? cfg.statusFailureThreshold, svc.recoveryThreshold ?? cfg.statusRecoveryThreshold);
    const previous = await deps.db.healthCheck.findMany({
      where: { serviceId: svc.id },
      orderBy: { checkedAt: 'desc' },
      take: window,
      select: { ok: true, degraded: true },
    });
    let result: CheckResult;
    try {
      result = await adapter.check(svc, opts.checkOptions);
    } catch {
      // Adapters shouldn't throw; if one does, record a sanitised failure.
      result = { ok: false, degraded: false, latencyMs: null, errorClass: 'INVALID_RESPONSE' };
    }
    const out = await recordCheck(deps, svc, result, now, { inMaintenance: maintenance.has(svc.id), previous });
    return { result, out };
  });

  for (const [i, r] of results.entries()) {
    if (!r.ok) {
      summary.errors++;
      deps.log.error({ err: r.error, serviceId: services[i]?.id }, 'status check failed');
      continue;
    }
    if (!r.value) continue;
    summary.checked++;
    if (!r.value.result.ok) summary.failures++;
    if (r.value.out?.transition) summary.transitions++;
    if (r.value.out?.alert) summary.alerts++;
  }
  return summary;
}

/** Retention: delete HealthCheck rows older than GuildConfig.healthCheckRetentionDays. */
export async function purgeOldHealthChecks(db: ServiceDeps['db'], guildId: string, now: Date): Promise<number> {
  const cfg = await getGuildConfig(db, guildId);
  const cutoff = new Date(now.getTime() - cfg.healthCheckRetentionDays * 86_400_000);
  const res = await db.healthCheck.deleteMany({ where: { checkedAt: { lt: cutoff }, service: { guildId } } });
  return res.count;
}
