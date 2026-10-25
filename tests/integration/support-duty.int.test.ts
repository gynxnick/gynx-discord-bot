import { afterAll, describe, expect, it } from 'vitest';
import type { WorkerEnv } from '@gynx/config';
import { support } from '@gynx/services';
import { JobRunner } from '../../apps/worker/src/framework/runner';
import { supportJobs } from '../../apps/worker/src/jobs/support';
import { ctxAs, drainJobs, freshGuild, silentLog, snowflake, testDb, testDeps } from './helpers';

async function setup() {
  const guildId = await freshGuild();
  const panelChannel = snowflake();
  await testDb().guildConfig.update({ where: { guildId }, data: { supportStatusChannelId: panelChannel } });
  const deps = testDeps();
  const lead = ctxAs(guildId, ['support.duty', 'support.duty.manage'], { deps });
  const staffId = snowflake();
  const staff = ctxAs(guildId, ['support.duty'], { deps, userId: staffId });
  const runner = new JobRunner(
    {
      deps,
      env: { DISCORD_GUILD_ID: guildId, DASHBOARD_URL: 'https://dash.test' } as WorkerEnv,
      log: silentLog,
      workerId: 't',
    },
    [supportJobs],
  );
  const panelPosts = () => deps.discord.sent.filter((m) => m.channelId === panelChannel);
  return { guildId, panelChannel, deps, lead, staff, staffId, runner, panelPosts };
}

const text = (body: unknown) => JSON.stringify(body);

describe('support duty and status panel', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('staff need an approved public name before going on duty', async () => {
    const { staff } = await setup();
    await expect(support.startDuty(staff)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('only support leads approve names; members cannot go on duty at all', async () => {
    const { guildId, staff, staffId } = await setup();
    await expect(support.setDutyProfile(staff, { userId: staffId, publicName: 'Me' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(support.startDuty(ctxAs(guildId))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('on duty → panel shows the approved name only; off duty → panel goes offline, same message edited', async () => {
    const { lead, staff, staffId, runner, panelPosts, deps, panelChannel } = await setup();
    await support.setDutyProfile(lead, { userId: staffId, publicName: 'Alex' });
    await drainJobs(runner);
    expect(panelPosts()).toHaveLength(1);
    expect(text(panelPosts()[0]!.body)).toContain('Support is currently offline');

    const r = await support.startDuty(staff);
    expect(r.publicName).toBe('Alex');
    await drainJobs(runner);
    expect(panelPosts()).toHaveLength(1); // never a new message per update
    const online = deps.discord.edits.filter((e) => e.channelId === panelChannel).at(-1)!;
    expect(text(online.body)).toContain('🟢 Alex');
    expect(text(online.body)).not.toContain(staffId); // never the Discord ID

    await support.endDuty(staff);
    await drainJobs(runner);
    const offline = deps.discord.edits.filter((e) => e.channelId === panelChannel).at(-1)!;
    expect(text(offline.body)).toContain('Support is currently offline');
    expect(panelPosts()).toHaveLength(1);
  });

  it('a double click cannot open two sessions', async () => {
    const { guildId, lead, staff, staffId } = await setup();
    await support.setDutyProfile(lead, { userId: staffId, publicName: 'Sam' });
    const results = await Promise.allSettled([support.startDuty(staff), support.startDuty(staff)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await testDb().dutySession.count({ where: { guildId, userId: staffId, endedAt: null } })).toBe(1);
  });

  it('sessions expire automatically after the maximum duty length', async () => {
    const { guildId, lead, staff, staffId, runner, deps, panelChannel } = await setup();
    await testDb().guildConfig.update({ where: { guildId }, data: { dutyMaxHours: 2 } });
    await support.setDutyProfile(lead, { userId: staffId, publicName: 'Robin' });
    await support.startDuty(staff);
    await drainJobs(runner);

    const later = new Date(Date.now() + 2 * 3_600_000 + 60_000);
    await drainJobs(runner, later);
    const s = await testDb().dutySession.findFirstOrThrow({ where: { guildId, userId: staffId } });
    expect(s.endReason).toBe('EXPIRED');
    const last = deps.discord.edits.filter((e) => e.channelId === panelChannel).at(-1)!;
    expect(text(last.body)).toContain('Support is currently offline');
  });

  it('leaving the server or losing the approved name ends the session', async () => {
    const { guildId, lead, staff, staffId } = await setup();
    await support.setDutyProfile(lead, { userId: staffId, publicName: 'Kai' });
    await support.startDuty(staff);
    expect(await support.endDutyOnLeave(testDb(), guildId, staffId, new Date())).toBe(true);
    expect(
      (await testDb().dutySession.findFirstOrThrow({ where: { guildId, userId: staffId } })).endReason,
    ).toBe('LEFT_SERVER');

    await support.startDuty(staff);
    await support.removeDutyProfile(lead, staffId);
    const open = await support.listOnDuty(testDb(), guildId, new Date());
    expect(open).toHaveLength(0);
  });

  it('support leads can end someone else’s session; it is audited', async () => {
    const { guildId, lead, staff, staffId } = await setup();
    await support.setDutyProfile(lead, { userId: staffId, publicName: 'Jo' });
    await support.startDuty(staff);
    expect(await support.endDutyFor(lead, staffId)).toBe('Jo');
    const audit = await testDb().securityAuditEvent.findFirst({
      where: { guildId, action: 'support.duty.end_other' },
    });
    expect(audit?.targetId).toBe(staffId);
    await expect(support.endDutyFor(staff, staffId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('re-posts the panel if someone deleted it, and does nothing when no channel is set', async () => {
    const { guildId, runner, panelPosts, deps } = await setup();
    // Periodic runs are once per window across all workers, so trigger syncs explicitly here.
    await support.requestPanelSync(testDb(), guildId, new Date());
    await drainJobs(runner);
    expect(panelPosts()).toHaveLength(1);
    const { DiscordAPIError } = await import('@discordjs/rest');
    deps.discord.editMessage = async () =>
      Promise.reject(
        new DiscordAPIError({ message: 'Unknown Message', code: 10008 }, 10008, 404, 'PATCH', '', {}),
      );
    await testDb().guildConfig.update({ where: { guildId }, data: { supportStatusHash: null } });
    await support.requestPanelSync(testDb(), guildId, new Date(Date.now() + 1));
    await drainJobs(runner, new Date(Date.now() + 1000));
    expect(panelPosts()).toHaveLength(2);

    const other = await freshGuild();
    expect(await support.syncSupportPanel(deps, other, new Date())).toBe('disabled');
  });
});
