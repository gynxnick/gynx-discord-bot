import { afterAll, describe, expect, it } from 'vitest';
import { DiscordAPIError } from '@discordjs/rest';
import type { WorkerEnv } from '@gynx/config';
import { community } from '@gynx/services';
import { JobRunner } from '../../apps/worker/src/framework/runner';
import { communityJobs } from '../../apps/worker/src/jobs/community';
import { ctxAs, drainJobs, fakeDiscord, freshGuild, silentLog, snowflake, testDb, testDeps } from './helpers';

const discordError = (status: number) =>
  new DiscordAPIError({ message: 'test', code: 0 }, 0, status, 'PATCH', 'https://discord.test', {});

async function setup() {
  const guildId = await freshGuild();
  const deps = testDeps();
  const staff = ctxAs(guildId, ['community.manage'], { deps });
  const runner = new JobRunner(
    {
      deps,
      env: { DISCORD_GUILD_ID: guildId, DASHBOARD_URL: 'https://dash.test' } as WorkerEnv,
      log: silentLog,
      workerId: 't',
    },
    [communityJobs],
  );
  await testDb().selfAssignableRole.createMany({
    data: [
      { guildId, roleId: snowflake(), label: 'Minecraft', group: 'games', emoji: '⛏️' },
      { guildId, roleId: snowflake(), label: 'Events ping', group: 'notifications' },
    ],
  });
  return { guildId, deps, staff, runner };
}

describe('role panels', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('only staff with community.manage can create panels', async () => {
    const guildId = await freshGuild();
    await expect(community.createRolePanel(ctxAs(guildId), { channelId: snowflake() })).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
  });

  it('creating a panel posts it once through the worker, then stays quiet while nothing changes', async () => {
    const { guildId, deps, staff, runner } = await setup();
    const channelId = snowflake();
    const panel = await community.createRolePanel(staff, {
      channelId,
      title: 'Game roles',
      groups: ['games'],
    });
    await drainJobs(runner);

    const posted = deps.discord.sent.filter((m) => m.channelId === channelId);
    expect(posted).toHaveLength(1);
    const json = JSON.stringify(posted[0]!.body);
    expect(json).toContain('Minecraft');
    expect(json).not.toContain('Events ping'); // other group
    const saved = await testDb().rolePanel.findUniqueOrThrow({ where: { id: panel.id } });
    expect(saved.messageId).toBeTruthy();

    expect(await community.syncRolePanel(deps, panel.id, new Date())).toBe('unchanged');
    expect(deps.discord.edits).toHaveLength(0);
    void guildId;
  });

  it('updates the same message when the allowlist changes', async () => {
    const { guildId, deps, staff, runner } = await setup();
    const panel = await community.createRolePanel(staff, { channelId: snowflake() });
    await drainJobs(runner);

    const role = await testDb().selfAssignableRole.findFirstOrThrow({
      where: { guildId, label: 'Minecraft' },
    });
    await community.updateSelfRole(staff, role.id, { label: 'Minecraft Java' });
    await drainJobs(runner);

    expect(deps.discord.sent).toHaveLength(1);
    expect(deps.discord.edits).toHaveLength(1);
    expect(JSON.stringify(deps.discord.edits[0]!.body)).toContain('Minecraft Java');
    expect((await testDb().rolePanel.findUniqueOrThrow({ where: { id: panel.id } })).messageId).toBeTruthy();
  });

  it('re-posts a panel whose message was deleted', async () => {
    const { deps, staff, runner } = await setup();
    const panel = await community.createRolePanel(staff, { channelId: snowflake() });
    await drainJobs(runner);
    deps.discord.editMessage = async () => Promise.reject(discordError(404));
    await community.refreshRolePanels(staff, panel.id);
    await drainJobs(runner);
    expect(deps.discord.sent).toHaveLength(2);
  });

  it('deleting a panel removes its Discord message', async () => {
    const { deps, staff, runner } = await setup();
    const channelId = snowflake();
    const panel = await community.createRolePanel(staff, { channelId });
    await drainJobs(runner);
    const { messageId } = await testDb().rolePanel.findUniqueOrThrow({ where: { id: panel.id } });

    await community.deleteRolePanel(staff, panel.id);
    await drainJobs(runner);
    expect(deps.discord.deletedMessages).toContainEqual({ channelId, messageId });
    expect(await testDb().rolePanel.findUnique({ where: { id: panel.id } })).toBeNull();
  });

  it('moving a panel to another channel deletes the old message and posts a new one', async () => {
    const { deps, staff, runner } = await setup();
    const oldChannel = snowflake();
    const panel = await community.createRolePanel(staff, { channelId: oldChannel });
    await drainJobs(runner);
    const newChannel = snowflake();
    await community.updateRolePanel(staff, panel.id, { channelId: newChannel });
    await drainJobs(runner);
    expect(deps.discord.deletedMessages.map((m) => m.channelId)).toContain(oldChannel);
    expect(deps.discord.sent.at(-1)!.channelId).toBe(newChannel);
  });

  it('a missing channel permission is reported, not dead-lettered', async () => {
    const guildId = await freshGuild();
    const discord = fakeDiscord({ sendMessage: async () => Promise.reject(discordError(403)) });
    const staff = ctxAs(guildId, ['community.manage']);
    const panel = await community.createRolePanel(staff, { channelId: snowflake() });
    expect(
      await community.syncRolePanel({ db: testDb(), discord, log: silentLog }, panel.id, new Date()),
    ).toBe('no_access');
  });
});
