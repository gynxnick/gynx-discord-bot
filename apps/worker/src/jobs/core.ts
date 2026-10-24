import type { WorkerModule } from '../framework/types';

const DAY = 86_400_000;

/** Housekeeping that belongs to no feature module. */
export const coreJobs: WorkerModule = {
  name: 'core',
  periodic: [
    {
      name: 'core.housekeeping',
      intervalMs: 60 * 60_000,
      async run(w, now) {
        const { db } = w.deps;
        // Finished jobs (incl. periodic buckets) are kept 7 days; dead letters 30 days for investigation.
        const jobs = await db.scheduledJob.deleteMany({
          where: {
            OR: [
              { status: { in: ['DONE', 'CANCELLED'] }, updatedAt: { lt: new Date(now.getTime() - 7 * DAY) } },
              { status: 'DEAD', updatedAt: { lt: new Date(now.getTime() - 30 * DAY) } },
            ],
          },
        });
        const sessions = await db.dashboardSession.deleteMany({
          where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
        });
        w.log.info({ jobs: jobs.count, sessions: sessions.count }, 'housekeeping complete');
      },
    },
  ],
};
