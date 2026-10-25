import type { GuildSnapshot, SnapshotChannel, SnapshotRole } from './types';

/**
 * Narrow Discord surface the setup engine needs. The REST implementation lives
 * in rest-admin-port.ts; tests use an in-memory fake that simulates a guild
 * (hierarchy, permission rules, rate limits, failures).
 *
 * Rules every implementation must follow:
 * - Permission overwrites are written ONE target at a time (PUT
 *   /channels/:id/permissions/:target), so overwrites the setup does not manage
 *   are never touched.
 * - Errors are thrown as-is (DiscordAPIError-like objects with `status` and
 *   `code`); the executor classifies them (retryable vs permanent).
 */
export interface DiscordAdminPort {
  snapshot(guildId: string): Promise<GuildSnapshot>;

  createRole(
    guildId: string,
    data: { name: string; color: number; permissions: bigint; hoist: boolean; mentionable: boolean },
    reason: string,
  ): Promise<SnapshotRole>;
  editRole(
    guildId: string,
    roleId: string,
    data: Partial<{ name: string; color: number; permissions: bigint; hoist: boolean; mentionable: boolean }>,
    reason: string,
  ): Promise<void>;
  /** Bulk position update for roles the bot manages (all positions below the bot's highest role). */
  setRolePositions(
    guildId: string,
    positions: Array<{ id: string; position: number }>,
    reason: string,
  ): Promise<void>;
  deleteRole(guildId: string, roleId: string, reason: string): Promise<void>;

  createChannel(
    guildId: string,
    data: {
      name: string;
      type: 0 | 2 | 4;
      parentId?: string | null;
      topic?: string;
      rateLimitPerUser?: number;
      /** Initial overwrites (only on create, before anyone can see the channel). */
      overwrites?: Array<{ id: string; type: 0 | 1; allow: bigint; deny: bigint }>;
    },
    reason: string,
  ): Promise<SnapshotChannel>;
  editChannel(
    channelId: string,
    data: Partial<{
      name: string;
      parentId: string | null;
      topic: string;
      rateLimitPerUser: number;
      position: number;
    }>,
    reason: string,
  ): Promise<void>;
  /** Write a single overwrite; never replaces the whole overwrite list. */
  setOverwrite(
    channelId: string,
    target: { id: string; type: 0 | 1 },
    allow: bigint,
    deny: bigint,
    reason: string,
  ): Promise<void>;
  deleteOverwrite(channelId: string, targetId: string, reason: string): Promise<void>;
  deleteChannel(channelId: string, reason: string): Promise<void>;

  /** Whether a channel contains any message not authored by the bot (rollback safety). */
  hasNonBotMessages(channelId: string, botUserId: string): Promise<boolean>;
  /** Whether a message still exists (panel repair). */
  messageExists(channelId: string, messageId: string): Promise<boolean>;
}
