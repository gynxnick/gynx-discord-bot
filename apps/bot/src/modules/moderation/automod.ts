import { randomUUID } from 'node:crypto';
import { PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import type { AutomodConfig } from '@gynx/database';
import { isModuleEnabled, makeCtx, moderation, systemActor } from '@gynx/services';
import { formatDuration, isAppError } from '@gynx/shared';
import { on, type BotRuntime, type EventListener } from '../../framework/types';

const CONFIG_TTL_MS = 30_000;
const NOTICE_COOLDOWN_MS = 30_000;
const NOTICE_TTL_MS = 8_000;

/**
 * Gateway automod. Keeps a bounded per-user sliding window in memory (max 20
 * messages per user, idle users evicted after 5 minutes), evaluates each message
 * with the pure engine, and on a hit: deletes the message, records the hit
 * (which decides DELETE / WARN / TIMEOUT by strikes — never a ban), applies the
 * decision through the same prepare/record path as moderators, and posts a
 * short self-deleting notice that pings only the author.
 *
 * Not evaluated: bots, webhooks, system messages, the guild owner, members with
 * Administrator, and the configured exempt roles/channels.
 */
export function automodListener(): EventListener {
  const history = new moderation.AutomodHistory({ maxPerUser: 20, idleMs: 5 * 60_000 });
  const lastNotice = new Map<string, number>();
  let cache: { at: number; cfg: AutomodConfig | null } | undefined;

  async function config(rt: BotRuntime, guildId: string): Promise<AutomodConfig | null> {
    const now = Date.now();
    if (cache && now - cache.at < CONFIG_TTL_MS) return cache.cfg;
    const enabled = await isModuleEnabled(rt.deps.db, guildId, 'moderation');
    const cfg = enabled ? await moderation.loadAutomodConfig(rt.deps.db, guildId) : null;
    cache = { at: now, cfg: cfg?.enabled ? cfg : null };
    return cache.cfg;
  }

  async function notice(message: Message<true>, text: string): Promise<void> {
    const now = Date.now();
    const last = lastNotice.get(message.author.id) ?? 0;
    if (now - last < NOTICE_COOLDOWN_MS) return;
    if (lastNotice.size > 2_000) lastNotice.clear();
    lastNotice.set(message.author.id, now);
    try {
      const sent = await message.channel.send({
        content: `<@${message.author.id}> ${text}`,
        allowedMentions: { users: [message.author.id] },
      });
      setTimeout(() => void sent.delete().catch(() => undefined), NOTICE_TTL_MS).unref?.();
    } catch {
      // no send permission in this channel — the hit is still recorded
    }
  }

  async function handleHit(
    rt: BotRuntime,
    message: Message<true>,
    member: GuildMember,
    hit: moderation.AutomodHit,
  ): Promise<void> {
    const log = rt.log.child({ module: 'automod', userId: member.id, rule: hit.rule });
    const deleted = await message.delete().then(
      () => true,
      (err: unknown) => {
        log.warn(
          { err: err instanceof Error ? err.message : err },
          'could not delete message (missing Manage Messages?)',
        );
        return false;
      },
    );
    const ctx = makeCtx(rt.deps, message.guildId, systemActor('bot'), `automod:${randomUUID().slice(0, 8)}`);
    const { event, decision } = await moderation.recordAutomodHit(ctx, {
      userId: member.id,
      channelId: message.channelId,
      rule: hit.rule,
      content: message.content,
    });

    let outcome: 'DELETE' | 'WARN' | 'TIMEOUT' | 'ALERT' = decision.action;
    if (decision.action !== 'DELETE') {
      try {
        const botHighest = message.guild.members.me?.roles.highest.position ?? 0;
        const plan = await moderation.prepareAction(
          ctx,
          {
            type: decision.action,
            targetId: member.id,
            reason: `Automod: ${hit.reason}`.slice(0, 512),
            duration: decision.durationMs ? `${Math.round(decision.durationMs / 60_000)}m` : undefined,
            automodEventId: event.id,
          },
          {
            actorHighest: botHighest,
            targetHighest: member.roles.highest.position,
            botHighest,
            guildOwnerId: message.guild.ownerId,
            targetIsBot: false,
            targetRoleIds: [...member.roles.cache.keys()].filter((id) => id !== message.guildId),
          },
        );
        let applied = true;
        let error: string | undefined;
        if (plan.type === 'TIMEOUT') {
          try {
            await member.timeout(plan.durationMs, plan.reason);
          } catch (err) {
            applied = false;
            error = err instanceof Error ? err.message.slice(0, 300) : 'timeout failed';
          }
        }
        await moderation.recordAction(ctx, plan, { applied, error, dmSent: false });
        if (!applied) outcome = 'DELETE';
      } catch (err) {
        // Hierarchy (e.g. member above the bot) or validation: fall back to delete-only.
        outcome = 'DELETE';
        if (!isAppError(err)) throw err;
        log.info({ code: err.code, msg: err.message }, 'automod escalation skipped');
      }
    }
    if (!deleted && outcome === 'DELETE') outcome = 'ALERT';
    if (outcome !== decision.action) await moderation.setAutomodEventOutcome(ctx, event.id, outcome);

    const base = deleted ? 'your message was removed' : 'your message was flagged';
    const text =
      outcome === 'TIMEOUT'
        ? `${base} and you have been timed out for ${formatDuration(decision.durationMs ?? 0)}. ${hit.reason}`
        : outcome === 'WARN'
          ? `${base} and you received a warning. ${hit.reason}`
          : `${base}. ${hit.reason}`;
    await notice(message, text);
  }

  return on('messageCreate', async (rt, message) => {
    if (!message.inGuild() || message.guildId !== rt.env.DISCORD_GUILD_ID) return;
    if (message.author.bot || message.webhookId || message.system) return;
    const cfg = await config(rt, message.guildId);
    if (!cfg) return;
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;
    if (member.id === message.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator))
      return;

    const now = message.createdAt;
    const prior = history.get(member.id, now);
    const hit = moderation.evaluateMessage(
      cfg,
      {
        authorId: member.id,
        channelId: message.channelId,
        content: message.content,
        mentionCount: message.mentions.users.size + message.mentions.roles.size,
        roleIds: [...member.roles.cache.keys()],
        accountCreatedAt: message.author.createdAt,
        memberJoinedAt: member.joinedAt,
        timestamp: now,
      },
      prior,
    );
    history.push(member.id, message.channelId, message.content, now);
    if (hit) await handleHit(rt, message, member, hit);
  });
}
