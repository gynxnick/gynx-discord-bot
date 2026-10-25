import { DiscordAPIError, RESTJSONErrorCodes, type Guild, type GuildMember, type Role } from 'discord.js';
import type { Logger } from '@gynx/config';
import { community } from '@gynx/services';
import { AppError } from '@gynx/shared';

export const roleMeta = (r: Role): community.RoleMeta => ({
  id: r.id,
  position: r.position,
  managed: r.managed,
  permissions: r.permissions.bitfield.toString(),
});

async function botHighestPosition(guild: Guild): Promise<number> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  return me.roles.highest.position;
}

/** Live role metadata + the bot's current highest role, read from the gateway right now. */
export async function liveRoleContext(guild: Guild, roleId: string): Promise<community.LiveRoleContext> {
  const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) throw new AppError('NOT_FOUND', community.CommunityText.roleGoneTellStaff());
  return { role: roleMeta(role), botHighestPosition: await botHighestPosition(guild) };
}

export async function liveRolesContext(
  guild: Guild,
  roleIds: readonly string[],
): Promise<{ roles: community.RoleMeta[]; botHighestPosition: number }> {
  const roles = roleIds.flatMap((id) => {
    const r = guild.roles.cache.get(id);
    return r ? [roleMeta(r)] : [];
  });
  return { roles, botHighestPosition: await botHighestPosition(guild) };
}

export type ApplyResult = { ok: true } | { ok: false; message: string };

/**
 * Add/remove a role on a member. Re-checks hierarchy against the bot's live
 * highest role immediately before acting, and turns Discord permission errors
 * into a friendly message (logged for staff).
 */
export async function applyRoleChange(
  member: GuildMember,
  change: { roleId: string; action: 'add' | 'remove' },
  reason: string,
  log: Logger,
): Promise<ApplyResult> {
  const guild = member.guild;
  const role = guild.roles.cache.get(change.roleId);
  if (!role) return { ok: false, message: community.CommunityText.roleGone() };
  const highest = await botHighestPosition(guild);
  if (role.position >= highest || role.managed || role.id === guild.id) {
    log.warn(
      { roleId: role.id, rolePosition: role.position, botHighest: highest },
      'refusing role change: hierarchy',
    );
    return {
      ok: false,
      message: community.CommunityText.roleAboveBot({ role: role.name }),
    };
  }
  try {
    if (change.action === 'add') await member.roles.add(role, reason);
    else await member.roles.remove(role, reason);
    return { ok: true };
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      (err.code === RESTJSONErrorCodes.MissingPermissions || err.status === 403)
    ) {
      log.warn({ roleId: role.id, code: err.code }, 'missing permissions to change role');
      return {
        ok: false,
        message: community.CommunityText.roleNoPermission({ role: role.name }),
      };
    }
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownRole) {
      return { ok: false, message: community.CommunityText.roleGone() };
    }
    log.error({ err, roleId: role.id }, 'role change failed');
    return { ok: false, message: community.CommunityText.roleChangeFailed({ role: role.name }) };
  }
}
