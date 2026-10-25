import { support } from '@gynx/services';
import type { WorkerModule } from '../framework/types';

/** Support status panel (public, availability only, no tickets) and the private staff duty panel. */
export const supportJobs: WorkerModule = {
  name: 'support',
  handlers: {
    /** Re-render the public panel right after a duty change. Idempotent (edits only on change). */
    async [support.SYNC_JOB](job, w) {
      const guildId = job.guildId ?? w.env.DISCORD_GUILD_ID;
      const result = await support.syncSupportPanel(w.deps, guildId, w.deps.now());
      if (result !== 'unchanged' && result !== 'disabled') w.log.info({ result }, 'support panel synced');
      const duty = await support.syncDutyControlPanel(w.deps, guildId, w.deps.now());
      if (duty !== 'unchanged' && duty !== 'disabled') w.log.info({ result: duty }, 'duty panel synced');
    },
  },
  periodic: [
    {
      // Ends sessions past their maximum length, then keeps the panel in sync (also
      // repairs a deleted panel and applies channel/website/text changes).
      name: 'support.duty',
      intervalMs: 60_000,
      async run(w, now) {
        const guildId = w.env.DISCORD_GUILD_ID;
        const expired = await support.expireDutySessions(w.deps.db, guildId, now);
        if (expired) w.log.info({ expired }, 'duty sessions expired');
        await support.syncSupportPanel(w.deps, guildId, now);
        await support.syncDutyControlPanel(w.deps, guildId, now);
      },
    },
  ],
};
