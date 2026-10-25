import { DiscordAPIError, REST } from '@discordjs/rest';
import {
  PermissionFlagsBits,
  Routes,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIMessage,
  type APIOverwrite,
  type APIRole,
  type APIUser,
} from 'discord-api-types/v10';
import type { DiscordAdminPort } from './port';
import type { GuildSnapshot, SnapshotChannel, SnapshotRole } from './types';

const ALL_BITS = Object.values(PermissionFlagsBits).reduce((a, b) => a | b, 0n);

const toRole = (r: APIRole): SnapshotRole => ({
  id: r.id,
  name: r.name,
  color: r.color,
  position: r.position,
  permissions: BigInt(r.permissions),
  managed: r.managed,
  hoist: r.hoist,
  mentionable: r.mentionable,
});

const toChannel = (c: APIChannel): SnapshotChannel => {
  const g = c as APIChannel & {
    parent_id?: string | null;
    position?: number;
    topic?: string | null;
    rate_limit_per_user?: number;
    permission_overwrites?: APIOverwrite[];
    name?: string | null;
  };
  return {
    id: g.id,
    name: g.name ?? '',
    type: g.type,
    parentId: g.parent_id ?? null,
    position: g.position ?? 0,
    topic: g.topic ?? null,
    rateLimitPerUser: g.rate_limit_per_user ?? 0,
    overwrites: (g.permission_overwrites ?? []).map((o) => ({
      id: o.id,
      type: o.type as 0 | 1,
      allow: BigInt(o.allow),
      deny: BigInt(o.deny),
    })),
  };
};

const status = (e: unknown) => (e instanceof DiscordAPIError ? e.status : undefined);

/**
 * REST implementation of the admin port. Overwrites are written one target at
 * a time (PUT /channels/:id/permissions/:target). @discordjs/rest queues per
 * route and honours 429 retry-after; errors are rethrown for the executor.
 */
export function createRestDiscordAdminPort(token: string): DiscordAdminPort {
  const rest = new REST({ version: '10', timeout: 15_000, retries: 1 }).setToken(token);
  let botUserId: string | undefined;

  const me = async () => {
    if (!botUserId) botUserId = ((await rest.get(Routes.user('@me'))) as APIUser).id;
    return botUserId;
  };

  return {
    async snapshot(guildId): Promise<GuildSnapshot> {
      const botId = await me();
      const [guild, channels, member] = await Promise.all([
        rest.get(Routes.guild(guildId)) as Promise<APIGuild>,
        rest.get(Routes.guildChannels(guildId)) as Promise<APIChannel[]>,
        rest.get(Routes.guildMember(guildId, botId)) as Promise<APIGuildMember>,
      ]);
      const roles = guild.roles.map(toRole);
      const everyone = roles.find((r) => r.id === guildId);
      const botRoles = roles.filter((r) => member.roles.includes(r.id));
      let perms = (everyone?.permissions ?? 0n) | botRoles.reduce((a, r) => a | r.permissions, 0n);
      if ((perms & PermissionFlagsBits.Administrator) !== 0n) perms = ALL_BITS;
      return {
        guildId,
        ownerId: guild.owner_id,
        botUserId: botId,
        botPermissions: perms,
        botHighestPosition: botRoles.reduce((m, r) => Math.max(m, r.position), 0),
        roles,
        channels: channels.map(toChannel),
      };
    },

    async createRole(guildId, data, reason) {
      const r = (await rest.post(Routes.guildRoles(guildId), {
        body: { ...data, permissions: data.permissions.toString() },
        reason,
      })) as APIRole;
      return toRole(r);
    },
    async editRole(guildId, roleId, data, reason) {
      await rest.patch(Routes.guildRole(guildId, roleId), {
        body: {
          ...data,
          ...(data.permissions !== undefined ? { permissions: data.permissions.toString() } : {}),
        },
        reason,
      });
    },
    async setRolePositions(guildId, positions, reason) {
      await rest.patch(Routes.guildRoles(guildId), { body: positions, reason });
    },
    async deleteRole(guildId, roleId, reason) {
      try {
        await rest.delete(Routes.guildRole(guildId, roleId), { reason });
      } catch (e) {
        if (status(e) !== 404) throw e;
      }
    },

    async createChannel(guildId, data, reason) {
      const c = (await rest.post(Routes.guildChannels(guildId), {
        body: {
          name: data.name,
          type: data.type,
          parent_id: data.parentId ?? undefined,
          topic: data.topic,
          rate_limit_per_user: data.rateLimitPerUser,
          permission_overwrites: (data.overwrites ?? []).map((o) => ({
            id: o.id,
            type: o.type,
            allow: o.allow.toString(),
            deny: o.deny.toString(),
          })),
        },
        reason,
      })) as APIChannel;
      return toChannel(c);
    },
    async editChannel(channelId, data, reason) {
      await rest.patch(Routes.channel(channelId), {
        body: {
          name: data.name,
          parent_id: data.parentId,
          topic: data.topic,
          rate_limit_per_user: data.rateLimitPerUser,
          position: data.position,
        },
        reason,
      });
    },
    async setOverwrite(channelId, target, allow, deny, reason) {
      await rest.put(Routes.channelPermission(channelId, target.id), {
        body: { type: target.type, allow: allow.toString(), deny: deny.toString() },
        reason,
      });
    },
    async deleteOverwrite(channelId, targetId, reason) {
      try {
        await rest.delete(Routes.channelPermission(channelId, targetId), { reason });
      } catch (e) {
        if (status(e) !== 404) throw e;
      }
    },
    async deleteChannel(channelId, reason) {
      try {
        await rest.delete(Routes.channel(channelId), { reason });
      } catch (e) {
        if (status(e) !== 404) throw e;
      }
    },

    async hasNonBotMessages(channelId, botId) {
      try {
        const msgs = (await rest.get(Routes.channelMessages(channelId), {
          query: new URLSearchParams({ limit: '100' }),
        })) as APIMessage[];
        return msgs.some((m) => m.author.id !== botId);
      } catch (e) {
        if (status(e) === 404) return false;
        // Unknown (e.g. no access): be conservative so rollback keeps the channel.
        return true;
      }
    },
    async messageExists(channelId, messageId) {
      try {
        await rest.get(Routes.channelMessage(channelId, messageId));
        return true;
      } catch (e) {
        if (status(e) === 404) return false;
        throw e;
      }
    },
  };
}
