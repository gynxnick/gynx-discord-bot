import type { Ctx, DiscordPort } from '@gynx/services';
import { AppError, validation } from '@gynx/shared';

/** Live role data the community services need to judge whether a role is safe to hand out. */
export interface LiveRole {
  role: { id: string; position: number; managed: boolean; permissions: string };
  botHighestPosition: number;
}

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * The bot's user id as seen by the dashboard. The dashboard process does not
 * receive `DISCORD_APPLICATION_ID` (bot-only); for a Discord application the
 * OAuth client id IS the application id, and the application id equals the
 * bot user's id. So `DISCORD_OAUTH_CLIENT_ID` identifies the bot member.
 */
export function dashboardBotUserId(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const id = env.DISCORD_OAUTH_CLIENT_ID ?? '';
  if (!SNOWFLAKE.test(id))
    throw new AppError('CONFIG', 'The dashboard is missing its Discord application id.');
  return id;
}

/** Highest position among the given role ids (0 = only @everyone). */
export function highestPosition(
  roleIds: readonly string[],
  roles: ReadonlyArray<{ id: string; position: number }>,
): number {
  let max = 0;
  for (const id of roleIds) {
    const r = roles.find((x) => x.id === id);
    if (r && r.position > max) max = r.position;
  }
  return max;
}

/**
 * Build `{ role, botHighestPosition }` from Discord right now (never from the
 * browser): `listRoles` for the role's position/permissions/managed flag and
 * the bot's own member record for its highest role.
 */
export async function liveRoleContext(
  ctx: Pick<Ctx, 'guildId' | 'discord'>,
  roleId: string,
  botUserId: string = dashboardBotUserId(),
): Promise<LiveRole> {
  const discord: DiscordPort | undefined = ctx.discord;
  if (!discord) throw new AppError('INTEGRATION', 'Discord is not configured for the dashboard.');
  if (!SNOWFLAKE.test(roleId)) throw validation('Choose a valid role.');
  let roles: Awaited<ReturnType<DiscordPort['listRoles']>>;
  let me: Awaited<ReturnType<DiscordPort['getMember']>>;
  try {
    [roles, me] = await Promise.all([
      discord.listRoles(ctx.guildId),
      discord.getMember(ctx.guildId, botUserId),
    ]);
  } catch (err) {
    throw new AppError(
      'INTEGRATION',
      'Could not load role details from Discord. Try again shortly.',
      undefined,
      { cause: err },
    );
  }
  const role = roles.find((r) => r.id === roleId);
  if (!role) throw validation('That role no longer exists in Discord.');
  if (!me)
    throw new AppError(
      'INTEGRATION',
      'The bot is not a member of this server, so role safety cannot be checked.',
    );
  return {
    role: { id: role.id, position: role.position, managed: role.managed, permissions: role.permissions },
    botHighestPosition: highestPosition(me.roles, roles),
  };
}
