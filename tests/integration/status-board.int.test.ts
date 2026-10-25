import { afterAll, describe, expect, it } from 'vitest';
import { DiscordAPIError } from '@discordjs/rest';
import { status } from '@gynx/services';
import { fakeDiscord, freshGuild, silentLog, snowflake, testDb } from './helpers';

const discordError = (httpStatus: number) =>
  new DiscordAPIError({ message: 'test', code: 0 }, 0, httpStatus, 'PATCH', 'https://discord.test', {});

async function setup() {
  const guildId = await freshGuild();
  const channelId = snowflake();
  await testDb().guildConfig.update({ where: { guildId }, data: { statusBoardChannelId: channelId } });
  const svc = await testDb().monitoredService.create({
    data: {
      guildId,
      name: 'Game Servers',
      slug: `game-${snowflake()}`,
      kind: 'MANUAL',
      state: 'OPERATIONAL',
    },
  });
  const discord = fakeDiscord();
  const deps = { db: testDb(), discord, log: silentLog };
  return { guildId, channelId, svc, discord, deps };
}

const t0 = new Date('2026-10-25T12:00:00Z');
const plus = (ms: number) => new Date(t0.getTime() + ms);

describe('live status board', () => {
  afterAll(async () => {
    await testDb().$disconnect();
  });

  it('does nothing until a board channel is configured', async () => {
    const guildId = await freshGuild();
    const discord = fakeDiscord();
    expect(await status.syncStatusBoard({ db: testDb(), discord, log: silentLog }, guildId, t0)).toBe(
      'disabled',
    );
    expect(discord.sent).toHaveLength(0);
  });

  it('posts once, then edits only when something visible changes', async () => {
    const { guildId, channelId, svc, discord, deps } = await setup();

    expect(await status.syncStatusBoard(deps, guildId, t0)).toBe('posted');
    expect(discord.sent).toHaveLength(1);
    expect(discord.sent[0]!.channelId).toBe(channelId);
    expect(JSON.stringify(discord.sent[0]!.body)).toContain('Game Servers');

    // Nothing changed, refresh window not reached → no Discord call at all.
    expect(await status.syncStatusBoard(deps, guildId, plus(30_000))).toBe('unchanged');
    expect(discord.edits).toHaveLength(0);

    // A service goes down → the same message is edited, not re-posted.
    await testDb().monitoredService.update({ where: { id: svc.id }, data: { state: 'OUTAGE' } });
    expect(await status.syncStatusBoard(deps, guildId, plus(60_000))).toBe('edited');
    expect(discord.sent).toHaveLength(1);
    expect(discord.edits).toHaveLength(1);
    expect(JSON.stringify(discord.edits[0]!.body)).toContain('Outage');
  });

  it('refreshes periodically so the "updated" time stays truthful', async () => {
    const { guildId, discord, deps } = await setup();
    await status.syncStatusBoard(deps, guildId, t0);
    expect(await status.syncStatusBoard(deps, guildId, plus(status.BOARD_REFRESH_MS - 1000))).toBe(
      'unchanged',
    );
    expect(await status.syncStatusBoard(deps, guildId, plus(status.BOARD_REFRESH_MS))).toBe('edited');
    expect(discord.edits).toHaveLength(1);
  });

  it('re-posts when the board message was deleted', async () => {
    const { guildId, svc, deps } = await setup();
    await status.syncStatusBoard(deps, guildId, t0);
    const before = (await testDb().guildConfig.findUniqueOrThrow({ where: { guildId } })).statusBoardMessage;
    deps.discord.editMessage = async () => Promise.reject(discordError(404));
    await testDb().monitoredService.update({ where: { id: svc.id }, data: { state: 'DEGRADED' } });
    expect(await status.syncStatusBoard(deps, guildId, plus(60_000))).toBe('reposted');
    expect(deps.discord.sent).toHaveLength(2);
    const after = (await testDb().guildConfig.findUniqueOrThrow({ where: { guildId } })).statusBoardMessage;
    expect(after).toBeTruthy();
    expect(after).not.toBe(before); // now tracks the new message
  });

  it('retires the old message when the board moves to another channel', async () => {
    const { guildId, channelId, discord, deps } = await setup();
    await status.syncStatusBoard(deps, guildId, t0);
    const newChannel = snowflake();
    await testDb().guildConfig.update({ where: { guildId }, data: { statusBoardChannelId: newChannel } });

    expect(await status.syncStatusBoard(deps, guildId, plus(30_000))).toBe('reposted');
    expect(discord.edits[0]!.channelId).toBe(channelId);
    expect(JSON.stringify(discord.edits[0]!.body)).toContain(`<#${newChannel}>`);
    expect(discord.sent.at(-1)!.channelId).toBe(newChannel);
  });

  it('reports missing permissions instead of throwing', async () => {
    const { guildId, deps } = await setup();
    deps.discord.sendMessage = async () => Promise.reject(discordError(403));
    expect(await status.syncStatusBoard(deps, guildId, t0)).toBe('no_access');
  });

  it('never shows internal monitoring targets', async () => {
    const { guildId, discord, deps } = await setup();
    await testDb().monitoredService.create({
      data: {
        guildId,
        name: 'Web panel',
        slug: `panel-${snowflake()}`,
        kind: 'HTTP',
        target: 'http://10.0.0.5:8080/health',
        state: 'OPERATIONAL',
      },
    });
    await status.syncStatusBoard(deps, guildId, t0);
    const json = JSON.stringify(discord.sent[0]!.body);
    expect(json).toContain('Web panel');
    expect(json).not.toContain('10.0.0.5');
  });
});
