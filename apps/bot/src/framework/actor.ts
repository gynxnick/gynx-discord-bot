import type { GuildMember, Interaction } from 'discord.js';
import { makeCtx, resolveActor, type Ctx } from '@gynx/services';
import type { BotRuntime } from './types';

/** Resolve the invoking member into a service Ctx with permissions loaded from the DB. */
export async function ctxForMember(rt: BotRuntime, member: GuildMember, correlationId: string): Promise<Ctx> {
  const actor = await resolveActor(rt.deps.db, member.guild.id, {
    userId: member.id,
    roleIds: [...member.roles.cache.keys()].filter((id) => id !== member.guild.id),
    isGuildOwner: member.guild.ownerId === member.id,
    source: 'bot',
    displayName: member.displayName,
  });
  return makeCtx(rt.deps, member.guild.id, actor, correlationId);
}

export async function ctxForInteraction(rt: BotRuntime, i: Interaction, correlationId: string): Promise<Ctx | null> {
  if (!i.inCachedGuild()) return null;
  return ctxForMember(rt, i.member, correlationId);
}
