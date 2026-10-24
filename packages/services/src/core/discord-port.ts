import { DiscordAPIError, REST } from '@discordjs/rest';
import {
  Routes,
  type APIChannel,
  type APIGuild,
  type APIGuildMember,
  type APIInvite,
  type APIMessage,
  type APIRole,
  type RESTPostAPIChannelMessageJSONBody,
} from 'discord-api-types/v10';

export type MessageBody = RESTPostAPIChannelMessageJSONBody;

/**
 * Narrow port for Discord side-effects performed outside the gateway process
 * (worker jobs, dashboard). Services depend on this interface, never on
 * discord.js, so business logic stays testable and transport-agnostic.
 */
export interface DiscordPort {
  sendMessage(channelId: string, body: MessageBody): Promise<{ id: string }>;
  editMessage(channelId: string, messageId: string, body: Partial<MessageBody>): Promise<void>;
  /** Returns null when the user has DMs closed / no mutual guild. */
  sendDm(userId: string, body: MessageBody): Promise<{ id: string } | null>;
  getGuild(
    guildId: string,
  ): Promise<{ id: string; name: string; ownerId: string; memberCount: number | null } | null>;
  getMember(
    guildId: string,
    userId: string,
  ): Promise<{
    userId: string;
    roles: string[];
    joinedAt: string | null;
    username: string;
    avatar: string | null;
  } | null>;
  listRoles(
    guildId: string,
  ): Promise<Array<{ id: string; name: string; position: number; managed: boolean; permissions: string }>>;
  listChannels(
    guildId: string,
  ): Promise<Array<{ id: string; name: string; type: number; parentId: string | null }>>;
  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  createInvite(
    channelId: string,
    opts: { maxAgeSeconds: number; maxUses: number; reason: string },
  ): Promise<{ code: string }>;
  listInvites(guildId: string): Promise<Array<{ code: string; uses: number; inviterId: string | null }>>;
  deleteChannel(channelId: string, reason: string): Promise<void>;
}

/** Safe default: never ping anyone unless a caller explicitly opts in. */
export const NO_MENTIONS = { parse: [] as never[] };

const isStatus = (e: unknown, ...codes: number[]) => e instanceof DiscordAPIError && codes.includes(e.status);

/** REST implementation. @discordjs/rest handles per-route rate limits and 429 retry-after. */
export function createRestDiscordPort(token: string): DiscordPort {
  const rest = new REST({ version: '10', timeout: 15_000, retries: 3 }).setToken(token);

  const withSafeMentions = (body: Partial<MessageBody>) => ({ allowed_mentions: NO_MENTIONS, ...body });

  return {
    async sendMessage(channelId, body) {
      const msg = (await rest.post(Routes.channelMessages(channelId), {
        body: withSafeMentions(body),
      })) as APIMessage;
      return { id: msg.id };
    },
    async editMessage(channelId, messageId, body) {
      await rest.patch(Routes.channelMessage(channelId, messageId), { body: withSafeMentions(body) });
    },
    async sendDm(userId, body) {
      try {
        const dm = (await rest.post(Routes.userChannels(), { body: { recipient_id: userId } })) as APIChannel;
        const msg = (await rest.post(Routes.channelMessages(dm.id), {
          body: withSafeMentions(body),
        })) as APIMessage;
        return { id: msg.id };
      } catch (e) {
        if (isStatus(e, 400, 403)) return null; // DMs closed
        throw e;
      }
    },
    async getGuild(guildId) {
      try {
        const g = (await rest.get(Routes.guild(guildId), {
          query: new URLSearchParams({ with_counts: 'true' }),
        })) as APIGuild;
        return {
          id: g.id,
          name: g.name,
          ownerId: g.owner_id,
          memberCount: g.approximate_member_count ?? null,
        };
      } catch (e) {
        if (isStatus(e, 403, 404)) return null;
        throw e;
      }
    },
    async getMember(guildId, userId) {
      try {
        const m = (await rest.get(Routes.guildMember(guildId, userId))) as APIGuildMember;
        return {
          userId: m.user.id,
          roles: m.roles,
          joinedAt: m.joined_at ?? null,
          username: m.nick ?? m.user.global_name ?? m.user.username,
          avatar: m.user.avatar ?? null,
        };
      } catch (e) {
        if (isStatus(e, 404)) return null;
        throw e;
      }
    },
    async listRoles(guildId) {
      const roles = (await rest.get(Routes.guildRoles(guildId))) as APIRole[];
      return roles.map((r) => ({
        id: r.id,
        name: r.name,
        position: r.position,
        managed: r.managed,
        permissions: r.permissions,
      }));
    },
    async listChannels(guildId) {
      const chans = (await rest.get(Routes.guildChannels(guildId))) as APIChannel[];
      return chans.map((c) => ({
        id: c.id,
        name: 'name' in c && c.name ? c.name : c.id,
        type: c.type,
        parentId: 'parent_id' in c ? (c.parent_id ?? null) : null,
      }));
    },
    async addRole(guildId, userId, roleId, reason) {
      await rest.put(Routes.guildMemberRole(guildId, userId, roleId), { reason });
    },
    async removeRole(guildId, userId, roleId, reason) {
      await rest.delete(Routes.guildMemberRole(guildId, userId, roleId), { reason });
    },
    async createInvite(channelId, opts) {
      const inv = (await rest.post(Routes.channelInvites(channelId), {
        body: { max_age: opts.maxAgeSeconds, max_uses: opts.maxUses, unique: true },
        reason: opts.reason,
      })) as APIInvite;
      return { code: inv.code };
    },
    async listInvites(guildId) {
      const invites = (await rest.get(Routes.guildInvites(guildId))) as Array<APIInvite & { uses?: number }>;
      return invites.map((i) => ({ code: i.code, uses: i.uses ?? 0, inviterId: i.inviter?.id ?? null }));
    },
    async deleteChannel(channelId, reason) {
      try {
        await rest.delete(Routes.channel(channelId), { reason });
      } catch (e) {
        if (!isStatus(e, 404)) throw e; // already gone
      }
    },
  };
}
