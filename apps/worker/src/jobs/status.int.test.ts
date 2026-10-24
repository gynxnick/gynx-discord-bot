import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { status, type MessageBody } from '@gynx/services';
import {
  ctxAs,
  freshGuild,
  silentLog,
  snowflake,
  testDb,
  testDeps,
} from '../../../../tests/integration/helpers';
import { JobRunner } from '../framework/runner';
import type { WorkerCtx } from '../framework/types';
import { createStatusJobs, statusJobs } from './status';

const OK: status.CheckResult = { ok: true, degraded: false, latencyMs: 42, statusCode: 200 };
const FAIL: status.CheckResult = { ok: false, degraded: false, latencyMs: null, errorClass: 'CONN_REFUSED' };

let workerSeq = 0;

async function setup(
  opts: {
    dmChunkSize?: number;
    sendDm?: (userId: string, body: MessageBody) => Promise<{ id: string } | null>;
    adapter?: status.CheckAdapter;
  } = {},
) {
  const db = testDb();
  const guildId = await freshGuild();
  const statusChannelId = snowflake();
  const incidentChannelId = snowflake();
  const roleId = snowflake();
  await db.guildConfig.update({
    where: { guildId },
    data: { statusChannelId, incidentChannelId, statusAlertRoleId: roleId },
  });

  const clock = { now: new Date(Math.floor(Date.now() / 60_000) * 60_000 + 5_000) };
  const deps = testDeps({ now: () => clock.now });
  if (opts.sendDm) deps.discord.sendDm = opts.sendDm;
  const results = new Map<string, status.CheckResult>();
  const adapter: status.CheckAdapter = opts.adapter ?? {
    kind: 'HTTP',
    check: async (svc) => results.get(svc.id) ?? OK,
  };
  const mod = createStatusJobs({ adapters: { HTTP: adapter }, dmChunkSize: opts.dmChunkSize });
  const w: WorkerCtx = {
    deps,
    env: { DISCORD_GUILD_ID: guildId, STATUS_CHECK_INTERVAL_SECONDS: 60 } as WorkerEnv,
    log: silentLog,
    workerId: `test-${++workerSeq}`,
  };
  const checks = mod.periodic!.find((p) => p.name === 'status.checks')!;

  /**
   * Run this guild's due jobs through the real handlers. (The shared JobRunner
   * would claim other test files' jobs from the shared database.)
   */
  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      const jobs = await db.scheduledJob.findMany({
        where: { guildId, status: 'PENDING', runAt: { lte: clock.now } },
        orderBy: [{ runAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (jobs.length === 0) return;
      for (const job of jobs) {
        const handler = mod.handlers![job.type];
        if (!handler) throw new Error(`no handler for ${job.type}`);
        await handler(job, w);
        await db.scheduledJob.update({
          where: { id: job.id },
          data: { status: 'DONE', completedAt: clock.now },
        });
      }
    }
  };
  /** Advance one check interval: run due jobs, the periodic check, then the jobs it produced. */
  const step = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.now = new Date(clock.now.getTime() + 60_000);
      await drain();
      await checks.run(w, clock.now);
      await drain();
    }
  };
  const staff = ctxAs(guildId, 'all', { deps });
  const sentTo = (channelId: string) => deps.discord.sent.filter((m) => m.channelId === channelId);
  const alertsIn = () =>
    sentTo(statusChannelId).filter((m) => JSON.stringify(m.body).includes('Automatic status alert'));
  return {
    db,
    guildId,
    statusChannelId,
    incidentChannelId,
    roleId,
    clock,
    deps,
    results,
    drain,
    step,
    staff,
    sentTo,
    alertsIn,
    mod,
    w,
  };
}

describe('status worker: monitoring, alerts and automatic incidents', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('3 failures → one OUTAGE alert + one auto incident; no duplicates; 2 successes → recovery alert + MONITORING', async () => {
    const t = await setup();
    const svc = await status.createService(t.staff, {
      name: 'Game Panel',
      slug: 'panel',
      region: 'EU-West',
      kind: 'HTTP',
      target: 'https://panel-internal.example.com/health',
    });

    await t.step(); // healthy first check: OPERATIONAL, silently
    expect((await t.db.monitoredService.findUniqueOrThrow({ where: { id: svc.id } })).state).toBe(
      'OPERATIONAL',
    );
    expect(t.alertsIn()).toHaveLength(0);

    t.results.set(svc.id, FAIL);
    await t.step(2);
    expect(t.alertsIn()).toHaveLength(0); // below threshold
    await t.step();
    expect((await t.db.monitoredService.findUniqueOrThrow({ where: { id: svc.id } })).state).toBe('OUTAGE');

    const alerts = t.alertsIn();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body.content).toBe(`<@&${t.roleId}>`);
    expect(alerts[0]!.body.allowed_mentions).toEqual({ parse: [], roles: [t.roleId] });

    const incidents = await t.db.incident.findMany({
      where: { guildId: t.guildId },
      include: { services: true },
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      autoCreated: true,
      createdById: 'system',
      severity: 'MAJOR',
      status: 'INVESTIGATING',
      ref: 'INC-0001',
    });
    expect(incidents[0]!.description).toContain('Game Panel');
    expect(incidents[0]!.services.map((s) => s.id)).toEqual([svc.id]);
    expect(t.sentTo(t.incidentChannelId)).toHaveLength(1);
    expect(incidents[0]!.messageId).toBeTruthy();

    // Further failures: no duplicate alert, no duplicate incident.
    await t.step(4);
    expect(t.alertsIn()).toHaveLength(1);
    expect(await t.db.incident.count({ where: { guildId: t.guildId } })).toBe(1);

    // Recovery
    t.results.set(svc.id, OK);
    await t.step();
    expect(t.alertsIn()).toHaveLength(1);
    await t.step();
    const after = t.alertsIn();
    expect(after).toHaveLength(2);
    expect(after[1]!.body.content).toBeUndefined(); // recovery never pings
    expect(after[1]!.body.allowed_mentions).toBeUndefined();
    expect(JSON.stringify(after[1]!.body)).toContain('Recovered');

    const inc = await t.db.incident.findUniqueOrThrow({
      where: { id: incidents[0]!.id },
      include: { updates: true },
    });
    expect(inc.status).toBe('MONITORING'); // staff resolve manually
    expect(inc.updates).toHaveLength(2);
    expect(inc.updates.every((u) => u.notifiedAt)).toBe(true);
    // Same incident message edited, plus an update line referencing it.
    expect(t.deps.discord.edits.filter((e) => e.messageId === inc.messageId)).toHaveLength(1);
    const lines = t.sentTo(t.incidentChannelId);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.body.message_reference?.message_id).toBe(inc.messageId);

    // Sanitised history + public output never contains the target.
    const checks = await t.db.healthCheck.findMany({ where: { serviceId: svc.id } });
    expect(checks).toHaveLength(10);
    expect(checks.filter((c) => !c.ok).every((c) => c.errorClass === 'CONN_REFUSED')).toBe(true);
    const everything = JSON.stringify([
      t.deps.discord.sent,
      t.deps.discord.edits,
      await status.getPublicStatus(t.db, t.guildId, t.clock.now),
    ]);
    expect(everything).not.toContain('panel-internal');
    expect(everything).not.toContain('CONN_REFUSED');

    const uptime = await status.getUptime(t.db, t.guildId, { slug: 'panel', days: 1 }, t.clock.now);
    expect(uptime[0]).toMatchObject({ totalChecks: 10, okChecks: 3, label: '30.00%' });
  });

  it('one failing service never affects the others, and private services do not alert publicly', async () => {
    const ids: Record<string, string> = {};
    const t = await setup({
      adapter: {
        kind: 'HTTP',
        check: async (svc) => {
          if (svc.id === ids.a) throw new Error('boom 10.0.0.1'); // a buggy adapter must not break the run
          return svc.id === ids.hidden ? FAIL : OK;
        },
      },
    });
    const a = await status.createService(t.staff, {
      name: 'API',
      slug: 'api',
      target: 'https://api.example.com',
    });
    const b = await status.createService(t.staff, {
      name: 'Web',
      slug: 'web',
      target: 'https://web.example.com',
    });
    const hidden = await status.createService(t.staff, {
      name: 'Internal DB',
      slug: 'db',
      target: 'https://db.example.com',
      public: false,
      failureThreshold: 1,
    });
    ids.a = a.id;
    ids.hidden = hidden.id;
    await t.step();

    const rows = await t.db.monitoredService.findMany({ where: { guildId: t.guildId } });
    expect(rows.find((r) => r.id === b.id)!.state).toBe('OPERATIONAL');
    expect(rows.find((r) => r.id === hidden.id)!.state).toBe('OUTAGE');
    const aChecks = await t.db.healthCheck.findMany({ where: { serviceId: a.id } });
    expect(aChecks).toHaveLength(1);
    expect(aChecks[0]).toMatchObject({ ok: false, errorClass: 'INVALID_RESPONSE' });
    expect(t.alertsIn()).toHaveLength(0); // hidden service outage is not posted publicly
    expect(await t.db.incident.count({ where: { guildId: t.guildId } })).toBe(0); // and no public auto incident
  });

  it('DMs subscribers filtered by severity and service, in chunks, ignoring DM failures', async () => {
    const failing = new Set<string>();
    const dms: string[] = [];
    const t = await setup({
      dmChunkSize: 2,
      sendDm: async (userId) => {
        if (failing.has(userId)) throw new Error('Cannot send messages to this user');
        dms.push(userId);
        return { id: snowflake() };
      },
    });
    await status.createService(t.staff, {
      name: 'Panel',
      slug: 'panel',
      target: 'https://panel.example.com',
    });
    await status.createService(t.staff, { name: 'Web', slug: 'web', target: 'https://web.example.com' });

    const users = Array.from({ length: 6 }, () => snowflake()).sort();
    const [uAll, uPanelMajor, uWeb, uPanelCritical, uAllDup, uFail] = users as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const as = (userId: string) => ctxAs(t.guildId, [], { deps: t.deps, userId });
    await status.subscribe(as(uAll), { service: 'all' });
    await status.subscribe(as(uPanelMajor), { service: 'panel', minSeverity: 'MAJOR' });
    await status.subscribe(as(uWeb), { service: 'web' });
    await status.subscribe(as(uPanelCritical), { service: 'panel', minSeverity: 'CRITICAL' });
    await status.subscribe(as(uAllDup), { service: 'all' });
    await status.subscribe(as(uAllDup), { service: 'panel' }); // two matching subs → still one DM
    await status.subscribe(as(uFail), { service: 'all' });
    failing.add(uFail);

    const incident = await status.createIncident(t.staff, {
      title: 'Panel login errors',
      description: 'Some users cannot log in.',
      severity: 'MAJOR',
      serviceSlugs: ['panel'],
    });
    await t.drain();

    expect(dms.sort()).toEqual([uAll, uPanelMajor, uAllDup].sort());
    const chunks = await t.db.scheduledJob.findMany({
      where: {
        type: 'status.subscribers.notify',
        dedupeKey: { startsWith: 'status.subscribers.notify:incident:' },
        guildId: t.guildId,
      },
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2); // 4 recipients (incl. failing) / chunk of 2
    expect(chunks.every((j) => j.status === 'DONE')).toBe(true);

    // Re-running the notify job is a no-op (idempotent).
    const before = dms.length;
    await t.db.scheduledJob.updateMany({
      where: { dedupeKey: { startsWith: 'status.incident.notify:' }, guildId: t.guildId },
      data: { status: 'PENDING', runAt: t.clock.now },
    });
    await t.drain();
    expect(dms.length).toBe(before);
    expect(t.sentTo(t.incidentChannelId)).toHaveLength(1);

    // A MINOR incident on web reaches web + all subscribers, not the panel MAJOR subscriber.
    dms.length = 0;
    await status.createIncident(t.staff, {
      title: 'Website slow',
      description: 'Pages load slowly.',
      severity: 'MINOR',
      serviceSlugs: ['web'],
    });
    await t.drain();
    expect(dms.sort()).toEqual([uAll, uWeb, uAllDup].sort());

    // Resolve the first incident → message edited, update line, DMs again.
    dms.length = 0;
    await status.addIncidentUpdate(t.staff, incident.id, {
      status: 'RESOLVED',
      message: 'Fixed.',
      resolutionSummary: 'A bad deploy was rolled back.',
    });
    await t.drain();
    expect(t.deps.discord.edits).toHaveLength(1);
    expect(dms.sort()).toEqual([uAll, uPanelMajor, uAllDup].sort());
  });
});

describe('status worker: maintenance windows', () => {
  it('announce → start (MAINTENANCE, no alerts) → end (UNKNOWN → real state on next check)', async () => {
    const t = await setup();
    const svc = await status.createService(t.staff, {
      name: 'Panel',
      slug: 'panel',
      target: 'https://panel.example.com',
      failureThreshold: 1,
    });
    const subYes = snowflake();
    const subNo = snowflake();
    await status.subscribe(ctxAs(t.guildId, [], { deps: t.deps, userId: subYes }), {
      service: 'panel',
      maintenance: true,
    });
    await status.subscribe(ctxAs(t.guildId, [], { deps: t.deps, userId: subNo }), {
      service: 'panel',
      maintenance: false,
    });
    await t.step();

    const startsAt = new Date(t.clock.now.getTime() + 150_000);
    const endsAt = new Date(t.clock.now.getTime() + 330_000);
    const win = await status.createMaintenance(t.staff, {
      title: 'Node upgrade',
      description: 'Kernel updates.',
      startsAt,
      endsAt,
      serviceSlugs: ['panel'],
    });
    await t.drain();
    expect(
      t.sentTo(t.statusChannelId).filter((m) => JSON.stringify(m.body).includes('Scheduled maintenance')),
    ).toHaveLength(1);
    expect(
      (await t.db.maintenanceWindow.findUniqueOrThrow({ where: { id: win.id } })).announcedAt,
    ).toBeTruthy();
    expect(t.deps.discord.dms.map((d) => d.userId)).toEqual([subYes]);

    await t.step(3); // past startsAt
    let w = await t.db.maintenanceWindow.findUniqueOrThrow({ where: { id: win.id } });
    expect(w.status).toBe('IN_PROGRESS');
    expect(w.startNotifiedAt).toBeTruthy();
    expect((await t.db.monitoredService.findUniqueOrThrow({ where: { id: svc.id } })).state).toBe(
      'MAINTENANCE',
    );

    t.results.set(svc.id, FAIL);
    await t.step(2); // failures during maintenance: suppressed
    expect((await t.db.monitoredService.findUniqueOrThrow({ where: { id: svc.id } })).state).toBe(
      'MAINTENANCE',
    );
    expect(t.alertsIn()).toHaveLength(0);
    expect(await t.db.incident.count({ where: { guildId: t.guildId } })).toBe(0);

    t.results.set(svc.id, OK);
    await t.step(2); // past endsAt
    w = await t.db.maintenanceWindow.findUniqueOrThrow({ where: { id: win.id } });
    expect(w.status).toBe('COMPLETED');
    expect(
      t.sentTo(t.statusChannelId).filter((m) => JSON.stringify(m.body).includes('Maintenance completed')),
    ).toHaveLength(1);
    await t.step();
    expect((await t.db.monitoredService.findUniqueOrThrow({ where: { id: svc.id } })).state).toBe(
      'OPERATIONAL',
    );
    expect(t.alertsIn()).toHaveLength(0);
  });

  it('cancellation cancels pending jobs; rescheduling moves them', async () => {
    const t = await setup();
    const svc = await status.createService(t.staff, {
      name: 'Panel',
      slug: 'panel',
      target: 'https://panel.example.com',
    });
    const at = (ms: number) => new Date(t.clock.now.getTime() + ms);

    // Reschedule before it starts.
    const w1 = await status.createMaintenance(t.staff, {
      title: 'DB migration',
      description: 'Short downtime.',
      startsAt: at(600_000),
      endsAt: at(1_200_000),
      serviceSlugs: ['panel'],
    });
    await t.drain(); // announce
    await status.updateMaintenance(t.staff, w1.id, { startsAt: at(1_800_000), endsAt: at(2_400_000) });
    const startJob = await t.db.scheduledJob.findUniqueOrThrow({
      where: { dedupeKey: `status.maintenance.start:${w1.id}` },
    });
    expect(startJob.runAt.getTime()).toBe(at(1_800_000).getTime());
    await t.drain();
    expect(
      t.sentTo(t.statusChannelId).filter((m) => JSON.stringify(m.body).includes('rescheduled')),
    ).toHaveLength(1);

    // Cancel: all pending jobs cancelled, a cancellation notice is posted (it was announced).
    await status.cancelMaintenance(t.staff, w1.id);
    const jobs = await t.db.scheduledJob.findMany({
      where: { dedupeKey: { in: [`status.maintenance.start:${w1.id}`, `status.maintenance.end:${w1.id}`] } },
    });
    expect(jobs.map((j) => j.status)).toEqual(['CANCELLED', 'CANCELLED']);
    await t.drain();
    expect(
      t.sentTo(t.statusChannelId).filter((m) => JSON.stringify(m.body).includes('Maintenance cancelled')),
    ).toHaveLength(1);

    // Time passes beyond the original window: nothing starts.
    t.clock.now = at(3_000_000);
    await t.drain();
    expect((await t.db.monitoredService.findUniqueOrThrow({ where: { id: svc.id } })).state).not.toBe(
      'MAINTENANCE',
    );
    expect(
      t.sentTo(t.statusChannelId).filter((m) => JSON.stringify(m.body).includes('Maintenance started')),
    ).toHaveLength(0);
    await expect(status.cancelMaintenance(t.staff, w1.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('status worker: registration', () => {
  it('registers every status job type and periodic task with the runner', async () => {
    const t = await setup();
    const runner = new JobRunner(t.w, [statusJobs]);
    expect(runner.jobTypes.sort()).toEqual(
      [
        'status.alert',
        'status.incident.notify',
        'status.maintenance.announce',
        'status.maintenance.cancelled',
        'status.maintenance.end',
        'status.maintenance.start',
        'status.subscribers.notify',
      ].sort(),
    );
    expect(runner.periodicNames).toEqual(['status.checks', 'status.retention']);
    const interval = statusJobs.periodic![0]!.intervalMs;
    expect(typeof interval === 'function' ? interval(t.w) : interval).toBe(60_000);
  });

  it('retention deletes health checks older than healthCheckRetentionDays', async () => {
    const t = await setup();
    const svc = await status.createService(t.staff, {
      name: 'Panel',
      slug: 'panel',
      target: 'https://panel.example.com',
    });
    await t.db.guildConfig.update({ where: { guildId: t.guildId }, data: { healthCheckRetentionDays: 7 } });
    const now = t.clock.now.getTime();
    await t.db.healthCheck.createMany({
      data: [
        { serviceId: svc.id, ok: true, checkedAt: new Date(now - 8 * 86_400_000) },
        { serviceId: svc.id, ok: true, checkedAt: new Date(now - 6 * 86_400_000) },
      ],
    });
    await t.mod.periodic!.find((p) => p.name === 'status.retention')!.run(t.w, t.clock.now);
    expect(await t.db.healthCheck.count({ where: { serviceId: svc.id } })).toBe(1);
  });
});
