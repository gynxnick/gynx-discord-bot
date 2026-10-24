import { troubleshooting } from '@gynx/services';
import type { WorkerModule } from '../framework/types';

export const troubleshootingJobs: WorkerModule = {
  name: 'troubleshooting',
  handlers: {},
  periodic: [
    {
      /**
       * Retention + housekeeping (idempotent; safe to run repeatedly):
       *  - diagnostic excerpts/evidence are purged at expiresAt; records deleted 30 days later
       *  - troubleshooting sessions idle for 24h are marked ABANDONED
       */
      name: 'troubleshooting.retention',
      intervalMs: 15 * 60_000,
      async run(w, now) {
        const guildId = w.env.DISCORD_GUILD_ID;
        const diagnostics = await troubleshooting.purgeExpiredDiagnostics(w.deps.db, guildId, now);
        const abandoned = await troubleshooting.abandonIdleSessions(w.deps.db, guildId, now);
        w.log.info({ ...diagnostics, abandoned }, 'troubleshooting retention applied');
      },
    },
  ],
};
