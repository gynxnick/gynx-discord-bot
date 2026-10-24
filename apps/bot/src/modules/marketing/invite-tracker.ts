import { Events, type Guild } from 'discord.js';
import { isModuleEnabled, makeCtx, marketing, systemActor } from '@gynx/services';
import { on, type BotRuntime, type EventListener } from '../../framework/types';

/**
 * In-memory invite use-count cache for referral attribution. Joins are
 * processed one at a time so two near-simultaneous joins can never be credited
 * to the same invite diff; if they overlap, the result is honestly AMBIGUOUS/UNKNOWN.
 */
const cache = new Map<string, number>();
let cacheReady = false;
let chain: Promise<unknown> = Promise.resolve();

const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
};

async function fetchUses(guild: Guild): Promise<Array<{ code: string; uses: number }> | null> {
  try {
    const invites = await guild.invites.fetch({ cache: false });
    return [...invites.values()].map((inv) => ({ code: inv.code, uses: inv.uses ?? 0 }));
  } catch {
    return null; // missing Manage Server permission or API error
  }
}

function reset(list: Array<{ code: string; uses: number }>) {
  cache.clear();
  for (const i of list) cache.set(i.code, i.uses);
  cacheReady = true;
}

async function prime(rt: BotRuntime, guild: Guild) {
  const list = await fetchUses(guild);
  if (list) reset(list);
  else rt.log.warn('could not fetch guild invites; referral attribution will record UNKNOWN until it can');
}

export const inviteTrackerEvents: EventListener[] = [
  on(Events.ClientReady, async (rt, client) => {
    const guild = client.guilds.cache.get(rt.env.DISCORD_GUILD_ID);
    if (guild) await serial(() => prime(rt, guild));
  }),
  on(Events.InviteCreate, async (rt, invite) => {
    if (invite.guild?.id !== rt.env.DISCORD_GUILD_ID) return;
    await serial(async () => {
      cache.set(invite.code, invite.uses ?? 0);
    });
  }),
  on(Events.InviteDelete, async (rt, invite) => {
    if (invite.guild?.id !== rt.env.DISCORD_GUILD_ID) return;
    await serial(async () => {
      cache.delete(invite.code);
    });
  }),
  on(Events.GuildMemberAdd, async (rt, member) => {
    if (member.guild.id !== rt.env.DISCORD_GUILD_ID || member.user.bot) return;
    await serial(async () => {
      const wasReady = cacheReady;
      const before = new Map(cache);
      const after = await fetchUses(member.guild);
      if (after) reset(after);
      if (!(await isModuleEnabled(rt.deps.db, member.guild.id, 'referrals'))) return;

      // Without a trustworthy "before" snapshot we cannot attribute: record UNKNOWN.
      const diff = after && wasReady ? marketing.diffInviteUses(before, after) : { confidence: 'UNKNOWN' as const, inviteCode: null, changedCodes: [] };
      const uses = diff.inviteCode ? after?.find((i) => i.code === diff.inviteCode)?.uses : undefined;
      const ctx = makeCtx(rt.deps, member.guild.id, systemActor('bot'), `join:${member.id}`);
      await marketing.recordAttribution(ctx, {
        joinedUserId: member.id,
        confidence: diff.confidence,
        inviteCode: diff.inviteCode,
        inviteUses: uses,
        joinedAt: member.joinedAt ?? new Date(),
        accountCreatedAt: member.user.createdAt,
      });
      if (diff.confidence === 'AMBIGUOUS') rt.log.info({ userId: member.id, changed: diff.changedCodes.length }, 'ambiguous referral attribution');
    });
  }),
];
