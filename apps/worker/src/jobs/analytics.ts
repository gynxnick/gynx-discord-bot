import { REST } from '@discordjs/rest';
import { Routes, type APIMessage } from 'discord-api-types/v10';
import { NO_MENTIONS, analytics, getGuildConfig, isModuleEnabled } from '@gynx/services';
import { dateKeyInZone, isValidTimeZone } from '@gynx/shared';
import type { WorkerCtx, WorkerModule } from '../framework/types';

/**
 * Report delivery uses @discordjs/rest directly because DiscordPort.sendMessage has no
 * file support: one message = summary embed + the full Markdown report as a `.md`
 * attachment. Mentions are always disabled.
 */
export function restReportSender(token: string): analytics.ReportSender {
  const rest = new REST({ version: '10', timeout: 30_000, retries: 3 }).setToken(token);
  return async (channelId, body, file) => {
    const msg = (await rest.post(Routes.channelMessages(channelId), {
      body: { ...body, allowed_mentions: NO_MENTIONS, attachments: [{ id: 0, filename: file.name }] },
      files: [{ name: file.name, data: file.data, contentType: 'text/markdown' }],
    })) as APIMessage;
    return { id: msg.id };
  };
}

export interface AnalyticsJobsOptions {
  /** Override the report sender (tests). Defaults to a REST sender using DISCORD_BOT_TOKEN. */
  reportSender?: (w: WorkerCtx) => analytics.ReportSender;
}

const reportIdOf = (payload: unknown) => (payload as { reportId?: string }).reportId ?? '';

export function createAnalyticsJobs(options: AnalyticsJobsOptions = {}): WorkerModule {
  let cached: analytics.ReportSender | undefined;
  const senderFor = (w: WorkerCtx) => {
    if (options.reportSender) return options.reportSender(w);
    cached ??= restReportSender(w.env.DISCORD_BOT_TOKEN);
    return cached;
  };

  return {
    name: 'analytics',
    handlers: {
      /** Deliver a generated report. Retries (with backoff) re-run delivery only — never generation. */
      async [analytics.DELIVER_JOB](job, w) {
        const outcome = await analytics.deliverReport(w.deps.db, reportIdOf(job.payload), senderFor(w), { now: w.deps.now(), dashboardUrl: w.env.DASHBOARD_URL });
        if (outcome === 'no-channel') w.log.warn({ reportId: reportIdOf(job.payload) }, 'report generated but no report channel configured');
      },
    },
    periodic: [
      {
        name: 'analytics.daily-rollup',
        intervalMs: 60 * 60_000,
        async run(w, now) {
          const guildId = w.env.DISCORD_GUILD_ID;
          const cfg = await getGuildConfig(w.deps.db, guildId);
          const tz = isValidTimeZone(cfg.timezone) ? cfg.timezone : 'UTC';
          const days = await analytics.runDailyRollup(w.deps.db, guildId, tz, now);
          const purged = await analytics.purgeExpiredActivity(w.deps.db, guildId, dateKeyInZone(now, tz), cfg.activityRetentionDays);
          w.log.debug({ days, purged }, 'analytics rollup done');
        },
      },
      {
        name: 'analytics.reports',
        intervalMs: 5 * 60_000,
        async run(w, now) {
          const guildId = w.env.DISCORD_GUILD_ID;
          if (!(await isModuleEnabled(w.deps.db, guildId, 'analytics'))) return;
          const results = await analytics.runDueReports(w.deps.db, guildId, now, {
            enabled: w.env.WEEKLY_REPORT_ENABLED,
            day: w.env.WEEKLY_REPORT_DAY,
            time: w.env.WEEKLY_REPORT_TIME,
            defaultTimezone: w.env.DEFAULT_TIMEZONE,
          });
          if (results.length) w.log.info({ results }, 'analytics reports generated');
        },
      },
    ],
  };
}

export const analyticsJobs: WorkerModule = createAnalyticsJobs();
