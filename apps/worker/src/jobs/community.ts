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
  },
  periodic: [
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
