import { DiscordAPIError } from '@discordjs/rest';
import { afterAll, describe, expect, it } from 'vitest';
import { support } from '@gynx/services';
import { ctxAs, freshGuild, snowflake, testDb, testDeps } from './helpers';

const apiError = (status: number) =>
  new DiscordAPIError({ message: 'error', code: 0 }, 0, status, 'PATCH', '', {});

async function setup() {
  const guildId = await freshGuild();
  const channelId = snowflake();
  await testDb().guildConfig.update({ where: { guildId }, data: { dutyPanelChannelId: channelId } });
  const deps = testDeps();
  const lead = ctxAs(guildId, ['support.duty', 'support.duty.manage'], { deps });
  const staffId = snowflake();
  const staff = ctxAs(guildId, ['support.duty'], { deps, userId: staffId });
  await support.setDutyProfile(lead, { userId: staffId, publicName: 'Alex' });
  const sync = (at = new Date()) => support.syncDutyControlPanel(deps, guildId, at);
  const posts = () => deps.discord.sent.filter((m) => m.channelId === channelId);
  const edits = () => deps.discord.edits.filter((m) => m.channelId === channelId);
  return { guildId, channelId, deps, lead, staff, staffId, sync, posts, edits };
}

const text = (b: unknown) => JSON.stringify(b);

describe('staff duty-control panel', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('posts once, stores the message, and does not edit when nothing changed', async () => {
    const { guildId, channelId, sync, posts, edits } = await setup();
    expect(await sync()).toBe('posted');
    expect(posts()).toHaveLength(1);
    const cfg = await testDb().guildConfig.findUniqueOrThrow({ where: { guildId } });
    expect(cfg.dutyPanelMessage).toMatch(new RegExp(`^${channelId}:\\d+$`));
    expect(text(posts()[0]!.body)).toContain('dutypanel:on');
    expect(text(posts()[0]!.body)).toContain('Nobody is on duty right now.');

    expect(await sync(new Date(Date.now() + 1000))).toBe('unchanged');
    expect(posts()).toHaveLength(1);
    expect(edits()).toHaveLength(0);
  });

  it('edits the same message when someone goes on or off duty', async () => {
    const { staff, staffId, sync, posts, edits } = await setup();
    await sync();
    await support.startDuty(staff);
    expect(await sync()).toBe('edited');
    expect(text(edits().at(-1)!.body)).toContain('🟢 Alex');
    expect(text(edits().at(-1)!.body)).not.toContain(staffId);

    await support.endDuty(staff);
    expect(await sync()).toBe('edited');
    expect(text(edits().at(-1)!.body)).toContain('Nobody is on duty right now.');
    expect(posts()).toHaveLength(1);
  });

  it('re-posts when the panel message was deleted (404)', async () => {
    const { deps, sync, posts, staff } = await setup();
    await sync();
    await support.startDuty(staff); // forces an edit attempt
    deps.discord.editMessage = () => Promise.reject(apiError(404));
    expect(await sync()).toBe('reposted');
    expect(posts()).toHaveLength(2);
  });

  it('reports no_access on 403 instead of failing', async () => {
    const { deps, sync, staff } = await setup();
    await sync();
    await support.startDuty(staff);
    deps.discord.editMessage = () => Promise.reject(apiError(403));
    expect(await sync()).toBe('no_access');

    const other = await setup();
    other.deps.discord.failNextSend = apiError(403);
    expect(await other.sync()).toBe('no_access');
  });

  it('is disabled without a channel, and retires the old message when the channel changes', async () => {
    const { guildId, deps, channelId, sync } = await setup();
    const bare = await freshGuild();
    expect(await support.syncDutyControlPanel(deps, bare, new Date())).toBe('disabled');

    await sync();
    const first = (await testDb().guildConfig.findUniqueOrThrow({ where: { guildId } })).dutyPanelMessage!;
    const next = snowflake();
    await testDb().guildConfig.update({ where: { guildId }, data: { dutyPanelChannelId: next } });
    expect(await sync()).toBe('reposted'); // same semantics as the support panel
    expect(deps.discord.deletedMessages).toContainEqual({
      channelId,
      messageId: first.split(':')[1],
    });
    expect(deps.discord.sent.at(-1)!.channelId).toBe(next);
  });

  it('button flows: on / me / team / off, through the duty service', async () => {
    const { guildId, staff, staffId } = await setup();
    expect(await support.getMyDutyStatus(staff)).toEqual({ onDuty: false });

    const started = await support.startDuty(staff);
    expect(started.publicName).toBe('Alex');
    const me = await support.getMyDutyStatus(staff);
    expect(me).toMatchObject({ onDuty: true, publicName: 'Alex' });
    const team = await support.viewOnDutyTeam(staff);
    expect(team.map((e) => e.publicName)).toEqual(['Alex']);
    await expect(support.startDuty(staff)).rejects.toMatchObject({ code: 'CONFLICT' });

    await support.endDuty(staff);
    expect(await support.getMyDutyStatus(staff)).toEqual({ onDuty: false });
    await expect(support.endDuty(staff)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(
      await testDb().dutySession.count({ where: { guildId, userId: staffId, endReason: 'MANUAL' } }),
    ).toBe(1);
  });

  it('members without support.duty cannot use any duty button', async () => {
    const { guildId } = await setup();
    const member = ctxAs(guildId);
    await expect(support.startDuty(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(support.endDuty(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(support.getMyDutyStatus(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(support.viewOnDutyTeam(member)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
