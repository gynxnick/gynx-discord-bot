import { randomUUID } from 'node:crypto';
import type { Message } from 'discord.js';
import { can, engagement, getGuildConfig } from '@gynx/services';
import { isAppError, truncate } from '@gynx/shared';
import { ctxForMember } from '../../framework/actor';
import { userFacingError } from '../../framework/reply';
import { on, type BotRuntime } from '../../framework/types';

/**
 * Suggestions channel: members just type. Each message becomes a suggestion
 * (same validation, rate limit, duplicate check and redaction as /suggest);
 * the original message is removed and the worker posts the voting card (and
 * a discussion thread, if enabled). Staff with suggestions.manage can post
 * normally, e.g. to leave notes.
 */

const NOTE_TTL_MS = 15_000;
const CONFIG_TTL_MS = 30_000;
const configCache = new Map<string, { at: number; channelId: string | null; enabled: boolean }>();

async function suggestionChannelOf(rt: BotRuntime, guildId: string): Promise<string | null> {
  const hit = configCache.get(guildId);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.enabled ? hit.channelId : null;
  const cfg = await getGuildConfig(rt.deps.db, guildId);
  const entry = {
    at: Date.now(),
    channelId: cfg.suggestionChannelId,
    enabled: cfg.enabledModules.includes('engagement'),
  };
  configCache.set(guildId, entry);
  return entry.enabled ? entry.channelId : null;
}

async function removeQuietly(message: Message, rt: BotRuntime) {
  await message
    .delete()
    .catch((err: unknown) =>
      rt.log.warn(
        { err: err instanceof Error ? err.message : err, channelId: message.channelId },
        'could not delete message in suggestions channel (needs Manage Messages)',
      ),
    );
}

export const suggestionChannelListener = on('messageCreate', async (rt, message) => {
  if (!message.inGuild() || message.guildId !== rt.env.DISCORD_GUILD_ID) return;
  if (message.author.bot || message.webhookId || message.system) return;
  const channelId = await suggestionChannelOf(rt, message.guildId);
  if (!channelId || message.channelId !== channelId) return;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return;
  const correlationId = randomUUID().slice(0, 8);
  const ctx = await ctxForMember(rt, member, correlationId);
  if (can(ctx, 'suggestions.manage')) return; // staff can talk in the channel

  const T = engagement.EngagementText;
  try {
    await engagement.submitSuggestionFromMessage(ctx, message.content);
    await removeQuietly(message, rt);
    return;
  } catch (err) {
    if (!isAppError(err)) rt.log.error({ err, correlationId }, 'suggestion from channel message failed');
    const reason = userFacingError(err, correlationId);

    // Keep their words: DM a copy before removing the message (fails silently if DMs are closed).
    await message.author
      .send({
        content: truncate(
          T.suggestionChannelDmCopy({ reason, content: message.content.slice(0, 1500) }),
          2000,
        ),
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);

    // One visible note per member per minute, so a burst of bad posts can't make the bot spam the channel.
    const noteAllowed = await rt.deps.rateLimiter.consume(
      `${message.guildId}:${message.author.id}:suggestion-note`,
      1,
      60,
    );
    if (noteAllowed.allowed && message.channel.isSendable()) {
      const note = await message.channel
        .send({
          content: truncate(T.suggestionChannelRemoved({ user: `<@${message.author.id}>`, reason }), 2000),
          allowedMentions: { users: [message.author.id] },
        })
        .catch(() => null);
      if (note) setTimeout(() => void note.delete().catch(() => undefined), NOTE_TTL_MS).unref?.();
    }
    await removeQuietly(message, rt);
  }
});
