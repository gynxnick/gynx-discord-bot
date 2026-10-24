import { DiscordAPIError, REST } from '@discordjs/rest';
import { Routes, type APIMessage } from 'discord-api-types/v10';
import { getGuildConfig, marketing } from '@gynx/services';
import type { WorkerCtx, WorkerModule } from '../framework/types';

const applicationId = (payload: unknown) => (payload as { applicationId?: string }).applicationId ?? '';

/** Total reactions on a message, or null if it no longer exists / is inaccessible. */
export type ReactionFetcher = (channelId: string, messageId: string) => Promise<number | null>;

let defaultFetcher: { token: string; fetch: ReactionFetcher } | undefined;

export function createReactionFetcher(token: string): ReactionFetcher {
  const rest = new REST({ version: '10', timeout: 15_000, retries: 2 }).setToken(token);
  return async (channelId, messageId) => {
    try {
      const msg = (await rest.get(Routes.channelMessage(channelId, messageId))) as APIMessage;
      return (msg.reactions ?? []).reduce((sum, r) => sum + (r.count ?? 0), 0);
    } catch (e) {
      if (e instanceof DiscordAPIError && [403, 404].includes(e.status)) return null;
      throw e;
    }
  };
}

function fetcherFor(w: WorkerCtx): ReactionFetcher {
  if (!defaultFetcher || defaultFetcher.token !== w.env.DISCORD_BOT_TOKEN) {
    defaultFetcher = { token: w.env.DISCORD_BOT_TOKEN, fetch: createReactionFetcher(w.env.DISCORD_BOT_TOKEN) };
  }
  return defaultFetcher.fetch;
}

/** Refresh reaction totals for announcements published in the last 14 days. Exposed for tests. */
export async function refreshEngagement(w: WorkerCtx, now: Date, fetchReactions?: ReactionFetcher): Promise<number> {
  const deliveries = await marketing.deliveriesForEngagementRefresh(w.deps.db, w.env.DISCORD_GUILD_ID, now);
  if (deliveries.length === 0) return 0;
  const fetch = fetchReactions ?? fetcherFor(w);
  let updated = 0;
  for (const d of deliveries) {
    try {
      const count = await fetch(d.channelId, d.messageId!);
      if (count === null) continue; // deleted message: keep the last known count
      await marketing.recordReactionCount(w.deps.db, d.id, count);
      updated++;
    } catch (err) {
      w.log.warn({ err, deliveryId: d.id }, 'reaction refresh failed for one message');
    }
  }
  return updated;
}

export const marketingJobs: WorkerModule = {
  name: 'marketing',
  handlers: {
    /** Publish an announcement version. At-most-once; see marketing.deliverAnnouncement. */
    async 'marketing.announcement.publish'(job, w) {
      const outcome = await marketing.deliverAnnouncement(w.deps, job.payload as { announcementId?: string; version?: number });
      w.log.info({ outcome, payload: job.payload }, 'announcement delivery');
    },

    /** Notify the partner review channel about a new application. */
    async 'marketing.partner.notify'(job, w) {
      const app = await w.deps.db.partnerApplication.findUnique({ where: { id: applicationId(job.payload) } });
      if (!app || app.status !== 'PENDING') return; // already picked up or decided
      const cfg = await getGuildConfig(w.deps.db, app.guildId);
      if (!cfg.partnerReviewChannelId) {
        w.log.warn({ guildId: app.guildId }, 'no partner review channel configured; application visible in dashboard only');
        return;
      }
      await w.deps.discord.sendMessage(cfg.partnerReviewChannelId, {
        embeds: [marketing.partnerApplicationEmbed(app)],
        components: marketing.partnerStaffButtons(app, w.env.DASHBOARD_URL),
      });
    },

    /**
     * After a decision: grant the partner role (approved only, with the privileged-bits
     * safety check), then DM the applicant once. Role grant is idempotent (roleGranted flag);
     * the DM is guarded by an audit marker.
     */
    async 'marketing.partner.decision'(job, w) {
      const app = await w.deps.db.partnerApplication.findUnique({ where: { id: applicationId(job.payload) } });
      if (!app || (app.status !== 'APPROVED' && app.status !== 'REJECTED')) return;
      if (app.status === 'APPROVED') {
        const role = await marketing.grantPartnerRole(w.deps, app.id);
        w.log.info({ applicationId: app.id, role }, 'partner role step');
      }
      if (await marketing.decisionDmAlreadySent(w.deps.db, app.id)) return;
      const cfg = await getGuildConfig(w.deps.db, app.guildId);
      const dm = await w.deps.discord.sendDm(app.applicantId, { embeds: [marketing.partnerDecisionEmbed(app, cfg.supportUrl)] });
      await marketing.markDecisionDmSent(w.deps, app, dm !== null);
    },
  },
  periodic: [
    {
      name: 'marketing.engagement-refresh',
      intervalMs: 60 * 60_000,
      async run(w, now) {
        const updated = await refreshEngagement(w, now);
        w.log.info({ updated }, 'announcement engagement refreshed');
      },
    },
  ],
};
