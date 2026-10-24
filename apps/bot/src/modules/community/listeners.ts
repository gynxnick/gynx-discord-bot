import { randomUUID } from 'node:crypto';
import type { GuildMember } from 'discord.js';
import { community, makeCtx, systemActor } from '@gynx/services';
import { on, type BotRuntime, type EventListener } from '../../framework/types';

async function postWelcome(rt: BotRuntime, member: GuildMember, res: community.JoinResult): Promise<void> {
  const w = res.welcome;
  // During a raid, public welcomes are suppressed so raiders aren't pinged and the channel isn't flooded.
  if (!w.enabled || !w.channelId || res.raid.isRaid) return;
  const channel =
    member.guild.channels.cache.get(w.channelId) ??
    (await member.guild.channels.fetch(w.channelId).catch(() => null));
  if (!channel || !channel.isSendable()) {
    rt.log.warn({ channelId: w.channelId }, 'welcome channel missing or not sendable');
    return;
  }
  await channel
    .send({
      content: `<@${member.id}>`,
      embeds: [
        community.welcomeEmbed(w, {
          userId: member.id,
          serverName: member.guild.name,
          requiresVerification: res.requiresVerification,
        }),
      ],
      components: community.onboardingButtons({ showAccept: false, showVerify: res.requiresVerification }),
      // Explicitly authorised: ping only the new member, nobody else.
      allowedMentions: { parse: [], users: [member.id] },
    })
    .catch((err: unknown) => rt.log.warn({ err, channelId: w.channelId }, 'failed to post welcome'));
}

async function dmWelcome(rt: BotRuntime, member: GuildMember, res: community.JoinResult): Promise<void> {
  if (!res.welcome.dmOnJoin || res.raid.isRaid) return;
  const supportUrl = await community.resolveSupportUrl(rt.deps.db, member.guild.id);
  await member
    .send({
      embeds: [
        community.welcomeDmEmbed(res.welcome, {
          serverName: member.guild.name,
          supportUrl,
          requiresVerification: res.requiresVerification,
        }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch(() => rt.log.debug({ userId: member.id }, 'welcome DM not delivered (DMs closed)'));
}

export const communityListeners: EventListener[] = [
  on('guildMemberAdd', async (rt, member) => {
    if (member.guild.id !== rt.env.DISCORD_GUILD_ID || member.user.bot) return;
    const ctx = makeCtx(rt.deps, member.guild.id, systemActor('bot'), randomUUID().slice(0, 8));
    const res = await community.recordJoin(ctx, {
      userId: member.id,
      joinedAt: member.joinedAt ?? new Date(),
      accountCreatedAt: member.user.createdAt,
      memberCount: member.guild.memberCount,
    });
    if (res.raid.isRaid) rt.log.warn({ joinsInWindow: res.raid.joinsInWindow }, 'raid threshold reached');
    if (!res.moduleEnabled) return;
    await postWelcome(rt, member, res);
    await dmWelcome(rt, member, res);
  }),
  on('guildMemberRemove', async (rt, member) => {
    if (member.guild.id !== rt.env.DISCORD_GUILD_ID || member.user?.bot) return;
    const ctx = makeCtx(rt.deps, member.guild.id, systemActor('bot'), randomUUID().slice(0, 8));
    await community.recordLeave(ctx, { userId: member.id, memberCount: member.guild.memberCount });
  }),
];
