import { isModuleEnabled, updates } from '@gynx/services';
import type { WorkerModule } from '../framework/types';

/** Update feed: posts stored GitHub deliveries to the staff and public channels. */
export const updatesJobs: WorkerModule = {
  name: 'updates',
  handlers: {
    /** Idempotent: message ids are stored per channel, so a retry never reposts. */
    async [updates.POST_JOB](job, w) {
      const eventId = (job.payload as { eventId?: unknown } | null)?.eventId;
      if (typeof eventId !== 'string') {
        w.log.warn({ jobId: job.id }, 'updates.post: job without an event id');
        return;
      }
      const guildId = job.guildId ?? w.env.DISCORD_GUILD_ID;
      if (!(await isModuleEnabled(w.deps.db, guildId, 'updates'))) {
        await w.deps.db.updateFeedEvent.updateMany({
          where: { id: eventId, status: 'PENDING' },
          data: { status: 'SKIPPED' },
        });
        w.log.info({ eventId }, 'update feed module disabled; delivery skipped');
        return;
      }
      const result = await updates.postUpdateEvent(w.deps, eventId);
      w.log.info({ eventId, ...result }, 'update feed delivery processed');
    },
  },
};
