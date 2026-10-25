import { afterAll, describe, expect, it } from 'vitest';
import { PermissionFlagsBits as P } from 'discord-api-types/v10';
import type { WorkerEnv } from '@gynx/config';
import { setup } from '@gynx/services';
import { JobRunner } from '../../apps/worker/src/framework/runner';
import { setupJobs } from '../../apps/worker/src/jobs/setup';
import {
  ALL_CHANNELS,
  VIEW,
  apiError,
  apply,
  harness,
  manifest,
  noSleep,
  resourceId,
} from './fake-admin-port';
import { ctxAs, drainJobs, silentLog, testDb } from './helpers';

const createsIn = (p: setup.OperationPreview) =>
  p.plan.changes.filter((c) => c.kind === 'role.create' || c.kind === 'channel.create');

describe('server setup engine', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('provisions an empty server completely (through the worker job)', async () => {
    const h = await harness();
    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    expect(preview.plan.blocked).toBe(false);
    expect(preview.summary.create).toBe(11 + 9 + ALL_CHANNELS.length + 1);
    // Turning on verification gates the community: disruptive, needs consent.
    expect(preview.requiresDisruptiveConsent).toBe(true);
    await expect(
      setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: false }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true })).toEqual({
      status: 'QUEUED',
      operationId: preview.operationId,
    });

    const runner = new JobRunner(
      { deps: h.deps, env: { DISCORD_GUILD_ID: h.guildId } as WorkerEnv, log: silentLog, workerId: 'setup' },
      [setupJobs],
    );
    await drainJobs(runner);
    const op = await h.db.setupOperation.findUniqueOrThrow({ where: { id: preview.operationId } });
    expect(op.status).toBe('SUCCEEDED');
    const result = op.result as unknown as setup.ExecutionSummary;
    expect(result.verified).toBe(true);
    expect(result.failed).toBe(0);

    // Roles: all present, in blueprint order, directly below the bot.
    const bot = h.guild.botRole.position;
    const ordered = setup.BLUEPRINT_ROLES.map((r) => h.guild.roleByName(r.name)!);
    ordered.forEach((r, i) => expect(r.position).toBe(bot - 1 - i));
    expect(h.guild.roleByName('Founder')!.permissions & P.Administrator).toBe(0n);

    // Channels with exact (emoji) names, in their categories.
    for (const ch of ALL_CHANNELS) {
      const live = h.guild.channelByName(ch.name);
      expect(live, ch.name).toBeDefined();
      expect(live!.parentId).toBe(h.guild.channelByName(ch.category.name)!.id);
      expect(live!.type).toBe(ch.type === 'voice' ? 2 : 0);
    }
    expect(h.guild.channelByName('🔧・troubleshooting')!.rateLimitPerUser).toBe(10);

    // Private areas: @everyone denied, restricted channels deny non-designated staff.
    for (const cat of setup.BLUEPRINT_CATEGORIES.filter((c) => c.private)) {
      const live = h.guild.channelByName(cat.name)!;
      const everyone = live.overwrites.find((o) => o.id === h.guildId)!;
      expect(everyone.deny & VIEW).toBe(VIEW);
      expect(everyone.allow & VIEW).toBe(0n);
    }
    const reports = h.guild.channelByName('📋・staff-reports')!;
    for (const name of ['Senior Support', 'Support', 'Moderator']) {
      const o = reports.overwrites.find((x) => x.id === h.guild.roleByName(name)!.id)!;
      expect(o.deny & VIEW, name).toBe(VIEW);
    }
    const mgmt = reports.overwrites.find((x) => x.id === h.guild.roleByName('Management')!.id)!;
    expect(mgmt.allow & VIEW).toBe(VIEW);

    // Panels deployed once each; manifest complete.
    const panelChannels = ['👋・welcome', '📜・rules', '🔐・verify', '🟢・support-status', '⏱️・staff-duty'];
    for (const n of panelChannels)
      expect(h.guild.messages.get(h.guild.channelByName(n)!.id)?.length, n).toBe(1);
    const rows = await manifest(h);
    expect(rows.filter((r) => r.resourceType === 'ROLE')).toHaveLength(11);
    expect(rows.filter((r) => r.resourceType === 'CATEGORY')).toHaveLength(9);
    expect(rows.filter((r) => r.resourceType === 'MESSAGE')).toHaveLength(5);
    expect(rows.filter((r) => r.ownership === 'CREATED')).toHaveLength(rows.length);

    // Bindings, grants, template.
    const cfg = await h.db.guildConfig.findUniqueOrThrow({ where: { guildId: h.guildId } });
    expect(cfg.modLogChannelId).toBe(h.guild.channelByName('🛡️・mod-logs')!.id);
    expect(cfg.setupLogChannelId).toBe(h.guild.channelByName('🧾・audit-logs')!.id);
    expect(cfg.staffPingRoleId).toBe(h.guild.roleByName('Support')!.id);
    const welcome = await h.db.welcomeConfig.findUniqueOrThrow({ where: { guildId: h.guildId } });
    expect(welcome.verificationEnabled).toBe(true);
    expect(welcome.verifiedRoleId).toBe(h.guild.roleByName('Verified')!.id);
    expect(await h.db.staffPermission.count({ where: { guildId: h.guildId } })).toBe(6);
    expect(
      await h.db.announcementTemplate.count({ where: { guildId: h.guildId, name: 'Official announcement' } }),
    ).toBe(1);

    const gs = await h.db.guildSetup.findUniqueOrThrow({ where: { guildId: h.guildId } });
    expect(gs.status).toBe('COMPLETE');
    expect(gs.lastVerifiedAt).not.toBeNull();

    // A private summary (counts only) was posted to the audit-log channel.
    const summary = h.guild.discord.sent.filter((m) => m.channelId === cfg.setupLogChannelId);
    expect(summary).toHaveLength(1);
    expect(
      await h.db.securityAuditEvent.count({ where: { guildId: h.guildId, action: 'setup.apply' } }),
    ).toBe(1);

    const overview = await setup.getSetupOverview(h.admin);
    expect(overview.completionPercent).toBe(100);
    expect(overview.status).toBe('COMPLETE');
    expect(overview.permissionFindings.filter((f) => f.level !== 'info')).toEqual([]);
    expect(overview.panels.every((p) => p.state === 'deployed')).toBe(true);
  });

  it('never touches unrelated roles, channels or overwrites', async () => {
    const h = await harness();
    const gamers = h.guild.addRole('Gamers', { permissions: P.SendMessages });
    const oldCat = h.guild.addChannel('OLD STUFF', 4);
    const random = h.guild.addChannel('random', 0, {
      parentId: oldCat.id,
      overwrites: [{ id: gamers.id, type: 0, allow: VIEW, deny: 0n }],
    });
    const before = structuredClone({ gamers, random, oldCat });
    const { summary } = await apply(h);
    expect(summary.status).toBe('SUCCEEDED');
    expect(h.guild.roleByName('Gamers')!.permissions).toBe(before.gamers.permissions);
    expect(h.guild.channelByName('random')).toMatchObject({
      name: 'random',
      parentId: oldCat.id,
      overwrites: before.random.overwrites,
    });
    const touched = h.guild.calls.filter((c) =>
      ['editRole', 'editChannel', 'setOverwrite', 'deleteOverwrite', 'deleteChannel', 'deleteRole'].includes(
        c.method,
      ),
    );
    for (const c of touched) {
      const ids = JSON.stringify(c.args, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v));
      expect(ids).not.toContain(gamers.id);
      expect(ids).not.toContain(random.id);
      expect(ids).not.toContain(oldCat.id);
    }
  });

  it('is idempotent: a second START creates nothing', async () => {
    const h = await harness();
    await apply(h);
    const roles = h.guild.roles.length;
    const channels = h.guild.channels.length;
    const again = await setup.previewOperation(h.admin, { type: 'START' });
    expect(createsIn(again)).toEqual([]);
    expect(again.plan.changes).toEqual([]);
    await setup.confirmOperation(h.admin, again.operationId, { acceptDisruptive: false });
    const s = await setup.executeSetupOperation(h.deps, again.operationId, noSleep);
    expect(s.status).toBe('SUCCEEDED');
    expect(h.guild.roles.length).toBe(roles);
    expect(h.guild.channels.length).toBe(channels);
    for (const n of ['🟢・support-status', '⏱️・staff-duty', '👋・welcome'])
      expect(h.guild.messages.get(h.guild.channelByName(n)!.id)).toHaveLength(1);
  });

  it('adopts unambiguous matches and skips ambiguous ones with a finding', async () => {
    const h = await harness();
    const support = h.guild.addRole('Support');
    h.guild.addRole('Moderator');
    h.guild.addRole('Moderator');
    const cat = h.guild.addChannel('SUPPORT CENTER', 4);
    const kb = h.guild.addChannel('📚・knowledge-base', 0, { parentId: cat.id });
    h.guild.postMemberMessage(kb.id);

    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    const kinds = (key: string) => preview.plan.changes.filter((c) => c.key === key).map((c) => c.kind);
    expect(kinds('role:support')).toContain('role.adopt');
    expect(kinds('role:moderator')).toEqual([]);
    expect(preview.plan.findings).toContainEqual(
      expect.objectContaining({ code: 'ambiguous-match', key: 'role:moderator' }),
    );
    expect(kinds('category:support-center')).toContain('channel.adopt');
    expect(kinds('channel:knowledge-base')).toContain('channel.adopt');

    await setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true });
    const s = await setup.executeSetupOperation(h.deps, preview.operationId, noSleep);
    expect(s.adopted).toBe(3);
    expect(await resourceId(h, 'role:support')).toBe(support.id);
    expect(await resourceId(h, 'channel:knowledge-base')).toBe(kb.id);
    expect(await resourceId(h, 'role:moderator')).toBeUndefined();
    expect(h.guild.roles.filter((r) => r.name === 'Moderator')).toHaveLength(2);
    expect(h.guild.channels.filter((c) => c.name === '📚・knowledge-base')).toHaveLength(1);
    // Adopted role permissions are never changed on START.
    expect(h.guild.calls.some((c) => c.method === 'editRole' && c.args[0] === support.id)).toBe(false);
    const rows = await manifest(h);
    expect(rows.find((r) => r.blueprintKey === 'channel:knowledge-base')!.ownership).toBe('ADOPTED');
  });

  it('reports a renamed channel on START and restores the name on REPAIR (same channel)', async () => {
    const h = await harness();
    await apply(h);
    const ch = h.guild.channelByName('🔧・troubleshooting')!;
    ch.name = 'tshoot';
    const start = await setup.previewOperation(h.admin, { type: 'START' });
    expect(start.plan.findings).toContainEqual(
      expect.objectContaining({ code: 'renamed', key: 'channel:troubleshooting' }),
    );
    expect(start.plan.changes).toEqual([]);

    const creates = h.guild.count('createChannel');
    const { preview, summary } = await apply(h, 'REPAIR');
    expect(preview.plan.changes.map((c) => c.kind)).toEqual(['channel.update']);
    expect(summary.status).toBe('SUCCEEDED');
    expect(h.guild.channels.find((c) => c.id === ch.id)!.name).toBe('🔧・troubleshooting');
    expect(h.guild.count('createChannel')).toBe(creates);
  });

  it('recreates a deleted category/channel only on REPAIR and moves orphans back', async () => {
    const h = await harness();
    await apply(h);
    const cat = h.guild.channelByName('STAFF VOICE — PRIVATE')!;
    const general = h.guild.channelByName('💬・general')!;
    await h.guild.deleteChannel(cat.id);
    await h.guild.deleteChannel(general.id);

    const start = await setup.previewOperation(h.admin, { type: 'START' });
    expect(createsIn(start)).toEqual([]);
    expect(start.plan.findings.filter((f) => f.code === 'deleted').map((f) => f.key)).toEqual(
      expect.arrayContaining(['category:staff-voice', 'channel:general']),
    );

    const { summary } = await apply(h, 'REPAIR');
    expect(summary.status).toBe('SUCCEEDED');
    const newCat = h.guild.channelByName('STAFF VOICE — PRIVATE')!;
    expect(newCat.id).not.toBe(cat.id);
    expect(newCat.overwrites.find((o) => o.id === h.guildId)!.deny & VIEW).toBe(VIEW);
    expect(h.guild.channelByName('🎙️・staff-voice')!.parentId).toBe(newCat.id);
    expect(h.guild.channelByName('💬・general')!.parentId).toBe(h.guild.channelByName('COMMUNITY')!.id);
    expect(h.guild.channels.filter((c) => c.name === '💬・general')).toHaveLength(1);
  });

  it('recreates a deleted panel without duplicating the other panel', async () => {
    const h = await harness();
    await apply(h);
    const statusCh = h.guild.channelByName('🟢・support-status')!;
    const dutyCh = h.guild.channelByName('⏱️・staff-duty')!;
    const old = h.guild.messages.get(statusCh.id)![0]!;
    await h.guild.discord.deleteMessage(statusCh.id, old.id);

    const overview = await setup.getSetupOverview(h.admin);
    expect(overview.panels.find((p) => p.key === 'support-status')!.state).toBe('missing');

    const { preview, summary } = await apply(h, 'REPAIR');
    expect(preview.plan.changes.map((c) => c.key)).toEqual(['message:support-status']);
    expect(summary.status).toBe('SUCCEEDED');
    expect(h.guild.messages.get(statusCh.id)).toHaveLength(1);
    expect(h.guild.messages.get(statusCh.id)![0]!.id).not.toBe(old.id);
    expect(h.guild.messages.get(dutyCh.id)).toHaveLength(1);
    expect(await resourceId(h, 'message:support-status')).toBe(h.guild.messages.get(statusCh.id)![0]!.id);
  });

  it('blocks the preview when the bot lacks Manage Channels', async () => {
    const h = await harness({ botPermissions: P.ManageRoles | P.ViewChannel | P.SendMessages });
    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    expect(preview.plan.blocked).toBe(true);
    expect(preview.plan.missingBotPermissions).toContain('ManageChannels');
    await expect(
      setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('reports a role hierarchy conflict and never touches that role', async () => {
    const h = await harness();
    const founder = h.guild.addRole('Founder', { position: h.guild.botRole.position + 1 });
    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    expect(preview.plan.findings).toContainEqual(
      expect.objectContaining({ code: 'hierarchy', key: 'role:founder', level: 'blocking' }),
    );
    expect(preview.plan.blocked).toBe(false);
    await setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true });
    const s = await setup.executeSetupOperation(h.deps, preview.operationId, noSleep);
    expect(s.failed).toBe(0);
    const roleCalls = h.guild.calls.filter((c) =>
      ['editRole', 'setRolePositions', 'deleteRole'].includes(c.method),
    );
    expect(
      JSON.stringify(roleCalls, (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toContain(founder.id);
    expect(h.guild.roles.filter((r) => r.name === 'Founder')).toHaveLength(1);
  });

  it('retries rate-limited calls and succeeds', async () => {
    const h = await harness();
    h.guild.failOn('createRole', () => apiError(429, 0, 'You are being rate limited.', 0.001), {
      skip: 2,
      times: 2,
    });
    h.guild.failOn('createChannel', () => apiError(502, 0, 'Bad Gateway'), { skip: 5, times: 1 });
    const { summary } = await apply(h);
    expect(summary.status).toBe('SUCCEEDED');
    expect(h.guild.count('createRole')).toBe(13);
    expect(h.guild.roles.filter((r) => !r.managed && r.id !== h.guildId)).toHaveLength(11);
  });

  it('fails midway → PARTIAL with checkpoints; a new START resumes without duplicates', async () => {
    const h = await harness();
    // The 4th category (COMMUNITY) fails permanently.
    h.guild.failOn('createChannel', () => apiError(403, 50013, 'Missing Permissions'), { skip: 3, times: 1 });
    const first = await apply(h);
    expect(first.summary.status).toBe('PARTIAL');
    expect(first.summary.failures.map((f) => f.key)).toEqual(['category:community']);
    const changes = await h.db.setupChange.findMany({ where: { operationId: first.preview.operationId } });
    expect(changes.find((c) => c.blueprintKey === 'channel:general')!.status).toBe('SKIPPED');
    expect(changes.find((c) => c.blueprintKey === 'channel:general')!.error).toMatch(/category:community/);
    expect(changes.filter((c) => c.status === 'APPLIED').length).toBeGreaterThan(30);
    const gs = await h.db.guildSetup.findUniqueOrThrow({ where: { guildId: h.guildId } });
    expect(gs.status).toBe('PARTIAL');

    const second = await apply(h);
    expect(
      createsIn(second.preview)
        .map((c) => c.key)
        .sort(),
    ).toEqual(
      [
        'category:community',
        ...setup.BLUEPRINT_CATEGORIES.find((c) => c.key === 'community')!.channels.map(
          (c) => `channel:${c.key}`,
        ),
      ].sort(),
    );
    expect(second.summary.status).toBe('SUCCEEDED');
    for (const ch of ALL_CHANNELS)
      expect(
        h.guild.channels.filter((c) => c.name === ch.name),
        ch.name,
      ).toHaveLength(1);
    for (const r of setup.BLUEPRINT_ROLES)
      expect(h.guild.roles.filter((x) => x.name === r.name)).toHaveLength(1);
    expect((await h.db.guildSetup.findUniqueOrThrow({ where: { guildId: h.guildId } })).status).toBe(
      'COMPLETE',
    );
  });

  it('re-running the same operation after a crash skips applied changes', async () => {
    const h = await harness();
    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    await setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true });
    // run snapshots: start, after roles, positions ← crash here
    h.guild.failOn('snapshot', () => new Error('worker crashed'), { skip: 2, times: 1 });
    await expect(setup.executeSetupOperation(h.deps, preview.operationId, noSleep)).rejects.toThrow(
      'worker crashed',
    );
    const roles = h.guild.count('createRole');
    expect(roles).toBe(11);
    const s = await setup.executeSetupOperation(h.deps, preview.operationId, noSleep);
    expect(s.status).toBe('SUCCEEDED');
    expect(h.guild.count('createRole')).toBe(roles);
  });

  it('verification flags private exposure introduced later', async () => {
    const h = await harness();
    await apply(h);
    const intruder = h.guild.addRole('Intruder');
    const staffChat = h.guild.channelByName('💬・staff-chat')!;
    staffChat.overwrites.push({ id: intruder.id, type: 0, allow: VIEW, deny: 0n });
    const reports = h.guild.channelByName('📋・staff-reports')!;
    const supportId = h.guild.roleByName('Support')!.id;
    reports.overwrites = reports.overwrites.filter((o) => o.id !== supportId);
    const overview = await setup.getSetupOverview(h.admin);
    expect(overview.permissionFindings).toContainEqual(
      expect.objectContaining({ code: 'private-exposure', key: 'channel:staff-chat' }),
    );
    expect(overview.permissionFindings).toContainEqual(
      expect.objectContaining({ code: 'restricted-access', key: 'channel:staff-reports' }),
    );
  });

  it('requires a fresh preview when the server changed (STALE)', async () => {
    const h = await harness();
    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    h.guild.addRole('Partner'); // now adoptable instead of created
    const r = await setup.confirmOperation(h.admin, preview.operationId, { acceptDisruptive: true });
    expect(r.status).toBe('STALE');
    if (r.status !== 'STALE') return;
    expect(r.preview.operationId).not.toBe(preview.operationId);
    expect(r.preview.plan.changes).toContainEqual(
      expect.objectContaining({ kind: 'role.adopt', key: 'role:partner' }),
    );
    const old = await h.db.setupOperation.findUniqueOrThrow({ where: { id: preview.operationId } });
    expect(old.status).toBe('CANCELLED');
  });

  it('only one queued/running operation per guild; cancel works for queued ones', async () => {
    const h = await harness();
    const a = await setup.previewOperation(h.admin, { type: 'START' });
    const b = await setup.previewOperation(h.admin, { type: 'START' });
    await setup.confirmOperation(h.admin, a.operationId, { acceptDisruptive: true });
    await expect(
      setup.confirmOperation(h.admin, b.operationId, { acceptDisruptive: true }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await setup.cancelOperation(h.admin, a.operationId);
    const detail = await setup.getOperation(h.admin, a.operationId);
    expect(detail.status).toBe('CANCELLED');
    await expect(setup.cancelOperation(h.admin, a.operationId)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(detail.preview.plan.blocked).toBe(false);
    expect(detail.preview.requiresDisruptiveConsent).toBe(true);
    const list = await setup.listOperations(h.admin, { limit: 1 });
    expect(list.items).toHaveLength(1);
    expect(list.nextCursor).not.toBeNull();
  });

  it('staff grants the operator cannot give become manual steps', async () => {
    const h = await harness({ perms: ['setup.manage'] });
    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    expect(preview.plan.changes.some((c) => c.kind === 'grant.set')).toBe(false);
    expect(
      preview.plan.findings.filter((f) => f.code === 'manual-step' && f.key?.startsWith('grant:')),
    ).toHaveLength(6);
  });

  it('config updates merge top-level keys and are validated', async () => {
    const h = await harness();
    await setup.updateSetupConfig(h.admin, { roles: { support: { name: 'Helpers' } } });
    const cfg = await setup.updateSetupConfig(h.admin, { showStaffNames: false });
    expect(cfg.roles.support?.name).toBe('Helpers');
    expect(cfg.showStaffNames).toBe(false);
    await expect(
      setup.updateSetupConfig(h.admin, { roles: { support: { color: 'red' } } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const preview = await setup.previewOperation(h.admin, { type: 'START' });
    expect(preview.plan.changes).toContainEqual(
      expect.objectContaining({ kind: 'role.create', name: 'Helpers' }),
    );
  });

  it('denies every API function without setup.manage (FORBIDDEN + audited)', async () => {
    const h = await harness();
    const anon = ctxAs(h.guildId, ['dashboard.access'], { deps: h.deps });
    const calls: Array<() => Promise<unknown>> = [
      () => setup.getSetupOverview(anon),
      () => setup.getSetupConfig(anon),
      () => setup.updateSetupConfig(anon, { showStaffNames: false }),
      () => setup.previewOperation(anon, { type: 'START' }),
      () => setup.previewRollback(anon),
      () => setup.confirmOperation(anon, 'x', { acceptDisruptive: true }),
      () => setup.cancelOperation(anon, 'x'),
      () => setup.listOperations(anon, {}),
      () => setup.getOperation(anon, 'x'),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await h.db.securityAuditEvent.count({
        where: { guildId: h.guildId, result: 'DENIED', actorId: anon.actor.userId },
      }),
    ).toBe(calls.length);
    expect(h.guild.calls).toEqual([]);
  });

  it('unknown or foreign operation ids are NOT_FOUND', async () => {
    const h = await harness();
    const other = await harness();
    const p = await setup.previewOperation(other.admin, { type: 'START' });
    await expect(setup.getOperation(h.admin, p.operationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(setup.cancelOperation(h.admin, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      setup.confirmOperation(h.admin, p.operationId, { acceptDisruptive: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
