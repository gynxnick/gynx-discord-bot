import { getGuildConfig, security } from '@gynx/services';
import type { WorkerModule } from '../framework/types';

const reportId = (payload: unknown) => (payload as { reportId?: string }).reportId ?? '';

export const securityJobs: WorkerModule = {
  name: 'security',
  handlers: {
    /** Post a private staff notification for a new report (idempotent via dedupeKey). */
    async 'security.report.notify'(job, w) {
      const r = await w.deps.db.abuseReport.findUnique({ where: { id: reportId(job.payload) } });
      if (!r) return; // deleted by retention
      const cfg = await getGuildConfig(w.deps.db, r.guildId);
      if (!cfg.securityChannelId) {
        w.log.warn({ guildId: r.guildId }, 'no security channel configured; report visible in dashboard only');
        return;
      }
      await w.deps.discord.sendMessage(cfg.securityChannelId, {
        embeds: [security.reportNotificationEmbed(r)],
        components: security.reportStaffButtons(r, w.env.DASHBOARD_URL),
      });
    },

    /** Tell the reporter their report was reviewed (no details about outcomes for others). */
    async 'security.report.reporter-update'(job, w) {
      const r = await w.deps.db.abuseReport.findUnique({ where: { id: reportId(job.payload) } });
      if (!r || r.reporterNotifiedAt) return;
      await w.deps.discord.sendDm(r.reporterId, { embeds: [security.reporterUpdateEmbed(r)] });
      await w.deps.db.abuseReport.update({ where: { id: r.id }, data: { reporterNotifiedAt: w.deps.now() } });
    },
  },
  periodic: [
    {
      name: 'security.retention',
      intervalMs: 6 * 60 * 60_000,
      async run(w, now) {
        const guildId = w.env.DISCORD_GUILD_ID;
        const reports = await security.purgeExpiredReports(w.deps.db, guildId, now);
        const auditEvents = await security.purgeExpiredAuditEvents(w.deps.db, guildId, now);
        w.log.info({ reports, auditEvents }, 'security retention applied');
      },
    },
  ],
};
