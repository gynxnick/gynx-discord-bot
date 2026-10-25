import { DiscordAPIError } from '@discordjs/rest';
import type { Db } from '@gynx/database';
import type { Logger } from '@gynx/config';
import { discordTimestamp, sha256 } from '@gynx/shared';
import { getGuildConfig } from '../core/config';
import type { DiscordPort, MessageBody } from '../core/discord-port';
import { infoEmbed } from '../core/render';
import { getPublicStatus, type PublicStatus } from './public';
import { statusButtons, statusPageEmbed } from './render';

/**
 * Live status board: one public message the worker keeps up to date by editing
 * it in place, so members never need to run /status.
 *
 * - Edits only when the visible content changed, plus a periodic refresh so the
 *   "updated" time stays truthful.
 * - Re-posts if the message was deleted; retires the old message if the board
 *   moves to another channel.
 * - Discord permission problems are reported to the caller, never thrown, so a
 *   misconfigured channel can't flood the dead-letter queue.
 */
export const BOARD_REFRESH_MS = 5 * 60_000;

export type BoardSyncResult =
  'disabled' | 'posted' | 'edited' | 'unchanged' | 'reposted' | 'no_access' | 'module_disabled';

/** Fingerprint of what members actually see (excludes the generation time). */
export function boardFingerprint(s: PublicStatus): string {
  const { generatedAt: _ignored, ...visible } = s;
  return sha256(JSON.stringify(visible));
}

export function statusBoardMessage(s: PublicStatus, now: Date): MessageBody {
  const embed = statusPageEmbed(s);
  embed.description = `${embed.description ?? ''}\n\nLive board · updated ${discordTimestamp(now, 'R')}`;
  embed.footer = { text: 'Updates automatically · Use the buttons for alerts and history' };
  return { embeds: [embed], components: statusButtons() };
}

const parseRef = (ref: string | null) => {
  const [channelId, messageId] = (ref ?? '').split(':');
  return channelId && messageId ? { channelId, messageId } : null;
};

const statusCode = (e: unknown) => (e instanceof DiscordAPIError ? e.status : undefined);

export async function syncStatusBoard(
  deps: { db: Db; discord: DiscordPort; log: Logger },
  guildId: string,
  now: Date,
): Promise<BoardSyncResult> {
  const cfg = await getGuildConfig(deps.db, guildId);
  const channelId = cfg.statusBoardChannelId;
  if (!channelId) return 'disabled';
  if (!cfg.enabledModules.includes('status')) return 'module_disabled';

  const status = await getPublicStatus(deps.db, guildId, now);
  const hash = boardFingerprint(status);
  const body = statusBoardMessage(status, now);
  const existing = parseRef(cfg.statusBoardMessage);

  const save = (messageId: string) =>
    deps.db.guildConfig.update({
      where: { guildId },
      data: {
        statusBoardMessage: `${channelId}:${messageId}`,
        statusBoardHash: hash,
        statusBoardUpdatedAt: now,
      },
    });

  // Board moved to a different channel: point the old message at the new one (best effort).
  if (existing && existing.channelId !== channelId) {
    await deps.discord
      .editMessage(existing.channelId, existing.messageId, {
        embeds: [infoEmbed('Status board moved', `The live status board is now in <#${channelId}>.`)],
        components: [],
      })
      .catch(() => undefined);
  }

  if (existing && existing.channelId === channelId) {
    const stale =
      !cfg.statusBoardUpdatedAt || now.getTime() - cfg.statusBoardUpdatedAt.getTime() >= BOARD_REFRESH_MS;
    if (cfg.statusBoardHash === hash && !stale) return 'unchanged';
    try {
      await deps.discord.editMessage(channelId, existing.messageId, body);
      await save(existing.messageId);
      return 'edited';
    } catch (e) {
      const code = statusCode(e);
      if (code === 403) {
        deps.log.warn({ guildId, channelId }, 'status board: missing access to edit the board message');
        return 'no_access';
      }
      if (code !== 404) throw e; // transient: retried on the next tick
      deps.log.info({ guildId, channelId }, 'status board message was deleted; posting a new one');
    }
  }

  try {
    const msg = await deps.discord.sendMessage(channelId, body);
    await save(msg.id);
    return existing ? 'reposted' : 'posted';
  } catch (e) {
    const code = statusCode(e);
    if (code === 403 || code === 404) {
      deps.log.warn({ guildId, channelId }, 'status board: cannot post (check channel and bot permissions)');
      return 'no_access';
    }
    throw e;
  }
}
