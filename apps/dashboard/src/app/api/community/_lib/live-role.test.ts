import { describe, expect, it } from 'vitest';
import type { DiscordPort } from '@gynx/services';
import { dashboardBotUserId, highestPosition, liveRoleContext } from './live-role';

const GUILD = '100000000000000001';
const BOT = '200000000000000002';
const ROLE = '300000000000000003';

function discord(overrides: Partial<DiscordPort>): DiscordPort {
  return {
    listRoles: async () => [
      { id: GUILD, name: '@everyone', position: 0, managed: false, permissions: '0' },
      { id: ROLE, name: 'Gamer', position: 3, managed: false, permissions: '0' },
      { id: '400000000000000004', name: 'Bot', position: 7, managed: true, permissions: '8' },
    ],
    getMember: async (_g, id) => ({
      userId: id,
      roles: ['400000000000000004'],
      joinedAt: null,
      username: 'bot',
      avatar: null,
    }),
    ...overrides,
  } as DiscordPort;
}

describe('live role context', () => {
  it('reads the bot id from DISCORD_OAUTH_CLIENT_ID', () => {
    expect(dashboardBotUserId({ DISCORD_OAUTH_CLIENT_ID: BOT })).toBe(BOT);
    expect(() => dashboardBotUserId({})).toThrow(/application id/);
  });

  it('computes the highest position among member roles', () => {
    expect(highestPosition([], [{ id: 'a', position: 3 }])).toBe(0);
    expect(
      highestPosition(
        ['a', 'b'],
        [
          { id: 'a', position: 3 },
          { id: 'b', position: 9 },
        ],
      ),
    ).toBe(9);
  });

  it('builds role metadata and the bot position from Discord', async () => {
    const live = await liveRoleContext({ guildId: GUILD, discord: discord({}) }, ROLE, BOT);
    expect(live).toEqual({
      role: { id: ROLE, position: 3, managed: false, permissions: '0' },
      botHighestPosition: 7,
    });
  });

  it('fails clearly for unknown roles, a missing bot or Discord errors', async () => {
    await expect(
      liveRoleContext({ guildId: GUILD, discord: discord({}) }, '999999999999999999', BOT),
    ).rejects.toThrow(/no longer exists/);
    await expect(
      liveRoleContext({ guildId: GUILD, discord: discord({ getMember: async () => null }) }, ROLE, BOT),
    ).rejects.toThrow(/not a member/);
    await expect(
      liveRoleContext(
        {
          guildId: GUILD,
          discord: discord({
            listRoles: async () => {
              throw new Error('503');
            },
          }),
        },
        ROLE,
        BOT,
      ),
    ).rejects.toMatchObject({ code: 'INTEGRATION' });
    await expect(liveRoleContext({ guildId: GUILD, discord: undefined }, ROLE, BOT)).rejects.toMatchObject({
      code: 'INTEGRATION',
    });
  });
});
