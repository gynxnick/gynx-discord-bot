import { community, getGuildConfig } from '@gynx/services';
import type { WorkerModule } from '../framework/types';

export const communityJobs: WorkerModule = {
  name: 'community',
  handlers: {
    /**
     * Staff raid alert. One job per guild per raid-window bucket (dedupeKey), so a
     * raid produces a single alert per window. Counts only — no member lists.
     */
    async [community.RAID_ALERT_JOB](job, w) {
      if (!job.guildId) return;
      const p = job.payload as unknown as community.RaidAlertPayload;
      if (!p?.windowStart || !p.detectedAt) return; // malformed payload: nothing sensible to post
      const cfg = await getGuildConfig(w.deps.db, job.guildId);
      const channelId = cfg.modLogChannelId ?? cfg.logChannelId;
      if (!channelId) {
        w.log.warn({ guildId: job.guildId }, 'raid detected but no mod-log/log channel configured');
        return;
      }
      const flagged = await community.countRaidFlaggedSince(w.deps.db, job.guildId, new Date(p.windowStart));
      await w.deps.discord.sendMessage(channelId, { embeds: [community.raidAlertEmbed(p, flagged)] });
    },

    /** Render a role panel; edits only when its content changed. Idempotent. */
    async 'community.rolepanel.sync'(job, w) {
      const panelId = (job.payload as { panelId?: string }).panelId;
      if (!panelId) return;
      const result = await community.syncRolePanel(w.deps, panelId, w.deps.now());
      if (result !== 'unchanged') w.log.info({ panelId, result }, 'role panel synced');
    },

    /** Remove the Discord message of a deleted or moved panel (already-gone is fine). */
    async 'community.rolepanel.delete'(job, w) {
      const p = job.payload as { channelId?: string; messageId?: string };
      if (!p.channelId || !p.messageId) return;
      await w.deps.discord.deleteMessage(p.channelId, p.messageId);
    },
  },
  periodic: [
    {
      // Safety net: re-sends stale panels so a deleted message is noticed and re-posted.
      name: 'community.rolepanels',
      intervalMs: 10 * 60_000,
      async run(w, now) {
        const panels = await w.deps.db.rolePanel.findMany({
          where: { guildId: w.env.DISCORD_GUILD_ID },
          select: { id: true },
        });
        for (const p of panels) await community.syncRolePanel(w.deps, p.id, now);
      },
    },
    {
      name: 'community.retention',
      intervalMs: 6 * 60 * 60_000,
      async run(w, now) {
        const result = await community.purgeCommunityData(w.deps.db, w.env.DISCORD_GUILD_ID, now);
        w.log.info(result, 'community retention applied');
      },
    },
  ],
};
